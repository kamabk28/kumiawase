import { buildPushPayload } from "@block65/webcrypto-web-push";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAX_BODY_LENGTH = 20_000;
const MAX_SUBSCRIPTIONS_PER_BROADCAST = 45;
const SEND_CONCURRENCY = 6;
const JSON_HEADERS = Object.freeze({
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
});

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: JSON_HEADERS,
  });
}

async function respond(callback) {
  try {
    return await callback();
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonResponse(
        { ok: false, error: { code: error.code, message: error.message } },
        error.status,
      );
    }
    console.error(error);
    return jsonResponse(
      { ok: false, error: { code: "SERVER_ERROR", message: "通知サーバーでエラーが発生しました。" } },
      500,
    );
  }
}

async function readJson(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY_LENGTH) throw new HttpError(413, "PAYLOAD_TOO_LARGE", "送信内容が大きすぎます。");

  const text = await request.text();
  if (!text || text.length > MAX_BODY_LENGTH) {
    throw new HttpError(400, "BAD_REQUEST", "送信内容が空か、大きすぎます。");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "BAD_REQUEST", "送信形式が不正です。");
  }
}

function decodeBase64Url(value) {
  const base64 = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeBase64Url(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function timingSafeEqual(first, second) {
  const a = String(first || "");
  const b = String(second || "");
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return difference === 0;
}

async function hmacSha256(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
  return encodeBase64Url(signature);
}

function bearerToken(request) {
  const authorization = request.headers.get("authorization") || "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

export async function verifySessionToken(token, env, now = Date.now()) {
  if (!env.SESSION_SECRET || !env.SESSION_VERSION) {
    throw new HttpError(503, "NOT_CONFIGURED", "通知サーバーの認証設定が完了していません。");
  }

  const parts = String(token || "").split(".");
  if (parts.length !== 2) throw new HttpError(401, "AUTH_REQUIRED", "ログインが必要です。");

  const expected = await hmacSha256(env.SESSION_SECRET, parts[0]);
  if (!timingSafeEqual(expected, parts[1])) {
    throw new HttpError(401, "AUTH_REQUIRED", "ログインが必要です。");
  }

  let payload;
  try {
    payload = JSON.parse(decoder.decode(decodeBase64Url(parts[0])));
  } catch {
    throw new HttpError(401, "AUTH_REQUIRED", "ログインが必要です。");
  }

  if (!payload.exp || Number(payload.exp) < now) {
    throw new HttpError(401, "AUTH_REQUIRED", "ログインの有効期限が切れました。");
  }
  if (!payload.iat || Number(payload.iat) > now + 5 * 60 * 1000) {
    throw new HttpError(401, "AUTH_REQUIRED", "ログインが必要です。");
  }
  if (String(payload.ver) !== String(env.SESSION_VERSION)) {
    throw new HttpError(401, "AUTH_REQUIRED", "パスワードが変更されています。もう一度ログインしてください。");
  }
  return payload;
}

function requireSubscriptionStore(env) {
  if (!env.PUSH_SUBSCRIPTIONS) {
    throw new HttpError(503, "NOT_CONFIGURED", "通知先の保存先が設定されていません。");
  }
  return env.PUSH_SUBSCRIPTIONS;
}

function normalizeSubscription(raw) {
  const endpoint = String(raw?.endpoint || "").trim();
  const auth = String(raw?.keys?.auth || "").trim();
  const p256dh = String(raw?.keys?.p256dh || "").trim();

  if (!endpoint.startsWith("https://") || endpoint.length > 2_000) {
    throw new HttpError(400, "INVALID_SUBSCRIPTION", "通知先が不正です。");
  }
  if (!/^[A-Za-z0-9_-]{8,512}$/.test(auth) || !/^[A-Za-z0-9_-]{32,512}$/.test(p256dh)) {
    throw new HttpError(400, "INVALID_SUBSCRIPTION", "通知用の鍵が不正です。");
  }

  return {
    endpoint,
    expirationTime: raw.expirationTime == null ? null : Number(raw.expirationTime),
    keys: { auth, p256dh },
  };
}

async function subscriptionKey(endpoint) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(endpoint)));
  return `subscription:${encodeBase64Url(digest)}`;
}

function notificationForSchedule(schedule) {
  const startTime = String(schedule?.startTime || "");
  const endTime = String(schedule?.endTime || "");
  const time = /^\d{2}:\d{2}$/.test(startTime) && /^\d{2}:\d{2}$/.test(endTime)
    ? `${startTime}〜${endTime}の`
    : "";
  return {
    title: "新しい予定が追加されました",
    body: `${time}組み合わせ練習です。タップして確認してください。`,
    tag: schedule?.id ? `schedule-${schedule.id}` : "schedule-created",
    url: "/",
  };
}

