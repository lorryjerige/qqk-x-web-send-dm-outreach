import { mkdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CdpConnection, CdpTab } from "./cdp-session.mjs";

export const X_WEB_HOME_URL = "https://x.com/home";
export const X_WEB_BASE_URL = "https://x.com";

export function resolveXConfirmedSideEffectMode({ actionValue, dryRunValue, confirmRealRunValue } = {}) {
  let action = readBooleanFlag(actionValue);
  const confirmRealRun = readBooleanFlag(confirmRealRunValue);
  const dryRun = dryRunValue === undefined ? !action : readBooleanFlag(dryRunValue);
  if (dryRun) action = false;
  else if (confirmRealRun) action = true;
  return { action, dryRun, confirmRealRun };
}

function readBooleanFlag(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return /^(?:1|true|yes|on)$/i.test(String(value || "").trim());
}

const HANDLE_PATTERN = /^[A-Za-z0-9_]{1,15}$/;
const POST_PATH_PATTERN = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)(?:\/.*)?$/;
const X_RESERVED_PATHS = new Set(["compose", "explore", "home", "i", "login", "messages", "notifications", "search", "settings"]);
const DEFAULT_WAIT_MS = 300;

export function throwIfXAborted(helpers = {}) {
  if (typeof helpers.throwIfAborted === "function") helpers.throwIfAborted();
  if (!helpers.signal?.aborted) return;
  if (helpers.signal.reason instanceof Error) throw helpers.signal.reason;
  const error = new Error(String(helpers.signal.reason || "EXECUTION_ABORTED"));
  error.code = "EXECUTION_ABORTED";
  throw error;
}

export function createXFailure(helpers, message, options = {}) {
  if (typeof helpers?.createTaskFailureError === "function") {
    return helpers.createTaskFailureError(message, options);
  }
  const error = new Error(message);
  if (options.code) error.code = options.code;
  error.taskFailure = Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined));
  return error;
}

export function normalizeXHandle(value, { required = false } = {}) {
  const raw = String(value || "").trim();
  let handle = raw.replace(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\//i, "")
    .replace(/^\/+/, "")
    .replace(/^@+/, "")
    .split(/[/?#]/, 1)[0]
    .trim();
  if (!handle && !required) return "";
  if (!HANDLE_PATTERN.test(handle)) throw new Error(`X_WEB_HANDLE_INVALID: ${raw || "missing handle"}`);
  return handle;
}

export function normalizeXPostUrl(value, { required = true } = {}) {
  const raw = String(value || "").trim();
  if (!raw && !required) return "";
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `${X_WEB_BASE_URL}${raw.startsWith("/") ? "" : "/"}${raw}`);
  } catch {
    throw new Error(`X_WEB_POST_URL_INVALID: ${raw || "missing post URL"}`);
  }
  if (!/^(?:www\.)?(?:x|twitter)\.com$/i.test(url.hostname)) {
    throw new Error(`X_WEB_POST_URL_INVALID: ${raw}`);
  }
  const match = POST_PATH_PATTERN.exec(url.pathname);
  if (!match) throw new Error(`X_WEB_POST_URL_INVALID: ${raw}`);
  return `${X_WEB_BASE_URL}/${match[1]}/status/${match[2]}`;
}

export function extractXPostId(value) {
  const url = normalizeXPostUrl(value);
  return POST_PATH_PATTERN.exec(new URL(url).pathname)?.[2] || "";
}

export function buildXProfileUrl(value) {
  return `${X_WEB_BASE_URL}/${normalizeXHandle(value, { required: true })}`;
}

export function buildXSearchUrl({ query, resultType = "latest", fromHandle, toHandle, language, sinceDate, untilDate } = {}) {
  const parts = [String(query || "").trim()];
  if (fromHandle) parts.push(`from:${normalizeXHandle(fromHandle, { required: true })}`);
  if (toHandle) parts.push(`to:${normalizeXHandle(toHandle, { required: true })}`);
  if (language) parts.push(`lang:${String(language).trim().toLowerCase()}`);
  if (sinceDate) parts.push(`since:${normalizeXDate(sinceDate, "sinceDate")}`);
  if (untilDate) parts.push(`until:${normalizeXDate(untilDate, "untilDate")}`);
  const normalized = parts.filter(Boolean).join(" ").trim();
  if (!normalized) throw new Error("X_WEB_SEARCH_QUERY_REQUIRED: query or a search filter is required");
  const params = new URLSearchParams({ q: normalized, src: "typed_query" });
  if (resultType === "latest") params.set("f", "live");
  else if (resultType === "people") params.set("f", "user");
  else if (resultType === "media") params.set("f", "media");
  return `${X_WEB_BASE_URL}/search?${params.toString()}`;
}

export function normalizeXVisibleTextForVerification(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\u200D\uFE0E\uFE0F]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function xVisibleTextsEqual(actual, expected) {
  const exactActual = String(actual || "").trim();
  const exactExpected = String(expected || "").trim();
  return exactActual === exactExpected
    || normalizeXVisibleTextForVerification(exactActual) === normalizeXVisibleTextForVerification(exactExpected);
}

export async function ensureXBrowserContext(step, context, helpers = {}, { initialUrl = X_WEB_HOME_URL } = {}) {
  throwIfXAborted(helpers);
  const input = context.input || {};
  let profileId = String(readParam(helpers, input, step?.profileIdFrom || "profileId", "") || "").trim();
  let profileName = String(readParam(helpers, input, step?.profileNameFrom || "profileName", "") || "").trim();
  if (!profileId && !profileName) {
    throw createXFailure(helpers, "X Web skills require profileId or profileName.", failureOptions({
      code: "X_WEB_PROFILE_REQUIRED",
      category: "user_input",
      origin: "input",
      operatorActionRequired: true,
      evidence: { required: "profileId_or_profileName" }
    }));
  }
  if (!context.bitbrowser) {
    throw createXFailure(helpers, "BitBrowser runtime is unavailable.", failureOptions({
      code: "X_WEB_BITBROWSER_UNAVAILABLE",
      category: "device_runtime",
      origin: "local_runtime",
      retryable: true,
      operatorActionRequired: true
    }));
  }

  if (!profileId) {
    const response = await context.bitbrowser.listProfiles({ page: 0, pageSize: 500, name: profileName });
    const matches = (response.data?.list || []).filter((item) => String(item.name || "").trim().toLowerCase() === profileName.toLowerCase());
    if (matches.length > 1) {
      throw createXFailure(helpers, `Multiple BitBrowser profiles are named ${profileName}.`, failureOptions({
        code: "AMBIGUOUS_PROFILE_NAME",
        category: "user_input",
        origin: "input",
        operatorActionRequired: true
      }));
    }
    if (!matches.length) {
      throw createXFailure(helpers, `BitBrowser profile not found: ${profileName}`, failureOptions({
        code: "PROFILE_NOT_FOUND",
        category: "user_input",
        origin: "input",
        operatorActionRequired: true
      }));
    }
    profileId = String(matches[0].id || "").trim();
    profileName = String(matches[0].name || profileName).trim();
  }

  if (!context.connection) {
    let opened;
    const existingPort = (await context.bitbrowser.ports().catch(() => null))?.data?.[profileId];
    if (existingPort) {
      opened = { success: true, data: { http: `127.0.0.1:${existingPort}` } };
    } else {
      try {
        opened = await context.bitbrowser.openProfile({ id: profileId, args: [], queue: true });
      } catch (cause) {
        throw createXFailure(helpers, `Could not open BitBrowser profile ${profileName || profileId}.`, failureOptions({
          code: "X_WEB_BITBROWSER_OPEN_FAILED",
          category: "device_runtime",
          origin: "local_runtime",
          retryable: true,
          operatorActionRequired: true,
          cause
        }));
      }
    }
    if (!opened?.data?.ws && !opened?.data?.http) {
      const ports = await context.bitbrowser.ports().catch(() => null);
      const port = ports?.data?.[profileId];
      if (!port) {
        throw createXFailure(helpers, `Profile ${profileId} did not expose a CDP endpoint.`, failureOptions({
          code: "X_WEB_CDP_ENDPOINT_MISSING",
          category: "device_runtime",
          origin: "local_runtime",
          retryable: true,
          operatorActionRequired: true
        }));
      }
      opened = { success: true, data: { http: `127.0.0.1:${port}` } };
    }
    const ws = await resolveXWebSocketEndpoint(opened, profileId);
    try {
      context.connection = await new CdpConnection(ws, { callTimeoutMs: 90000 }).connect();
    } catch (cause) {
      throw createXFailure(helpers, "Could not connect to the BitBrowser CDP runtime.", failureOptions({
        code: "X_WEB_CDP_CONNECT_FAILED",
        category: "device_runtime",
        origin: "local_runtime",
        retryable: true,
        operatorActionRequired: true,
        cause
      }));
    }
    context.output.ws = ws;
    context.output.http = opened.data?.http;
    context.output.pid = opened.data?.pid;
  }

  if (!context.tab) {
    const targets = await context.connection.listTargets();
    const target = targets.find((item) => item.type === "page" && isXWebUrl(item.url));
    if (target) {
      const { sessionId } = await context.connection.call("Target.attachToTarget", { targetId: target.targetId, flatten: true });
      await context.connection.call("Runtime.enable", {}, sessionId);
      await context.connection.call("Page.enable", {}, sessionId);
      context.tab = new CdpTab(context.connection, { targetId: target.targetId, sessionId });
    } else {
      context.tab = await context.connection.createTab(initialUrl);
    }
  }

  Object.assign(context.input, { profileId, profileName });
  Object.assign(context.output, { profileId, profileName, targetId: context.tab.targetId });
  if (initialUrl && !(await currentXUrl(context.tab)).startsWith(initialUrl)) {
    await navigateX(context.tab, initialUrl, helpers, { timeoutMs: 60000 });
  }
  await assertXPageReady(context.tab, helpers);
  return { profileId, profileName, connection: context.connection, tab: context.tab };
}

export async function navigateX(tab, url, helpers = {}, { timeoutMs = 60000 } = {}) {
  throwIfXAborted(helpers);
  const targetUrl = /^https:\/\//i.test(String(url || "")) ? String(url) : `${X_WEB_BASE_URL}${String(url || "").startsWith("/") ? "" : "/"}${url}`;
  if (!isXWebUrl(targetUrl)) throw new Error(`X_WEB_URL_INVALID: ${targetUrl}`);
  let dialogHandling = Promise.resolve();
  let dialogFailure = null;
  const handleDialogOpening = (params, sessionId) => {
    if (sessionId !== tab.sessionId || params?.type !== "beforeunload") return;
    dialogHandling = tab.connection.call("Page.handleJavaScriptDialog", { accept: true }, tab.sessionId)
      .catch((error) => {
        dialogFailure = error;
      });
  };
  let removeDialogListener = () => {};
  if (typeof tab.connection?.onEvent === "function") {
    removeDialogListener = tab.connection.onEvent("Page.javascriptDialogOpening", handleDialogOpening);
  } else if (typeof tab.connection?.ws?.addEventListener === "function") {
    const handleWebSocketMessage = (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message?.method === "Page.javascriptDialogOpening") {
        handleDialogOpening(message.params || {}, message.sessionId);
      }
    };
    tab.connection.ws.addEventListener("message", handleWebSocketMessage);
    removeDialogListener = () => tab.connection.ws?.removeEventListener?.("message", handleWebSocketMessage);
  }
  try {
    await tab.navigate(targetUrl);
    await dialogHandling;
    if (dialogFailure) throw dialogFailure;
  } finally {
    removeDialogListener();
  }
  await waitForXCondition(tab, () => document.readyState !== "loading" && /^https:\/\/(?:www\.)?x\.com\//i.test(location.href), {
    helpers,
    timeoutMs,
    code: "X_WEB_NAVIGATION_TIMEOUT",
    message: `X page did not finish navigation: ${targetUrl}`
  });
  await delayWithAbort(helpers, 500);
  return currentXUrl(tab);
}

