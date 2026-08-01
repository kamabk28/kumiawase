/**
 * 公開しても問題ないフロントエンド設定です。
 * TURNSTILE_SECRET やパスワードなどの秘密情報は、ここには絶対に書かないでください。
 */
window.APP_CONFIG = Object.freeze({
  apiUrl: "YOUR_GAS_WEB_APP_URL",
  turnstileSiteKey: "YOUR_TURNSTILE_SITE_KEY",
  pollIntervalMs: 30_000,
  requestTimeoutMs: 20_000,
  sessionStorageKey: "ensemble-board-session-v1",
  undoStorageKey: "ensemble-board-undo-v1",
});

window.onTurnstileReady = () => {
  document.dispatchEvent(new CustomEvent("turnstile-ready"));
};
