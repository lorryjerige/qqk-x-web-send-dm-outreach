# Architecture

## Runtime Flow

```text
QQK AI Assistant
  -> input-schema validation
  -> Safety Rehearsal and explicit approval
  -> published single-step workflow
  -> send-dm-outreach.mjs
  -> send-direct-message.mjs
  -> x-web-skill-runtime.mjs
  -> QQK CDP browser session
  -> visible X Chat UI
  -> task report and screenshots
```

## Module Responsibilities

### `send-dm-outreach.mjs`

The public skill entry point. It delegates the browser operation to the direct-message module and adds outreach-oriented counters:

- `recipientsProcessed`
- `messagesAttempted`
- `messagesSucceeded`

### `send-direct-message.mjs`

Owns the business operation:

- Resolve and open the requested BitBrowser profile
- Open X Chat
- Open the visible recipient search
- Search and require an exact handle
- Open the selected conversation through visible controls
- Type the requested message
- Preview or send according to resolved safety mode
- Verify the visible outgoing message
- Return conservative result fields

### `x-web-skill-runtime.mjs`

Shared X website primitives such as page readiness, visible-element handling, keyboard typing, screenshots, unexpected-dialog handling, and browser-profile lifecycle.

### `cdp-session.mjs`

The minimal Chrome DevTools Protocol connection used by QQK Local Admin. It is included here so the open-source module graph contains no private machine path.

## Workflow and Database Boundary

The `.mjs` modules do not embed the QQK workflow registry row.

`skill/qqk-skill.json` documents the published contract and its single workflow step:

```json
{
  "action": "x_web_send_dm_outreach",
  "exportName": "run"
}
```

During the controlled QQK release process, the skill metadata and workflow payload are uploaded as a draft. After security review and publication, QQK stores the workflow definition in its workflow database and stores the skill contract in its skill registry.

The AI Assistant can separately create multi-skill plans. Those plan steps, bindings, schedules, and results are runtime database records. They are not part of this source package and are not embedded in `send-dm-outreach.mjs`.

## Source Manifest Status

The manifest is provided for transparency, review, and future packaging automation. The supported end-user installation route is currently QQK catalog sync in Local Admin. The repository does not claim that dropping the JSON file into an arbitrary directory registers a skill.

## Side-Effect Model

`dryRun` is controlled by the QQK Safety Rehearsal switch:

- `dryRun=true`: navigate, search, prepare, and capture evidence without sending.
- `dryRun=false`: QQK requires explicit approval before the skill can send.

The public input schema intentionally excludes `send`, `publish`, and `confirmRealRun`.
