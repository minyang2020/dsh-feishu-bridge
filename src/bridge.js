/**
 * Bridge core: wires Feishu long-connection events to DSH sessions and DSH
 * mux events back to Feishu, including approval/question forwarding.
 */
import { SessionMap } from './session-map.js'

const APPROVAL_YES = /^(同意|允许|批准|approve|yes|ok|y|1)\s*$/i
const APPROVAL_NO = /^(拒绝|不同意|拒绝批准|deny|reject|no|n|0)\s*$/i

function chunkText(text, maxChars) {
  if (text.length <= maxChars) return [text]
  const chunks = []
  let rest = text
  while (rest.length > maxChars) {
    let cut = maxChars
    const space = rest.lastIndexOf(' ', maxChars)
    if (space > maxChars * 0.6) cut = space
    chunks.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) chunks.push(rest)
  return chunks
}

function textOfAssistantMessage(eventData) {
  const blocks = eventData?.message?.content
  if (!Array.isArray(blocks)) return ''
  return blocks
    .filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('')
    .trim()
}

function parseTextContent(message) {
  try {
    const parsed = JSON.parse(message.content)
    return typeof parsed.text === 'string' ? parsed.text : ''
  } catch {
    return ''
  }
}

function stripMentionTokens(text) {
  return text.replace(/@_user_\d+/g, '').replace(/\s+/g, ' ').trim()
}

export class Bridge {
  constructor({ config, dsh, feishu, log }) {
    this.config = config
    this.dsh = dsh
    this.feishu = feishu
    this.log = log
    this.map = new SessionMap(config.stateDir)
    this.botOpenId = null
    this.botName = null
    this.seenEvents = new Map() // event_id -> timestamp (dedup)
    this.token = null
    this.tokenExpiresAt = 0
  }

  async start() {
    await this.fetchBotIdentity()
    this.dsh.mux(frame => this.handleMuxFrame(frame))
    this.log(`bridge ready: bot="${this.botName}" (${this.botOpenId})`)
  }

  // ---------------------------------------------------------------- Feishu API

