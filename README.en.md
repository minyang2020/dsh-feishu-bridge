# feishu-dsh-bridge

> [English](README.en.md) | [中文](README.md)

[![CI](https://github.com/minyang2020/dsh-feishu-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/minyang2020/dsh-feishu-bridge/actions/workflows/ci.yml)

A bidirectional bridge that lets you chat with your [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) agent from Feishu (Lark).

Messages sent to the bot (private chat, or @-mention in a group) enter the locally running DSH (`dsh web`) over a **long connection** (WebSocket — no public port, no public URL needed). The agent's replies, approval requests, and questions come right back into the Feishu conversation.

```
Feishu DM / @mention ──> Feishu long connection (WSClient) ──> session.prompt ──> DSH agent session
Feishu group / DM <── im.message.reply/create <── mux WS (session/event) <── DSH agent
```

## Features

- **Per-user private chat**: each Feishu user is bound to its own DSH session with continuous context
- **Group @-mention mode**: the bot only responds when mentioned; replies land in the group
- **Streaming output**: agent replies stream into a cardkit typewriter card (falls back to plain replies when the cardkit permission is missing)
- **Approval forwarding**: when the agent requests a permission, the confirmation appears in Feishu — reply 「同意/拒绝」(approve/reject)
- **Question forwarding**: when the agent asks, answer by number/option
- **Auto-reconnect** for both the Feishu long connection and the DSH event stream
- **Zero public-network dependency**: the long connection is initiated from your machine

Two consumption modes, one codebase:

| Mode | How to run |
|---|---|
| Standalone sidecar | `npm install` + `npm start` (a separate process next to `dsh web`) |
| dsh bundle plugin | `dsh plugin --profile <name> add feishu-dsh-bridge` (spawned and managed by the host) |

## Requirements

- Node.js >= 22 (verified on v24)
- A running DSH: `dsh web` (or any DSH host exposing `/api` via the `client-connection` plugin, default `http://127.0.0.1:3200`)
- A Feishu self-built app (App ID / App Secret)

## Quick start

```bash
git clone https://github.com/minyang2020/dsh-feishu-bridge.git
cd dsh-feishu-bridge
npm install
cp .env.example .env       # fill in your Feishu App ID / App Secret
npm start
```

Configuration (`.env`):

```
FEISHU_APP_ID=cli_xxxxxxxxxxxxxxxx
FEISHU_APP_SECRET=your_app_secret
DSH_BASE_URL=http://127.0.0.1:3200   # DSH backend address
DSH_SESSION_CWD=D:\workspace        # working directory of agent sessions
```

### Install as a dsh bundle plugin

```bash
dsh plugin --profile <name> add feishu-dsh-bridge
```

then configure in the profile's `cordis.patch.yml`:

```yaml
- id: feishu-dsh-bridge
  config:
    appId: cli_xxxxxxxxxxxxxxxx
    appSecret: your_app_secret
    dshBaseUrl: http://127.0.0.1:3200
    sessionCwd: D:\workspace
```

## Feishu Open Platform setup (once, ~10 minutes)

1. Open [Feishu Open Platform](https://open.feishu.cn/app) → create an **enterprise self-built app**.
2. In 「Credentials & Basic Info」, copy **App ID / App Secret** into `.env`.
3. Add the **Bot** capability (「添加应用能力」→「机器人」).
4. In 「Permission Management」, enable:
   - `im:message.p2p_msg:readonly` — read user messages sent to the bot
   - `im:message.group_msg:readonly` — read group messages
   - `im:message:send_as_bot` — send messages as the app
   - `cardkit:card:write` — streaming cards (optional; replies fall back to plain messages when missing)
5. In 「Events & Callbacks」→ event subscription, choose **receive events via long connection** (WebSocket, no public URL needed) and add the event **`im.message.receive_v1`**.
6. In 「Version Management & Release」, create a version and **publish** it. Permission/event changes only take effect after publishing.
7. Usage:
   - **Private chat**: search the app name in Feishu and start a conversation.
   - **Group chat**: add the bot to the group via group settings; afterwards it responds only to **@mentions**.

> Permission/event changes require a published version; if the long connection cannot be established, check steps 5 and 6.

## Usage notes

- `/stop` — cancel the current task of the session
- Bindings persist in `state/mapping.json` (delete the file to reset)
- **Streaming** (on by default): set `STREAMING=false` to disable; `STREAM_UPDATE_INTERVAL_MS` controls the card refresh throttle (default 500ms)
- Non-streaming replies are chunked by `REPLY_CHUNK_CHARS` (default 3500); the first chunk is sent as a thread reply
- Image/file/rich-text messages are not supported yet (a hint is returned)

## Self-test scripts

| Script | Purpose | Needs Feishu credentials |
|---|---|---|
| `npm test` | Unit tests + syntax checks (no network) | no |
| `npm run smoke:dsh` | DSH RPC + event stream (create session → prompt → reply) | no |
| `npm run test:feishu-ws` | Feishu long connection establishment | yes |
| `npm run test:roundtrip` | Full loop (create chat → synthetic inbound → agent reply → real outbound) | yes |

> CI runs the unit tests and syntax checks on every push/PR. The DSH/Feishu E2E scripts need a live DSH host and real credentials, so they run locally.

## Security

- `.env` holds real credentials and is **gitignored — never commit it**
- `state/` holds real session bindings and is not committed either
- The bridge only talks to the DSH loopback API; Feishu credentials are tenant-scoped

## Community

- Topic: [`dsh-plugin`](https://github.com/topics/dsh-plugin)
- Feedback: [DeepSeek Harness Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions)
- License: MIT
