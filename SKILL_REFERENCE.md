# X Web Send DM Outreach / X网页私信触达

This skill sends one exact direct message through the normal X Chat New message UI. It does not use the X API, does not reuse a collected conversation identifier as input, and never concatenates or navigates to a conversation URL.

## Natural UI Flow

- Opens the stable X Chat entry route and clicks the visible New message control.
- Types the exact recipient handle one character at a time into the visible user search box.
- Requires one exact `@handle` suggestion, clicks that result, and opens the conversation through visible controls.
- Types the message with per-character keyboard events, clicks the visible Send control only in a confirmed real run, and verifies the exact outgoing message in the visible conversation.
- Detects an identical visible message before sending to prevent accidental duplicates.

## Inputs And Safety

`recipientHandle` and `message` are required. The public contract deliberately has no `send`, `publish`, or `confirmRealRun` field. The AI Assistant Safety Rehearsal toggle supplies `dryRun`; Local Admin supplies internal approval only after the operator approves a real run. `closeProfile` defaults to `false`.

Preview mode searches and opens the real recipient conversation and prepares the message without clicking Send. Real mode reports only a visibly verified outgoing message as sent.

## Task Report

The task report includes recipient and message counts, verified message ID, detected chat variant, final visible conversation URL, setup blockers, duplicate state, success/failure screenshots, and conservative business status. Recipient-not-found, encrypted-chat setup, ambiguous controls, and unverified submission are never reported as successful delivery.

Version 2 recognizes both current `New chat` controls and legacy `New message` controls, prioritizes the visible labeled control, and only types into the recipient-search dialog rather than the inbox filter. The shared runtime also treats `Unlock more on X` as a blocking unexpected dialog: it clicks `Got it`, verifies the dialog is gone, and then resumes the intended action.

Version 3 prioritizes the large visible-text `New chat` button over the compact header icon when both controls exist, and dispatches a complete left-button press/release sequence before requiring `new-dm-search-input`.

Version 4 clicks the current X Chat controls in a deterministic order: the large empty-conversation `New chat` control first, then the compact header control, then the legacy fallback. It uses the proven tab click path for each exact visible test ID and requires the recipient-search input after every attempt, avoiding repeated low-level CDP command timeouts.

Version 5 keeps the deterministic control order and sends the exact two-event mouse sequence X Chat currently requires: a left-button press with `buttons: 1`, followed by a left-button release with `buttons: 0`. It deliberately omits the unnecessary mouse-move event and verifies that the recipient-search dialog opened before continuing.

Version 6 attaches a short-lived input session to the current X Chat page target for the New chat click, matching the verified live CDP path after X navigation. The session is released after the recipient-search check, while the normal skill session continues to own page inspection and message entry.

Version 7 isolates the verified New chat input sequence on a short-lived CDP WebSocket connection. It attaches the current page target, dispatches the complete press/release sequence, verifies the recipient-search dialog through the normal skill tab, and then detaches and closes only the temporary connection.

Version 8 records bounded recipient-search telemetry for each exact control and fallback attempt. Task reports can now distinguish a missing visible point, a dispatched click that X ignored, and a successfully opened recipient-search input without exposing message content.