export async function assertXPageReady(tab, helpers = {}) {
  const state = await inspectXSessionState(tab);
  if (state.humanVerificationRequired) {
    throw createXFailure(helpers, "X requires human verification for the current account session.", failureOptions({
      code: "X_WEB_VERIFICATION_REQUIRED",
      category: "account_session",
      origin: "remote_platform",
      operatorActionRequired: true,
      evidence: { route: safeXRoute(state.url) }
    }));
  }
  if (state.loginRequired) {
    throw createXFailure(helpers, "X login is required for this BitBrowser profile.", failureOptions({
      code: "X_WEB_LOGIN_REQUIRED",
      category: "account_session",
      origin: "remote_platform",
      operatorActionRequired: true,
      evidence: { route: safeXRoute(state.url) }
    }));
  }
  if (state.networkError) {
    throw createXFailure(helpers, "X displayed a network error page.", failureOptions({
      code: "X_WEB_NETWORK_ERROR",
      category: "network",
      origin: "network",
      retryable: true,
      evidence: { route: safeXRoute(state.url) }
    }));
  }
  return state;
}

export async function inspectXSessionState(tab) {
  return tab.evaluate(String.raw`(() => {
    const body = document.body?.innerText || "";
    const url = location.href;
    const accountButton = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
    const profileNode = document.querySelector('[data-testid="AppTabBar_Profile_Link"]');
    const profileLink = profileNode?.closest("a") || profileNode?.querySelector?.("a") || [...document.querySelectorAll('a[href^="/"]')].find((node) => /^Profile$/i.test((node.innerText || node.textContent || "").trim()));
    const challenge = /captcha|verify (?:you are|your identity)|unusual activity|account (?:locked|suspended)|security check|\u5b89\u5168\u9a8c\u8bc1|\u9a8c\u8bc1\u4f60\u7684\u8eab\u4efd|\u8d26\u53f7\u5df2\u9501\u5b9a/i.test(body);
    const loginRoute = /\/(?:i\/flow\/login|login)(?:[/?#]|$)/i.test(location.pathname);
    const loginUi = !!document.querySelector('input[autocomplete="username"], a[href="/login"], [data-testid="loginButton"]');
    const networkError = /something went wrong|try reloading|network error|\u51fa\u4e86\u70b9\u95ee\u9898|\u91cd\u65b0\u52a0\u8f7d/i.test(body) && !accountButton;
    return {
      url,
      title: document.title,
      lang: document.documentElement.lang || "",
      loggedIn: Boolean(accountButton && profileLink && !challenge),
      loginRequired: Boolean(loginRoute || (loginUi && !accountButton)),
      humanVerificationRequired: challenge,
      networkError,
      accountText: (accountButton?.innerText || accountButton?.textContent || "").trim(),
      profilePath: profileLink?.getAttribute("href") || ""
    };
  })()`);
}

