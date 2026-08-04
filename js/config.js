/**
 * 公開しても問題ないフロントエンド設定です。
 * TURNSTILE_SECRET やパスワードなどの秘密情報は、ここには絶対に書かないでください。
 */
window.APP_CONFIG = Object.freeze({
  apiUrl: "https://script.google.com/macros/s/AKfycbxQGPcgejyl2R9GgnHFUqg7lZ76xEhs90hmMBRDesOPt-W0VFlbsD_Bu97KNwgjj76Z/exec",
  turnstileSiteKey: "0x4AAAAAAEDgelgQX6TLlnUe",
  pollIntervalMs: 30_000,
  requestTimeoutMs: 20_000,
  sessionStorageKey: "ensemble-board-session-v1",
  undoStorageKey: "ensemble-board-undo-v1",
  pushApiBase: "/api/push",
  pushServiceWorkerUrl: "/sw.js",
});

window.onTurnstileReady = () => {
  document.dispatchEvent(new CustomEvent("turnstile-ready"));
};
