/**
 * Ensemble Board - Google Apps Script API
 *
 * このファイルはGoogleスプレッドシートに紐づくApps Scriptへ配置します。
 * パスワードや秘密鍵はコードに書かず、スクリプトプロパティへ保存してください。
 */

const APP = Object.freeze({
  name: "Ensemble Board",
  timeZone: "Asia/Tokyo",
  schedulesSheet: "Schedules",
  settingsSheet: "Settings",
  changeLogSheet: "ChangeLog",
  sessionDays: 90,
  undoSeconds: 10,
  maxContentLength: 120,
  maxCustomValueLength: 30,
});

const PROPERTY_KEYS = Object.freeze({
  spreadsheetId: "SPREADSHEET_ID",
  passwordSalt: "PASSWORD_SALT",
  passwordHash: "PASSWORD_HASH",
  sessionSecret: "SESSION_SECRET",
  sessionVersion: "SESSION_VERSION",
  turnstileSecret: "TURNSTILE_SECRET",
  allowedHostname: "ALLOWED_HOSTNAME",
});

const SCHEDULE_HEADERS = Object.freeze([
  "id",
  "practiceDate",
  "startTime",
  "endTime",
  "part",
  "withParts",
  "room",
  "content",
  "createdAt",
  "updatedAt",
  "status",
  "deletedAt",
  "version",
]);

const SETTINGS_HEADERS = Object.freeze(["type", "group", "value", "sortOrder", "enabled"]);
const CHANGE_LOG_HEADERS = Object.freeze(["timestamp", "action", "scheduleId", "before", "after"]);
const OTHER_PREFIX = "その他：";

const DEFAULT_INSTRUMENT_GROUPS = Object.freeze([
  {
    name: "木管楽器",
    values: [
      "ピッコロ",
      "フルート",
      "オーボエ",
      "ファゴット",
      "E♭クラリネット",
      "B♭クラリネット",
      "アルトクラリネット",
      "バスクラリネット",
      "ソプラノサクソフォン",
      "アルトサクソフォン",
      "テナーサクソフォン",
      "バリトンサクソフォン",
    ],
  },
  {
    name: "金管楽器",
    values: [
      "トランペット",
      "コルネット",
      "ホルン",
      "トロンボーン",
      "バストロンボーン",
      "ユーフォニアム",
      "チューバ",
    ],
  },
  {
    name: "その他の標準パート",
    values: ["コントラバス", "打楽器", "ピアノ・キーボード", "ハープ"],
  },
]);

const DEFAULT_ROOMS = Object.freeze(["音楽室", "映写室", "1-8", "1-9"]);

/** ヘルスチェック用。予定データは返しません。 */
function doGet() {
  return jsonResponse_({ ok: true, data: { name: APP.name, status: "ready" } });
}

/** GitHub Pagesから呼び出されるAPIの入口。 */
function doPost(event) {
  try {
    const request = parseRequest_(event);
    const action = String(request.action || "");

    if (action === "login") {
      const loginResult = login_(request);
      return jsonResponse_({
        ok: true,
        data: { authenticated: true, expiresAt: loginResult.expiresAt },
        sessionToken: loginResult.token,
      });
    }

    validateSession_(request.sessionToken);

    if (action === "checkSession") {
      const renewed = issueSession_();
      return jsonResponse_({
        ok: true,
        data: { authenticated: true, expiresAt: renewed.expiresAt },
        sessionToken: renewed.token,
      });
    }

    let data;
    switch (action) {
      case "bootstrap":
        data = bootstrap_(request);
        break;
      case "list":
        data = listSchedules_(request);
        break;
      case "create":
        data = { schedule: createSchedule_(request.schedule) };
        break;
      case "update":
        data = { schedule: updateSchedule_(request.schedule) };
        break;
      case "delete":
        data = deleteSchedule_(request.id, request.version);
        break;
      case "undoDelete":
        data = { schedule: undoDelete_(request.id) };
        break;
      default:
        throw appError_("UNKNOWN_ACTION", "未対応の操作です。");
    }

    return jsonResponse_({ ok: true, data: data });
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    return jsonResponse_({
      ok: false,
      error: {
        code: error.code || "SERVER_ERROR",
        message: error.publicMessage || "サーバーでエラーが発生しました。",
        details: error.details || null,
      },
    });
  }
}