export async function readCurrentXAccountIdentity(tab, helpers = {}, { openProfile = true, requirePlatformAccountId = true } = {}) {
  await waitForXCondition(tab, () => {
    const body = document.body?.innerText || "";
    return Boolean(
      document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]')
      || document.querySelector('input[autocomplete="username"], [data-testid="loginButton"]')
      || /captcha|verify (?:you are|your identity)|unusual activity|account (?:locked|suspended)|security check|something went wrong|try reloading|network error/i.test(body)
    );
  }, {
    helpers,
    timeoutMs: 30000,
    code: "X_WEB_ACCOUNT_SHELL_TIMEOUT",
    message: "X did not finish loading the signed-in account shell."
  });
  const state = await assertXPageReady(tab, helpers);
  const profilePathHandle = String(state.profilePath || "").match(/^\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/)?.[1] || "";
  const accountTextHandle = String(state.accountText || "").match(/@[A-Za-z0-9_]{1,15}/)?.[0] || "";
  const currentPathHandle = (() => {
    try {
      const candidate = new URL(state.url).pathname.match(/^\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/)?.[1] || "";
      return X_RESERVED_PATHS.has(candidate.toLowerCase()) ? "" : candidate;
    } catch {
      return "";
    }
  })();
  if (!profilePathHandle && !accountTextHandle && !currentPathHandle) {
    throw createXFailure(helpers, `Could not resolve the signed-in X handle from stable navigation state: ${JSON.stringify({ url: state.url, profilePath: state.profilePath, accountText: state.accountText })}`, failureOptions({
      code: "X_WEB_ACCOUNT_HANDLE_NOT_FOUND",
      category: "skill_bug",
      origin: "skill_module",
      bugCandidate: true,
      deterministic: true
    }));
  }
  const sideHandle = normalizeXHandle(profilePathHandle || accountTextHandle || currentPathHandle, { required: true });
  if (openProfile) {
    await navigateX(tab, buildXProfileUrl(sideHandle), helpers);
    await waitForXCondition(tab, (args) => {
      const node = document.querySelector('[data-testid="UserProfileSchema-test"]');
      const schemaReady = Boolean(node?.textContent && /identifier|additionalName/.test(node.textContent));
      const visibleHandle = (document.body?.innerText || "").toLowerCase().includes("@" + args.handle.toLowerCase());
      const exactProfile = location.pathname.toLowerCase() === "/" + args.handle.toLowerCase();
      const linkedAccountId = [...document.querySelectorAll('a[href*="user_id="]')]
        .map((anchor) => {
          try { return new URL(anchor.getAttribute('href') || '', location.origin).searchParams.get('user_id') || ''; } catch { return ''; }
        })
        .find((value) => /^\d+$/.test(value));
      return schemaReady || (visibleHandle && exactProfile && (!args.requirePlatformAccountId || Boolean(linkedAccountId)));
    }, {
      helpers,
      timeoutMs: 20000,
      code: "X_WEB_ACCOUNT_IDENTITY_TIMEOUT",
      message: "X profile identity metadata did not become ready.",
      arg: { handle: sideHandle, requirePlatformAccountId }
    });
  }
  const identity = await tab.evaluate(String.raw`(() => {
    const schemaNode = document.querySelector('[data-testid="UserProfileSchema-test"]');
    let schema = null;
    try { schema = JSON.parse(schemaNode?.textContent || "null"); } catch {}
    const graph = Array.isArray(schema?.["@graph"]) ? schema["@graph"] : [];
    const entity = schema?.mainEntity || graph.find((item) => item?.identifier && item?.additionalName) || {};
    const userName = document.querySelector('[data-testid="UserName"]')?.innerText || "";
    const pageHandle = location.pathname.match(/^\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/)?.[1] || "";
    const handle = String(entity.additionalName || (userName.match(/@[A-Za-z0-9_]{1,15}/)?.[0] || "") || pageHandle).replace(/^@/, "");
    const linkedAccountId = [...document.querySelectorAll('a[href*="user_id="]')]
      .map((anchor) => {
        try { return new URL(anchor.getAttribute('href') || '', location.origin).searchParams.get('user_id') || ''; } catch { return ''; }
      })
      .find((value) => /^\d+$/.test(value)) || '';
    const avatar = entity.image?.contentUrl || document.querySelector('[data-testid^="UserAvatar-Container-"] img')?.src || "";
    return {
      platformAccountId: String(entity.identifier || linkedAccountId),
      handle,
      displayName: String(entity.name || userName.split(/\n+/)[0] || "").trim(),
      profileUrl: String(entity.url || location.href).replace(/\?.*$/, ""),
      avatarUrl: String(avatar || ""),
      schemaConfirmed: Boolean(entity.identifier && entity.additionalName && entity.url),
      identitySource: entity.identifier ? "profile_schema" : linkedAccountId ? "profile_follow_link" : "visible_profile",
      pageUrl: location.href
    };
  })()`);
  const handle = normalizeXHandle(identity.handle, { required: true });
  const confirmed = handle.toLowerCase() === sideHandle.toLowerCase() && (Boolean(identity.platformAccountId) || !requirePlatformAccountId);
  if (!confirmed) {
    throw createXFailure(helpers, "The current X account identity could not be confirmed against the profile page.", failureOptions({
      code: "X_WEB_ACCOUNT_IDENTITY_NOT_CONFIRMED",
      category: "account_session",
      origin: "remote_platform",
      operatorActionRequired: true,
      evidence: { sideHandle, pageHandle: handle, schemaConfirmed: Boolean(identity.schemaConfirmed) }
    }));
  }
  return { ...identity, handle, sideHandle, confirmed, loginStatus: "logged_in", lang: state.lang };
}

export async function assertXAccountHandle(tab, helpers, expectedHandle) {
  const identity = await readCurrentXAccountIdentity(tab, helpers);
  const expected = normalizeXHandle(expectedHandle, { required: true });
  if (identity.handle.toLowerCase() !== expected.toLowerCase()) {
    throw createXFailure(helpers, `The active X account @${identity.handle} does not match @${expected}.`, failureOptions({
      code: "X_WEB_ACCOUNT_MISMATCH",
      category: "account_session",
      origin: "remote_platform",
      operatorActionRequired: true,
      evidence: { actualHandle: identity.handle, expectedHandle: expected }
    }));
  }
  return identity;
}

export async function parseVisibleXTweets(tab, { maxItems = 50, targetPostId = "" } = {}) {
  const rows = await tab.evaluate(String.raw`((args) => {
    const parseMetric = (value) => {
      const text = String(value || "").replace(/,/g, "");
      const match = text.match(/([0-9]+(?:\.[0-9]+)?)([KMB])?/i);
      if (!match) return null;
      const scale = { K: 1e3, M: 1e6, B: 1e9 }[String(match[2] || "").toUpperCase()] || 1;
      return Math.round(Number(match[1]) * scale);
    };
    const absolute = (href) => {
      try { return new URL(href, location.origin).href.replace(/\?.*$/, ""); } catch { return ""; }
    };
    return Array.from(document.querySelectorAll('article[data-testid="tweet"]')).slice(0, args.maxItems).map((article, index) => {
      const statusAnchor = article.querySelector('time')?.closest('a[href*="/status/"]')
        || Array.from(article.querySelectorAll('a[href]')).find((a) => /\/status\/\d+/.test(a.getAttribute("href") || ""));
      const rawPostUrl = absolute(statusAnchor?.getAttribute("href") || "");
      const statusMatch = /\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/.exec(rawPostUrl);
      const postId = statusMatch?.[2] || "";
      const userText = article.querySelector('[data-testid="User-Name"]')?.innerText || "";
      const handle = userText.match(/@([A-Za-z0-9_]{1,15})/)?.[1] || statusMatch?.[1] || "";
      const postUrl = postId && handle ? location.origin + "/" + handle + "/status/" + postId : rawPostUrl;
      const userLines = userText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
      const displayName = userLines.find((line) => !line.startsWith("@") && !/^\u00b7$/.test(line)) || "";
      const timelineLabel = article.closest('section[aria-label], [role="region"][aria-label], div[aria-label]')?.getAttribute("aria-label") || "";
      const isPromoted = Boolean(article.querySelector('[data-testid="placementTracking"]')) || /(?:^|\n)Ad(?:\n|$)/.test(article.innerText || "");
      const replyingText = Array.from(article.querySelectorAll("span, div")).map((node) => node.innerText || "").find((text) => /^Replying to\s+@/i.test(text.trim())) || "";
      const replyingToHandles = Array.from(replyingText.matchAll(/@([A-Za-z0-9_]{1,15})/g), (match) => match[1]);
      const action = (testid) => article.querySelector('[data-testid="' + testid + '"]')?.getAttribute("aria-label") || "";
      const media = Array.from(article.querySelectorAll('[data-testid="tweetPhoto"] img, [data-testid="tweetPhoto"][src], video')).map((node) => ({
        type: node.tagName === "VIDEO" ? "video" : "image",
        url: node.currentSrc || node.src || node.poster || "",
        alt: node.getAttribute("alt") || ""
      })).filter((item) => item.url);
      if (!media.length) {
        for (const anchor of article.querySelectorAll('a[href*="/photo/"], a[href*="/video/"]')) {
          const url = absolute(anchor.getAttribute("href") || "");
          if (url && !media.some((item) => item.url === url)) media.push({ type: url.includes("/video/") ? "video" : "image", url, alt: "" });
        }
      }
      const visibleViewText = article.innerText.match(/([0-9]+(?:\.[0-9]+)?\s*[KMB]?)\s+Views?\b/i)?.[1] || "";
      return {
        index,
        postId,
        postUrl,
        handle,
        displayName,
        text: (article.querySelector('[data-testid="tweetText"]')?.innerText || "").trim(),
        createdAt: article.querySelector("time")?.getAttribute("datetime") || "",
        media,
        metrics: {
          replies: parseMetric(action("reply")),
          reposts: parseMetric(action("retweet")),
          likes: parseMetric(action("like")),
          bookmarks: parseMetric(action("bookmark")),
          views: parseMetric(article.querySelector('a[href$="/analytics"]')?.getAttribute("aria-label") || visibleViewText)
        },
        replyingToHandles,
        isReply: replyingToHandles.length > 0,
        timelineLabel,
        isPromoted,
        isTargetPost: Boolean(args.targetPostId && postId === args.targetPostId)
      };
    }).filter((item) => item.postId && item.postUrl);
  })(${JSON.stringify({ maxItems: Math.max(1, Math.min(200, Number(maxItems) || 50)), targetPostId: String(targetPostId || "") })})`);
  return deduplicateBy(rows || [], (item) => item.postId || item.postUrl);
}

