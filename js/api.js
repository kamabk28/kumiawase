import {
  addMinutes,
  allScheduleParts,
  rangesOverlap,
  roundTime,
  sortSchedules,
  todayKey,
} from "./core.js";

export class ApiError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.details = details;
  }
}

export class ApiClient {
  constructor(apiUrl, { timeoutMs = 20_000 } = {}) {
    this.apiUrl = apiUrl;
    this.timeoutMs = timeoutMs;
    this.sessionToken = "";
  }

  setSessionToken(token) {
    this.sessionToken = String(token ?? "");
  }

  async request(action, data = {}, { authenticated = true } = {}) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), this.timeoutMs);
    const payload = { action, ...data };
    if (authenticated) payload.sessionToken = this.sessionToken;

    try {
      const response = await fetch(this.apiUrl, {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        redirect: "follow",
        cache: "no-store",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const text = await response.text();
      let result;
      try {
        result = JSON.parse(text);
      } catch {
        throw new ApiError(
          "INVALID_RESPONSE",
          "サーバーから正しい応答を受け取れませんでした。GASの公開設定を確認してください。",
        );
      }

      if (!result.ok) {
        throw new ApiError(
          result.error?.code || "API_ERROR",
          result.error?.message || "処理に失敗しました。",
          result.error?.details ?? null,
        );
      }

      if (result.sessionToken) this.setSessionToken(result.sessionToken);
      return result;
    } catch (error) {
      if (error.name === "AbortError") {
        throw new ApiError("TIMEOUT", "通信がタイムアウトしました。もう一度お試しください。");
      }
      if (error instanceof ApiError) throw error;
      throw new ApiError("NETWORK_ERROR", "通信できませんでした。ネットワーク接続を確認してください。");
    } finally {
      window.clearTimeout(timeout);
    }
  }

  login(password, turnstileToken) {
    return this.request("login", { password, turnstileToken }, { authenticated: false });
  }

  checkSession() {
    return this.request("checkSession");
  }

  bootstrap(date = todayKey()) {
    return this.request("bootstrap", { date });
  }

  list(date) {
    return this.request("list", { date });
  }

  create(schedule) {
    return this.request("create", { schedule });
  }

  update(schedule) {
    return this.request("update", { schedule });
  }

  remove(id, version) {
    return this.request("delete", { id, version });
  }

  undoDelete(id) {
    return this.request("undoDelete", { id });
  }
}

export class MockApi {
  constructor() {
    this.sessionToken = "demo-session";
    this.counter = 10;
    this.schedules = makeDemoSchedules();
  }

  setSessionToken(token) {
    this.sessionToken = String(token ?? "");
  }

  async delay(value) {
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    return value;
  }

  login() {
    return this.delay({ ok: true, data: { authenticated: true }, sessionToken: "demo-session" });
  }

  checkSession() {
    return this.delay({ ok: true, data: { authenticated: true }, sessionToken: "demo-session" });
  }

  bootstrap(date = todayKey()) {
    return this.delay({
      ok: true,
      data: {
        date,
        schedules: this.activeForDate(date),
        options: null,
      },
      sessionToken: "demo-session",
    });
  }

  list(date) {
    return this.delay({ ok: true, data: { date, schedules: this.activeForDate(date) } });
  }

  activeForDate(date) {
    return sortSchedules(
      this.schedules.filter((schedule) => schedule.practiceDate === date && schedule.status === "active"),
    );
  }

  async create(input) {
    this.assertConflicts(input);
    const now = new Date().toISOString();
    const record = {
      ...input,
      id: `demo-${this.counter++}`,
      practiceDate: todayKey(),
      createdAt: now,
      updatedAt: now,
      status: "active",
      deletedAt: "",
      version: 1,
    };
    this.schedules.push(record);
    return this.delay({ ok: true, data: { schedule: record } });
  }

