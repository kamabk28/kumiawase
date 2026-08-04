import test from "node:test";
import assert from "node:assert/strict";

import {
  NOTIFICATION_STATES,
  PushNotificationManager,
  base64UrlToUint8Array,
} from "../js/notifications.js";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createNotificationFixture() {
  const requests = [];
  let currentSubscription = null;
  let unsubscribed = false;
  const subscription = {
    endpoint: "https://push.example.test/device-1",
    toJSON() {
      return {
        endpoint: this.endpoint,
        expirationTime: null,
        keys: {
          auth: "A".repeat(22),
          p256dh: "B".repeat(87),
        },
      };
    },
    async unsubscribe() {
      unsubscribed = true;
      currentSubscription = null;
      return true;
    },
  };
  const registration = {
    pushManager: {
      async getSubscription() {
        return currentSubscription;
      },
      async subscribe(options) {
        assert.equal(options.userVisibleOnly, true);
        assert.ok(options.applicationServerKey instanceof Uint8Array);
        currentSubscription = subscription;
        return subscription;
      },
    },
    async showNotification() {},
  };
  const Notification = {
    permission: "default",
    async requestPermission() {
      this.permission = "granted";
      return "granted";
    },
  };
  const environment = {
    isSecureContext: true,
    Notification,
    PushManager: class PushManager {},
    navigator: {
      serviceWorker: {
        ready: Promise.resolve(registration),
        async register(url, options) {
          assert.equal(url, "/sw.js");
          assert.deepEqual(options, { scope: "/" });
          return registration;
        },
        async getRegistration() {
          return registration;
        },
      },
    },
  };
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if (url.endsWith("/config")) {
      return jsonResponse({
        ok: true,
        data: {
          enabled: true,
          publicKey: "BOr6vY6fDDwM17l8p8PMs8Ygk5LQ6lve3cdvnaOuwOr6vY6fDDwM17l8p8PMs8Ygk5LQ6lve3cdvnaOuwA",
        },
      });
    }
    return jsonResponse({ ok: true, data: {} });
  };

  return {
    environment,
    fetchImpl,
    get requests() {
      return requests;
    },
    get unsubscribed() {
      return unsubscribed;
    },
  };
}

test("VAPID公開鍵のbase64urlをUint8Arrayへ変換する", () => {
  assert.deepEqual([...base64UrlToUint8Array("AQID-_8")], [1, 2, 3, 251, 255]);
});

test("通知を許可して購読先を認証付きで保存する", async () => {
  const fixture = createNotificationFixture();
  const manager = new PushNotificationManager({
    getSessionToken: () => "signed-session",
    environment: fixture.environment,
    fetchImpl: fixture.fetchImpl,
  });

  const state = await manager.enable();
  assert.equal(state.key, NOTIFICATION_STATES.enabled);

  const put = fixture.requests.find((request) => request.options.method === "PUT");
  assert.ok(put);
  assert.equal(put.url, "/api/push/subscriptions");
  assert.equal(put.options.headers.Authorization, "Bearer signed-session");
  assert.equal(JSON.parse(put.options.body).subscription.endpoint, "https://push.example.test/device-1");
});

test("通知停止時にサーバーとブラウザの購読を解除する", async () => {
  const fixture = createNotificationFixture();
  const manager = new PushNotificationManager({
    getSessionToken: () => "signed-session",
    environment: fixture.environment,
    fetchImpl: fixture.fetchImpl,
  });
  await manager.enable();

  const state = await manager.disable();
  assert.equal(state.key, NOTIFICATION_STATES.disabled);
  assert.equal(fixture.unsubscribed, true);

  const request = fixture.requests.find((item) => item.options.method === "DELETE");
  assert.ok(request);
  assert.equal(request.options.headers.Authorization, "Bearer signed-session");
  assert.equal(JSON.parse(request.options.body).endpoint, "https://push.example.test/device-1");
});

test("安全なコンテキストでない場合は非対応として扱う", async () => {
  const manager = new PushNotificationManager({
    environment: {
      isSecureContext: false,
      navigator: {},
      Notification: {},
      PushManager: class PushManager {},
    },
    fetchImpl: async () => {
      throw new Error("呼ばれない");
    },
  });

  assert.equal((await manager.getState()).key, NOTIFICATION_STATES.unsupported);
});