export async function boundedXScrollCollect({
  tab,
  helpers = {},
  collect,
  key = (item) => item.postId || item.postUrl || JSON.stringify(item),
  maxResults,
  maxScrolls = 12,
  idleLimit = 3,
  totalTimeoutMs = 60000,
  scrollY = 900
} = {}) {
  if (typeof collect !== "function") throw new Error("boundedXScrollCollect requires collect");
  const limit = Math.max(1, Number(maxResults || 0));
  const startedAt = Date.now();
  const rows = new Map();
  let scannedCount = 0;
  let duplicateCount = 0;
  let idleScrolls = 0;
  let scrolls = 0;
  while (rows.size < limit && idleScrolls < idleLimit && Date.now() - startedAt < totalTimeoutMs) {
    throwIfXAborted(helpers);
    const batch = await collect();
    let added = 0;
    for (const item of batch || []) {
      scannedCount += 1;
      const itemKey = String(key(item) || "").trim();
      if (!itemKey) continue;
      if (rows.has(itemKey)) {
        duplicateCount += 1;
        continue;
      }
      rows.set(itemKey, item);
      added += 1;
      if (rows.size >= limit) break;
    }
    if (rows.size >= limit) break;
    idleScrolls = added ? 0 : idleScrolls + 1;
    if (scrolls >= maxScrolls) break;
    scrolls += 1;
    await tab.evaluate(String.raw`window.scrollBy({ top: ${Number(scrollY) || 900}, behavior: "smooth" }); true`);
    await delayWithAbort(helpers, 650);
  }
  return {
    items: [...rows.values()].slice(0, limit),
    resultCount: Math.min(rows.size, limit),
    scannedCount,
    deduplicatedCount: duplicateCount,
    scrollCount: scrolls,
    idleScrolls,
    timedOut: Date.now() - startedAt >= totalTimeoutMs
  };
}

export async function findVisibleXElement(tab, { testids = [], ariaLabels = [], texts = [], selector = "" } = {}) {
  return tab.evaluate(String.raw`((args) => {
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 1 && rect.height > 1 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth && style.display !== "none" && style.visibility !== "hidden" && style.pointerEvents !== "none";
    };
    const candidates = [];
    for (const testid of args.testids) candidates.push(...document.querySelectorAll('[data-testid="' + CSS.escape(testid) + '"]'));
    for (const aria of args.ariaLabels) candidates.push(...document.querySelectorAll('[aria-label="' + CSS.escape(aria) + '"]'));
    if (args.selector) { try { candidates.push(...document.querySelectorAll(args.selector)); } catch {} }
    if (args.texts.length) {
      candidates.push(...Array.from(document.querySelectorAll('button, [role="button"], [role="menuitem"], a, input, textarea, [contenteditable="true"]')).filter((node) => args.texts.includes((node.innerText || node.getAttribute("aria-label") || node.getAttribute("placeholder") || "").trim())));
    }
    const unique = Array.from(new Set(candidates)).filter(visible);
    if (!unique.length) return null;
    const topmost = unique.filter((candidate) => { const box = candidate.getBoundingClientRect(); const top = document.elementFromPoint(box.left + box.width / 2, box.top + Math.min(box.height / 2, 30)); return candidate === top || candidate.contains(top); });
    const actionable = topmost.length ? topmost : unique;
    const node = actionable[0];
    const rect = node.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + Math.min(rect.height / 2, 30));
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, left: rect.left, top: rect.top, width: rect.width, height: rect.height, tagName: node.tagName, testid: node.getAttribute("data-testid") || "", ariaLabel: node.getAttribute("aria-label") || "", ariaDisabled: node.getAttribute("aria-disabled") || "", disabled: Boolean(node.disabled), text: (node.innerText || "").trim().slice(0, 200), count: actionable.length, rawCount: unique.length, unoccluded: node === hit || node.contains(hit), hitTagName: hit?.tagName || "", hitTestid: hit?.getAttribute?.("data-testid") || "" };
  })(${JSON.stringify({ testids, ariaLabels, texts, selector })})`);
}

export async function clickVisibleXElement(tab, connection, helpers, criteria, { code = "X_WEB_ELEMENT_NOT_FOUND", expectedCount = 1, pressDurationMs = 0, requireUnoccluded = false } = {}) {
  throwIfXAborted(helpers);
  const target = await findVisibleXElement(tab, criteria);
  if (!target || (expectedCount === 1 && target.count !== 1) || (requireUnoccluded && !target.unoccluded)) {
    throw createXFailure(helpers, "The requested visible X control was not found unambiguously.", failureOptions({
      code: requireUnoccluded && target && !target.unoccluded ? "X_WEB_ELEMENT_OCCLUDED" : code,
      category: "skill_bug",
      origin: "remote_platform",
      retryable: true,
      bugCandidate: true,
      confidence: 0.72,
      requiredOccurrences: 3,
      evidence: { testids: (criteria.testids || []).join(","), count: target?.count || 0, unoccluded: target?.unoccluded, hitTagName: target?.hitTagName || "", hitTestid: target?.hitTestid || "" }
    }));
  }
  await dispatchMouseClick(connection, tab, target, { pressDurationMs });
  return target;
}

export async function dismissXTransientOverlay(tab, connection, helpers = {}) {
  throwIfXAborted(helpers);
  await connection.call("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }, tab.sessionId);
  await connection.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }, tab.sessionId);
  await delayWithAbort(helpers, 180);
}