  async update(input) {
    const index = this.schedules.findIndex((item) => item.id === input.id);
    if (index < 0) throw new ApiError("NOT_FOUND", "予定が見つかりませんでした。");
    this.assertConflicts(input, input.id);
    const record = {
      ...this.schedules[index],
      ...input,
      updatedAt: new Date().toISOString(),
      version: this.schedules[index].version + 1,
    };
    this.schedules[index] = record;
    return this.delay({ ok: true, data: { schedule: record } });
  }

  async remove(id, version) {
    const record = this.schedules.find((item) => item.id === id && item.status === "active");
    if (!record) throw new ApiError("NOT_FOUND", "予定が見つかりませんでした。");
    if (record.version !== version) throw new ApiError("VERSION_CONFLICT", "予定が更新されています。");
    record.status = "deleted";
    record.deletedAt = new Date().toISOString();
    record.version += 1;
    const undoUntil = Date.now() + 10_000;
    return this.delay({ ok: true, data: { id, undoUntil } });
  }

  async undoDelete(id) {
    const record = this.schedules.find((item) => item.id === id && item.status === "deleted");
    if (!record) throw new ApiError("UNDO_EXPIRED", "取り消し可能時間を過ぎています。");
    if (Date.now() - new Date(record.deletedAt).getTime() > 10_000) {
      throw new ApiError("UNDO_EXPIRED", "取り消し可能時間を過ぎています。");
    }
    record.status = "active";
    record.deletedAt = "";
    record.version += 1;
    return this.delay({ ok: true, data: { schedule: record } });
  }

  assertConflicts(input, excludedId = "") {
    const overlapping = this.schedules.filter(
      (item) =>
        item.status === "active" &&
        item.practiceDate === todayKey() &&
        item.id !== excludedId &&
        rangesOverlap(input.startTime, input.endTime, item.startTime, item.endTime),
    );

    const roomConflict = overlapping.find((item) => item.room === input.room);
    if (roomConflict) {
      throw new ApiError("ROOM_CONFLICT", "同じ時間にその部屋が使われています。", {
        conflicts: [roomConflict],
      });
    }

    const inputParts = new Set(allScheduleParts(input));
    const partConflicts = overlapping.filter((item) => allScheduleParts(item).some((part) => inputParts.has(part)));
    if (partConflicts.length && !input.allowPartConflict) {
      throw new ApiError("PART_CONFLICT", "同じ楽器が別の予定にも含まれています。", {
        conflicts: partConflicts,
      });
    }
  }
}

function makeDemoSchedules() {
  const start = roundTime(new Date(), 15);
  const earlier = addMinutes(start, -45);
  const later = addMinutes(start, 60);
  const date = todayKey();
  const now = new Date().toISOString();
  return [
    {
      id: "demo-1",
      practiceDate: date,
      startTime: earlier,
      endTime: addMinutes(earlier, 40),
      part: "B♭クラリネット",
      withParts: ["ホルン"],
      room: "音楽室",
      content: "課題曲A 98小節目から",
      createdAt: now,
      updatedAt: now,
      status: "active",
      deletedAt: "",
      version: 1,
    },
    {
      id: "demo-2",
      practiceDate: date,
      startTime: start,
      endTime: addMinutes(start, 45),
      part: "フルート",
      withParts: ["オーボエ", "ファゴット"],
      room: "映写室",
      content: "自由曲 木管アンサンブル部分",
      createdAt: now,
      updatedAt: now,
      status: "active",
      deletedAt: "",
      version: 1,
    },
    {
      id: "demo-3",
      practiceDate: date,
      startTime: later,
      endTime: addMinutes(later, 50),
      part: "トランペット",
      withParts: ["トロンボーン", "ユーフォニアム"],
      room: "1-8",
      content: "コラールの縦と音程確認",
      createdAt: now,
      updatedAt: now,
      status: "active",
      deletedAt: "",
      version: 1,
    },
  ];
}
