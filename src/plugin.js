/**
 * DSH bundle plugin entry: manages the feishu-bridge child process from
 * inside a dsh host. The bridge core (src/) is unchanged — it talks to the
 * host over its loopback /api like any other client.
 *
 * Install: dsh plugin --profile <name> add github:<you>/dsh-feishu-bridge
 * Configure in the profile's cordis.patch.yml:
 *
 *   - id: feishu-dsh-bridge
 *     config:
 *       appId: cli_xxx
 *       appSecret: xxx
 *       dshBaseUrl: http://127.0.0.1:3200
 *       sessionCwd: D:\workspace
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import z from '@deepseek-ai/schemastery'

export const name = 'feishu-dsh-bridge'

export const Config = z.object({
  /** Set false to load the plugin without starting the bridge. */
  enabled: z.boolean().default(true),
  /** Feishu self-built app id; required when enabled. */
  appId: z.string().default(''),
  /** Feishu self-built app secret; required when enabled. */
  appSecret: z.string().default(''),
  /** DSH host base URL the bridge connects to. */
  dshBaseUrl: z.string().default('http://127.0.0.1:3200'),
  /** Working directory for bridge-created agent sessions. */
  sessionCwd: z.string().default(''),
  /** Reply chunk size in characters. */
  replyChunkChars: z.natural().default(3500),
  /** Stream agent replies as a cardkit typewriter card (falls back when unavailable). */
  streaming: z.boolean().default(true),
  /** Card content update throttle in milliseconds. */
  streamUpdateIntervalMs: z.natural().default(500),
  /** Bridge log level: fatal | error | warn | info | debug | trace. */
  logLevel: z.string().default('info'),
})

export function apply(ctx, config = {}) {
  if (config.enabled === false) return
  if (!config.appId || !config.appSecret) {
    ctx.logger?.warn?.('[feishu-dsh-bridge] appId/appSecret not configured; bridge not started. '
      + 'Set config.appId/config.appSecret in the profile cordis.patch.yml.')
    return
  }
  const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), 'main.js')
  const env = {
    ...process.env,
    FEISHU_APP_ID: config.appId,
    FEISHU_APP_SECRET: config.appSecret,
    DSH_BASE_URL: config.dshBaseUrl,
    DSH_SESSION_CWD: config.sessionCwd || '',
    REPLY_CHUNK_CHARS: String(config.replyChunkChars),
    STREAMING: config.streaming ? 'true' : 'false',
    STREAM_UPDATE_INTERVAL_MS: String(config.streamUpdateIntervalMs),
    LOG_LEVEL: config.logLevel,
  }
  const child = spawn(process.execPath, [entry], { env, stdio: 'inherit' })
  child.on('exit', (code, signal) => {
    ctx.logger?.warn?.(`[feishu-dsh-bridge] bridge exited (code=${code} signal=${signal ?? ''}); host continues.`)
  })
  ctx.effect(() => () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
  }, 'feishu-dsh-bridge.child')
}