/**
 * 初回だけApps Scriptエディタから実行します。
 * Schedules / Settings / ChangeLogシートを作り、スプレッドシートIDを保存します。
 */
function setupSheets() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error("スプレッドシートに紐づいたApps Scriptから実行してください。");

  PropertiesService.getScriptProperties().setProperty(PROPERTY_KEYS.spreadsheetId, spreadsheet.getId());
  const schedules = ensureSheet_(spreadsheet, APP.schedulesSheet, SCHEDULE_HEADERS);
  const settings = ensureSheet_(spreadsheet, APP.settingsSheet, SETTINGS_HEADERS);
  const changeLog = ensureSheet_(spreadsheet, APP.changeLogSheet, CHANGE_LOG_HEADERS);

  if (settings.getLastRow() <= 1) writeDefaultSettings_(settings);
  formatSheet_(schedules, SCHEDULE_HEADERS.length);
  formatSheet_(settings, SETTINGS_HEADERS.length);
  formatSheet_(changeLog, CHANGE_LOG_HEADERS.length);

  return getSetupStatus();
}

/** Apps Scriptエディタから、設定不足がないか確認できます。 */
function getSetupStatus() {
  const properties = PropertiesService.getScriptProperties();
  const required = Object.keys(PROPERTY_KEYS).map(function (key) { return PROPERTY_KEYS[key]; });
  const missing = required.filter(function (key) { return !properties.getProperty(key); });
  const result = {
    ready: missing.length === 0,
    missingProperties: missing,
    spreadsheetConfigured: Boolean(properties.getProperty(PROPERTY_KEYS.spreadsheetId)),
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function bootstrap_(request) {
  const listed = listSchedules_(request);
  return {
    date: listed.date,
    schedules: listed.schedules,
    options: getOptions_(),
  };
}

function listSchedules_(request) {
  const date = normalizeDate_(request.date || today_());
  if (date > today_()) throw appError_("FUTURE_DATE", "未来の日付は表示できません。");
  return {
    date: date,
    schedules: getAllSchedules_()
      .filter(function (record) { return record.status === "active" && record.practiceDate === date; })
      .sort(compareSchedules_),
  };
}

function createSchedule_(rawSchedule) {
  return withWriteLock_(function () {
    const now = new Date();
    const schedule = normalizeSchedule_(rawSchedule);
    schedule.id = Utilities.getUuid();
    schedule.practiceDate = today_();
    schedule.createdAt = now.toISOString();
    schedule.updatedAt = now.toISOString();
    schedule.status = "active";
    schedule.deletedAt = "";
    schedule.version = 1;

    assertNoBlockingConflicts_(schedule, "", Boolean(rawSchedule && rawSchedule.allowPartConflict));
    getSchedulesSheet_().appendRow(scheduleToRow_(schedule));
    appendChangeLog_("create", schedule.id, null, schedule);
    return schedule;
  });
}

function updateSchedule_(rawSchedule) {
  return withWriteLock_(function () {
    const id = normalizeId_(rawSchedule && rawSchedule.id);
    const found = findSchedule_(id);
    if (!found || found.record.status !== "active") throw appError_("NOT_FOUND", "予定が見つかりませんでした。");
    if (found.record.practiceDate !== today_()) throw appError_("ARCHIVE_READ_ONLY", "過去の予定は編集できません。");
    if (Number(rawSchedule.version) !== found.record.version) {
      throw appError_("VERSION_CONFLICT", "別の人がこの予定を更新しました。");
    }

    const normalized = normalizeSchedule_(rawSchedule);
    const updated = {
      id: found.record.id,
      practiceDate: found.record.practiceDate,
      startTime: normalized.startTime,
      endTime: normalized.endTime,
      part: normalized.part,
      withParts: normalized.withParts,
      room: normalized.room,
      content: normalized.content,
      createdAt: found.record.createdAt,
      updatedAt: new Date().toISOString(),
      status: "active",
      deletedAt: "",
      version: found.record.version + 1,
    };

    assertNoBlockingConflicts_(updated, id, Boolean(rawSchedule.allowPartConflict));
    getSchedulesSheet_().getRange(found.rowNumber, 1, 1, SCHEDULE_HEADERS.length).setValues([scheduleToRow_(updated)]);
    appendChangeLog_("update", id, found.record, updated);
    return updated;
  });
}

function deleteSchedule_(rawId, rawVersion) {
  return withWriteLock_(function () {
    const id = normalizeId_(rawId);
    const found = findSchedule_(id);
    if (!found || found.record.status !== "active") throw appError_("NOT_FOUND", "予定が見つかりませんでした。");
    if (found.record.practiceDate !== today_()) throw appError_("ARCHIVE_READ_ONLY", "過去の予定は削除できません。");
    if (Number(rawVersion) !== found.record.version) {
      throw appError_("VERSION_CONFLICT", "別の人がこの予定を更新しました。");
    }

    const now = new Date();
    const deleted = Object.assign({}, found.record, {
      status: "deleted",
      deletedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      version: found.record.version + 1,
    });
    getSchedulesSheet_().getRange(found.rowNumber, 1, 1, SCHEDULE_HEADERS.length).setValues([scheduleToRow_(deleted)]);
    appendChangeLog_("delete", id, found.record, deleted);
    return { id: id, undoUntil: now.getTime() + APP.undoSeconds * 1000 };
  });
}

function undoDelete_(rawId) {
  return withWriteLock_(function () {
    const id = normalizeId_(rawId);
    const found = findSchedule_(id);
    if (!found || found.record.status !== "deleted" || !found.record.deletedAt) {
      throw appError_("UNDO_EXPIRED", "削除を取り消せませんでした。");
    }
    if (found.record.practiceDate !== today_()) throw appError_("UNDO_EXPIRED", "削除を取り消せませんでした。");

    const deletedAt = new Date(found.record.deletedAt).getTime();
    if (!isFinite(deletedAt) || Date.now() - deletedAt > APP.undoSeconds * 1000) {
      throw appError_("UNDO_EXPIRED", "取り消し可能時間を過ぎています。");
    }

    const restored = Object.assign({}, found.record, {
      status: "active",
      deletedAt: "",
      updatedAt: new Date().toISOString(),
      version: found.record.version + 1,
    });
    const conflicts = findConflicts_(restored, id);
    if (conflicts.room.length) {
      throw appError_("UNDO_CONFLICT", "同じ部屋に別の予定が登録されたため、元に戻せません。", {
        conflicts: conflicts.room.map(publicSchedule_),
      });
    }

    getSchedulesSheet_().getRange(found.rowNumber, 1, 1, SCHEDULE_HEADERS.length).setValues([scheduleToRow_(restored)]);
    appendChangeLog_("restore", id, found.record, restored);
    return restored;
  });
}

function assertNoBlockingConflicts_(schedule, excludedId, allowPartConflict) {
  const conflicts = findConflicts_(schedule, excludedId);
  if (conflicts.room.length) {
    throw appError_("ROOM_CONFLICT", "同じ時間にその部屋が使われています。", {
      conflicts: conflicts.room.map(publicSchedule_),
    });
  }
  if (conflicts.part.length && !allowPartConflict) {
    throw appError_("PART_CONFLICT", "同じ楽器が別の予定にも含まれています。", {
      conflicts: conflicts.part.map(publicSchedule_),
    });
  }
}

function findConflicts_(schedule, excludedId) {
  const candidateParts = [schedule.part].concat(schedule.withParts);
  const overlapping = getAllSchedules_().filter(function (record) {
    return record.status === "active" &&
      record.practiceDate === schedule.practiceDate &&
      record.id !== excludedId &&
      rangesOverlap_(schedule.startTime, schedule.endTime, record.startTime, record.endTime);
  });
  return {
    room: overlapping.filter(function (record) { return record.room === schedule.room; }),
    part: overlapping.filter(function (record) {
      const parts = [record.part].concat(record.withParts);
      return parts.some(function (part) { return candidateParts.indexOf(part) >= 0; });
    }),
  };
}

function normalizeSchedule_(raw) {
  if (!raw || typeof raw !== "object") throw appError_("VALIDATION_ERROR", "予定の入力内容が不正です。");
  const options = getOptions_();
  const startTime = normalizeTime_(raw.startTime);
  const endTime = normalizeTime_(raw.endTime);
  if (timeToMinutes_(startTime) >= timeToMinutes_(endTime)) {
    throw appError_("VALIDATION_ERROR", "終了時間は開始時間より後にしてください。");
  }

  const part = normalizeInstrument_(raw.part, options);
  if (!Array.isArray(raw.withParts) || raw.withParts.length === 0) {
    throw appError_("VALIDATION_ERROR", "一緒に練習する楽器を1つ以上選んでください。");
  }
  const withParts = unique_(raw.withParts.map(function (value) { return normalizeInstrument_(value, options); }));
  if (withParts.indexOf(part) >= 0) {
    throw appError_("VALIDATION_ERROR", "登録する楽器と練習相手に同じ楽器は選べません。");
  }

  const room = normalizeRoom_(raw.room, options);
  const content = String(raw.content || "").trim();
  if (!content) throw appError_("VALIDATION_ERROR", "練習内容または曲名を入力してください。");
  if (content.length > APP.maxContentLength) {
    throw appError_("VALIDATION_ERROR", "練習内容は" + APP.maxContentLength + "文字以内にしてください。");
  }

  return {
    startTime: startTime,
    endTime: endTime,
    part: part,
    withParts: withParts,
    room: room,
    content: content,
  };
}

function normalizeInstrument_(raw, options) {
  const value = String(raw || "").trim();
  if (options.instruments.indexOf(value) >= 0) return value;
  return normalizeOther_(value, "楽器名");
}

function normalizeRoom_(raw, options) {
  const value = String(raw || "").trim();
  if (options.rooms.indexOf(value) >= 0) return value;
  return normalizeOther_(value, "場所名");
}

function normalizeOther_(value, label) {
  if (value.indexOf(OTHER_PREFIX) !== 0) throw appError_("VALIDATION_ERROR", label + "を選択してください。");
  const custom = value.slice(OTHER_PREFIX.length).trim();
  if (!custom) throw appError_("VALIDATION_ERROR", label + "を入力してください。");
  if (custom.length > APP.maxCustomValueLength) {
    throw appError_("VALIDATION_ERROR", label + "は" + APP.maxCustomValueLength + "文字以内にしてください。");
  }
  return OTHER_PREFIX + custom;
}

function normalizeTime_(raw) {
  const value = String(raw || "");
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
    throw appError_("VALIDATION_ERROR", "開始時間と終了時間を正しく入力してください。");
  }
  return value;
}

function normalizeDate_(raw) {
  const value = String(raw || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw appError_("VALIDATION_ERROR", "日付が不正です。");
  return value;
}

function normalizeId_(raw) {
  const value = String(raw || "").trim();
  if (!/^[0-9a-f-]{30,40}$/i.test(value) && !/^demo-/.test(value)) {
    throw appError_("VALIDATION_ERROR", "予定IDが不正です。");
  }
  return value;
}

function login_(request) {
  ensureAuthConfigured_();
  validateTurnstile_(request.turnstileToken);

  const properties = PropertiesService.getScriptProperties();
  const salt = properties.getProperty(PROPERTY_KEYS.passwordSalt);
  const expected = properties.getProperty(PROPERTY_KEYS.passwordHash);
  const actual = hashPassword_(salt, String(request.password || ""));
  if (!constantTimeEqual_(expected, actual)) {
    throw appError_("INVALID_LOGIN", "パスワードが違います。");
  }
  return issueSession_();
}

function validateTurnstile_(token) {
  if (!token) throw appError_("TURNSTILE_REQUIRED", "ロボットではないことを確認してください。");
  const properties = PropertiesService.getScriptProperties();
  const secret = properties.getProperty(PROPERTY_KEYS.turnstileSecret);
  const response = UrlFetchApp.fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "post",
    payload: { secret: secret, response: String(token) },
    muteHttpExceptions: true,
  });

  let result;
  try {
    result = JSON.parse(response.getContentText());
  } catch (error) {
    throw appError_("TURNSTILE_ERROR", "安全性を確認できませんでした。もう一度お試しください。");
  }
  if (!result.success) throw appError_("TURNSTILE_ERROR", "安全性を確認できませんでした。もう一度お試しください。");
  if (result.action && result.action !== "login") {
    throw appError_("TURNSTILE_ERROR", "安全性の確認結果が一致しませんでした。");
  }

  const allowedHostname = properties.getProperty(PROPERTY_KEYS.allowedHostname);
  if (allowedHostname && result.hostname !== allowedHostname) {
    throw appError_("TURNSTILE_ERROR", "許可されていないサイトからのアクセスです。");
  }
}

