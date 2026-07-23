import {
  assertXSubmissionAccepted,
  captureXRuntimeScreenshot,
  clickReadyXElement,
  closeXProfileIfRequested,
  commonXOutput,
  createXFailure,
  delayWithAbort,
  detectXDirectMessageVariant,
  dismissXUnexpectedBlockingDialog,
  ensureXBrowserContext,
  fillVisibleXInput,
  normalizeXHandle,
  normalizeXVisibleTextForVerification,
  resolveXConfirmedSideEffectMode,
  throwIfXAborted,
  typeVisibleXInputHumanLike,
  waitForXComposerSubmissionState,
  waitForXCondition
} from "./x-web-skill-runtime.mjs";
import { CdpConnection } from "./cdp-session.mjs";

const CHAT_URL = "https://x.com/i/chat";

async function clickExactRecipient(tab, handle) {
  const point = await tab.evaluate(String.raw`((target) => {
    const modal = document.querySelector('[data-testid="dm-new-chat-modal"]') || document;
    const nodes = [...modal.querySelectorAll('*')];
    const leaf = nodes.find((item) => (item.innerText || item.textContent || '').trim().toLowerCase() === ('@' + target).toLowerCase() && ![...item.children].some((child) => (child.innerText || child.textContent || '').trim().toLowerCase() === ('@' + target).toLowerCase()));
    const node = leaf?.closest('[data-testid^="new-dm-user-suggestion-"], button, [role="button"], [tabindex="0"]') || leaf;
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    return node === hit || node.contains(hit) ? { x, y } : null;
  })(${JSON.stringify(handle)})`);
  if (!point) return false;
  await tab.click(point);
  return true;
}

async function findExactConversationMessage(tab, message) {
  const rows = await tab.evaluate(String.raw`(() => {
    const nodes = [...document.querySelectorAll('[data-testid^="message-text-"], [data-testid="messageEntry"], [data-message-id], [data-testid*="message-bubble" i]')];
    return nodes.map((node) => ({ text: String(node.innerText || node.textContent || '').trim(), testid: node.getAttribute('data-testid') || '', dataMessageId: node.getAttribute('data-message-id') || '' }));
  })()`);
  const expected = normalizeXVisibleTextForVerification(message);
  const row = (Array.isArray(rows) ? rows : []).find((item) => {
    const actual = normalizeXVisibleTextForVerification(item.text);
    return actual === expected || String(item.text || '').split(/\r?\n/).some((line) => normalizeXVisibleTextForVerification(line) === expected);
  });
  return {
    found: Boolean(row),
    messageId: row?.testid?.startsWith('message-text-') ? row.testid.slice('message-text-'.length) : row?.dataMessageId || ''
  };
}

