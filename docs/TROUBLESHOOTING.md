# Troubleshooting

## The Skill Opens X but Cannot Send

Check that:

- The selected BitBrowser profile is signed in to X.
- Safety Rehearsal is off for a real send.
- The real-run task card was explicitly approved.
- The recipient allows direct messages.
- X is not asking for encrypted-chat or passcode setup.

The task report should identify setup blockers rather than reporting a false success.

## Recipient Not Found

- Pass the exact X handle without `@` in structured input.
- Confirm the account exists and is visible to the signed-in account.
- Check for similar handles; the skill deliberately rejects ambiguous results.
- Do not replace normal search with a constructed private-conversation URL.

## `Unlock more on X` Keeps Appearing

The shared runtime recognizes this unexpected dialog and clicks **Got it**. If X changes the visible dialog text or control, attach a redacted screenshot to a private support report and include the stable error code.

## Message Was Typed but Not Sent

This is expected when Safety Rehearsal is on. If Safety Rehearsal was off, check:

- Whether the task was approved
- `dryRun`
- `send`
- `sent`
- `setupRequired`
- `businessStatus`
- `failureScreenshotPath`

Do not infer delivery from the presence of text in the composer.

## Duplicate Message

If the same visible outgoing message already exists in the conversation, the skill can return:

```json
{
  "alreadySent": true,
  "sent": false
}
```

This protects against accidental duplicate delivery.

## Profile Closed Unexpectedly

The public schema defaults `closeProfile` to `false`. Confirm that the caller did not explicitly override it and that an external browser manager did not close the profile.

## Reporting a Problem

Never upload an unredacted conversation, cookie, token, tenant ID, local filesystem path, or complete production task report to a public issue. Follow [SECURITY.md](../SECURITY.md).
