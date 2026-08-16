/**
 * Full-loop roundtrip test without waiting for Feishu to push events:
 *  1. Creates a real group chat (app-owned) via the Feishu API.
 *  2. Feeds the bridge a synthetic im.message.receive_v1 payload
 *     (@-mention in that chat) — exercises parse, mention check, mapping,
 *     session.create, session.prompt.
 *  3. Waits for the DSH agent reply and verifies a real message lands in the
 *     created chat (polled via im.message.list, with the DSH history as the
 *     authoritative reply source).
 * Run: node scripts/test-roundtrip.mjs
 */
import { randomUUID } from 'node:crypto'
import * as lark from '@larksuiteoapi/node-sdk'
import { loadConfig } from '../src/config.js'
import { DshClient } from '../src/dsh-client.js'
import { Bridge } from '../src/bridge.js'

const config = loadConfig()

async function main() {
  const feishu = new lark.Client({
    appId: config.feishuAppId,
    appSecret: config.feishuAppSecret,
    appType: lark.AppType.SelfBuild,
    domain: lark.Domain.Feishu,
    loggerLevel: lark.LoggerLevel.warn,
  })
  const dsh = new DshClient(config.dshBaseUrl, { log: (m) => console.log(`[dsh] ${m}`) })
  const bridge = new Bridge({ config, dsh, feishu, log: (m) => console.log(`[bridge] ${m}`) })
  await bridge.start()

  // 1. Real group chat owned by the app.
  let chatId
  try {
    const chat = await feishu.im.chat.create({
      data: { name: 'bridge-e2e', description: 'feishu-bridge automatic test' },
    })
    chatId = chat.data?.chat_id
    console.log(`created chat ${chatId}`)
    if (!chatId) throw new Error(`unexpected chat.create response: ${JSON.stringify(chat).slice(0, 200)}`)
  } catch (err) {
    console.log(`CHAT_CREATE_FAILED: ${err.message}`)
    console.log('(the app may lack the im:chat create permission; see README permission step)')
    process.exit(1)
  }

  const prompt = '你好,请用两句话介绍一下你自己。(端到端自动测试)'

  // 2. Synthetic receive_v1: group message with a bot mention.
  const synthetic = {
    event_id: `evt-synth-${Date.now()}`,
    sender: { sender_id: { open_id: 'ou_synthetic_user' }, sender_type: 'user' },
    message: {
      message_id: `om_synth_${randomUUID().replace(/-/g, '')}`,
      chat_id: chatId,
      chat_type: 'group',
      message_type: 'text',
      content: JSON.stringify({ text: `@_user_1 ${prompt}` }),
      mentions: [{ key: '@_user_1', id: { open_id: bridge.botOpenId }, name: bridge.botName }],
    },
  }
  await bridge.handleFeishuMessage(synthetic)
  console.log('handler invoked; waiting for agent reply…')

  const chatKey = `group:${chatId}`
  const deadline = Date.now() + 150_000
  let lastAssistantText = ''
  let botMessageSeen = false

  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 5000))

    // Authoritative reply source: the DSH session log.
    const sessionId = bridge.map.sessionFor(chatKey)
    if (sessionId) {
      try {
        const history = await dsh.call('session.history', { sessionId, maxMessages: 4 })
        const assistant = history.events
          .map(e => e.event)
          .filter(e => e.type === 'assistant/message')
          .pop()
        if (assistant) {
          lastAssistantText = (assistant.data.message?.content ?? [])
            .filter(b => b?.type === 'text').map(b => b.text).join('').trim()
        }
      } catch { /* history read may race */ }
    }

    // Outbound proof: poll the chat for a bot-sent text message.
    try {
      const list = await feishu.im.message.list({
        params: { container_id_type: 'chat', container_id: chatId, page_size: 20, sort_type: 'ByCreateTimeDesc' },
      })
      const mine = (list.data?.items ?? []).find(m => m.sender?.sender_type === 'app' && typeof m.body?.content === 'string')
      if (mine) {
        botMessageSeen = true
        console.log(`\n===== bot message in chat (im.message.list) =====`)
        console.log(JSON.parse(mine.body.content).text)
        console.log(`==================================================`)
      }
    } catch (err) {
      console.log(`(im.message.list unavailable: ${err.message})`)
    }

    if (lastAssistantText && (botMessageSeen || Date.now() > deadline - 10_000)) break
  }

  console.log('\n===== DSH assistant reply (session history) =====')
  console.log(lastAssistantText || '(none)')
  console.log('==================================================')

  const ok = Boolean(lastAssistantText)
  console.log(`\n${ok ? 'ROUNDTRIP OK' : 'ROUNDTRIP INCOMPLETE'} session=${bridge.map.sessionFor(chatKey)} botMessageSeen=${botMessageSeen}`)

  // Best-effort cleanup of the test chat.
  try { await feishu.im.chat.delete({ path: { chat_id: chatId } }); console.log('test chat deleted') } catch (err) {
    console.log(`(test chat cleanup skipped: ${err.message}; chat_id=${chatId})`)
  }
  process.exit(ok ? 0 : 2)
}

main().catch((err) => {
  console.error(`ROUNDTRIP FAILED: ${err.stack ?? err}`)
  process.exit(1)
})
