/**
 * Config loader: reads .env (optional) plus process environment.
 * Node >= 21.7 provides process.loadEnvFile.
 */
import { loadEnvFile } from 'node:process'
import path from 'node:path'
import fs from 'node:fs'

const rootDir = path.resolve(import.meta.dirname, '..')

function loadDotEnv() {
  const file = path.join(rootDir, '.env')
  if (!fs.existsSync(file)) return
  try {
    loadEnvFile(file)
  } catch (err) {
    throw new Error(`failed to load .env: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function required(name) {
  const value = process.env[name]
  if (!value || !value.trim()) {
    throw new Error(`missing required env: ${name}`)
  }
  return value.trim()
}

export function loadConfig() {
  loadDotEnv()
  const dshBaseUrl = (process.env.DSH_BASE_URL || 'http://127.0.0.1:3200').replace(/\/+$/, '')
  return {
    feishuAppId: required('FEISHU_APP_ID'),
    feishuAppSecret: required('FEISHU_APP_SECRET'),
    dshBaseUrl,
    dshSessionCwd: process.env.DSH_SESSION_CWD || 'D:\\workspace',
    stateDir: path.join(rootDir, 'state'),
    /** Reply chunk size in characters (Feishu text messages are size-bounded). */
    replyChunkChars: Number(process.env.REPLY_CHUNK_CHARS || 3500),
    logLevel: process.env.LOG_LEVEL || 'info',
  }
}