export async function dismissXUnexpectedBlockingDialog(tab, helpers = {}, {
  appearanceTimeoutMs = 0,
  timeoutMs = 12000
} = {}) {
  const startedAt = Date.now();
  let sawDialog = false;
  while (Date.now() - startedAt < timeoutMs) {
    throwIfXAborted(helpers);
    const state = await tab.evaluate(String.raw`(() => {
      const visible = (node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 1 && rect.height > 1 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth && style.display !== 'none' && style.visibility !== 'hidden';
      };
      const dialog = [...document.querySelectorAll('[role="dialog"]')].filter(visible).find((node) => {
        const text = String(node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
        return /\bUnlock more on X\b/i.test(text) && /\bhuman behind this account\b/i.test(text);
      });
      if (!dialog) return { present: false, point: null };
      const button = [...dialog.querySelectorAll('button, [role="button"]')].filter(visible).find((node) => /^Got it$/i.test(String(node.innerText || node.textContent || node.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim()));
      if (!button) return { present: true, point: null };
      const rect = button.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      return { present: true, point: button === hit || button.contains(hit) ? { x, y } : null };
    })()`);
    if (!state.present) {
      if (sawDialog) return { dismissed: true };
      if (Date.now() - startedAt >= appearanceTimeoutMs) return { dismissed: false };
      await delayWithAbort(helpers, 150);
      continue;
    }
    sawDialog = true;
    if (state.point) await tab.click(state.point);
    await delayWithAbort(helpers, 300);
  }
  if (!sawDialog) return { dismissed: false };
  throw createXFailure(helpers, "The X Unlock more dialog remained visible after clicking Got it.", failureOptions({
    code: "X_WEB_UNLOCK_MORE_DIALOG_NOT_DISMISSED",
    category: "skill_bug",
    origin: "remote_platform",
    retryable: true,
    bugCandidate: true,
    confidence: 0.95,
    requiredOccurrences: 2
  }));
}

export async function clickReadyXElement(tab, connection, helpers, criteria, {
  code = "X_WEB_ELEMENT_NOT_FOUND",
  readyCode = "X_WEB_ELEMENT_NOT_READY",
  readyMessage = "The requested X control did not become enabled and unobstructed.",
  timeoutMs = 5000,
  expectedCount = 1,
  pressDurationMs = 80,
  dismissTransientOverlay = true
} = {}) {
  throwIfXAborted(helpers);
  const startedAt = Date.now();
  let target = null;
  let overlayDismissed = false;
  while (Date.now() - startedAt < timeoutMs) {
    throwIfXAborted(helpers);
    await dismissXUnexpectedBlockingDialog(tab, helpers, { timeoutMs: 3000 });
    target = await findVisibleXElement(tab, criteria);
    if (target
      && (expectedCount !== 1 || target.count === 1)
      && target.unoccluded
      && !target.disabled
      && target.ariaDisabled !== "true") {
      return clickVisibleXElement(tab, connection, helpers, criteria, { code, expectedCount, pressDurationMs, requireUnoccluded: true });
    }
    if (dismissTransientOverlay && target && !target.unoccluded && !overlayDismissed) {
      await dismissXTransientOverlay(tab, connection, helpers);
      overlayDismissed = true;
      continue;
    }
    await delayWithAbort(helpers, 150);
  }
  throw createXFailure(helpers, readyMessage, failureOptions({
    code: readyCode,
    category: "skill_bug",
    origin: "remote_platform",
    retryable: true,
    bugCandidate: true,
    confidence: 0.9,
    requiredOccurrences: 2,
    evidence: {
      testids: (criteria.testids || []).join(","),
      count: target?.count || 0,
      disabled: Boolean(target?.disabled),
      ariaDisabled: target?.ariaDisabled || "",
      unoccluded: target?.unoccluded,
      hitTagName: target?.hitTagName || "",
      hitTestid: target?.hitTestid || ""
    }
  }));
}

export async function waitForXComposerSubmissionState(tab, helpers = {}, {
  timeoutMs = 45000,
  intervalMs = 250,
  composerSelector = '[data-testid="tweetTextarea_0"]'
} = {}) {
  const startedAt = Date.now();
  let lastState = { kind: "ambiguous", alertText: "", composerTextLength: 0 };
  while (Date.now() - startedAt < timeoutMs) {
    throwIfXAborted(helpers);
    lastState = await tab.evaluate(String.raw`((selector) => {
      const visible = (node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 1 && rect.height > 1 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth && style.display !== 'none' && style.visibility !== 'hidden';
      };
      const composers = [...document.querySelectorAll(selector)].filter(visible);
      const composerText = composers.map((node) => String(node.innerText || node.textContent || '').trim()).filter(Boolean).join(' ');
      const alerts = [...document.querySelectorAll('[role="alert"], [data-testid="toast"]')]
        .map((node) => String(node.innerText || node.textContent || '').trim())
        .filter(Boolean);
      const alertText = alerts.join(' | ').slice(0, 500);
      if (/already said that/i.test(alertText)) return { kind: 'duplicate', alertText, composerTextLength: composerText.length };
      if (/your post was sent|post sent|\u5e16\u5b50\u5df2\u53d1\u9001|\u5df2\u53d1\u9001\u5e16\u5b50/i.test(alertText)) return { kind: 'confirmed', alertText, composerTextLength: composerText.length };
      if (alertText && /something went wrong|try again|network|rate limit|unable to (?:post|send)|account (?:is )?(?:locked|suspended)|verify/i.test(alertText)) return { kind: 'rejected', alertText, composerTextLength: composerText.length };
      if (!composers.length || !composerText) return { kind: 'composer_cleared', alertText, composerTextLength: 0 };
      return { kind: 'pending', alertText, composerTextLength: composerText.length };
    })(${JSON.stringify(composerSelector)})`).catch(() => ({ kind: "pending", alertText: "", composerTextLength: -1 }));
    if (["confirmed", "composer_cleared", "duplicate", "rejected"].includes(lastState.kind)) return lastState;
    await delayWithAbort(helpers, intervalMs);
  }
  return { ...lastState, kind: "ambiguous", timeoutMs };
}

export function assertXSubmissionAccepted(helpers, submissionState, {
  actionLabel = "X action",
  codePrefix = "X_WEB_ACTION"
} = {}) {
  if (submissionState?.kind === "rejected") {
    const alertText = String(submissionState.alertText || "");
    if (/network|something went wrong|try again/i.test(alertText)) {
      throw createXFailure(helpers, `X displayed a network error while submitting the ${actionLabel}.`, failureOptions({ code: "X_WEB_NETWORK_ERROR", category: "network", origin: "network", retryable: true, operatorActionRequired: false, bugCandidate: false, confidence: 0.95, evidence: { submissionState: submissionState.kind } }));
    }
    if (/account (?:is )?(?:locked|suspended)|verify/i.test(alertText)) {
      throw createXFailure(helpers, `X blocked the ${actionLabel} for the active account session.`, failureOptions({ code: `${codePrefix}_ACCOUNT_BLOCKED`, category: "account_session", origin: "remote_platform", retryable: false, operatorActionRequired: true, bugCandidate: false, confidence: 0.95, evidence: { submissionState: submissionState.kind } }));
    }
    throw createXFailure(helpers, `X rejected the submitted ${actionLabel}.`, failureOptions({ code: `${codePrefix}_REJECTED`, category: "business_result", origin: "remote_platform", retryable: false, operatorActionRequired: false, bugCandidate: false, confidence: 0.9, evidence: { submissionState: submissionState.kind } }));
  }
  if (submissionState?.kind === "ambiguous") {
    throw createXFailure(helpers, `X did not accept the ${actionLabel} button activation; the composer remained unchanged.`, failureOptions({ code: `${codePrefix}_CLICK_NOT_ACCEPTED`, category: "skill_bug", origin: "remote_platform", retryable: true, operatorActionRequired: false, bugCandidate: true, confidence: 0.9, deterministic: false, requiredOccurrences: 2, evidence: { submissionState: submissionState.kind, composerTextLength: submissionState.composerTextLength } }));
  }
  return submissionState;
}