  async getTenantToken() {
    if (this.token && Date.now() < this.tokenExpiresAt) return this.token
    const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: this.config.feishuAppId, app_secret: this.config.feishuAppSecret }),
    })
    const json = await res.json()
    if (json.code !== 0) {
      throw new Error(`tenant_access_token ${json.code}: ${json.msg}`)
    }
    this.token = json.tenant_access_token
    this.tokenExpiresAt = Date.now() + (json.expire - 60) * 1000
    return this.token
  }

  async fetchBotIdentity() {
    const token = await this.getTenantToken()
    const res = await fetch('https://open.feishu.cn/open-apis/bot/v3/info', {
      headers: { Authorization: `Bearer ${token}` },
    })
    const json = await res.json()
    if (json.code !== 0) {
      throw new Error(`bot info ${json.code}: ${json.msg}`)
    }
    this.botOpenId = json.bot.open_id
    this.botName = json.bot.app_name
  }

  isBotMentioned(mentions) {
    if (!Array.isArray(mentions) || mentions.length === 0) return false
    return mentions.some((mention) => {
      const id = mention?.id?.open_id
      if (id && id === this.botOpenId) return true
      if (mention?.mentioned_type === 'app') return true
      if (this.botName && mention?.name && mention.name.includes(this.botName)) return true
      return false
    })
  }

  isDuplicate(eventId) {
    if (!eventId) return false
    const now = Date.now()
    for (const [id, ts] of this.seenEvents) {
      if (now - ts > 10 * 60 * 1000) this.seenEvents.delete(id)
    }
    if (this.seenEvents.has(eventId)) return true
    this.seenEvents.set(eventId, now)
    return false
  }

  async sendText(chat, text, { replyTo = null } = {}) {
    const chunks = chunkText(text, this.config.replyChunkChars)
    if (chunks.length === 0) return
    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i]
      const useReply = i === 0 && replyTo !== null
      try {
        if (useReply) {
          const result = await this.feishu.im.message.reply({
            path: { message_id: replyTo },
            data: { msg_type: 'text', content: JSON.stringify({ text: chunk }) },
          })
          if (result.code !== 0) throw new Error(`feishu reply ${result.code}: ${result.msg}`)
          this.log(`feishu reply ok (${text.length} chars)`)
        } else {
          await this.createText(chat.chatId, chunk)
        }
      } catch (err) {
        if (useReply) {
          // Thread reply failed (stale id, message not visible); fall back to a plain message.
          try {
            await this.createText(chat.chatId, chunk)
          } catch (err2) {
            this.log(`feishu send failed: ${err.message}; fallback also failed: ${err2.message}`)
          }
        } else {
          this.log(`feishu send failed: ${err.message}`)
        }
      }
    }
  }

  async createText(chatId, text) {
    const result = await this.feishu.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: { receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text }) },
    })
    if (result.code !== 0) throw new Error(`feishu create ${result.code}: ${result.msg}`)
    this.log(`feishu send ok (chat ${chatId.slice(0, 8)}…, ${text.length} chars)`)
    return result
  }

  // ---------------------------------------------------------------- Feishu -> DSH

  async handleFeishuMessage(data) {
    try {
      const { sender, message } = data
      if (!message || !message.message_id) return
      if (this.isDuplicate(data.event_id)) return
      if (sender?.sender_type === 'app') return // our own bot echo

      const chatType = message.chat_type
      const chatId = message.chat_id
      const openId = sender?.sender_id?.open_id
      if (chatType !== 'p2p' && chatType !== 'group') return

      // Group: respond only when the bot is @-mentioned.
      if (chatType === 'group' && !this.isBotMentioned(message.mentions)) return

      if (message.message_type !== 'text') {
        if (chatType === 'p2p') {
          await this.sendText({ chatId }, '目前只支持文本消息(图片/文件暂不支持)。', { replyTo: message.message_id })
        }
        return
      }

      const text = stripMentionTokens(parseTextContent(message))
      if (!text) return

      const chatKey = SessionMap.chatKey(chatType, chatType === 'p2p' ? openId : chatId)
      const chat = { chatId, kind: chatType }

      // A pending approval/question in this chat resolves with this reply.
      const pending = this.map.takePending(chatKey)
      if (pending) {
        await this.resolvePending(pending, text, chat, message.message_id)
        return
      }

      if (text === '/stop') {
        const sessionId = this.map.sessionFor(chatKey)
        if (sessionId) {
          await this.dsh.call('session.cancel', { sessionId })
        }
        await this.sendText(chat, '已停止当前任务。', { replyTo: message.message_id })
        return
      }

      let sessionId = this.map.sessionFor(chatKey)
      if (!sessionId) {
        const created = await this.dsh.call('session.create', {
          cwd: this.config.dshSessionCwd,
        })
        sessionId = created.sessionId
        this.map.bind(chatKey, sessionId, chatId, chatType)
        this.log(`bound ${chatKey} -> session ${sessionId}`)
      }

      this.map.setLastMessageId(sessionId, message.message_id)
      await this.sendText(chat, '收到,正在处理…', { replyTo: message.message_id })

      const accepted = await this.dsh.call('session.prompt', {
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text }],
      })
      if (!accepted.accepted) {
        await this.sendText(chat, '消息未能被接受,请稍后重试。', { replyTo: message.message_id })
      }
    } catch (err) {
      this.log(`handleFeishuMessage failed: ${err instanceof Error ? err.stack : String(err)}`)
    }
  }

  async resolvePending(pending, text, chat, messageId) {
    if (pending.kind === 'approval') {
      if (APPROVAL_YES.test(text)) {
        await this.dsh.respond(pending.rpcId, {
          sessionId: pending.sessionId,
          approvalId: pending.approvalId,
          outcome: 'allowed-once',
        })
      } else if (APPROVAL_NO.test(text)) {
        await this.dsh.respond(pending.rpcId, {
          sessionId: pending.sessionId,
          approvalId: pending.approvalId,
          outcome: 'rejected',
        })
      } else {
        this.map.setPending(this.chatKeyOf(chat, pending.sessionId), pending)
        await this.sendText(chat, '未识别你的答复,请回复「同意」或「拒绝」。', { replyTo: messageId })
      }
      return
    }
    if (pending.kind === 'question') {
      const answer = this.parseQuestionAnswer(text, pending.questions)
      if (answer) {
        await this.dsh.respond(pending.rpcId, {
          sessionId: pending.sessionId,
          answer,
        })
      } else {
        this.map.setPending(this.chatKeyOf(chat, pending.sessionId), pending)
        await this.sendText(chat, '未识别你的答复,请按提示格式回复。', { replyTo: messageId })
      }
    }
  }

  chatKeyOf(chat, sessionId) {
    // Rebuild the chatKey from the bound chat record (kind tells the id source).
    const record = this.map.chatFor(sessionId)
    if (record) return SessionMap.chatKey(record.kind, record.chatId)
    return SessionMap.chatKey(chat.kind, chat.chatId)
  }

  parseQuestionAnswer(text, questions) {
    if (!Array.isArray(questions) || questions.length === 0) return null
    const answers = []
    let matched = false
    // Format "1: text" / "1: text; 2: text" per line or semicolon-separated.
    const lines = text.split(/[;\n]/).map(line => line.trim()).filter(Boolean)
    const byNumber = []
    for (const line of lines) {
      const m = line.match(/^(\d+)\s*[:：]\s*(.+)$/)
      if (m) byNumber.push({ index: Number(m[1]) - 1, value: m[2] })
    }
    if (byNumber.length > 0) {
      for (const { index, value } of byNumber) {
        const item = questions[index]
        if (!item) continue
        matched = true
        answers.push(this.answerFor(item, value))
      }
    } else {
      // Fallback: single question, whole text is the answer.
      const item = questions[0]
      if (questions.length === 1) {
        matched = true
        answers.push(this.answerFor(item, text))
      }
    }
    return matched ? { answers } : null
  }

  answerFor(item, value) {
    const options = item.options ?? []
    const trimmed = value.trim()
    const exact = options.findIndex(opt => opt.label === trimmed)
    if (exact !== -1) {
      return { id: item.id, selected: [options[exact].label] }
    }
    const numbered = trimmed.match(/^(\d+)$/)
    if (numbered) {
      const at = Number(numbered[1]) - 1
      if (options[at]) return { id: item.id, selected: [options[at].label] }
    }
    return { id: item.id, selected: [], custom: trimmed }
  }

  // ---------------------------------------------------------------- DSH -> Feishu

  handleMuxFrame(frame) {
    if (!frame || frame.type !== 'server-request') return
    const payload = frame.payload
    switch (payload.type) {
      case 'session/event':
        this.handleSessionEvent(payload)
        break
      case 'approval/requested':
        this.handleApprovalRequested(frame.rpcId, payload)
        break
      case 'question/requested':
        this.handleQuestionRequested(frame.rpcId, payload)
        break
      default:
        break
    }
  }

  handleSessionEvent(payload) {
    const sessionId = payload.sessionId
    const event = payload.event
    if (!event) return
    if (event.type === 'assistant/message') {
      const text = textOfAssistantMessage(event.data)
      if (!text) return
      void this.deliverReply(sessionId, text)
    }
  }

  async deliverReply(sessionId, text) {
    try {
      const chat = this.map.chatFor(sessionId)
      if (!chat) return
      await this.sendText(chat, text, { replyTo: this.map.lastMessageId(sessionId) })
    } catch (err) {
      this.log(`deliverReply failed: ${err.message}`)
    }
  }

  handleApprovalRequested(rpcId, payload) {
    const chat = this.map.chatFor(payload.sessionId)
    if (!chat) return
    const chatKey = SessionMap.chatKey(chat.kind, chat.chatId)
    this.map.setPending(chatKey, {
      rpcId,
      kind: 'approval',
      sessionId: payload.sessionId,
      approvalId: payload.approvalId,
    })
    const lines = [
      '⚠️ Agent 请求权限确认',
      `工具: ${payload.toolName}`,
    ]
    if (payload.reason) lines.push(`原因: ${payload.reason}`)
    lines.push('', '请回复「同意」或「拒绝」。')
    void this.sendText(chat, lines.join('\n'), { replyTo: this.map.lastMessageId(payload.sessionId) })
  }

  handleQuestionRequested(rpcId, payload) {
    const chat = this.map.chatFor(payload.sessionId)
    if (!chat) return
    const chatKey = SessionMap.chatKey(chat.kind, chat.chatId)
    this.map.setPending(chatKey, {
      rpcId,
      kind: 'question',
      sessionId: payload.sessionId,
      questions: payload.questions,
    })
    const lines = ['❓ Agent 提问:']
    payload.questions.forEach((item, i) => {
      lines.push(`${i + 1}) ${item.question}`)
      if (item.detail) lines.push(`   ${item.detail}`)
      ;(item.options ?? []).forEach((opt, j) => {
        lines.push(`   ${String.fromCharCode(97 + j)}) ${opt.label}`)
      })
    })
    lines.push('', '回复格式:单问直接回复内容或选项序号;多问用「1: …; 2: …」。')
    void this.sendText(chat, lines.join('\n'), { replyTo: this.map.lastMessageId(payload.sessionId) })
  }
}
