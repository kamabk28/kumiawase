export const NOTIFICATION_STATES = Object.freeze({
  blocked: "blocked",
  disabled: "disabled",
  enabled: "enabled",
  unavailable: "unavailable",
  unsupported: "unsupported",
});

export function base64UrlToUint8Array(value) {
  const base64 = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function state(key, message) {
  return { key, message };
}

export class PushNotificationManager {
  constructor({
    apiBase = "/api/push",
    serviceWorkerUrl = "/sw.js",
    getSessionToken,
    environment = globalThis,
    fetchImpl = globalThis.fetch,
  } = {}) {
    this.apiBase = String(apiBase).replace(/\/+$/, "");
    this.serviceWorkerUrl = serviceWorkerUrl;
    this.getSessionToken = getSessionToken || (() => "");
    this.environment = environment;
    this.fetchImpl = fetchImpl;
    this.config = null;
  }

  isSupported() {
    const { navigator, Notification, PushManager, isSecureContext } = this.environment;
    return Boolean(
      isSecureContext &&
      navigator?.serviceWorker &&
      Notification &&
      PushManager,
    );
  }

  async getState({ checkServer = false } = {}) {
    if (!this.isSupported()) {
      return state(
        NOTIFICATION_STATES.unsupported,
        "このブラウザではWeb Push通知を利用できません。",
      );
    }

    if (this.environment.Notification.permission === "denied") {
      return state(
        NOTIFICATION_STATES.blocked,
        "ブラウザ側で通知が拒否されています。サイト設定から通知を許可してください。",
      );
    }

    if (checkServer) {
      try {
        const config = await this.fetchConfig({ refresh: true });
        if (!config.enabled || !config.publicKey) {
          return state(
            NOTIFICATION_STATES.unavailable,
            "Cloudflare Pages側の通知設定がまだ完了していません。",
          );
        }
      } catch {
        return state(
          NOTIFICATION_STATES.unavailable,
          "通知サーバーへ接続できません。Cloudflare Pagesの設定を確認してください。",
        );
      }
    }

    if (this.environment.Notification.permission !== "granted") {
      return state(
        NOTIFICATION_STATES.disabled,
        "この端末では通知がまだ有効になっていません。",
      );
    }

    const registration = await this.environment.navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager?.getSubscription();
    return subscription
      ? state(NOTIFICATION_STATES.enabled, "この端末で新しい予定の通知を受け取ります。")
      : state(NOTIFICATION_STATES.disabled, "この端末では通知が停止しています。");
  }

  async fetchConfig({ refresh = false } = {}) {
    if (this.config && !refresh) return this.config;
    const response = await this.fetchImpl(`${this.apiBase}/config`, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) {
      throw new Error(result?.error?.message || "通知設定を取得できませんでした。");
    }
    this.config = result.data;
    return this.config;
  }

  async registerServiceWorker() {
    const registration = await this.environment.navigator.serviceWorker.register(
      this.serviceWorkerUrl,
      { scope: "/" },
    );
    await this.environment.navigator.serviceWorker.ready;
    return registration;
  }

  async saveSubscription(subscription) {
    const sessionToken = String(this.getSessionToken() || "");
    if (!sessionToken) throw new Error("通知を有効にするにはログインが必要です。");

    const response = await this.fetchImpl(`${this.apiBase}/subscriptions`, {
      method: "PUT",
      cache: "no-store",
      credentials: "omit",
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ subscription: subscription.toJSON() }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) {
      throw new Error(result?.error?.message || "通知先を登録できませんでした。");
    }
  }

  async enable() {
    if (!this.isSupported()) return this.getState();
    const config = await this.fetchConfig({ refresh: true });
    if (!config.enabled || !config.publicKey) {
      throw new Error("Cloudflare Pages側の通知設定がまだ完了していません。");
    }

    const registration = await this.registerServiceWorker();
    const permission = await this.environment.Notification.requestPermission();
    if (permission !== "granted") {
      return state(
        NOTIFICATION_STATES.blocked,
        "通知が許可されませんでした。ブラウザのサイト設定をご確認ください。",
      );
    }

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(config.publicKey),
      });
    }

    try {
      await this.saveSubscription(subscription);
    } catch (error) {
      await subscription.unsubscribe().catch(() => {});
      throw error;
    }
    return state(NOTIFICATION_STATES.enabled, "この端末で通知を受け取るようにしました。");
  }

  async resyncIfEnabled() {
    if (!this.isSupported() || this.environment.Notification.permission !== "granted") return;
    const registration = await this.environment.navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager?.getSubscription();
    if (!subscription) return;
    await this.fetchConfig({ refresh: true });
    await this.saveSubscription(subscription);
  }

  async disable() {
    if (!this.isSupported()) return this.getState();
    const registration = await this.environment.navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager?.getSubscription();
    if (!subscription) {
      return state(NOTIFICATION_STATES.disabled, "この端末の通知は停止しています。");
    }

    const sessionToken = String(this.getSessionToken() || "");
    if (sessionToken) {
      await this.fetchImpl(`${this.apiBase}/subscriptions`, {
        method: "DELETE",
        cache: "no-store",
        credentials: "omit",
        headers: {
          Authorization: `Bearer ${sessionToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      }).catch(() => null);
    }
    await subscription.unsubscribe();
    return state(NOTIFICATION_STATES.disabled, "この端末の通知を停止しました。");
  }

  async showTestNotification() {
    if (!this.isSupported() || this.environment.Notification.permission !== "granted") {
      throw new Error("先に通知を有効にしてください。");
    }
    const registration =
      (await this.environment.navigator.serviceWorker.getRegistration()) ||
      (await this.registerServiceWorker());
    await registration.showNotification("組み合わせ練習・通知テスト", {
      body: "通知は正常に動作しています。",
      tag: "notification-test",
      data: { url: "/" },
    });
  }
}
