/**
 * Entry point: wires the Feishu long connection (WSClient + EventDispatcher)
 * to the DSH bridge. Run: npm start
 */
import * as lark from '@larksuiteoapi/node-sdk'
import { loadConfig } from './config.js'
import { DshClient } from './dsh-client.js'
import { Bridge } from './bridge.js'

const config = loadConfig()
const level = lark.LoggerLevel[config.logLevel] ?? lark.LoggerLevel.info

function log(message) {
  const time = new Date().toISOString()
  console.log(`[${time}] ${message}`)
}

async function main() {
  const dsh = new DshClient(config.dshBaseUrl, { log })
  const feishu = new lark.Client({
    appId: config.feishuAppId,
    appSecret: config.feishuAppSecret,
    appType: lark.AppType.SelfBuild,
    domain: lark.Domain.Feishu,
    loggerLevel: level,
  })
  const bridge = new Bridge({ config, dsh, feishu, log })

  // Health-check the DSH host first so a wrong base URL fails loudly.
  const describe = await dsh.call('host.describe', {})
  log(`dsh host ${config.dshBaseUrl}: v${describe.version} cwd=${describe.cwd}`)

  const dispatcher = new lark.EventDispatcher({ loggerLevel: level }).register({
    'im.message.receive_v1': (data) => bridge.handleFeishuMessage(data),
  })

  const ws = new lark.WSClient({
    appId: config.feishuAppId,
    appSecret: config.feishuAppSecret,
    domain: lark.Domain.Feishu,
    loggerLevel: level,
    onReady: () => log('feishu long connection ready'),
    onReconnecting: () => log('feishu long connection reconnecting…'),
    onReconnected: () => log('feishu long connection reconnected'),
    onError: (err) => log(`feishu long connection error: ${err.message}`),
  })

  await bridge.start()
  await ws.start({ eventDispatcher: dispatcher })
  log('feishu-bridge running. Press Ctrl+C to stop.')

  const shutdown = () => {
    log('shutting down…')
    dsh.closeMux()
    ws.close()
    setTimeout(() => process.exit(0), 500)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error(`[fatal] ${err instanceof Error ? err.stack : String(err)}`)
  process.exit(1)
})
