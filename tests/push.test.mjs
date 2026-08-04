import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import {
  handleBroadcastPost,
  handleSubscriptionDelete,
  handleSubscriptionPut,
  verifySessionToken,
} from "../cloudflare/push.js";

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function createSessionToken(secret, version = "1", now = Date.now()) {
  const payload = base64Url(JSON.stringify({
    iat: now - 1_000,
    exp: now + 60_000,
    ver: version,
    nonce: "test",
  }));
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

class FakeKV {
  constructor() {
    this.records = new Map();
  }

  async put(key, value) {
    this.records.set(key, value);
  }

  async get(key, type) {
    const value = this.records.get(key);
    if (value == null) return null;
    return type === "json" ? JSON.parse(value) : value;
  }

  async delete(key) {
    this.records.delete(key);
  }

  async list({ prefix, limit }) {
    const keys = [...this.records.keys()]
      .filter((key) => key.startsWith(prefix))
      .slice(0, limit)
      .map((name) => ({ name }));
    return { keys, list_complete: keys.length === this.records.size };
  }
}

function subscription(endpoint = "https://push.example.test/device-1") {
  return {
    endpoint,
    expirationTime: null,
    keys: {
      auth: "A".repeat(22),
      p256dh: "B".repeat(87),
    },
  };
}

function request(url, method, token, body) {
  return new Request(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function pushEnv(store) {
  return {
    PUSH_SUBSCRIPTIONS: store,
    SESSION_SECRET: "session-secret",
    SESSION_VERSION: "1",
    VAPID_PUBLIC_KEY: "public-key",
    VAPID_PRIVATE_KEY: "private-key",
    VAPID_SUBJECT: "mailto:admin@example.test",
    PUSH_WEBHOOK_SECRET: "webhook-secret",
  };
}

test("GASと同じ形式の署名済みセッショントークンを検証する", async () => {
  const env = pushEnv(new FakeKV());
  const token = createSessionToken(env.SESSION_SECRET);
  const payload = await verifySessionToken(token, env);
  assert.equal(payload.ver, "1");

  await assert.rejects(
    verifySessionToken(`${token}x`, env),
    /ログインが必要です/,
  );
});

test("通知購読をKVへ登録し、同じ端末を解除できる", async () => {
  const store = new FakeKV();
  const env = pushEnv(store);
  const token = createSessionToken(env.SESSION_SECRET);

  const putResponse = await handleSubscriptionPut({
    env,
    request: request(
      "https://app.example.test/api/push/subscriptions",
      "PUT",
      token,
      { subscription: subscription() },
    ),
  });
  assert.equal(putResponse.status, 200);
  assert.equal(store.records.size, 1);

  const deleteResponse = await handleSubscriptionDelete({
    env,
    request: request(
      "https://app.example.test/api/push/subscriptions",
      "DELETE",
      token,
      { endpoint: subscription().endpoint },
    ),
  });
  assert.equal(deleteResponse.status, 200);
  assert.equal(store.records.size, 0);
});

test("認証済みWebhookで現行セッションの端末へ通知し、旧端末を除去する", async () => {
  const store = new FakeKV();
  await store.put("subscription:current", JSON.stringify({
    subscription: subscription("https://push.example.test/current"),
    sessionVersion: "1",
  }));
  await store.put("subscription:stale", JSON.stringify({
    subscription: subscription("https://push.example.test/stale"),
    sessionVersion: "0",
  }));
  const env = pushEnv(store);
  const pushed = [];
  const tasks = [];

  const response = await handleBroadcastPost(
    {
      env,
      request: request(
        "https://app.example.test/api/push/broadcast",
        "POST",
        env.PUSH_WEBHOOK_SECRET,
        { schedule: { id: "schedule-1", startTime: "14:00", endTime: "15:00" } },
      ),
      waitUntil(task) {
        tasks.push(task);
      },
    },
    {
      async buildPayload(message, target) {
        assert.match(message.data.body, /14:00〜15:00/);
        return { method: "POST", body: JSON.stringify({ target }) };
      },
      async fetchImpl(endpoint) {
        pushed.push(endpoint);
        return new Response("", { status: 201 });
      },
    },
  );

  assert.equal(response.status, 202);
  await Promise.all(tasks);
  assert.deepEqual(pushed, ["https://push.example.test/current"]);
  assert.equal(store.records.has("subscription:stale"), false);
});

test("Webhook秘密鍵が違う場合は通知しない", async () => {
  const env = pushEnv(new FakeKV());
  const response = await handleBroadcastPost({
    env,
    request: request(
      "https://app.example.test/api/push/broadcast",
      "POST",
      "wrong-secret",
      { schedule: { id: "schedule-1" } },
    ),
  });

  assert.equal(response.status, 401);
});
