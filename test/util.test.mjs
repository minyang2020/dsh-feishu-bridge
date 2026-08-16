import test from 'node:test'
import assert from 'node:assert/strict'
import {
  APPROVAL_NO,
  APPROVAL_YES,
  answerFor,
  buildStreamCardJson,
  chunkText,
  parseQuestionAnswer,
  parseTextContent,
  streamTextDelta,
  stripMentionTokens,
  textOfAssistantMessage,
} from '../src/util.js'

test('chunkText splits long text losslessly within size bounds', () => {
  assert.deepEqual(chunkText('hello', 10), ['hello'])
  const long = 'word '.repeat(100).trim()
  const chunks = chunkText(long, 40)
  assert.ok(chunks.length > 1)
  assert.ok(chunks.every(c => c.length <= 40))
  assert.equal(chunks.join(''), long)
})

test('chunkText cuts at whitespace when available', () => {
  const chunks = chunkText('word '.repeat(100).trim(), 40)
  assert.ok(chunks.slice(0, -1).every(c => c.endsWith(' ')))
  const dense = chunkText('x'.repeat(300), 40)
  assert.equal(dense.length, Math.ceil(300 / 40))
  assert.equal(dense.join(''), 'x'.repeat(300))
})

test('textOfAssistantMessage joins text blocks only', () => {
  const data = {
    message: {
      content: [
        { type: 'text', text: 'a' },
        { type: 'image', imageKey: 'x' },
        { type: 'text', text: ' b' },
      ],
    },
  }
  assert.equal(textOfAssistantMessage(data), 'a b')
  assert.equal(textOfAssistantMessage({ message: { content: [] } }), '')
  assert.equal(textOfAssistantMessage({}), '')
  assert.equal(textOfAssistantMessage({ message: { content: [{ type: 'image' }] } }), '')
})

test('parseTextContent handles text JSON and garbage', () => {
  assert.equal(parseTextContent({ content: '{"text":"hi"}' }), 'hi')
  assert.equal(parseTextContent({ content: 'not json' }), '')
  assert.equal(parseTextContent({ content: '{"foo":1}' }), '')
})

test('stripMentionTokens removes @_user_N placeholders and collapses spaces', () => {
  assert.equal(stripMentionTokens('@_user_1 你好 @_user_2  世界'), '你好 世界')
  assert.equal(stripMentionTokens('  plain  '), 'plain')
})

test('approval regexes accept Chinese and English variants', () => {
  for (const yes of ['同意', '允许', '批准', 'approve', 'yes', 'ok', 'y', '1', ' 同意 ']) {
    assert.ok(APPROVAL_YES.test(yes), `yes should match: ${yes}`)
  }
  for (const no of ['拒绝', '不同意', 'deny', 'reject', 'no', 'n', '0']) {
    assert.ok(APPROVAL_NO.test(no), `no should match: ${no}`)
  }
  assert.ok(!APPROVAL_YES.test('不确定'))
  assert.ok(!APPROVAL_NO.test('maybe'))
})

test('answerFor matches label, number, then custom fallback', () => {
  const item = { id: 'q1', options: [{ label: 'A方案' }, { label: 'B方案' }] }
  assert.deepEqual(answerFor(item, 'A方案'), { id: 'q1', selected: ['A方案'] })
  assert.deepEqual(answerFor(item, '2'), { id: 'q1', selected: ['B方案'] })
  assert.deepEqual(answerFor(item, '自定义内容'), { id: 'q1', selected: [], custom: '自定义内容' })
  assert.deepEqual(answerFor(item, '3'), { id: 'q1', selected: [], custom: '3' })
})

test('parseQuestionAnswer parses numbered multi-answer replies', () => {
  const questions = [
    { id: 'q1', question: '方案?', options: [{ label: 'A' }, { label: 'B' }] },
    { id: 'q2', question: '备注?' },
  ]
  const answer = parseQuestionAnswer('1: B; 2: 随便写写', questions)
  assert.deepEqual(answer, {
    answers: [
      { id: 'q1', selected: ['B'] },
      { id: 'q2', selected: [], custom: '随便写写' },
    ],
  })
})

test('parseQuestionAnswer falls back to whole-text answer for a single question', () => {
  const questions = [{ id: 'q1', question: '你好?' }]
  assert.deepEqual(parseQuestionAnswer('直接回复', questions), {
    answers: [{ id: 'q1', selected: [], custom: '直接回复' }],
  })
  assert.equal(parseQuestionAnswer('', []), null)
})

test('streamTextDelta extracts only text deltas', () => {
  assert.equal(streamTextDelta({ type: 'text-delta', index: 0, text: '你好' }), '你好')
  assert.equal(streamTextDelta({ type: 'text-delta', index: 0, text: '' }), '')
  assert.equal(streamTextDelta({ type: 'block-start', index: 0, blockType: 'text' }), '')
  assert.equal(streamTextDelta({ type: 'tool-call-delta', index: 0, id: 'x', argumentsDelta: '{}' }), '')
  assert.equal(streamTextDelta({ type: 'finish', reason: 'stop' }), '')
  assert.equal(streamTextDelta(undefined), '')
})

test('buildStreamCardJson produces a streaming cardkit card', () => {
  const card = buildStreamCardJson({ title: 'T', content: 'hi', elementId: 'md_9' })
  assert.equal(card.schema, '2.0')
  assert.equal(card.header.title.content, 'T')
  assert.equal(card.config.streaming_mode, true)
  assert.equal(card.config.streaming_config.print_step.default, 2)
  assert.equal(card.body.elements[0].tag, 'markdown')
  assert.equal(card.body.elements[0].content, 'hi')
  assert.equal(card.body.elements[0].element_id, 'md_9')
})
