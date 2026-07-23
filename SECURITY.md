# Security Policy

## Reporting a Vulnerability

Do not disclose a vulnerability, credential, cookie, private conversation, tenant identifier, or unredacted task report in a public GitHub issue.

Report security concerns through the official support contact available after signing in at [qqk.ai](https://www.qqk.ai/). Include:

- A concise description of the problem
- The affected QQK skill version
- Reproduction steps using synthetic accounts and messages
- A redacted task-report identifier when needed
- The expected security boundary

Do not include API keys, session cookies, BitBrowser profile data, upload codes, or customer messages.

## Supported Version

Security fixes target the latest released QQK skill version. Older versions may be referenced for diagnosis but are not promised separate patches.

## Security Boundaries

- The skill must not send when Safety Rehearsal is on.
- A real send requires explicit approval through QQK Local Admin.
- The skill must not report success unless the outgoing message is visibly verified.
- Private-conversation URLs and identifiers are outputs for reporting, not trusted targeting inputs.
- The browser profile stays open by default unless the operator explicitly asks to close it.
