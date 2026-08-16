/**
 * Pure helpers shared by the bridge and unit tests. No I/O, no state.
 */

export const APPROVAL_YES = /^\s*(同意|允许|批准|approve|yes|ok|y|1)\s*$/i
export const APPROVAL_NO = /^\s*(拒绝|不同意|拒绝批准|deny|reject|no|n|0)\s*$/i

/** Split text into chunks of at most maxChars, preferring whitespace breaks. */
export function chunkText(text, maxChars) {
  if (text.length <= maxChars) return [text]
  const chunks = []
  let rest = text
  while (rest.length > maxChars) {
    let cut = maxChars
    const space = rest.lastIndexOf(' ', maxChars)
    if (space > maxChars * 0.6) cut = space + 1 // keep the separator so chunks join losslessly
    chunks.push(rest.slice(0, cut))
    rest = rest.slice(cut).trim()
  }
  if (rest) chunks.push(rest)
  return chunks
}

/** Extract the joined text of an assistant/message event payload. */
export function textOfAssistantMessage(eventData) {
  const blocks = eventData?.message?.content
  if (!Array.isArray(blocks)) return ''
  return blocks
    .filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('')
    .trim()
}

/** Parse a Feishu text message content JSON into its plain text. */
export function parseTextContent(message) {
  try {
    const parsed = JSON.parse(message.content)
    return typeof parsed.text === 'string' ? parsed.text : ''
  } catch {
    return ''
  }
}

/** Remove Feishu mention placeholders (@_user_1) from a message. */
export function stripMentionTokens(text) {
  return text.replace(/@_user_\d+/g, '').replace(/\s+/g, ' ').trim()
}

/** Appendable text of one StreamChunk ('' for non-text deltas). */
export function streamTextDelta(chunk) {
  return chunk?.type === 'text-delta' && typeof chunk.text === 'string' ? chunk.text : ''
}

/**
 * Card JSON for a Feishu cardkit streaming card (typewriter effect). The card
 * is created via POST /open-apis/cardkit/v1/cards, sent with msg_type
 * 'interactive', updated via PUT .../cards/:card_id/elements/:element_id/content,
 * and closed via PUT .../cards/:card_id/settings.
 */
export function buildStreamCardJson({ title = '🤖 DSH 回复', content = '', elementId = 'md_1' } = {}) {
  return {
    schema: '2.0',
    header: { title: { tag: 'plain_text', content: title } },
    config: {
      streaming_mode: true,
      summary: { content: '' },
      streaming_config: {
        print_frequency_ms: { default: 50, android: 50, ios: 50, pc: 50 },
        print_step: { default: 2, android: 2, ios: 2, pc: 2 },
      },
    },
    body: { elements: [{ tag: 'markdown', content, element_id: elementId }] },
  }
}

/** One question answer from a Feishu reply: exact option label, option number, or custom text. */
export function answerFor(item, value) {
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

/**
 * Parse a Feishu reply into AskUserQuestionAnswer. Accepts "1: …; 2: …" per
 * line/semicolon, or falls back to treating the whole text as the answer to a
 * single question. Returns null when nothing could be matched.
 */
export function parseQuestionAnswer(text, questions) {
  if (!Array.isArray(questions) || questions.length === 0) return null
  const answers = []
  let matched = false
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
      answers.push(answerFor(item, value))
    }
  } else if (questions.length === 1) {
    matched = true
    answers.push(answerFor(questions[0], text))
  }
  return matched ? { answers } : null
}
