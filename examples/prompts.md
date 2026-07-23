# Prompt Examples

Replace all example values before running.

## English Preview

Keep QQK **Safety Rehearsal on**:

```text
Use BitBrowser profile demo-us-1 to open X Chat, click New message,
type @example_user into the visible recipient search, click the exact result,
and prepare this message: Hi! I enjoyed your recent browser automation post.
Do not construct a conversation URL. Keep the profile open when finished.
```

## English Real Send

Turn QQK **Safety Rehearsal off**, review the task card, and explicitly approve:

```text
Use BitBrowser profile demo-us-1 to open X Chat, click New message,
type @example_user into the visible recipient search, click the exact result,
and send this message: Hi! I enjoyed your recent browser automation post.
Do not construct a conversation URL. Keep the profile open when finished.
```

## 中文安全演练

保持 QQK **安全演练开启**：

```text
请使用 BitBrowser profile“demo-us-1”打开 X Chat，点击新消息，
在可见的收件人搜索框逐字输入 @example_user，点击准确用户结果，
准备以下私信：你好，我看了你最近关于浏览器自动化的分享，很有启发。
不得拼接会话 URL，任务结束保持浏览器打开。
```

## 中文真实发送

关闭 QQK **安全演练**，检查任务卡并明确批准：

```text
请使用 BitBrowser profile“demo-us-1”打开 X Chat，点击新消息，
在可见的收件人搜索框逐字输入 @example_user，点击准确用户结果，
发送以下私信：你好，我看了你最近关于浏览器自动化的分享，很有启发。
不得拼接会话 URL，任务结束保持浏览器打开。
```

Do not put `dryRun`, `send`, `publish`, or `confirmRealRun` into a natural-language prompt. The Local Admin Safety Rehearsal and approval controls own that decision.