export async function fillVisibleXInput(tab, connection, helpers, criteria, value, { code = "X_WEB_INPUT_NOT_FOUND", domEdit = false } = {}) {
  const target = await findVisibleXElement(tab, criteria);
  if (!target || target.count !== 1) {
    throw createXFailure(helpers, "The requested visible X input was not found unambiguously.", failureOptions({
      code,
      category: "skill_bug",
      origin: "remote_platform",
      retryable: true,
      bugCandidate: true,
      confidence: 0.72,
      requiredOccurrences: 3,
      evidence: { testids: (criteria.testids || []).join(","), count: target?.count || 0 }
    }));
  }
  await dispatchMouseClick(connection, tab, target);
  await tab.evaluate(String.raw`((args) => {
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 1 && rect.height > 1 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth && style.display !== "none" && style.visibility !== "hidden";
    };
    const candidates = [];
    for (const testid of args.testids || []) candidates.push(...document.querySelectorAll('[data-testid="' + CSS.escape(testid) + '"]'));
    for (const aria of args.ariaLabels || []) candidates.push(...document.querySelectorAll('[aria-label="' + CSS.escape(aria) + '"]'));
    if (args.selector) { try { candidates.push(...document.querySelectorAll(args.selector)); } catch {} }
    const unique = Array.from(new Set(candidates)).filter(visible);
    const candidate = unique.find((node) => { const rect = node.getBoundingClientRect(); const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + Math.min(rect.height / 2, 30)); return node === top || node.contains(top); }) || unique[0];
    const input = candidate?.matches?.('input, textarea, [contenteditable="true"]') ? candidate : candidate?.querySelector?.('input, textarea, [contenteditable="true"]');
    input?.focus?.();
    return Boolean(input);
  })(${JSON.stringify(criteria || {})})`);
  if (domEdit) {
    await tab.evaluate(String.raw`((args) => {
      const candidates = args.selector ? [...document.querySelectorAll(args.selector)] : [...document.querySelectorAll('[data-testid="' + CSS.escape(args.testids?.[0] || "") + '"]')];
      const candidate = candidates.find((node) => { const rect = node.getBoundingClientRect(); const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + Math.min(rect.height / 2, 30)); return node === top || node.contains(top); }) || candidates[0];
      const input = candidate?.matches?.('input, textarea, [contenteditable="true"]') ? candidate : candidate?.querySelector?.('input, textarea, [contenteditable="true"]');
      input?.focus?.();
      document.execCommand("selectAll", false, null);
      document.execCommand("insertText", false, args.value);
      return Boolean(input);
    })(${JSON.stringify({ ...criteria, value: String(value ?? "") })})`);
  } else {
    await connection.call("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17, modifiers: 2 }, tab.sessionId);
    await connection.call("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 }, tab.sessionId);
    await connection.call("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 }, tab.sessionId);
    await connection.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17 }, tab.sessionId);
    await connection.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 }, tab.sessionId);
    await connection.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 }, tab.sessionId);
    if (String(value ?? "")) await connection.call("Input.insertText", { text: String(value ?? "") }, tab.sessionId);
  }
  await delayWithAbort(helpers, 250);
  const actual = await tab.evaluate(String.raw`((args) => {
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 1 && rect.height > 1 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth && style.display !== "none" && style.visibility !== "hidden";
    };
    const candidates = [];
    for (const testid of args.testids || []) candidates.push(...document.querySelectorAll('[data-testid="' + CSS.escape(testid) + '"]'));
    for (const aria of args.ariaLabels || []) candidates.push(...document.querySelectorAll('[aria-label="' + CSS.escape(aria) + '"]'));
    if (args.selector) { try { candidates.push(...document.querySelectorAll(args.selector)); } catch {} }
    const unique = Array.from(new Set(candidates)).filter(visible);
    const candidate = unique.find((node) => { const rect = node.getBoundingClientRect(); const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + Math.min(rect.height / 2, 30)); return node === top || node.contains(top); }) || unique[0];
    const input = candidate?.matches?.('input, textarea, [contenteditable="true"]') ? candidate : candidate?.querySelector?.('input, textarea, [contenteditable="true"]');
    return String(input?.value ?? input?.innerText ?? input?.textContent ?? "");
  })(${JSON.stringify(criteria || {})})`);
  if (normalizeInputText(actual) !== normalizeInputText(value)) {
    throw createXFailure(helpers, "X input text did not match the requested value after typing.", failureOptions({
      code: "X_WEB_INPUT_VALUE_MISMATCH",
      category: "skill_bug",
      origin: "remote_platform",
      retryable: true,
      bugCandidate: true,
      confidence: 0.86,
      requiredOccurrences: 2,
      evidence: { expectedLength: String(value ?? "").length, actualLength: String(actual || "").length }
    }));
  }
  return actual;
}

