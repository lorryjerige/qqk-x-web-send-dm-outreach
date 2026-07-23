# QQK X 网页私信触达

[English](README.md)

![许可证：MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![QQK 技能版本](https://img.shields.io/badge/QQK%20skill-v8-19c2ff)
![是否需要 X API](https://img.shields.io/badge/X%20API-%E4%B8%8D%E9%9C%80%E8%A6%81-22a06b)

这是一个面向 QQK 的开源 X 私信触达技能。它通过正常的 X Chat 网页界面搜索准确用户，使用键盘事件逐字输入一条私信，只在用户明确批准真实执行后发送，并通过 QQK 任务报告验证页面中可见的发送结果。

它不使用 X API、不依赖 X Pro，也不会拼接私信会话 URL。

![QQK X 私信触达技能工作流程](assets/x-dm-outreach-flow.svg)

## 技能可以做什么

- 通过正常网页入口打开 X Chat。
- 点击页面上可见的 **New message** 或 **New chat**。
- 在收件人搜索框中逐字输入准确的 `@handle`。
- 要求出现准确匹配的用户并点击该结果。
- 使用键盘事件输入消息，而不是粘贴。
- 仅在关闭 QQK 安全演练并明确批准后点击发送。
- 发送前检查当前会话中是否已经存在相同消息，避免重复发送。
- 遇到 X 的 **Unlock more on X** 弹窗时点击 **Got it**，关闭后继续。
- 只有在页面中验证到真实发出的消息后，任务报告才会显示成功。
- 默认保持 BitBrowser Profile 打开。

这个仓库既方便开发者审查源码，也方便 QQK 用户直接找到和使用 X 网页自动化技能。

## 快速开始

### 前置条件

- [免费注册 QQK 账号](https://www.qqk.ai/?utm_source=github&utm_medium=repository&utm_campaign=x_web_send_dm_outreach_zh)
- 安装并运行 QQK Local Admin
- 安装 BitBrowser
- 准备一个已经登录 X 的 BitBrowser Profile

### 在 QQK Local Admin 中运行

1. 登录 QQK 并安装 Local Admin。
2. 打开**技能列表**，同步或启用 **X Web Send DM Outreach / X网页私信触达**。
3. 打开已经登录 X 的 BitBrowser Profile。
4. 在 Local Admin 中打开 **AI 助手**。
5. 预览时保持**安全演练**开启；真实发送时关闭安全演练并批准任务。
6. 使用类似下面的提示词：

```text
请使用 BitBrowser profile“demo-us-1”打开 X Chat，点击新消息，
在搜索框逐字输入 @example_user，点击准确用户结果并发送以下私信：
你好，我看了你最近关于浏览器自动化的分享，很有启发，想进一步交流一下。
不得拼接会话 URL，任务结束保持浏览器打开。
```

`dryRun` 由 QQK AI 助手的安全演练开关统一提供。不要在技能参数里增加 `send`、`publish` 或 `confirmRealRun`。

更多中英文模板见 [examples/prompts.md](examples/prompts.md)。

## 安全演练与真实发送

| 安全演练 | 实际行为 |
| --- | --- |
| 开启 | 打开真实会话、输入消息并截图，但不点击发送。 |
| 关闭 | 要求用户明确批准，点击发送，并且只有页面中验证到发出的消息后才报告成功。 |

技能不会把“点击了发送按钮”直接等同于“发送成功”。

## 任务报告

任务报告提供便于业务检查的结果，包括：

- `businessStatus`
- `recipientHandle`
- `recipientsProcessed`
- `messagesAttempted`
- `messagesSucceeded`
- `sent`
- `alreadySent`
- `messageId`
- `conversationUrl`
- `screenshotPath`
- `closedProfile`

仓库提供了完全虚构和脱敏的[任务报告示例](examples/task-report.sample.json)。请不要在 GitHub Issue 中上传真实客户聊天记录、未脱敏截图或者本机绝对路径。

## 源码结构

```text
.
├── skill/
│   ├── modules/
│   │   ├── cdp-session.mjs
│   │   ├── send-direct-message.mjs
│   │   ├── send-dm-outreach.mjs
│   │   └── x-web-skill-runtime.mjs
│   ├── config.json
│   └── qqk-skill.json
├── docs/
├── examples/
└── tools/
```

JavaScript 模块负责浏览器操作。单步骤 QQK workflow 以可审查形式放在 `skill/qqk-skill.json` 中，正式发布或目录同步后由 QQK Local Admin 保存到工作流数据库。AI 助手生成的多技能编排计划是另一类运行时数据库记录，不包含在这些 `.mjs` 文件中。

具体边界见[架构说明](docs/ARCHITECTURE.md)。

## 开源与运行边界

本仓库源码采用 MIT 许可证。通过官方产品链路运行技能，需要 QQK Local Admin 提供浏览器连接、操作批准、技能注册和任务报告能力。

仓库中的 manifest 用于公开展示并审查已发布技能的完整契约。当前 QQK 用户应从 QQK 技能目录同步正式版本；这里的 manifest 不冒充可以独立双击安装的程序。

## 合理使用

只能在你有权控制的账号上运行，并且只能发送你有权发送的消息。不得用于垃圾消息、骚扰、冒充、欺骗性触达或未经同意的批量私信。使用者需要自行遵守 X 规则和适用法律。

真实运行前请阅读[合理使用说明](docs/RESPONSIBLE_USE.md)和[安全政策](SECURITY.md)。

## 开发与检查

建议使用 Node.js 22 或更高版本：

```bash
npm test
```

该命令只检查 JavaScript 语法、JSON、必需文件、本机绝对路径和常见敏感信息，不会打开浏览器，也不会发送私信。

## 许可证与声明

MIT License，见 [LICENSE](LICENSE)。

本项目与 X Corp. 不存在附属、认可或赞助关系。X 及相关标识归其权利人所有。
