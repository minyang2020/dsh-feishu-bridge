/**
 * DSH-only smoke test: creates a session, sends a prompt, and waits for the
 * assistant's final reply over the mux stream. No Feishu involved.
 * Run: npm run smoke:dsh
 */
import { randomUUID } from 'node:crypto'
import { loadConfig } from '../src/config.js'
import { DshClient } from '../src/dsh-client.js'

const config = loadConfig()
const dsh = new DshClient(config.dshBaseUrl, { log: (m) => console.log(`[dsh] ${m}`) })

const prompt = process.argv[2] || '你好,请用一句话介绍你自己。'

async function main() {
  const describe = await dsh.call('host.describe', {})
  console.log(`host: v${describe.version} cwd=${describe.cwd} model=${describe.model ?? describe.provider}`)

  const created = await dsh.call('session.create', { cwd: config.dshSessionCwd })
  const sessionId = created.sessionId
  console.log(`created session ${sessionId}`)

  const reply = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      dsh.closeMux()
      reject(new Error('timed out waiting for assistant reply (180s)'))
    }, 180_000)

    dsh.mux((frame) => {
      if (frame.type !== 'server-request') return
      const payload = frame.payload
      if (payload.type !== 'session/event' || payload.sessionId !== sessionId) return
      const event = payload.event
      switch (event.type) {
        case 'user/message':
          console.log(`[event] user/message accepted`)
          break
        case 'turn/start':
          console.log(`[event] turn/start turn=${event.data.turn}`)
          break
        case 'assistant/message': {
          const text = (event.data.message?.content ?? [])
            .filter(b => b?.type === 'text')
            .map(b => b.text)
            .join('')
            .trim()
          console.log(`[event] assistant/message (${text.length} chars)`)
          clearTimeout(timer)
          dsh.closeMux()
          resolve(text)
          break
        }
        default:
          break
      }
    })

    void dsh.call('session.prompt', {
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: prompt }],
    }).catch(reject)
  })

  console.log('\n===== assistant reply =====')
  console.log(reply)
  console.log('===========================')
  console.log(`\nsmoke OK (session ${sessionId})`)
}

main().catch((err) => {
  console.error(`smoke FAILED: ${err.stack ?? err}`)
  process.exit(1)
})