export async function typeVisibleXInputHumanLike(tab, connection, helpers, criteria, value, {
  code = "X_WEB_INPUT_NOT_FOUND",
  minimumDelayMs = 32,
  maximumDelayMs = 84,
  retryAttempt = 0,
  eventMode = "char"
} = {}) {
  await dismissXUnexpectedBlockingDialog(tab, helpers, { timeoutMs: 3000 });
  const target = await findVisibleXElement(tab, criteria);
  if (!target || target.count !== 1) {
    throw createXFailure(helpers, "The requested visible X input was not found unambiguously.", failureOptions({
      code,
      category: "skill_bug",
      origin: "remote_platform",
      retryable: true,
      bugCandidate: true,
      confidence: 0.72,
      requiredOccurrences: 3,
      evidence: { testids: (criteria.testids || []).join(","), count: target?.count || 0 }
    }));
  }

  // BitBrowser may leave an otherwise attached X tab in the background after
  // another window receives focus. CDP key events are reliable only after the
  // page target is brought to the front again.
  await connection.call("Page.bringToFront", {}, tab.sessionId).catch(() => {});
  await delayWithAbort(helpers, 120);
  await dispatchMouseClick(connection, tab, target, { pressDurationMs: 55 });
  const focused = await tab.evaluate(String.raw`((args) => {
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 1 && rect.height > 1 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth && style.display !== "none" && style.visibility !== "hidden";
    };
    const candidates = [];
    for (const testid of args.testids || []) candidates.push(...document.querySelectorAll('[data-testid="' + CSS.escape(testid) + '"]'));
    for (const aria of args.ariaLabels || []) candidates.push(...document.querySelectorAll('[aria-label="' + CSS.escape(aria) + '"]'));
    if (args.selector) { try { candidates.push(...document.querySelectorAll(args.selector)); } catch {} }
    const unique = Array.from(new Set(candidates)).filter(visible);
    const candidate = unique.find((node) => {
      const rect = node.getBoundingClientRect();
      const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + Math.min(rect.height / 2, 30));
      return node === top || node.contains(top);
    }) || unique[0];
    const input = candidate?.matches?.('input, textarea, [contenteditable="true"]') ? candidate : candidate?.querySelector?.('input, textarea, [contenteditable="true"]');
    input?.focus?.();
    return Boolean(input && document.activeElement && (input === document.activeElement || input.contains(document.activeElement)));
  })(${JSON.stringify(criteria || {})})`);
  if (!focused) {
    throw createXFailure(helpers, "The requested X input could not receive keyboard focus.", failureOptions({
      code: "X_WEB_INPUT_FOCUS_FAILED",
      category: "skill_bug",
      origin: "remote_platform",
      retryable: true,
      bugCandidate: true,
      confidence: 0.86,
      requiredOccurrences: 2
    }));
  }

  await connection.call("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17, modifiers: 2 }, tab.sessionId);
  await connection.call("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 }, tab.sessionId);
  await connection.call("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 }, tab.sessionId);
  await connection.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17 }, tab.sessionId);
  await connection.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 }, tab.sessionId);
  await connection.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 }, tab.sessionId);

  // Clearing X's search field can replace the React-owned input node. Resolve
  // and click the current visible node again before sending character events.
  await delayWithAbort(helpers, 220);
  const refreshedTarget = await findVisibleXElement(tab, criteria);
  if (!refreshedTarget || refreshedTarget.count !== 1) {
    throw createXFailure(helpers, "The requested X input changed after clearing and could not be resolved again.", failureOptions({
      code: "X_WEB_INPUT_REFRESH_FAILED",
      category: "skill_bug",
      origin: "remote_platform",
      retryable: true,
      bugCandidate: true,
      confidence: 0.9,
      requiredOccurrences: 2,
      evidence: { testids: (criteria.testids || []).join(","), count: refreshedTarget?.count || 0 }
    }));
  }
  await dispatchMouseClick(connection, tab, refreshedTarget, { pressDurationMs: 55 });
  const refocused = await tab.evaluate(String.raw`((args) => {
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 1 && rect.height > 1 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth && style.display !== "none" && style.visibility !== "hidden";
    };
    const candidates = [];
    for (const testid of args.testids || []) candidates.push(...document.querySelectorAll('[data-testid="' + CSS.escape(testid) + '"]'));
    for (const aria of args.ariaLabels || []) candidates.push(...document.querySelectorAll('[aria-label="' + CSS.escape(aria) + '"]'));
    if (args.selector) { try { candidates.push(...document.querySelectorAll(args.selector)); } catch {} }
    const unique = Array.from(new Set(candidates)).filter(visible);
    const candidate = unique.find((node) => {
      const rect = node.getBoundingClientRect();
      const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + Math.min(rect.height / 2, 30));
      return node === top || node.contains(top);
    }) || unique[0];
    const input = candidate?.matches?.('input, textarea, [contenteditable="true"]') ? candidate : candidate?.querySelector?.('input, textarea, [contenteditable="true"]');
    input?.focus?.();
    return Boolean(input && document.activeElement && (input === document.activeElement || input.contains(document.activeElement)));
  })(${JSON.stringify(criteria || {})})`);
  if (!refocused) {
    throw createXFailure(helpers, "The refreshed X input could not receive keyboard focus.", failureOptions({
      code: "X_WEB_INPUT_REFOCUS_FAILED",
      category: "skill_bug",
      origin: "remote_platform",
      retryable: true,
      bugCandidate: true,
      confidence: 0.9,
      requiredOccurrences: 2
    }));
  }

  const requested = String(value ?? "").replace(/\r\n?/g, "\n");
  const characters = Array.from(requested);
  const startedAt = Date.now();
  const lowerDelay = Math.max(0, Number(minimumDelayMs) || 0);
  const upperDelay = Math.max(lowerDelay, Number(maximumDelayMs) || lowerDelay);
  for (let index = 0; index < characters.length; index += 1) {
    throwIfXAborted(helpers);
    const character = characters[index];
    if (character === "\n") {
      await connection.call("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }, tab.sessionId);
      await connection.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }, tab.sessionId);
    } else if (eventMode === "key") {
      const keyboard = keyboardEventForCharacter(character);
      await connection.call("Input.dispatchKeyEvent", { type: "keyDown", ...keyboard }, tab.sessionId);
      await connection.call("Input.dispatchKeyEvent", { type: "keyUp", key: keyboard.key, code: keyboard.code, windowsVirtualKeyCode: keyboard.windowsVirtualKeyCode }, tab.sessionId);
    } else {
      await connection.call("Input.dispatchKeyEvent", { type: "char", text: character, unmodifiedText: character }, tab.sessionId);
    }
    const codePoint = character.codePointAt(0) || 0;
    const spread = upperDelay - lowerDelay;
    const baseDelay = lowerDelay + (spread ? ((codePoint + (index * 17)) % (spread + 1)) : 0);
    const punctuationPause = /[.!?。！？,，;；:：]/u.test(character) ? 70 : 0;
    const newlinePause = character === "\n" ? 110 : 0;
    await delayWithAbort(helpers, baseDelay + punctuationPause + newlinePause);
  }
  await delayWithAbort(helpers, 220);

  const actual = await tab.evaluate(String.raw`((args) => {
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 1 && rect.height > 1 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth && style.display !== "none" && style.visibility !== "hidden";
    };
    const candidates = [];
    for (const testid of args.testids || []) candidates.push(...document.querySelectorAll('[data-testid="' + CSS.escape(testid) + '"]'));
    for (const aria of args.ariaLabels || []) candidates.push(...document.querySelectorAll('[aria-label="' + CSS.escape(aria) + '"]'));
    if (args.selector) { try { candidates.push(...document.querySelectorAll(args.selector)); } catch {} }
    const unique = Array.from(new Set(candidates)).filter(visible);
    const candidate = unique.find((node) => {
      const rect = node.getBoundingClientRect();
      const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + Math.min(rect.height / 2, 30));
      return node === top || node.contains(top);
    }) || unique[0];
    const input = candidate?.matches?.('input, textarea, [contenteditable="true"]') ? candidate : candidate?.querySelector?.('input, textarea, [contenteditable="true"]');
    return String(input?.value ?? input?.innerText ?? input?.textContent ?? "");
  })(${JSON.stringify(criteria || {})})`);
  if (normalizeInputText(actual) !== normalizeInputText(requested)) {
    if (retryAttempt < 1) {
      await delayWithAbort(helpers, 500);
      return typeVisibleXInputHumanLike(tab, connection, helpers, criteria, value, {
        code,
        minimumDelayMs,
        maximumDelayMs,
        retryAttempt: retryAttempt + 1,
        eventMode: "key"
      });
    }
    throw createXFailure(helpers, "X input text did not match the requested value after human-like typing.", failureOptions({
      code: "X_WEB_INPUT_VALUE_MISMATCH",
      category: "skill_bug",
      origin: "remote_platform",
      retryable: true,
      bugCandidate: true,
      confidence: 0.9,
      requiredOccurrences: 2,
      evidence: { expectedLength: requested.length, actualLength: String(actual || "").length, inputMethod: eventMode === "key" ? "cdp_key_events" : "cdp_character_events", typingAttempts: retryAttempt + 1 }
    }));
  }
  return {
    actual,
    method: eventMode === "key" ? "cdp_key_events" : "cdp_character_events",
    characterCount: characters.length,
    durationMs: Date.now() - startedAt
  };
}

function keyboardEventForCharacter(character) {
  if (/^[A-Za-z]$/.test(character)) {
    const upper = character.toUpperCase();
    return { key: character, code: `Key${upper}`, windowsVirtualKeyCode: upper.charCodeAt(0), text: character, unmodifiedText: character };
  }
  if (/^[0-9]$/.test(character)) {
    return { key: character, code: `Digit${character}`, windowsVirtualKeyCode: character.charCodeAt(0), text: character, unmodifiedText: character };
  }
  if (character === " ") return { key: " ", code: "Space", windowsVirtualKeyCode: 32, text: " ", unmodifiedText: " " };
  return { key: character, code: "", windowsVirtualKeyCode: character.codePointAt(0) || 0, text: character, unmodifiedText: character };
}

export async function setXFileInputFiles(context, helpers, mediaPaths = []) {
  const files = [];
  for (const value of mediaPaths || []) {
    const path = resolve(String(value || "").trim());
    if (!String(value || "").trim()) continue;
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) {
      throw createXFailure(helpers, `X media file was not found: ${path}`, failureOptions({ code: "X_WEB_MEDIA_FILE_NOT_FOUND", category: "user_input", origin: "input", operatorActionRequired: true, evidence: { path } }));
    }
    files.push(path);
  }
  if (!files.length) return [];
  const document = await context.connection.call("DOM.getDocument", { depth: -1, pierce: true }, context.tab.sessionId);
  const rootNodeId = document.root?.nodeId;
  const query = await context.connection.call("DOM.querySelector", { nodeId: rootNodeId, selector: 'input[data-testid="fileInput"], input[type="file"]' }, context.tab.sessionId);
  if (!query.nodeId) {
    throw createXFailure(helpers, "The X compose media input was not found.", failureOptions({ code: "X_WEB_MEDIA_INPUT_NOT_FOUND", category: "skill_bug", origin: "remote_platform", retryable: true, bugCandidate: true, confidence: 0.72, requiredOccurrences: 3 }));
  }
  await context.connection.call("DOM.setFileInputFiles", { nodeId: query.nodeId, files }, context.tab.sessionId);
  await delayWithAbort(helpers, 1000);
  return files;
}

