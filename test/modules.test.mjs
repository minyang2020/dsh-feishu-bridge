import test from 'node:test'
import assert from 'node:assert/strict'

test('bundle plugin module loads and exposes the cordis contract', async () => {
  const plugin = await import('../src/plugin.js')
  assert.equal(plugin.name, 'feishu-dsh-bridge')
  assert.equal(typeof plugin.apply, 'function')
  assert.equal(typeof plugin.Config, 'function')
})

test('bridge core module loads', async () => {
  const { Bridge } = await import('../src/bridge.js')
  assert.equal(typeof Bridge, 'function')
})