function issueSession_() {
  ensureAuthConfigured_();
  const properties = PropertiesService.getScriptProperties();
  const now = Date.now();
  const expiresAt = now + APP.sessionDays * 24 * 60 * 60 * 1000;
  const payload = {
    iat: now,
    exp: expiresAt,
    ver: properties.getProperty(PROPERTY_KEYS.sessionVersion),
    nonce: Utilities.getUuid(),
  };
  const payloadPart = base64UrlEncodeString_(JSON.stringify(payload));
  const signature = sign_(payloadPart, properties.getProperty(PROPERTY_KEYS.sessionSecret));
  return { token: payloadPart + "." + signature, expiresAt: expiresAt };
}

function validateSession_(token) {
  ensureAuthConfigured_();
  const parts = String(token || "").split(".");
  if (parts.length !== 2) throw appError_("AUTH_REQUIRED", "ログインが必要です。");

  const properties = PropertiesService.getScriptProperties();
  const expectedSignature = sign_(parts[0], properties.getProperty(PROPERTY_KEYS.sessionSecret));
  if (!constantTimeEqual_(expectedSignature, parts[1])) throw appError_("AUTH_REQUIRED", "ログインが必要です。");

  let payload;
  try {
    payload = JSON.parse(base64UrlDecodeString_(parts[0]));
  } catch (error) {
    throw appError_("AUTH_REQUIRED", "ログインが必要です。");
  }

  const now = Date.now();
  if (!payload.exp || Number(payload.exp) < now) throw appError_("AUTH_REQUIRED", "ログインの有効期限が切れました。");
  if (!payload.iat || Number(payload.iat) > now + 5 * 60 * 1000) throw appError_("AUTH_REQUIRED", "ログインが必要です。");
  if (String(payload.ver) !== properties.getProperty(PROPERTY_KEYS.sessionVersion)) {
    throw appError_("AUTH_REQUIRED", "パスワードが変更されました。もう一度ログインしてください。");
  }
  return payload;
}

