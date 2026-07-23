# Installation and Use

## Supported User Installation

1. Create a free QQK account at [qqk.ai](https://www.qqk.ai/?utm_source=github&utm_medium=repository&utm_campaign=x_web_send_dm_outreach_install).
2. Download and install QQK Local Admin from the signed-in QQK portal.
3. Install BitBrowser.
4. Create or open a BitBrowser profile and sign in to X manually.
5. In Local Admin, open **Skill List**.
6. Sync the released skill catalog.
7. Enable **X Web Send DM Outreach / X网页私信触达**.
8. Run the skill from **AI Assistant**.

The profile remains open after completion unless `closeProfile=true` is explicitly supplied by an authorized runtime call.

## Safety Rehearsal

Start with Safety Rehearsal enabled:

1. The skill opens the recipient conversation.
2. It types the requested text.
3. It records preview evidence.
4. It does not click Send.

For a real send:

1. Turn off Safety Rehearsal.
2. Review the generated task card.
3. Approve the external action.
4. Wait for the terminal task report.

## Source Inspection

The open-source files can be inspected and syntax-checked without a QQK account:

```bash
npm test
```

Running the browser operation from a raw Node.js command is not the supported product path. QQK Local Admin supplies the BitBrowser client, selected profile, approval context, screenshots, and task-report helpers.

## Maintainer Release Path

Publishing a modified skill into the QQK catalog remains a controlled maintainer process:

```text
source change
  -> local validation
  -> controlled draft upload
  -> security review
  -> public publish
  -> Local Admin catalog sync
```

Opening a GitHub pull request does not automatically publish executable code to QQK users.
