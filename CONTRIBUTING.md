# Contributing

Thank you for helping improve this QQK skill.

## Before Opening an Issue

- Confirm the problem still occurs with the latest released QQK skill version.
- State whether Safety Rehearsal was on or off.
- Include the X Chat UI variant and the stable error code when available.
- Remove handles, message content, cookies, tokens, tenant IDs, local paths, conversation URLs, and screenshots containing private conversations.
- Do not post credentials or an unredacted QQK task report.

## Pull Requests

Keep changes focused and explain the visible browser state being handled. A pull request should:

1. Preserve explicit approval before external state changes.
2. Preserve `closeProfile=false` as the default.
3. Avoid constructed X private-conversation URLs.
4. Prefer visible, deterministic UI state over inferred success.
5. Add or update documentation when behavior or the public contract changes.
6. Pass `npm test`.

Real-send testing must use an account and recipient controlled by the tester. Never send test messages to an unrelated person.

## Scope

This repository contains one skill. Broader QQK platform requests should be reported through the official QQK support channel rather than mixed into a narrowly scoped skill pull request.
