export const TIME_ZONE = "Asia/Tokyo";

export const INSTRUMENT_GROUPS = Object.freeze([
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

export const OTHER_VALUE = "__other__";
export const OTHER_PREFIX = "その他：";
export const ROOMS = Object.freeze(["音楽室", "映写室", "1-8", "1-9"]);

const DATE_FORMATTER = new Intl.DateTimeFormat("ja-JP", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const DATE_LABEL_FORMATTER = new Intl.DateTimeFormat("ja-JP", {
  timeZone: TIME_ZONE,
  month: "long",
  day: "numeric",
  weekday: "short",
});

const TIME_FORMATTER = new Intl.DateTimeFormat("ja-JP", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function partsMap(formatter, value) {
  return Object.fromEntries(
    formatter
      .formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

export function todayKey(now = new Date()) {
  const parts = partsMap(DATE_FORMATTER, now);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function dateLabel(dateKey) {
  const date = dateKeyToDate(dateKey);
  return DATE_LABEL_FORMATTER.format(date);
}

export function dateKeyToDate(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey));
  if (!match) return new Date(Number.NaN);
  return new Date(`${match[1]}-${match[2]}-${match[3]}T12:00:00+09:00`);
}

export function previousDateKey(dateKey = todayKey()) {
  const date = dateKeyToDate(dateKey);
  date.setUTCDate(date.getUTCDate() - 1);
  return todayKey(date);
}

export function formatUpdatedTime(date = new Date()) {
  return TIME_FORMATTER.format(date);
}

export function timeToMinutes(time) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(time));
  if (!match) return Number.NaN;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return Number.NaN;
  return hour * 60 + minute;
}

export function currentTokyoMinutes(now = new Date()) {
  const parts = partsMap(TIME_FORMATTER, now);
  return Number(parts.hour) * 60 + Number(parts.minute);
}

export function rangesOverlap(startA, endA, startB, endB) {
  const aStart = timeToMinutes(startA);
  const aEnd = timeToMinutes(endA);
  const bStart = timeToMinutes(startB);
  const bEnd = timeToMinutes(endB);
  if ([aStart, aEnd, bStart, bEnd].some(Number.isNaN)) return false;
  return aStart < bEnd && bStart < aEnd;
}

export function getScheduleState(schedule, now = new Date()) {
  const currentDate = todayKey(now);
  if (schedule.practiceDate < currentDate) return { key: "finished", label: "終了" };
  if (schedule.practiceDate > currentDate) return { key: "upcoming", label: "予定" };

  const current = currentTokyoMinutes(now);
  const start = timeToMinutes(schedule.startTime);
  const end = timeToMinutes(schedule.endTime);

  if (current >= end) return { key: "finished", label: "終了" };
  if (current >= start) return { key: "active", label: "練習中" };
  if (start - current <= 30) return { key: "soon", label: "まもなく" };
  return { key: "upcoming", label: "予定" };
}

export function sortSchedules(schedules) {
  return [...schedules].sort((a, b) => {
    const byDate = String(a.practiceDate).localeCompare(String(b.practiceDate));
    if (byDate !== 0) return byDate;
    const byTime = String(a.startTime).localeCompare(String(b.startTime));
    if (byTime !== 0) return byTime;
    return String(a.room).localeCompare(String(b.room), "ja");
  });
}

export function allScheduleParts(schedule) {
  return [schedule.part, ...(Array.isArray(schedule.withParts) ? schedule.withParts : [])].filter(Boolean);
}

export function filterSchedules(schedules, { part = "", room = "" } = {}) {
  return schedules.filter((schedule) => {
    const matchesPart = !part || allScheduleParts(schedule).includes(part);
    const matchesRoom = !room || schedule.room === room;
    return matchesPart && matchesRoom;
  });
}

export function buildOtherValue(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed ? `${OTHER_PREFIX}${trimmed}` : "";
}

export function parseOtherValue(value) {
  const text = String(value ?? "");
  if (!text.startsWith(OTHER_PREFIX)) return null;
  return text.slice(OTHER_PREFIX.length);
}

export function validateScheduleInput(input) {
  const errors = [];
  const start = timeToMinutes(input.startTime);
  const end = timeToMinutes(input.endTime);

  if (Number.isNaN(start) || Number.isNaN(end)) {
    errors.push("開始時間と終了時間を入力してください。");
  } else if (start >= end) {
    errors.push("終了時間は開始時間より後にしてください。");
  }

  if (!String(input.part ?? "").trim()) errors.push("登録する楽器を選んでください。");
  if (!Array.isArray(input.withParts) || input.withParts.length === 0) {
    errors.push("一緒に練習する楽器を1つ以上選んでください。");
  }
  if (!String(input.room ?? "").trim()) errors.push("使用場所を選んでください。");

  const content = String(input.content ?? "").trim();
  if (!content) errors.push("練習内容または曲名を入力してください。");
  if (content.length > 120) errors.push("練習内容は120文字以内にしてください。");

  if (input.withParts?.includes(input.part)) {
    errors.push("登録する楽器と練習相手に同じ楽器は選べません。");
  }

  return errors;
}

export function roundTime(date = new Date(), stepMinutes = 15) {
  const minutes = currentTokyoMinutes(date);
  const rounded = Math.ceil(minutes / stepMinutes) * stepMinutes;
  const safe = Math.min(rounded, 23 * 60 + 45);
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

export function addMinutes(time, amount) {
  const minutes = timeToMinutes(time);
  if (Number.isNaN(minutes)) return "";
  const adjusted = Math.max(0, Math.min(minutes + amount, 23 * 60 + 59));
  return `${String(Math.floor(adjusted / 60)).padStart(2, "0")}:${String(adjusted % 60).padStart(2, "0")}`;
}
