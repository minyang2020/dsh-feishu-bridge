/**
 * Feishu long-connection smoke test: starts WSClient with an EventDispatcher,
 * waits for onReady (or fails on onError), prints connection status, exits.
 * Run: node scripts/test-feishu-ws.mjs
 */
import * as lark from '@larksuiteoapi/node-sdk'
import { loadConfig } from '../src/config.js'

const config = loadConfig()

async function main() {
  const feishu = new lark.Client({
    appId: config.feishuAppId,
    appSecret: config.feishuAppSecret,
    appType: lark.AppType.SelfBuild,
    domain: lark.Domain.Feishu,
    loggerLevel: lark.LoggerLevel.info,
  })

  const dispatcher = new lark.EventDispatcher({ loggerLevel: lark.LoggerLevel.info }).register({
    'im.message.receive_v1': () => undefined,
  })

  const ws = new lark.WSClient({
    appId: config.feishuAppId,
    appSecret: config.feishuAppSecret,
    domain: lark.Domain.Feishu,
    loggerLevel: lark.LoggerLevel.info,
    onReady: () => {
      console.log('LONG_CONNECTION_READY')
      setTimeout(() => { ws.close(); process.exit(0) }, 2000)
    },
    onError: (err) => {
      console.log('LONG_CONNECTION_ERROR:', err.message)
      process.exit(1)
    },
    onReconnecting: () => console.log('reconnecting…'),
  })

  console.log('starting long connection…')
  try {
    await ws.start({ eventDispatcher: dispatcher })
    console.log('start() resolved; status:', JSON.stringify(ws.getConnectionStatus()))
  } catch (err) {
    console.log('start() failed:', err.message)
    process.exit(1)
  }
  setTimeout(() => {
    console.log('no ready event within 25s; status:', JSON.stringify(ws.getConnectionStatus()))
    process.exit(2)
  }, 25_000)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