export function handlePushConfig(context) {
  return respond(async () => {
    const publicKey = String(context.env.VAPID_PUBLIC_KEY || "").trim();
    return jsonResponse({
      ok: true,
      data: {
        enabled: Boolean(publicKey),
        publicKey,
      },
    });
  });
}

export function handleSubscriptionPut(context) {
  return respond(async () => {
    const store = requireSubscriptionStore(context.env);
    const session = await verifySessionToken(bearerToken(context.request), context.env);
    const body = await readJson(context.request);
    const subscription = normalizeSubscription(body.subscription);
    const key = await subscriptionKey(subscription.endpoint);
    const expiresAtSeconds = Math.floor(Number(session.exp) / 1000);

    await store.put(
      key,
      JSON.stringify({
        subscription,
        sessionVersion: String(session.ver),
        createdAt: new Date().toISOString(),
      }),
      { expiration: expiresAtSeconds },
    );
    return jsonResponse({ ok: true, data: { subscribed: true } });
  });
}

export function handleSubscriptionDelete(context) {
  return respond(async () => {
    const store = requireSubscriptionStore(context.env);
    await verifySessionToken(bearerToken(context.request), context.env);
    const body = await readJson(context.request);
    const endpoint = String(body.endpoint || "").trim();
    if (!endpoint.startsWith("https://")) {
      throw new HttpError(400, "INVALID_SUBSCRIPTION", "通知先が不正です。");
    }
    await store.delete(await subscriptionKey(endpoint));
    return jsonResponse({ ok: true, data: { subscribed: false } });
  });
}

async function sendOne({ key, record, schedule, env, buildPayload, fetchImpl, store }) {
  if (!record?.subscription || String(record.sessionVersion) !== String(env.SESSION_VERSION)) {
    await store.delete(key);
    return "removed";
  }

  try {
    const payload = await buildPayload(
      {
        data: notificationForSchedule(schedule),
        options: { ttl: 300, urgency: "normal" },
      },
      record.subscription,
      {
        subject: env.VAPID_SUBJECT,
        publicKey: env.VAPID_PUBLIC_KEY,
        privateKey: env.VAPID_PRIVATE_KEY,
      },
    );
    const response = await fetchImpl(record.subscription.endpoint, payload);
    if (response.status === 404 || response.status === 410) {
      await store.delete(key);
      return "removed";
    }
    return response.ok ? "sent" : "failed";
  } catch (error) {
    console.error("Web Push delivery failed", error);
    return "failed";
  }
}

async function broadcast(schedule, env, { buildPayload = buildPushPayload, fetchImpl = fetch } = {}) {
  const store = requireSubscriptionStore(env);
  const required = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT", "SESSION_VERSION"];
  if (required.some((key) => !env[key])) {
    throw new HttpError(503, "NOT_CONFIGURED", "Web Pushの鍵または認証設定が不足しています。");
  }

  const listed = await store.list({
    prefix: "subscription:",
    limit: MAX_SUBSCRIPTIONS_PER_BROADCAST,
  });
  const entries = [];
  for (let index = 0; index < listed.keys.length; index += SEND_CONCURRENCY) {
    const keyBatch = listed.keys.slice(index, index + SEND_CONCURRENCY);
    const records = await Promise.all(keyBatch.map((item) => store.get(item.name, "json")));
    entries.push(...keyBatch.map((item, itemIndex) => ({ key: item.name, record: records[itemIndex] })));
  }

  const results = [];
  for (let index = 0; index < entries.length; index += SEND_CONCURRENCY) {
    const batch = entries.slice(index, index + SEND_CONCURRENCY);
    results.push(
      ...(await Promise.all(
        batch.map((entry) =>
          sendOne({
            ...entry,
            schedule,
            env,
            buildPayload,
            fetchImpl,
            store,
          }),
        ),
      )),
    );
  }

  return {
    sent: results.filter((result) => result === "sent").length,
    failed: results.filter((result) => result === "failed").length,
    removed: results.filter((result) => result === "removed").length,
    limited: listed.list_complete === false,
  };
}

export function handleBroadcastPost(
  context,
  dependencies = {},
) {
  return respond(async () => {
    const providedSecret = bearerToken(context.request);
    const expectedSecret = String(context.env.PUSH_WEBHOOK_SECRET || "");
    if (!expectedSecret || !timingSafeEqual(providedSecret, expectedSecret)) {
      throw new HttpError(401, "UNAUTHORIZED", "通知送信を許可できません。");
    }

    const body = await readJson(context.request);
    if (!body.schedule || typeof body.schedule !== "object") {
      throw new HttpError(400, "BAD_REQUEST", "予定データがありません。");
    }

    const task = broadcast(body.schedule, context.env, dependencies);
    if (typeof context.waitUntil === "function") {
      context.waitUntil(
        task.catch((error) => {
          console.error("Push broadcast failed", error);
        }),
      );
      return jsonResponse({ ok: true, data: { queued: true } }, 202);
    }

    return jsonResponse({ ok: true, data: await task });
  });
}