async function openVisibleRecipientSearch(context, helpers) {
  await dismissXUnexpectedBlockingDialog(context.tab, helpers, { appearanceTimeoutMs: 1000, timeoutMs: 6000 });
  const telemetry = [];
  context.output.recipientSearchTelemetry = telemetry;
  const recipientSearchReady = () => context.tab.evaluate(String.raw`Boolean(document.querySelector('[data-testid="new-dm-search-input"], [data-testid="dm-new-chat-search-input"], [data-testid="dm-new-chat-modal"] input, [role="dialog"] input[placeholder*="Search" i], [role="dialog"] input[aria-label*="Search" i]'))`);
  const clickPoint = async (point) => {
    const inputConnection = await new CdpConnection(context.output.ws, { callTimeoutMs: 10000 }).connect();
    const attached = await inputConnection.call("Target.attachToTarget", {
      targetId: context.tab.targetId,
      flatten: true
    });
    const inputSessionId = attached.sessionId;
    await inputConnection.call("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button: "left",
      buttons: 1,
      clickCount: 1
    }, inputSessionId);
    await inputConnection.call("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: point.x,
      y: point.y,
      button: "left",
      buttons: 0,
      clickCount: 1
    }, inputSessionId);
    return { inputConnection, inputSessionId };
  };
  const releaseClickSession = async (clickSession) => {
    if (!clickSession?.inputConnection) return;
    await clickSession.inputConnection.call("Target.detachFromTarget", {
      sessionId: clickSession.inputSessionId
    }).catch(() => {});
    await clickSession.inputConnection.close().catch(() => {});
  };
  if (await recipientSearchReady()) {
    telemetry.push({ stage: "initial", testid: "", pointFound: false, clickDispatched: false, opened: true });
    return true;
  }
  const orderedTestids = [
    "dm-empty-conversation-new-chat-button",
    "dm-new-chat-button",
    "dm-new-conversation-button"
  ];
  for (const testid of orderedTestids) {
    const point = await context.tab.evaluate(String.raw`((targetTestid) => {
      const node = document.querySelector('[data-testid="' + targetTestid + '"]');
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      if (rect.width <= 1 || rect.height <= 1 || rect.bottom <= 0 || rect.right <= 0 || rect.top >= innerHeight || rect.left >= innerWidth || style.display === 'none' || style.visibility === 'hidden') return null;
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      return node === hit || node.contains(hit) ? { x, y } : null;
    })(${JSON.stringify(testid)})`);
    if (!point) {
      telemetry.push({ stage: "ordered", testid, pointFound: false, clickDispatched: false, opened: false });
      continue;
    }
    let clickSession = null;
    try {
      clickSession = await clickPoint(point);
      await delayWithAbort(helpers, 1000 + Math.floor(Math.random() * 2001));
      const opened = await recipientSearchReady();
      telemetry.push({ stage: "ordered", testid, pointFound: true, clickDispatched: true, opened });
      if (opened) return true;
    } finally {
      await releaseClickSession(clickSession);
    }
  }
  const fallbackPoint = await context.tab.evaluate(String.raw`(() => {
    const candidates = [...document.querySelectorAll('button, [role="button"]')].filter((node) => {
      const text = String(node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
      const aria = String(node.getAttribute('aria-label') || '').trim();
      if (!/^(?:New chat|New message)$/i.test(text) && !/^(?:New chat|New message)$/i.test(aria)) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 1 && rect.height > 1 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth && style.display !== 'none' && style.visibility !== 'hidden';
    }).sort((left, right) => {
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      return (rightRect.width * rightRect.height) - (leftRect.width * leftRect.height);
    });
    for (const node of candidates) {
      const rect = node.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      if (node === hit || node.contains(hit)) return { x, y };
    }
    return null;
  })()`);
  if (fallbackPoint) {
    let clickSession = null;
    try {
      clickSession = await clickPoint(fallbackPoint);
      await delayWithAbort(helpers, 1000 + Math.floor(Math.random() * 2001));
      telemetry.push({ stage: "fallback", testid: "", pointFound: true, clickDispatched: true, opened: await recipientSearchReady() });
    } finally {
      await releaseClickSession(clickSession);
    }
  } else {
    telemetry.push({ stage: "fallback", testid: "", pointFound: false, clickDispatched: false, opened: false });
  }
  return recipientSearchReady();
}

