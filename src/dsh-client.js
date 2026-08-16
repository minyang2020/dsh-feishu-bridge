/**
 * Minimal DeepSeek Harness client: unary JSON-RPC over HTTP plus the
 * all-session mux event stream over WebSocket, with reconnect.
 *
 * Wire protocol (from @deepseek-ai/dsh-host-apiproxy):
 *  - Client -> host: POST /api/<method>  body { type:'client-request', rpcId, method, payload }
 *  - Host -> client:  { type:'server-response', rpcId, result:{ok:true,value}|{ok:false,error} }
 *  - Pushes:          WS /api/events.mux  frame { type:'server-request', rpcId, method, payload }
 *  - Answer to a server-request: POST /api/respond body { type:'client-response', rpcId, result }
 */
import { randomUUID } from 'node:crypto'

export class DshRpcError extends Error {
  constructor(error) {
    super(`dsh rpc ${error.code}: ${error.message}`)
    this.name = 'DshRpcError'
    this.code = error.code
    this.details = error.details
  }
}

export class DshClient {
  constructor(baseUrl, { log = () => {} } = {}) {
    this.base = baseUrl
    this.log = log
    this.muxSocket = null
    this.muxHandlers = []
    this.muxClosed = false
  }

  async call(method, payload, { attempts = 3, timeoutMs = 60_000 } = {}) {
    const rpcId = randomUUID()
    let lastError
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)
        let response
        try {
          response = await fetch(`${this.base}/api/${method}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
            signal: controller.signal,
          })
        } finally {
          clearTimeout(timer)
        }
        if (!response.ok) {
          throw new Error(`http ${response.status}`)
        }
        const body = await response.json()
        if (body.type !== 'server-response' || body.rpcId !== rpcId) {
          throw new Error('malformed rpc response')
        }
        const result = body.result
        if (result.ok) return result.value
        throw new DshRpcError(result.error)
      } catch (err) {
        lastError = err
        if (err instanceof DshRpcError) throw err // business error: no retry
        if (attempt < attempts) {
          const delay = 250 * 2 ** (attempt - 1)
          this.log(`dsh.call ${method} attempt ${attempt} failed (${err.message}); retrying in ${delay}ms`)
          await new Promise(resolve => setTimeout(resolve, delay))
        }
      }
    }
    throw lastError
  }

  /** Answer a server-request frame (approval / question) by echoing its rpcId. */
  async respond(rpcId, value) {
    const response = await fetch(`${this.base}/api/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'client-response', rpcId, result: { ok: true, value } }),
    })
    if (!response.ok) {
      throw new Error(`respond http ${response.status}`)
    }
    return response.json()
  }

  /**
   * Open (and keep open) the mux event stream. Each incoming frame is
   * dispatched to every registered handler: handler(frame) where frame =
   * { rpcId, method, payload }. Reconnects with capped backoff.
   */
  async mux(handlers) {
    if (Array.isArray(handlers)) this.muxHandlers.push(...handlers)
    else this.muxHandlers.push(handlers)
    if (this.muxSocket) return // already running
    this.muxClosed = false
    void this.muxLoop()
  }

  closeMux() {
    this.muxClosed = true
    if (this.muxSocket) {
      try { this.muxSocket.close() } catch { /* already closed */ }
      this.muxSocket = null
    }
  }

  async muxLoop() {
    let backoff = 500
    while (!this.muxClosed) {
      try {
        await this.muxConnectOnce()
        backoff = 500
      } catch (err) {
        if (this.muxClosed) break
        this.log(`mux disconnected: ${err.message}; reconnecting in ${backoff}ms`)
        await new Promise(resolve => setTimeout(resolve, backoff))
        backoff = Math.min(backoff * 2, 10_000)
      }
    }
  }

  muxConnectOnce() {
    return new Promise((resolve, reject) => {
      const wsUrl = this.base.replace(/^http/, 'ws') + '/api/events.mux'
      const socket = new WebSocket(wsUrl)
      this.muxSocket = socket
      const settled = { value: false }
      const done = (err) => {
        if (settled.value) return
        settled.value = true
        if (err) reject(err)
        else resolve()
      }
      socket.onopen = () => {
        this.log('mux connected')
      }
      socket.onmessage = (event) => {
        let frame
        try {
          frame = JSON.parse(event.data)
        } catch {
          return
        }
        for (const handler of this.muxHandlers) {
          try { handler(frame) } catch (err) { /* handler errors never kill the stream */ }
        }
      }
      socket.onerror = () => {
        done(new Error('mux websocket error'))
      }
      socket.onclose = () => {
        done(new Error('mux websocket closed'))
      }
    })
  }
}
