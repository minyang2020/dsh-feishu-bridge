/**
 * Chat <-> DSH session mapping plus per-chat pending interactions
 * (approvals / questions awaiting a Feishu answer), persisted as JSON.
 */
import fs from 'node:fs'
import path from 'node:path'

export class SessionMap {
  constructor(stateDir) {
    this.file = path.join(stateDir, 'mapping.json')
    this.data = {
      /** chatKey -> { sessionId, chatId, kind: 'p2p'|'group' } */
      chats: {},
      /** sessionId -> chatKey (derived index, persisted for transparency) */
      sessions: {},
      /** chatKey -> { rpcId, kind:'approval'|'question', sessionId, approvalId?, questions? } */
      pending: {},
      /** sessionId -> last Feishu message_id we replied under (threading) */
      lastMessageId: {},
    }
    this.load()
  }

  static chatKey(chatType, id) {
    return chatType === 'p2p' ? `p2p:${id}` : `group:${id}`
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      this.data = { ...this.data, ...raw }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn(`[state] mapping load failed: ${err.message}`)
      }
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = this.file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2))
    fs.renameSync(tmp, this.file)
  }

  sessionFor(chatKey) {
    return this.data.chats[chatKey]?.sessionId ?? null
  }

  chatFor(sessionId) {
    const chatKey = this.data.sessions[sessionId]
    return chatKey ? this.data.chats[chatKey] ?? null : null
  }

  bind(chatKey, sessionId, chatId, kind) {
    this.data.chats[chatKey] = { sessionId, chatId, kind }
    this.data.sessions[sessionId] = chatKey
    this.save()
  }

  setLastMessageId(sessionId, messageId) {
    this.data.lastMessageId[sessionId] = messageId
    this.save()
  }

  lastMessageId(sessionId) {
    return this.data.lastMessageId[sessionId] ?? null
  }

  setPending(chatKey, pending) {
    this.data.pending[chatKey] = pending
    this.save()
  }

  takePending(chatKey) {
    const pending = this.data.pending[chatKey]
    if (pending) {
      delete this.data.pending[chatKey]
      this.save()
    }
    return pending ?? null
  }

  clearPending(chatKey) {
    if (this.data.pending[chatKey]) {
      delete this.data.pending[chatKey]
      this.save()
    }
  }

  allSessionIds() {
    return Object.keys(this.data.sessions)
  }
}