function sign_(value, secret) {
  const bytes = Utilities.computeHmacSha256Signature(value, secret, Utilities.Charset.UTF_8);
  return stripPadding_(Utilities.base64EncodeWebSafe(bytes));
}

function hashPassword_(salt, password) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(salt) + ":" + String(password),
    Utilities.Charset.UTF_8
  );
  return Utilities.base64Encode(bytes);
}

function base64UrlEncodeString_(value) {
  return stripPadding_(Utilities.base64EncodeWebSafe(Utilities.newBlob(value).getBytes()));
}

function base64UrlDecodeString_(value) {
  const padded = addPadding_(value);
  return Utilities.newBlob(Utilities.base64DecodeWebSafe(padded)).getDataAsString("UTF-8");
}

function stripPadding_(value) {
  return String(value).replace(/=+$/, "");
}

function addPadding_(value) {
  const remainder = value.length % 4;
  return remainder ? value + "=".repeat(4 - remainder) : value;
}

function constantTimeEqual_(a, b) {
  const first = String(a || "");
  const second = String(b || "");
  let difference = first.length ^ second.length;
  const length = Math.max(first.length, second.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (first.charCodeAt(index) || 0) ^ (second.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function ensureAuthConfigured_() {
  const properties = PropertiesService.getScriptProperties();
  const required = [
    PROPERTY_KEYS.passwordSalt,
    PROPERTY_KEYS.passwordHash,
    PROPERTY_KEYS.sessionSecret,
    PROPERTY_KEYS.sessionVersion,
    PROPERTY_KEYS.turnstileSecret,
  ];
  const missing = required.filter(function (key) { return !properties.getProperty(key); });
  if (missing.length) throw appError_("NOT_CONFIGURED", "アプリの初期設定が完了していません。");
}

function getOptions_() {
  const sheet = getSpreadsheet_().getSheetByName(APP.settingsSheet);
  if (!sheet || sheet.getLastRow() <= 1) {
    return {
      instrumentGroups: DEFAULT_INSTRUMENT_GROUPS,
      instruments: flattenInstrumentGroups_(DEFAULT_INSTRUMENT_GROUPS),
      rooms: DEFAULT_ROOMS.slice(),
    };
  }

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, SETTINGS_HEADERS.length).getValues();
  const enabled = rows.filter(function (row) { return isEnabled_(row[4]); });
  const instrumentRows = enabled
    .filter(function (row) { return row[0] === "instrument"; })
    .sort(function (a, b) { return Number(a[3]) - Number(b[3]); });
  const roomRows = enabled
    .filter(function (row) { return row[0] === "room"; })
    .sort(function (a, b) { return Number(a[3]) - Number(b[3]); });

  const groupNames = unique_(instrumentRows.map(function (row) { return String(row[1]); }));
  const instrumentGroups = groupNames.map(function (groupName) {
    return {
      name: groupName,
      values: instrumentRows
        .filter(function (row) { return String(row[1]) === groupName; })
        .map(function (row) { return String(row[2]); }),
    };
  });
  return {
    instrumentGroups: instrumentGroups,
    instruments: flattenInstrumentGroups_(instrumentGroups),
    rooms: roomRows.map(function (row) { return String(row[2]); }),
  };
}

function getAllSchedules_() {
  const sheet = getSchedulesSheet_();
  if (sheet.getLastRow() <= 1) return [];
  return sheet
    .getRange(2, 1, sheet.getLastRow() - 1, SCHEDULE_HEADERS.length)
    .getValues()
    .map(rowToSchedule_)
    .filter(function (record) { return Boolean(record.id); });
}

function findSchedule_(id) {
  const sheet = getSchedulesSheet_();
  if (sheet.getLastRow() <= 1) return null;
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, SCHEDULE_HEADERS.length).getValues();
  for (let index = 0; index < rows.length; index += 1) {
    if (String(rows[index][0]) === id) return { rowNumber: index + 2, record: rowToSchedule_(rows[index]) };
  }
  return null;
}

function rowToSchedule_(row) {
  let withParts = [];
  try {
    withParts = JSON.parse(String(row[5] || "[]"));
  } catch (error) {
    withParts = String(row[5] || "").split(",").map(function (value) { return value.trim(); }).filter(Boolean);
  }
  return {
    id: String(row[0] || ""),
    practiceDate: String(row[1] || ""),
    startTime: String(row[2] || ""),
    endTime: String(row[3] || ""),
    part: String(row[4] || ""),
    withParts: Array.isArray(withParts) ? withParts : [],
    room: String(row[6] || ""),
    content: String(row[7] || ""),
    createdAt: dateCellToIso_(row[8]),
    updatedAt: dateCellToIso_(row[9]),
    status: String(row[10] || "active"),
    deletedAt: row[11] ? dateCellToIso_(row[11]) : "",
    version: Number(row[12]) || 1,
  };
}

function scheduleToRow_(schedule) {
  return [
    schedule.id,
    schedule.practiceDate,
    schedule.startTime,
    schedule.endTime,
    schedule.part,
    JSON.stringify(schedule.withParts),
    schedule.room,
    schedule.content,
    schedule.createdAt,
    schedule.updatedAt,
    schedule.status,
    schedule.deletedAt,
    schedule.version,
  ];
}

function publicSchedule_(schedule) {
  return {
    id: schedule.id,
    practiceDate: schedule.practiceDate,
    startTime: schedule.startTime,
    endTime: schedule.endTime,
    part: schedule.part,
    withParts: schedule.withParts,
    room: schedule.room,
    content: schedule.content,
    version: schedule.version,
  };
}

function appendChangeLog_(action, id, before, after) {
  const sheet = getSpreadsheet_().getSheetByName(APP.changeLogSheet);
  if (!sheet) return;
  sheet.appendRow([
    new Date().toISOString(),
    action,
    id,
    before ? JSON.stringify(before) : "",
    after ? JSON.stringify(after) : "",
  ]);
}

function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty(PROPERTY_KEYS.spreadsheetId);
  if (!id) throw appError_("NOT_CONFIGURED", "スプレッドシートの初期設定が完了していません。");
  return SpreadsheetApp.openById(id);
}

