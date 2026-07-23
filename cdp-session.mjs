let nextMessageId = 1;
const DEFAULT_CONNECT_TIMEOUT_MS = 30000;
const DEFAULT_CALL_TIMEOUT_MS = 60000;

function readPositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

export class CdpConnection {
  constructor(wsUrl, { connectTimeoutMs, callTimeoutMs } = {}) {
    if (!wsUrl) throw new Error("CdpConnection requires wsUrl");
    this.wsUrl = wsUrl;
    this.connectTimeoutMs = readPositiveInteger(connectTimeoutMs ?? process.env.QQK_CDP_CONNECT_TIMEOUT_MS, DEFAULT_CONNECT_TIMEOUT_MS);
    this.callTimeoutMs = readPositiveInteger(callTimeoutMs ?? process.env.QQK_CDP_CALL_TIMEOUT_MS, DEFAULT_CALL_TIMEOUT_MS);
    this.ws = null;
    this.pending = new Map();
    this.sessions = new Map();
    this.eventListeners = new Map();
  }

  async connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return this;

    this.ws = new WebSocket(this.wsUrl);
    this.ws.addEventListener("message", (event) => this.onMessage(event));
    this.ws.addEventListener("close", () => this.rejectAll(new Error("CDP WebSocket closed")));
    this.ws.addEventListener("error", () => this.rejectAll(new Error("CDP WebSocket error")));

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timed out connecting to ${this.wsUrl} after ${this.connectTimeoutMs}ms`)), this.connectTimeoutMs);
      this.ws.addEventListener("open", () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });
      this.ws.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error(`Failed connecting to ${this.wsUrl}`));
      }, { once: true });
    });

    return this;
  }

  async close() {
    if (this.ws) this.ws.close();
    this.rejectAll(new Error("CDP connection closed"));
  }

  async call(method, params = {}, sessionId) {
    await this.connect();
    const id = nextMessageId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;

    const promise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP call timed out after ${this.callTimeoutMs}ms: ${method}`));
      }, this.callTimeoutMs);
      this.pending.set(id, { resolve, reject, timeout, method });
    });

    this.ws.send(JSON.stringify(payload));
    return promise;
  }

  async createTab(url = "about:blank") {
    const { targetId } = await this.call("Target.createTarget", { url });
    const { sessionId } = await this.call("Target.attachToTarget", { targetId, flatten: true });
    await this.call("Runtime.enable", {}, sessionId);
    await this.call("Page.enable", {}, sessionId);
    return new CdpTab(this, { targetId, sessionId });
  }

  async listTargets() {
    const result = await this.call("Target.getTargets");
    return result.targetInfos || [];
  }

  onEvent(method, listener) {
    if (!method || typeof listener !== "function") {
      throw new Error("CdpConnection.onEvent requires a method and listener");
    }
    const listeners = this.eventListeners.get(method) || new Set();
    listeners.add(listener);
    this.eventListeners.set(method, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.eventListeners.delete(method);
    };
  }

  onMessage(event) {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    if (message.method) {
      for (const listener of this.eventListeners.get(message.method) || []) {
        try {
          listener(message.params || {}, message.sessionId, message);
        } catch {
          // Event consumers own asynchronous error handling; one listener must
          // not prevent other CDP events or command responses from resolving.
        }
      }
    }

    if (!message.id) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pending.delete(message.id);

    if (message.error) {
      pending.reject(new Error(`${pending.method}: ${message.error.message || JSON.stringify(message.error)}`));
      return;
    }

    pending.resolve(message.result || {});
  }

  rejectAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export class CdpTab {
  constructor(connection, { targetId, sessionId }) {
    this.connection = connection;
    this.targetId = targetId;
    this.sessionId = sessionId;
  }

  async navigate(url) {
    await this.connection.call("Page.navigate", { url }, this.sessionId);
    return { targetId: this.targetId, url };
  }

  async evaluate(expression) {
    const result = await this.connection.call("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    }, this.sessionId);
    if (result.exceptionDetails) {
      const description = result.exceptionDetails.exception?.description
        || result.exceptionDetails.exception?.value
        || result.exceptionDetails.text
        || "Evaluation failed";
      throw new Error(String(description));
    }
    return result.result?.value;
  }

  async domSnapshot() {
    return this.evaluate("document.body ? document.body.innerText : document.documentElement.innerText");
  }

  async click({ x, y }) {
    await this.connection.call("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      clickCount: 1
    }, this.sessionId);
    await this.connection.call("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      clickCount: 1
    }, this.sessionId);
    return { x, y };
  }

  async type(text) {
    for (const char of [...text]) {
      await this.connection.call("Input.dispatchKeyEvent", {
        type: "char",
        text: char,
        unmodifiedText: char
      }, this.sessionId);
    }
    return { length: text.length };
  }

  async press(key) {
    await this.connection.call("Input.dispatchKeyEvent", { type: "keyDown", key }, this.sessionId);
    await this.connection.call("Input.dispatchKeyEvent", { type: "keyUp", key }, this.sessionId);
    return { key };
  }

  async screenshot({ fullPage = false } = {}) {
    const params = { format: "png", fromSurface: true };
    if (fullPage) {
      const metrics = await this.connection.call("Page.getLayoutMetrics", {}, this.sessionId);
      const size = metrics.cssContentSize;
      if (size) {
        params.captureBeyondViewport = true;
        params.clip = { x: size.x || 0, y: size.y || 0, width: size.width, height: size.height, scale: 1 };
      }
    }
    const result = await this.connection.call("Page.captureScreenshot", params, this.sessionId);
    return result.data;
  }
}
