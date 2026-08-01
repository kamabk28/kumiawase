import test from "node:test";
import assert from "node:assert/strict";

import {
  INSTRUMENT_GROUPS,
  addMinutes,
  buildOtherValue,
  filterSchedules,
  getScheduleState,
  parseOtherValue,
  previousDateKey,
  rangesOverlap,
  todayKey,
  validateScheduleInput,
} from "../js/core.js";

test("主要な打楽器を専用グループに含める", () => {
  const percussion = INSTRUMENT_GROUPS.find((group) => group.name === "打楽器");
  assert.ok(percussion);
  assert.ok(percussion.values.includes("ティンパニ"));
  assert.ok(percussion.values.includes("マリンバ"));
  assert.ok(percussion.values.includes("グロッケン"));
  assert.ok(percussion.values.includes("スネアドラム"));
});

test("日本時間の日付キーを生成する", () => {
  assert.equal(todayKey(new Date("2026-08-01T14:59:00Z")), "2026-08-01");
  assert.equal(todayKey(new Date("2026-08-01T15:01:00Z")), "2026-08-02");
  assert.equal(previousDateKey("2026-08-01"), "2026-07-31");
});

test("時間帯の重複は境界を正しく判定する", () => {
  assert.equal(rangesOverlap("13:00", "14:00", "13:30", "14:30"), true);
  assert.equal(rangesOverlap("13:00", "14:00", "14:00", "15:00"), false);
  assert.equal(rangesOverlap("13:00", "14:00", "12:00", "13:00"), false);
});

test("予定の状態を日本時間で判定する", () => {
  const schedule = {
    practiceDate: "2026-08-01",
    startTime: "14:00",
    endTime: "15:00",
  };
  assert.equal(getScheduleState(schedule, new Date("2026-08-01T04:00:00Z")).key, "upcoming");
  assert.equal(getScheduleState(schedule, new Date("2026-08-01T04:40:00Z")).key, "soon");
  assert.equal(getScheduleState(schedule, new Date("2026-08-01T05:30:00Z")).key, "active");
  assert.equal(getScheduleState(schedule, new Date("2026-08-01T06:00:00Z")).key, "finished");
});

test("予定入力の必須項目と時刻を検証する", () => {
  const valid = {
    startTime: "13:00",
    endTime: "13:45",
    part: "フルート",
    withParts: ["オーボエ"],
    room: "音楽室",
    content: "自由曲",
  };
  assert.deepEqual(validateScheduleInput(valid), []);
  assert.match(validateScheduleInput({ ...valid, endTime: "12:00" })[0], /終了時間/);
  assert.match(validateScheduleInput({ ...valid, withParts: [] })[0], /1つ以上/);
  assert.match(validateScheduleInput({ ...valid, withParts: ["フルート"] })[0], /同じ楽器/);
});

test("楽器と部屋で予定を絞り込む", () => {
  const schedules = [
    { id: "1", part: "フルート", withParts: ["オーボエ"], room: "音楽室" },
    { id: "2", part: "ホルン", withParts: ["トランペット"], room: "映写室" },
  ];
  assert.deepEqual(filterSchedules(schedules, { part: "オーボエ" }).map((item) => item.id), ["1"]);
  assert.deepEqual(filterSchedules(schedules, { room: "映写室" }).map((item) => item.id), ["2"]);
});

test("その他の値と時刻加算を扱う", () => {
  assert.equal(buildOtherValue("  バスクラ  "), "その他：バスクラ");
  assert.equal(parseOtherValue("その他：バスクラ"), "バスクラ");
  assert.equal(parseOtherValue("フルート"), null);
  assert.equal(addMinutes("13:30", 45), "14:15");
});