function getSchedulesSheet_() {
  const sheet = getSpreadsheet_().getSheetByName(APP.schedulesSheet);
  if (!sheet) throw appError_("NOT_CONFIGURED", "Schedulesシートがありません。setupSheetsを実行してください。");
  return sheet;
}

function ensureSheet_(spreadsheet, name, headers) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  const currentHeaders = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const needsHeaders = headers.some(function (header, index) { return currentHeaders[index] !== header; });
  if (needsHeaders && sheet.getLastRow() > 0 && currentHeaders.some(Boolean)) {
    throw new Error(name + "シートの見出しが仕様と異なります。空のシートでやり直してください。");
  }
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  return sheet;
}

function writeDefaultSettings_(sheet) {
  const rows = [];
  let order = 1;
  DEFAULT_INSTRUMENT_GROUPS.forEach(function (group) {
    group.values.forEach(function (value) {
      rows.push(["instrument", group.name, value, order, true]);
      order += 1;
    });
  });
  DEFAULT_ROOMS.forEach(function (room, index) {
    rows.push(["room", "練習場所", room, index + 1, true]);
  });
  sheet.getRange(2, 1, rows.length, SETTINGS_HEADERS.length).setValues(rows);
}

function formatSheet_(sheet, columnCount) {
  sheet.getRange(1, 1, 1, columnCount).setFontWeight("bold").setBackground("#dff3ef");
  sheet.autoResizeColumns(1, columnCount);
}