export async function run(step, context, helpers = {}) {
  throwIfXAborted(helpers);
  const input = context.input || {};
  let recipientHandle;
  try { recipientHandle = normalizeXHandle(input.recipientHandle, { required: true }); } catch (cause) { throw createXFailure(helpers, cause.message, { code: "X_WEB_DM_RECIPIENT_INVALID", category: "user_input", origin: "input", operatorActionRequired: true, bugCandidate: false, confidence: 0.99, cause }); }
  const message = String(input.message || '').trim();
  if (!message || message.length > 10000) throw createXFailure(helpers, "Direct message text must contain 1 to 10000 characters.", { code: "X_WEB_DM_MESSAGE_INVALID", category: "user_input", origin: "input", operatorActionRequired: true, bugCandidate: false, confidence: 0.99 });
  const { action: send, dryRun, confirmRealRun } = resolveXConfirmedSideEffectMode({
    actionValue: input.send,
    dryRunValue: input.dryRun,
    confirmRealRunValue: input.confirmRealRun
  });
  if (!dryRun && (!send || !confirmRealRun)) throw createXFailure(helpers, "Real X direct-message sending requires dryRun=false and Local Admin approval.", { code: "REAL_RUN_CONFIRMATION_REQUIRED", category: "user_input", origin: "input", operatorActionRequired: true, bugCandidate: false, confidence: 0.99 });
  try {
    await ensureXBrowserContext(step, context, helpers, { initialUrl: CHAT_URL });
    await context.tab.navigate(CHAT_URL);
    await waitForXCondition(context.tab, () => {
      const body = document.body?.innerText || '';
      return Boolean(document.querySelector('[data-testid="pin-onboarding-title"], [data-testid="dm-container"], [data-testid="dm-new-chat-button"]')) || /welcome to the new x chat|create passcode|something went wrong|try reloading/i.test(body);
    }, { helpers, timeoutMs: Math.max(10000, Math.min(60000, Number(input.timeoutMs ?? 30000))), code: "X_WEB_DM_SEND_INBOX_TIMEOUT", message: "X Chat did not reach an inbox or setup requirement." });
    await delayWithAbort(helpers, 2000);
    const variant = await detectXDirectMessageVariant(context.tab);
    const pageState = await context.tab.evaluate(String.raw`(() => ({ url: location.href, body: document.body?.innerText || '', setupRequired: Boolean(document.querySelector('[data-testid="pin-onboarding-title"]')) || /create passcode/i.test(document.body?.innerText || '') }))()`);
    if (/something went wrong|try reloading/i.test(pageState.body)) throw createXFailure(helpers, "X displayed a network error while opening direct messages.", { code: "X_WEB_NETWORK_ERROR", category: "network", origin: "network", retryable: true, operatorActionRequired: false, bugCandidate: false, confidence: 0.96 });
    if (pageState.setupRequired) {
      const screenshotPath = await captureXRuntimeScreenshot(context, helpers, { prefix: "x-web-send-direct-message-setup-required" });
      const result = commonXOutput(context, { businessStatus: "setup_required", dryRun, send, sent: false, alreadySent: false, messageId: "", chatVariant: variant.variant, chatUrl: pageState.url, setupRequired: true, setupReason: "x_chat_passcode", recipientHandle, message, preparedScreenshotPath: screenshotPath, conversationId: "", conversationUrl: "", screenshotPath });
      Object.assign(context.output, result);
      await closeXProfileIfRequested(step, context, helpers);
      result.closedProfile = Boolean(context.output.closedProfile);
      return result;
    }
    const searchOpened = await openVisibleRecipientSearch(context, helpers);
    if (!searchOpened) throw createXFailure(helpers, "X Chat recipient search did not become ready after clicking the visible New chat control.", { code: "X_WEB_DM_RECIPIENT_SEARCH_TIMEOUT", category: "skill_bug", origin: "remote_platform", retryable: true, bugCandidate: true, confidence: 0.9 });
    const recipientSearchSelector = '[data-testid="dm-new-chat-modal"] input, [role="dialog"] input[placeholder*="Search" i], [role="dialog"] input[aria-label*="Search" i]';
    await waitForXCondition(context.tab, () => Boolean(document.querySelector('[data-testid="new-dm-search-input"], [data-testid="dm-new-chat-search-input"], [data-testid="dm-new-chat-modal"] input, [role="dialog"] input[placeholder*="Search" i], [role="dialog"] input[aria-label*="Search" i]')), { helpers, timeoutMs: 15000, code: "X_WEB_DM_RECIPIENT_SEARCH_TIMEOUT", message: "X Chat recipient search did not become ready." });
    await typeVisibleXInputHumanLike(context.tab, context.connection, helpers, { testids: ["new-dm-search-input", "dm-new-chat-search-input"], selector: recipientSearchSelector }, recipientHandle);
    let recipientClicked = false;
    for (let attempt = 0; attempt < 40 && !recipientClicked; attempt += 1) {
      recipientClicked = await clickExactRecipient(context.tab, recipientHandle);
      if (recipientClicked) break;
      const noResults = await context.tab.evaluate(String.raw`/no people found|no results/i.test(document.body?.innerText || '')`);
      if (noResults) break;
      if (attempt < 39) await delayWithAbort(helpers, 500);
    }
    if (!recipientClicked) {
      const screenshotPath = await captureXRuntimeScreenshot(context, helpers, { prefix: "x-web-send-direct-message-recipient-unavailable" });
      const result = commonXOutput(context, { businessStatus: "recipient_unavailable", dryRun, send, sent: false, alreadySent: false, messageId: "", chatVariant: variant.variant, chatUrl: pageState.url, setupRequired: false, setupReason: "", recipientHandle, message, preparedScreenshotPath: screenshotPath, conversationId: "", conversationUrl: "", screenshotPath });
      Object.assign(context.output, result);
      await closeXProfileIfRequested(step, context, helpers);
      result.closedProfile = Boolean(context.output.closedProfile);
      return result;
    }
    await waitForXCondition(context.tab, () => Boolean(document.querySelector('[data-testid="dm-composer-textarea"], textarea[placeholder*="message" i], [contenteditable="true"][aria-label*="message" i], [data-testid="pin-onboarding-title"]')) || /create passcode/i.test(document.body?.innerText || ''), { helpers, timeoutMs: 20000, code: "X_WEB_DM_COMPOSER_TIMEOUT", message: "X Chat message composer did not become ready." });
    const setupAfterRecipient = await context.tab.evaluate(String.raw`Boolean(document.querySelector('[data-testid="pin-onboarding-title"]')) || /create passcode/i.test(document.body?.innerText || '')`);
    if (setupAfterRecipient) {
      const screenshotPath = await captureXRuntimeScreenshot(context, helpers, { prefix: "x-web-send-direct-message-setup-required" });
      const result = commonXOutput(context, { businessStatus: "setup_required", dryRun, send, sent: false, alreadySent: false, messageId: "", chatVariant: variant.variant, chatUrl: pageState.url, setupRequired: true, setupReason: "x_chat_passcode", recipientHandle, message, preparedScreenshotPath: screenshotPath, conversationId: "", conversationUrl: "", screenshotPath });
      Object.assign(context.output, result);
      await closeXProfileIfRequested(step, context, helpers);
      result.closedProfile = Boolean(context.output.closedProfile);
      return result;
    }
    if (!dryRun) {
      let existingMessage = { found: false, messageId: "" };
      for (let attempt = 0; attempt < 6; attempt += 1) {
        existingMessage = await findExactConversationMessage(context.tab, message);
        if (existingMessage.found) break;
        if (attempt < 5) await delayWithAbort(helpers, 500);
      }
      if (existingMessage.found) {
        const finalState = await context.tab.evaluate(String.raw`(() => ({ url: location.href, conversationId: /^\/i\/chat\/([^/?#]+)/.exec(location.pathname)?.[1] || '' }))()`);
        await dismissXUnexpectedBlockingDialog(context.tab, helpers, { appearanceTimeoutMs: 2500, timeoutMs: 10000 });
        const screenshotPath = await captureXRuntimeScreenshot(context, helpers, { prefix: "x-web-send-direct-message-success-existing" });
        const result = commonXOutput(context, { businessStatus: "sent", dryRun: false, send: true, sent: true, alreadySent: true, messageId: existingMessage.messageId, chatVariant: variant.variant, chatUrl: pageState.url, setupRequired: false, setupReason: "", recipientHandle, message, preparedScreenshotPath: screenshotPath, conversationId: finalState.conversationId, conversationUrl: finalState.url, screenshotPath });
        Object.assign(context.output, result);
        await closeXProfileIfRequested(step, context, helpers);
        result.closedProfile = Boolean(context.output.closedProfile);
        return result;
      }
    }
    const editorSpec = { testids: ["dm-composer-textarea"], selector: 'textarea[placeholder*="message" i], [contenteditable="true"][aria-label*="message" i]' };
    await typeVisibleXInputHumanLike(context.tab, context.connection, helpers, editorSpec, message);
    const preparedScreenshotPath = await captureXRuntimeScreenshot(context, helpers, { prefix: "x-web-send-direct-message-prepared" });
    if (dryRun) {
      await fillVisibleXInput(context.tab, context.connection, helpers, editorSpec, "");
      const result = commonXOutput(context, { businessStatus: "prepared", dryRun: true, send: false, sent: false, alreadySent: false, messageId: "", chatVariant: variant.variant, chatUrl: pageState.url, setupRequired: false, setupReason: "", recipientHandle, message, preparedScreenshotPath, conversationId: "", conversationUrl: "", screenshotPath: preparedScreenshotPath });
      Object.assign(context.output, result);
      await closeXProfileIfRequested(step, context, helpers);
      result.closedProfile = Boolean(context.output.closedProfile);
      return result;
    }
    await clickReadyXElement(context.tab, context.connection, helpers, { testids: ["dm-composer-send-button", "dm-send-button"], ariaLabels: ["Send"] }, { code: "X_WEB_DM_SEND_BUTTON_NOT_FOUND", readyCode: "X_WEB_DM_SEND_BUTTON_NOT_READY", readyMessage: "The X Chat Send button remained disabled or covered by a transient overlay." });
    const submissionState = await waitForXComposerSubmissionState(context.tab, helpers, { timeoutMs: 30000, composerSelector: editorSpec.selector });
    assertXSubmissionAccepted(helpers, submissionState, { actionLabel: "direct message", codePrefix: "X_WEB_DM_SEND" });
    let sentMessage = { found: false, messageId: "" };
    for (let attempt = 0; attempt < 60 && !sentMessage.found; attempt += 1) {
      sentMessage = await findExactConversationMessage(context.tab, message);
      if (!sentMessage.found && attempt < 59) await delayWithAbort(helpers, 500);
    }
    if (!sentMessage.found) throw createXFailure(helpers, "The submitted X direct message could not be verified in the visible conversation.", { code: "X_WEB_DM_SEND_NOT_VERIFIED", category: "skill_bug", origin: "remote_platform", retryable: true, operatorActionRequired: false, bugCandidate: false, confidence: 0.6, deterministic: false, requiredOccurrences: 2 });
    const finalState = await context.tab.evaluate(String.raw`(() => ({ url: location.href, conversationId: /^\/i\/chat\/([^/?#]+)/.exec(location.pathname)?.[1] || '' }))()`);
    await dismissXUnexpectedBlockingDialog(context.tab, helpers, { appearanceTimeoutMs: 2500, timeoutMs: 10000 });
    const screenshotPath = await captureXRuntimeScreenshot(context, helpers, { prefix: "x-web-send-direct-message-success" });
    const result = commonXOutput(context, { businessStatus: "sent", dryRun: false, send: true, sent: true, alreadySent: false, messageId: sentMessage.messageId, chatVariant: variant.variant, chatUrl: pageState.url, setupRequired: false, setupReason: "", recipientHandle, message, preparedScreenshotPath, conversationId: finalState.conversationId, conversationUrl: finalState.url, screenshotPath });
    Object.assign(context.output, result);
    await closeXProfileIfRequested(step, context, helpers);
    result.closedProfile = Boolean(context.output.closedProfile);
    return result;
  } catch (error) {
    await captureXRuntimeScreenshot(context, helpers, { prefix: "x-web-send-direct-message", failure: true }).catch(() => "");
    throw error;
  }
}