export async function waitForXCondition(tab, predicate, { helpers = {}, timeoutMs = 15000, intervalMs = DEFAULT_WAIT_MS, code = "X_WEB_WAIT_TIMEOUT", message = "X page condition timed out", arg = null } = {}) {
  const source = typeof predicate === "function" ? `(${predicate.toString()})(${JSON.stringify(arg)})` : String(predicate);
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    throwIfXAborted(helpers);
    await dismissXUnexpectedBlockingDialog(tab, helpers, { timeoutMs: 3000 });
    const ready = await tab.evaluate(String.raw`Boolean(${source})`).catch(() => false);
    if (ready) return true;
    await delayWithAbort(helpers, intervalMs);
  }
  throw createXFailure(helpers, message, failureOptions({
    code,
    category: "skill_bug",
    origin: "remote_platform",
    retryable: true,
    bugCandidate: true,
    confidence: 0.72,
    requiredOccurrences: 3,
    evidence: { timeoutMs }
  }));
}

export async function detectXDirectMessageVariant(tab) {
  return tab.evaluate(String.raw`(() => {
    const path = location.pathname;
    const has = (id) => Boolean(document.querySelector('[data-testid="' + id + '"]'));
    const title = (document.querySelector('[data-testid="dm-inbox-title"]')?.innerText || "").trim();
    const variant = has("dm-container") || /^\/i\/chat(?:\/|$)/.test(path) ? "chat" : /^\/messages(?:\/|$)/.test(path) ? "messages" : "unknown";
    return { variant, path, title, hasInbox: has("dm-inbox-panel"), hasConversationPanel: has("dm-conversation-panel"), hasNewMessageButton: has("dm-new-chat-button") || has("NewDM_Button") };
  })()`);
}

export async function captureXRuntimeScreenshot(context, helpers = {}, { prefix = "x-web", failure = false } = {}) {
  if (!context?.tab) return "";
  const outputKey = failure ? "failureScreenshotPath" : "screenshotPath";
  const root = resolve(String(context.outputDir || "outputs"), "x-web");
  await mkdir(root, { recursive: true });
  const path = resolve(root, `${safeFileName(prefix)}-${failure ? "failure-" : ""}${Date.now()}.png`);
  let isolated = null;
  try {
    const profileId = String(context.output?.profileId || context.input?.profileId || "");
    const port = (await context.bitbrowser?.ports?.())?.data?.[profileId];
    if (port) {
      isolated = await new CdpConnection(await resolveXWebSocketEndpoint({ data: { http: `127.0.0.1:${port}` } }, profileId), { callTimeoutMs: 30000 }).connect();
      const target = (await isolated.listTargets()).find((item) => item.targetId === context.tab.targetId) || (await isolated.listTargets()).find((item) => item.type === "page" && isXWebUrl(item.url));
      if (target) {
        const { sessionId } = await isolated.call("Target.attachToTarget", { targetId: target.targetId, flatten: true });
        await isolated.call("Page.enable", {}, sessionId);
        const screenshot = await isolated.call("Page.captureScreenshot", { format: "png", fromSurface: true }, sessionId);
        await writeFile(path, Buffer.from(screenshot.data, "base64"));
      }
    }
  } finally {
    await isolated?.close?.().catch(() => {});
  }
  if (!(await stat(path).catch(() => null))) {
    if (typeof helpers.screenshot === "function") await helpers.screenshot({ prefix, outputKey }, context);
    const helperPath = context.output?.[outputKey] || "";
    if (helperPath) return helperPath;
    await writeFile(path, Buffer.from(await context.tab.screenshot({ fullPage: false }), "base64"));
  }
  context.output ||= {};
  context.output[outputKey] = path;
  return path;
}

export async function closeXProfileIfRequested(step, context, helpers = {}) {
  const closeProfile = Boolean(readParam(helpers, context.input || {}, step?.closeProfileFrom || "closeProfile", false));
  if (!closeProfile) {
    context.output.closedProfile = false;
    return false;
  }
  const profileId = String(context.input?.profileId || context.output?.profileId || "").trim();
  if (profileId && context.bitbrowser?.closeProfile) await context.bitbrowser.closeProfile({ id: profileId });
  context.output.closedProfile = true;
  return true;
}

export function commonXOutput(context, values = {}) {
  return {
    businessStatus: String(values.businessStatus || context.output?.businessStatus || "unknown"),
    profileId: String(context.output?.profileId || context.input?.profileId || ""),
    profileName: String(context.output?.profileName || context.input?.profileName || ""),
    screenshotPath: String(context.output?.screenshotPath || values.screenshotPath || ""),
    failureScreenshotPath: String(context.output?.failureScreenshotPath || values.failureScreenshotPath || ""),
    closedProfile: Boolean(context.output?.closedProfile),
    ...values
  };
}

export async function resolveXWebSocketEndpoint(opened, profileId) {
  const data = opened?.data || {};
  if (data.ws || data.wsEndpoint || data.browserWSEndpoint) return data.ws || data.wsEndpoint || data.browserWSEndpoint;
  const http = String(data.http || "").trim();
  if (!http) throw new Error(`X_WEB_CDP_ENDPOINT_MISSING: ${profileId}`);
  const versionUrl = /^https?:\/\//i.test(http) ? `${http.replace(/\/+$/, "")}/json/version` : `http://${http}/json/version`;
  const response = await fetch(versionUrl);
  if (!response.ok) throw new Error(`X_WEB_CDP_VERSION_HTTP_${response.status}`);
  const version = await response.json();
  if (!version.webSocketDebuggerUrl) throw new Error(`X_WEB_CDP_ENDPOINT_MISSING: ${profileId}`);
  return version.webSocketDebuggerUrl;
}

function failureOptions(options = {}) {
  return {
    retryable: false,
    operatorActionRequired: false,
    bugCandidate: false,
    confidence: 0.99,
    deterministic: false,
    ...options
  };
}

function normalizeXDate(value, field) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new Error(`X_WEB_${field.toUpperCase()}_INVALID: ${text || "missing"}`);
  }
  return text;
}

function readParam(helpers, input, key, fallback) {
  return typeof helpers?.readParam === "function" ? helpers.readParam(input, key, fallback) : input?.[key] ?? fallback;
}

export async function delayWithAbort(helpers, ms) {
  throwIfXAborted(helpers);
  if (typeof helpers?.delay === "function") await helpers.delay(ms);
  else await new Promise((resolveDelay) => setTimeout(resolveDelay, Math.max(0, Number(ms) || 0)));
  throwIfXAborted(helpers);
}

export async function waitXHumanStepDelay(helpers, { minimumMs = 1000, maximumMs = 3000 } = {}) {
  const lowerBound = Math.max(0, Math.floor(Number(minimumMs) || 0));
  const upperBound = Math.max(lowerBound, Math.floor(Number(maximumMs) || lowerBound));
  const delayMs = lowerBound + Math.floor(Math.random() * (upperBound - lowerBound + 1));
  await delayWithAbort(helpers, delayMs);
  return delayMs;
}

async function currentXUrl(tab) {
  return String(await tab.evaluate("location.href").catch(() => ""));
}

function isXWebUrl(value) {
  try { return /^(?:www\.)?x\.com$/i.test(new URL(value).hostname); } catch { return false; }
}

function safeXRoute(value) {
  try { return new URL(value).pathname; } catch { return ""; }
}

function deduplicateBy(items, key) {
  const rows = new Map();
  for (const item of items || []) {
    const value = String(key(item) || "").trim();
    if (value && !rows.has(value)) rows.set(value, item);
  }
  return [...rows.values()];
}

async function dispatchMouseClick(connection, tab, point, { pressDurationMs = 0 } = {}) {
  await connection.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y }, tab.sessionId);
  await connection.call("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1 }, tab.sessionId);
  if (Number(pressDurationMs) > 0) await new Promise((resolvePromise) => setTimeout(resolvePromise, Math.min(250, Number(pressDurationMs))));
  await connection.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1 }, tab.sessionId);
}

function normalizeInputText(value) {
  return String(value ?? "").replace(/\r\n/g, "\n").trimEnd();
}

function safeFileName(value) {
  return String(value || "x-web").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "x-web";
}