function withWriteLock_(callback) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const result = callback();
    SpreadsheetApp.flush();
    return result;
  } catch (error) {
    if (error && error.code) throw error;
    if (String(error).indexOf("Lock") >= 0) throw appError_("BUSY", "ほかの人が更新中です。少し待ってからお試しください。");
    throw error;
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function parseRequest_(event) {
  if (!event || !event.postData || !event.postData.contents) {
    throw appError_("BAD_REQUEST", "リクエストが空です。");
  }
  if (Number(event.postData.length || 0) > 25000) throw appError_("BAD_REQUEST", "送信内容が大きすぎます。");
  try {
    return JSON.parse(event.postData.contents);
  } catch (error) {
    throw appError_("BAD_REQUEST", "リクエスト形式が不正です。");
  }
}

function jsonResponse_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

function appError_(code, publicMessage, details) {
  const error = new Error(publicMessage);
  error.code = code;
  error.publicMessage = publicMessage;
  error.details = details || null;
  return error;
}

function compareSchedules_(a, b) {
  return a.practiceDate.localeCompare(b.practiceDate) ||
    a.startTime.localeCompare(b.startTime) ||
    a.room.localeCompare(b.room, "ja");
}

function rangesOverlap_(startA, endA, startB, endB) {
  return timeToMinutes_(startA) < timeToMinutes_(endB) && timeToMinutes_(startB) < timeToMinutes_(endA);
}

function timeToMinutes_(time) {
  const parts = String(time).split(":");
  return Number(parts[0]) * 60 + Number(parts[1]);
}

function today_() {
  return Utilities.formatDate(new Date(), APP.timeZone, "yyyy-MM-dd");
}

function dateCellToIso_(value) {
  if (value instanceof Date) return value.toISOString();
  return String(value || "");
}

function unique_(values) {
  return values.filter(function (value, index, array) { return array.indexOf(value) === index; });
}

function flattenInstrumentGroups_(groups) {
  return groups.reduce(function (all, group) { return all.concat(group.values); }, []);
}

function isEnabled_(value) {
  return value === true || value === 1 || String(value).toLowerCase() === "true";
}
