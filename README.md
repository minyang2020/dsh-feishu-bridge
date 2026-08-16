# feishu-dsh-bridge

> [中文](README.md) | [English](README.en.md)

[![CI](https://github.com/minyang2020/dsh-feishu-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/minyang2020/dsh-feishu-bridge/actions/workflows/ci.yml)

在飞书(Lark)里直接和你的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Agent 对话的双向桥接器。

飞书用户(私聊或群里 @机器人)的消息通过**长连接**(WebSocket,无需公网端口)进入本机正在运行的 DSH(`dsh web`),Agent 的回复、审批请求、提问都会实时回到飞书会话。

```
飞书私聊/@机器人 ──> Feishu 长连接(WSClient) ──> session.prompt ──> DSH Agent 会话
飞书群聊/私聊 <── im.message.reply/create <── mux WS (session/event) <── DSH Agent
```

## 特性

- **私聊按用户**:每个飞书用户自动绑定一个独立 DSH 会话,上下文连续互不干扰
- **群聊按 @**:群里只有 @机器人 才响应,回复发回群里
- **流式输出**:Agent 回复以 cardkit 打字机卡片逐字上屏(cardkit 权限缺失时自动降级为普通回复)
- **审批转发**:Agent 请求权限时飞书收到确认文本,回复「同意/拒绝」即可
- **提问转发**:Agent 提问时按序号/选项格式回复
- **断线重连**:飞书长连接与 DSH 事件流均自动重连
- **零公网依赖**:飞书长连接由本机主动发起,无需开放端口、无需公网 URL

## 环境要求

- Node.js >= 22(在 v24 上验证)
- 正在运行的 DSH:`dsh web`(或任意通过 `client-connection` 插件暴露 `/api` 的 DSH 宿主,默认 `http://127.0.0.1:3200`)
- 飞书企业自建应用(App ID / App Secret)

## 快速开始

```powershell
git clone https://github.com/minyang2020/dsh-feishu-bridge.git
cd dsh-feishu-bridge
npm install
copy .env.example .env      # 填入飞书 App ID / App Secret
npm start
```

### 作为 dsh bundle 插件安装

```powershell
dsh plugin --profile <名字> add feishu-dsh-bridge
```

然后在 profile 的 `cordis.patch.yml` 里配置:

```yaml
- id: feishu-dsh-bridge
  config:
    appId: cli_xxxxxxxxxxxxxxxx
    appSecret: your_app_secret
    dshBaseUrl: http://127.0.0.1:3200
    sessionCwd: D:\workspace
```

> 注:GitHub 仓库名为 `dsh-feishu-bridge`,npm 包名为 `feishu-dsh-bridge`(npm 原名已被占用);两者是同一项目。

配置文件 `.env`:

```
FEISHU_APP_ID=cli_xxxxxxxxxxxxxxxx
FEISHU_APP_SECRET=your_app_secret
DSH_BASE_URL=http://127.0.0.1:3200   # DSH 后端地址
DSH_SESSION_CWD=D:\workspace        # Agent 会话的工作目录
```

## 飞书开放平台配置清单(一次性,约 10 分钟)

1. 打开 [飞书开放平台](https://open.feishu.cn/app) →「创建企业自建应用」。
2. 「凭证与基础信息」:记下 **App ID / App Secret**,填入 `.env`。
3. 「添加应用能力」→ 启用 **机器人**。
4. 「权限管理」→ 开通:
   - `im:message.p2p_msg:readonly` — 读取用户发给机器人的单聊消息
   - `im:message.group_msg:readonly` — 获取群组中所有消息
   - `im:message:send_as_bot` — 以应用的身份发消息
   - `cardkit:card:write` — 流式卡片(可选,缺失时回复自动降级为非流式)
5. 「事件与回调」→「事件订阅」→ 请求方式选 **使用长连接接收事件**(WebSocket,无需公网 URL)→ 添加事件 **`接收消息 im.message.receive_v1`**。
6. 「版本管理与发布」→「创建版本」→「申请发布」。企业内自建应用通常即时生效;若企业开启审核需管理员通过。
7. 使用方式:
   - **私聊**:在飞书搜索应用名,发起单聊。
   - **群聊**:群设置 → 添加机器人 → 把应用加进群,之后 **@机器人** 才响应。

> 权限/事件改动需「发布版本」后才生效;若长连接连不上,先检查第 5、6 步。

## 使用说明

- **`/stop`**:取消当前会话正在进行的任务
- 绑定关系持久化在 `state/mapping.json`(删除该文件可重置绑定)
- **流式输出**(默认开启):`STREAMING=false` 可关闭;`STREAM_UPDATE_INTERVAL_MS` 控制卡片刷新节流(默认 500ms)
- 非流式回复按 `REPLY_CHUNK_CHARS`(默认 3500 字符)分片,首片以回复形式回在原消息下
- 暂不支持图片/文件/富文本消息(会提示仅支持文本)

## 自测脚本

| 脚本 | 用途 | 需要飞书凭据 |
|---|---|---|
| `npm test` | 单元测试 + 语法检查(无需网络) | 否 |
| `npm run smoke:dsh` | 验证 DSH RPC + 事件流(建会话→提问→收回复) | 否 |
| `npm run test:feishu-ws` | 验证飞书长连接可建立 | 是 |
| `npm run test:roundtrip` | 全链路回环(建群→合成入站→Agent 回复→真实出站) | 是 |

> CI(每次 push/PR)运行单元测试和语法检查;DSH/飞书端到端脚本需要真实环境,在本地跑。

## 安全说明

- `.env` 含真实凭据,**已加入 `.gitignore`,切勿提交**
- `state/` 含真实会话绑定信息,同样不提交
- 桥接只监听本机 DSH 的 loopback API;飞书侧凭据按租户隔离

## 社区

- 本仓库打上 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题便于被发现
- 问题/建议欢迎到 [DeepSeek Harness Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) 反馈
- 协议:MIT
