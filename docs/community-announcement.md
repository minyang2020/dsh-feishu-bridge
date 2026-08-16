# [分享] dsh-feishu-bridge:在飞书里直接和你的 DSH Agent 对话

大家好,分享一个自用的飞书桥接器,现在开源出来了,欢迎试用和反馈。

## 这是什么

`dsh-feishu-bridge` 是一个独立旁路进程:把飞书自建应用(长连接模式)和本机正在运行的 `dsh web` 对接起来。飞书里私聊机器人或群里 @机器人,消息就会进入一个 DSH Agent 会话,Agent 的回复、**审批请求**、**提问**都会实时回到飞书。

- 私聊按用户绑定独立会话,上下文连续互不干扰
- 群聊只有 @机器人 才响应
- 长连接收发,**无需公网端口**
- 也可作为 dsh bundle 插件安装:`dsh plugin add github:<you>/dsh-feishu-bridge`

## 快速体验

```powershell
git clone <repo-url>
cd dsh-feishu-bridge
npm install
copy .env.example .env   # 填飞书 App ID/Secret
npm start
```

飞书开放平台配置清单在 README 里,大约 10 分钟(启用机器人 → 3 个权限 → 长连接事件订阅 `im.message.receive_v1` → 发布版本)。

## 说明

- 桥接只访问 DSH 本机 loopback 的 `/api`(与 Web GUI 同一套客户端协议),不侵入宿主
- 已在真实环境验证:私聊/群聊 @、审批、提问转发全链路跑通
- 技术栈:Node.js + `@larksuiteoapi/node-sdk`,零框架依赖

欢迎 Star / Issue / PR。也欢迎大家给 DSH 生态多贡献这种「通道型」集成(Telegram、Slack、企微……思路一样)。
