import { run as runSendDirectMessage } from "./send-direct-message.mjs";

export async function run(step, context, helpers = {}) {
  const result = await runSendDirectMessage(step, context, helpers);
  const metrics = {
    recipientsProcessed: 1,
    messagesAttempted: result.dryRun || result.alreadySent || result.setupRequired ? 0 : 1,
    messagesSucceeded: result.sent ? 1 : 0
  };
  Object.assign(result, metrics);
  Object.assign(context.output, metrics);
  return result;
}
