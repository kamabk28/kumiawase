import { ApiClient, ApiError, MockApi } from "./api.js?v=20260801-2";
import {
  INSTRUMENT_GROUPS,
  OTHER_VALUE,
  ROOMS,
  addMinutes,
  allScheduleParts,
  buildOtherValue,
  dateLabel,
  filterSchedules,
  formatUpdatedTime,
  getScheduleState,
  parseOtherValue,
  previousDateKey,
  roundTime,
  sortSchedules,
  todayKey,
  validateScheduleInput,
} from "./core.js?v=20260801-2";

const config = window.APP_CONFIG;
const params = new URLSearchParams(window.location.search);
const isDemo = params.get("demo") === "1";
const isConfigured =
  !config.apiUrl.startsWith("YOUR_") &&
  !config.turnstileSiteKey.startsWith("YOUR_") &&
  /^https:\/\/script\.google\.com\//.test(config.apiUrl);

const api = isDemo
  ? new MockApi()
  : new ApiClient(config.apiUrl, { timeoutMs: config.requestTimeoutMs });

const state = {
  sessionToken: localStorage.getItem(config.sessionStorageKey) || "",
  todaySchedules: [],
  archiveSchedules: [],
  currentView: "today",
  editingSchedule: null,
  deletingSchedule: null,
  allowPartConflict: false,
  pollTimer: null,
  turnstileWidgetId: null,
  turnstileToken: "",
  toastTimer: null,
  instrumentGroups: INSTRUMENT_GROUPS,
  rooms: ROOMS,
  optionsSignature: "",
};

const dom = {
  setupScreen: get("setup-screen"),
  authScreen: get("auth-screen"),
  appShell: get("app-shell"),
  loginForm: get("login-form"),
  password: get("password"),
  passwordToggle: get("password-toggle"),
  loginButton: get("login-button"),
  loginError: get("login-error"),
  turnstileStatus: get("turnstile-status"),
  turnstileContainer: get("turnstile-container"),
  syncStatus: get("sync-status"),
  refreshButton: get("refresh-button"),
  logoutButton: get("logout-button"),
  todayView: get("today-view"),
  archiveView: get("archive-view"),
  todayLabel: get("today-label"),
  todaySummary: get("today-summary"),
  lastUpdated: get("last-updated"),
  rulesCard: get("rules-card"),
  usageNotices: get("usage-notices"),
  todayLoading: get("today-loading"),
  todayList: get("today-list"),
  archiveLoading: get("archive-loading"),
  archiveList: get("archive-list"),
  archiveDate: get("archive-date"),
  todayPartFilter: get("today-part-filter"),
  todayRoomFilter: get("today-room-filter"),
  archivePartFilter: get("archive-part-filter"),
  archiveRoomFilter: get("archive-room-filter"),
  newScheduleButton: get("new-schedule-button"),
  scheduleDialog: get("schedule-dialog"),
  scheduleForm: get("schedule-form"),
  scheduleDialogTitle: get("schedule-dialog-title"),
  startTime: get("start-time"),
  endTime: get("end-time"),
  ownerPart: get("owner-part"),
  ownerOtherWrap: get("owner-other-wrap"),
  ownerOther: get("owner-other"),
  withPartsOptions: get("with-parts-options"),
  withOtherWrap: get("with-other-wrap"),
  withOther: get("with-other"),
  room: get("room"),
  roomOtherWrap: get("room-other-wrap"),
  roomOther: get("room-other"),
  content: get("content"),
  contentCount: get("content-count"),
  conflictBox: get("conflict-box"),
  conflictTitle: get("conflict-title"),
  conflictMessage: get("conflict-message"),
  scheduleError: get("schedule-error"),
  saveScheduleButton: get("save-schedule-button"),
  deleteDialog: get("delete-dialog"),
  deleteSummary: get("delete-summary"),
  deleteError: get("delete-error"),
  confirmDeleteButton: get("confirm-delete-button"),
  toastRegion: get("toast-region"),
};

initializeControls();
bindEvents();
void initializeApp();

function get(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element: ${id}`);
  return element;
}

function initializeControls() {
  populateInstrumentSelect(dom.ownerPart, true);
  renderWithPartsOptions();
  populateRoomSelect(dom.room, true);

  [dom.todayPartFilter, dom.archivePartFilter].forEach((select) => {
    appendInstrumentOptions(select, false);
  });
  [dom.todayRoomFilter, dom.archiveRoomFilter].forEach((select) => {
    state.rooms.forEach((room) => select.add(new Option(room, room)));
  });

  const today = todayKey();
  dom.archiveDate.max = previousDateKey(today);
  dom.archiveDate.value = previousDateKey(today);

  dom.todayLabel.textContent = dateLabel(today);
}

function bindEvents() {
  dom.passwordToggle.addEventListener("click", togglePasswordVisibility);
  dom.loginForm.addEventListener("submit", handleLogin);
  document.addEventListener("turnstile-ready", renderTurnstile);

  dom.refreshButton.addEventListener("click", () => {
    if (state.currentView === "today") void loadToday();
    else void loadArchive();
  });
  dom.logoutButton.addEventListener("click", () => logOut());

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });

  dom.todayPartFilter.addEventListener("change", renderToday);
  dom.todayRoomFilter.addEventListener("change", renderToday);
  dom.archivePartFilter.addEventListener("change", renderArchive);
  dom.archiveRoomFilter.addEventListener("change", renderArchive);
  dom.archiveDate.addEventListener("change", () => void loadArchive());

  dom.newScheduleButton.addEventListener("click", () => openScheduleDialog());
  dom.scheduleForm.addEventListener("submit", handleScheduleSubmit);
  dom.ownerPart.addEventListener("change", handleOwnerPartChange);
  dom.room.addEventListener("change", handleRoomChange);
  dom.content.addEventListener("input", updateContentCount);
  dom.withPartsOptions.addEventListener("change", handleWithPartsChange);

  document.querySelectorAll("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => dom.scheduleDialog.close());
  });
  document.querySelectorAll("[data-close-delete]").forEach((button) => {
    button.addEventListener("click", () => dom.deleteDialog.close());
  });
  dom.confirmDeleteButton.addEventListener("click", handleDeleteConfirm);

  dom.scheduleDialog.addEventListener("click", closeOnBackdrop);
  dom.deleteDialog.addEventListener("click", closeOnBackdrop);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !dom.appShell.hidden && state.currentView === "today") void loadToday({ silent: true });
  });
}

async function initializeApp() {
  if (!isConfigured && !isDemo) {
    showOnly(dom.setupScreen);
    return;
  }

  if (isDemo) {
    state.sessionToken = "demo-session";
    api.setSessionToken(state.sessionToken);
    await enterApp();
    return;
  }

  if (!state.sessionToken) {
    showLogin();
    return;
  }

  api.setSessionToken(state.sessionToken);
  showOnly(dom.authScreen);
  setLoginBusy(true, "認証状態を確認中…");
  try {
    const result = await api.checkSession();
    persistSession(result.sessionToken || api.sessionToken);
    await enterApp();
  } catch (error) {
    if (error.code === "AUTH_REQUIRED") {
      clearSession();
      showLogin("ログインの有効期限が切れました。");
    } else {
      await enterApp();
    }
  } finally {
    setLoginBusy(false);
  }
}

function showOnly(target) {
  [dom.setupScreen, dom.authScreen, dom.appShell].forEach((element) => {
    element.hidden = element !== target;
  });
}

function showLogin(message = "") {
  showOnly(dom.authScreen);
  hideError(dom.loginError);
  if (message) showError(dom.loginError, message);
  dom.password.value = "";
  state.turnstileToken = "";
  dom.loginButton.disabled = true;
  dom.turnstileStatus.textContent = "安全性を確認しています…";
  ensureTurnstileScript();
  window.setTimeout(renderTurnstile, 0);
  window.setTimeout(() => dom.password.focus(), 50);
}

function ensureTurnstileScript() {
  if (isDemo || !isConfigured || window.turnstile || document.querySelector("script[data-turnstile-script]")) return;
  const script = document.createElement("script");
  script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileReady&render=explicit";
  script.async = true;
  script.defer = true;
  script.dataset.turnstileScript = "true";
  script.addEventListener("error", () => {
    dom.turnstileStatus.textContent = "安全性の確認を読み込めませんでした。通信状態をご確認ください。";
  });
  document.head.append(script);
}

async function enterApp() {
  showOnly(dom.appShell);
  startPolling();
  await loadToday();
  restoreUndoToast();
}

function renderTurnstile() {
  if (isDemo || dom.authScreen.hidden || !window.turnstile || !isConfigured) return;
  if (state.turnstileWidgetId !== null) {
    try {
      window.turnstile.remove(state.turnstileWidgetId);
    } catch {
      // A removed widget can safely be rendered again.
    }
  }

  state.turnstileToken = "";
  dom.loginButton.disabled = true;
  state.turnstileWidgetId = window.turnstile.render(dom.turnstileContainer, {
    sitekey: config.turnstileSiteKey,
    action: "login",
    theme: "light",
    size: "flexible",
    appearance: "interaction-only",
    retry: "auto",
    "refresh-expired": "auto",
    callback(token) {
      state.turnstileToken = token;
      dom.turnstileStatus.textContent = "安全性を確認できました";
      dom.loginButton.disabled = false;
    },
    "expired-callback"() {
      state.turnstileToken = "";
      dom.turnstileStatus.textContent = "確認の有効期限が切れました。再確認しています…";
      dom.loginButton.disabled = true;
    },
    "error-callback"() {
      state.turnstileToken = "";
      dom.turnstileStatus.textContent = "安全性の確認に失敗しました。通信状態をご確認ください。";
      dom.loginButton.disabled = true;
    },
  });
}

async function handleLogin(event) {
  event.preventDefault();
  hideError(dom.loginError);
  const password = dom.password.value;
  if (!password) {
    showError(dom.loginError, "パスワードを入力してください。");
    return;
  }
  if (!state.turnstileToken) {
    showError(dom.loginError, "ロボットではないことの確認が完了するまでお待ちください。");
    return;
  }

  setLoginBusy(true, "確認しています…");
  try {
    const result = await api.login(password, state.turnstileToken);
    persistSession(result.sessionToken || api.sessionToken);
    dom.password.value = "";
    await enterApp();
  } catch (error) {
    showError(dom.loginError, error.message);
    state.turnstileToken = "";
    dom.loginButton.disabled = true;
    if (window.turnstile && state.turnstileWidgetId !== null) window.turnstile.reset(state.turnstileWidgetId);
  } finally {
    setLoginBusy(false);
  }
}

function setLoginBusy(isBusy, text = "") {
  dom.password.disabled = isBusy;
  dom.passwordToggle.disabled = isBusy;
  if (isBusy) {
    dom.loginButton.disabled = true;
    dom.loginButton.firstElementChild.textContent = text || "処理中…";
  } else {
    dom.loginButton.firstElementChild.textContent = "ボードを開く";
    dom.loginButton.disabled = !state.turnstileToken;
  }
}

function persistSession(token) {
  state.sessionToken = token;
  api.setSessionToken(token);
  localStorage.setItem(config.sessionStorageKey, token);
}

function clearSession() {
  state.sessionToken = "";
  api.setSessionToken("");
  localStorage.removeItem(config.sessionStorageKey);
}

function logOut(showMessage = true) {
  clearSession();
  stopPolling();
  if (showMessage) showLogin("このブラウザからログアウトしました。");
  else showLogin();
}

async function loadToday({ silent = false } = {}) {
  if (!silent) dom.todayLoading.hidden = false;
  setSyncStatus("syncing", isDemo ? "デモ" : "更新中");
  dom.refreshButton.classList.add("is-spinning");

  try {
    const result = await api.bootstrap(todayKey());
    state.todaySchedules = sortSchedules(result.data.schedules || []);
    applyAvailableOptions(result.data.options);
    if (Array.isArray(result.data.options?.notices)) renderUsageNotices(result.data.options.notices);
    renderToday();
    const now = new Date();
    dom.lastUpdated.textContent = `${formatUpdatedTime(now)} 更新`;
    setSyncStatus("online", isDemo ? "デモ" : "同期済み");
  } catch (error) {
    handleApiFailure(error, "予定を更新できませんでした。");
  } finally {
    dom.todayLoading.hidden = true;
    dom.refreshButton.classList.remove("is-spinning");
  }
}

async function loadArchive() {
  const date = dom.archiveDate.value;
  if (!date) return;
  dom.archiveLoading.hidden = false;
  dom.archiveList.replaceChildren();
  setSyncStatus("syncing", "読込中");
  try {
    const result = await api.list(date);
    state.archiveSchedules = sortSchedules(result.data.schedules || []);
    renderArchive();
    setSyncStatus("online", isDemo ? "デモ" : "同期済み");
  } catch (error) {
    handleApiFailure(error, "アーカイブを読み込めませんでした。");
  } finally {
    dom.archiveLoading.hidden = true;
  }
}

function renderToday() {
  const filtered = filterSchedules(state.todaySchedules, {
    part: dom.todayPartFilter.value,
    room: dom.todayRoomFilter.value,
  });
  renderScheduleList(dom.todayList, filtered, true);

  const activeCount = state.todaySchedules.filter(
    (schedule) => getScheduleState(schedule).key === "active",
  ).length;
  const countText = `${state.todaySchedules.length}件の予定`;
  dom.todaySummary.textContent = activeCount ? `${countText}・${activeCount}件が練習中` : countText;
}

function renderUsageNotices(notices) {
  const cleanNotices = notices.map((notice) => String(notice).trim()).filter(Boolean);
  dom.usageNotices.replaceChildren(...cleanNotices.map((notice) => element("li", "", notice)));
  dom.rulesCard.hidden = cleanNotices.length === 0;
}

function applyAvailableOptions(options) {
  if (!options) return;
  const instrumentGroups = Array.isArray(options.instrumentGroups)
    ? options.instrumentGroups
        .map((group) => ({
          name: String(group.name || "").trim(),
          values: Array.isArray(group.values) ? group.values.map((value) => String(value).trim()).filter(Boolean) : [],
        }))
        .filter((group) => group.name && group.values.length)
    : [];
  const rooms = Array.isArray(options.rooms) ? options.rooms.map((room) => String(room).trim()).filter(Boolean) : [];
  if (!instrumentGroups.length || !rooms.length) return;

  const signature = JSON.stringify({ instrumentGroups, rooms });
  if (signature === state.optionsSignature) return;
  state.optionsSignature = signature;
  state.instrumentGroups = instrumentGroups;
  state.rooms = rooms;

  populateInstrumentSelect(dom.ownerPart, true);
  renderWithPartsOptions();
  populateRoomSelect(dom.room, true);
  populateFilterSelect(dom.todayPartFilter, instrumentGroups.flatMap((group) => group.values));
  populateFilterSelect(dom.archivePartFilter, instrumentGroups.flatMap((group) => group.values));
  populateFilterSelect(dom.todayRoomFilter, rooms);
  populateFilterSelect(dom.archiveRoomFilter, rooms);
}

function populateFilterSelect(select, values) {
  const selected = select.value;
  select.replaceChildren(new Option("すべて", ""));
  values.forEach((value) => select.add(new Option(value, value)));
  select.value = values.includes(selected) ? selected : "";
}

function renderArchive() {
  const filtered = filterSchedules(state.archiveSchedules, {
    part: dom.archivePartFilter.value,
    room: dom.archiveRoomFilter.value,
  });
  renderScheduleList(dom.archiveList, filtered, false, dom.archiveDate.value);
}

function renderScheduleList(container, schedules, editable, date = todayKey()) {
  container.replaceChildren();
  if (!schedules.length) {
    const empty = element("div", "empty-state");
    const inner = element("div");
    inner.append(
      element("h2", "", editable ? "今日の予定はまだありません" : `${dateLabel(date)}の予定はありません`),
      element("p", "", editable ? "下の「新しい予定」から登録できます。" : "別の日付を選んで確認してください。"),
    );
    empty.append(inner);
    container.append(empty);
    return;
  }

  schedules.forEach((schedule) => container.append(createScheduleCard(schedule, editable)));
}

function createScheduleCard(schedule, editable) {
  const scheduleState = getScheduleState(schedule);
  const card = element("article", "schedule-card");
  card.dataset.state = scheduleState.key;

  const body = element("div", "card-body");
  const time = element("div", "card-time");
  time.append(element("strong", "", schedule.startTime), element("span", "", `〜 ${schedule.endTime}`));

  const main = element("div", "card-main");
  const topLine = element("div", "card-topline");
  topLine.append(element("h2", "", schedule.content));
  const statePill = element("span", "state-pill", scheduleState.label);
  statePill.dataset.state = scheduleState.key;
  topLine.append(statePill);

  const parts = element("div", "card-parts");
  parts.append(element("span", "part-chip is-owner", schedule.part));
  schedule.withParts.forEach((part) => parts.append(element("span", "part-chip", part)));

  const room = element("div", "card-room");
  room.textContent = `場所：${schedule.room}`;
  main.append(topLine, parts, room);
  body.append(time, main);
  card.append(body);

  if (editable) {
    const actions = element("div", "card-actions");
    const editButton = element("button", "card-action", "編集");
    editButton.type = "button";
    editButton.addEventListener("click", () => openScheduleDialog(schedule));
    const deleteButton = element("button", "card-action is-danger", "削除");
    deleteButton.type = "button";
    deleteButton.addEventListener("click", () => openDeleteDialog(schedule));
    actions.append(editButton, deleteButton);
    card.append(actions);
  }

  return card;
}

function element(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function switchView(view) {
  if (!['today', 'archive'].includes(view)) return;
  state.currentView = view;
  dom.todayView.hidden = view !== "today";
  dom.archiveView.hidden = view !== "archive";
  dom.newScheduleButton.hidden = view !== "today";
  document.querySelectorAll("[data-view]").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  if (view === "archive" && !state.archiveSchedules.length) void loadArchive();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openScheduleDialog(schedule = null) {
  state.editingSchedule = schedule;
  state.allowPartConflict = false;
  dom.scheduleForm.reset();
  hideError(dom.scheduleError);
  dom.conflictBox.hidden = true;
  dom.scheduleDialogTitle.textContent = schedule ? "予定を編集" : "新しい予定";
  dom.saveScheduleButton.textContent = schedule ? "変更を保存" : "登録する";

  if (schedule) {
    dom.startTime.value = schedule.startTime;
    dom.endTime.value = schedule.endTime;
    setPartValue(dom.ownerPart, dom.ownerOther, schedule.part);
    setWithPartsValues(schedule.withParts);
    setRoomValue(schedule.room);
    dom.content.value = schedule.content;
  } else {
    const start = roundTime();
    dom.startTime.value = start;
    dom.endTime.value = addMinutes(start, 45);
    dom.ownerPart.value = "";
    dom.room.value = "";
  }

  handleOwnerPartChange();
  handleRoomChange();
  handleWithPartsChange();
  updateContentCount();
  dom.scheduleDialog.showModal();
  window.setTimeout(() => dom.startTime.focus(), 80);
}

async function handleScheduleSubmit(event) {
  event.preventDefault();
  hideError(dom.scheduleError);
  const schedule = collectScheduleForm();
  const errors = validateScheduleInput(schedule);
  if (errors.length) {
    showError(dom.scheduleError, errors[0]);
    return;
  }

  setScheduleBusy(true);
  try {
    const result = state.editingSchedule
      ? await api.update({
          ...schedule,
          id: state.editingSchedule.id,
          version: state.editingSchedule.version,
        })
      : await api.create(schedule);

    const saved = result.data.schedule;
    const index = state.todaySchedules.findIndex((item) => item.id === saved.id);
    if (index >= 0) state.todaySchedules[index] = saved;
    else state.todaySchedules.push(saved);
    state.todaySchedules = sortSchedules(state.todaySchedules);
    dom.scheduleDialog.close();
    renderToday();
    showToast(state.editingSchedule ? "予定を変更しました。" : "予定を登録しました。");
  } catch (error) {
    handleScheduleError(error);
  } finally {
    setScheduleBusy(false);
  }
}

function collectScheduleForm() {
  const part = dom.ownerPart.value === OTHER_VALUE
    ? buildOtherValue(dom.ownerOther.value)
    : dom.ownerPart.value;
  const withParts = [...dom.withPartsOptions.querySelectorAll("input:checked")]
    .map((input) => input.value)
    .filter((value) => value !== OTHER_VALUE);
  const otherChecked = dom.withPartsOptions.querySelector(`input[value="${OTHER_VALUE}"]`)?.checked;
  if (otherChecked) withParts.push(buildOtherValue(dom.withOther.value));
  const room = dom.room.value === OTHER_VALUE ? buildOtherValue(dom.roomOther.value) : dom.room.value;

  return {
    startTime: dom.startTime.value,
    endTime: dom.endTime.value,
    part,
    withParts: [...new Set(withParts.filter(Boolean))],
    room,
    content: dom.content.value.trim(),
    allowPartConflict: state.allowPartConflict,
  };
}

function handleScheduleError(error) {
  const conflicts = error.details?.conflicts || [];
  const conflictText = conflicts
    .slice(0, 2)
    .map((item) => `${item.startTime}〜${item.endTime} ${item.room}（${allScheduleParts(item).join("・")}）`)
    .join(" / ");

  if (error.code === "PART_CONFLICT") {
    state.allowPartConflict = true;
    dom.conflictTitle.textContent = "同じ楽器の予定が重なっています";
    dom.conflictMessage.textContent = `${conflictText} 人数を分ける場合は、もう一度保存してください。`;
    dom.conflictBox.hidden = false;
    dom.saveScheduleButton.textContent = "重複を承知で保存";
    return;
  }

  if (error.code === "ROOM_CONFLICT") {
    dom.conflictTitle.textContent = "この部屋は使用中です";
    dom.conflictMessage.textContent = `${conflictText} 時間または部屋を変更してください。`;
    dom.conflictBox.hidden = false;
    return;
  }

  if (error.code === "VERSION_CONFLICT" || error.code === "NOT_FOUND") {
    dom.scheduleDialog.close();
    showToast("別の人がこの予定を更新しました。最新の一覧を読み込みます。", { type: "error" });
    void loadToday();
    return;
  }

  if (error.code === "AUTH_REQUIRED") {
    logOut(false);
    return;
  }
  showError(dom.scheduleError, error.message);
}

function setScheduleBusy(isBusy) {
  dom.saveScheduleButton.disabled = isBusy;
  dom.scheduleDialog.querySelectorAll("input, select, textarea, button").forEach((control) => {
    if (control.hasAttribute("data-close-dialog")) return;
    if (control !== dom.saveScheduleButton) control.disabled = isBusy;
  });
  if (isBusy) dom.saveScheduleButton.textContent = "保存中…";
  else {
    handleOwnerPartChange();
    handleWithPartsChange();
    handleRoomChange();
    if (!state.allowPartConflict) dom.saveScheduleButton.textContent = state.editingSchedule ? "変更を保存" : "登録する";
  }
}

function openDeleteDialog(schedule) {
  state.deletingSchedule = schedule;
  hideError(dom.deleteError);
  dom.deleteSummary.replaceChildren(
    element("strong", "", `${schedule.startTime}〜${schedule.endTime}　${schedule.room}`),
    document.createElement("br"),
    document.createTextNode(`${allScheduleParts(schedule).join(" × ")} / ${schedule.content}`),
  );
  dom.deleteDialog.showModal();
}

async function handleDeleteConfirm() {
  const schedule = state.deletingSchedule;
  if (!schedule) return;
  dom.confirmDeleteButton.disabled = true;
  dom.confirmDeleteButton.textContent = "削除中…";
  hideError(dom.deleteError);

  try {
    const result = await api.remove(schedule.id, schedule.version);
    state.todaySchedules = state.todaySchedules.filter((item) => item.id !== schedule.id);
    renderToday();
    dom.deleteDialog.close();
    const undo = { id: schedule.id, undoUntil: Number(result.data.undoUntil) };
    localStorage.setItem(config.undoStorageKey, JSON.stringify(undo));
    showUndoToast(undo);
  } catch (error) {
    if (error.code === "AUTH_REQUIRED") logOut(false);
    else if (error.code === "VERSION_CONFLICT" || error.code === "NOT_FOUND") {
      dom.deleteDialog.close();
      showToast("予定が更新されています。最新の一覧を読み込みます。", { type: "error" });
      void loadToday();
    } else showError(dom.deleteError, error.message);
  } finally {
    dom.confirmDeleteButton.disabled = false;
    dom.confirmDeleteButton.textContent = "削除する";
  }
}

function showUndoToast(undo) {
  const remaining = Math.max(0, undo.undoUntil - Date.now());
  if (!remaining) {
    localStorage.removeItem(config.undoStorageKey);
    return;
  }
  showToast("予定を削除しました。", {
    duration: remaining,
    actionLabel: "元に戻す",
    onAction: () => void undoDelete(undo.id),
  });
}

function restoreUndoToast() {
  try {
    const undo = JSON.parse(localStorage.getItem(config.undoStorageKey) || "null");
    if (undo?.id && Number(undo.undoUntil) > Date.now()) showUndoToast(undo);
    else localStorage.removeItem(config.undoStorageKey);
  } catch {
    localStorage.removeItem(config.undoStorageKey);
  }
}

async function undoDelete(id) {
  try {
    const result = await api.undoDelete(id);
    localStorage.removeItem(config.undoStorageKey);
    const restored = result.data.schedule;
    if (restored) state.todaySchedules = sortSchedules([...state.todaySchedules, restored]);
    else await loadToday({ silent: true });
    renderToday();
    showToast("削除を取り消しました。");
  } catch (error) {
    localStorage.removeItem(config.undoStorageKey);
    showToast(error.message || "削除を取り消せませんでした。", { type: "error" });
  }
}

function populateInstrumentSelect(select, placeholder) {
  select.replaceChildren();
  if (placeholder) select.add(new Option("選択してください", ""));
  appendInstrumentOptions(select, true);
}

function appendInstrumentOptions(select, includeOther) {
  state.instrumentGroups.forEach((group) => {
    const optgroup = document.createElement("optgroup");
    optgroup.label = group.name;
    group.values.forEach((value) => optgroup.append(new Option(value, value)));
    select.append(optgroup);
  });
  if (includeOther) select.add(new Option("その他（入力する）", OTHER_VALUE));
}

function populateRoomSelect(select, placeholder) {
  select.replaceChildren();
  if (placeholder) select.add(new Option("選択してください", ""));
  state.rooms.forEach((room) => select.add(new Option(room, room)));
  select.add(new Option("その他（入力する）", OTHER_VALUE));
}

function renderWithPartsOptions() {
  dom.withPartsOptions.replaceChildren();
  [...state.instrumentGroups, { name: "その他", values: [OTHER_VALUE] }].forEach((group) => {
    const wrapper = element("div", "parts-group");
    wrapper.append(element("p", "parts-group-title", group.name));
    const list = element("div", "parts-group-list");
    group.values.forEach((value) => {
      const label = element("label", "check-chip");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = value;
      input.name = "withParts";
      label.append(input, element("span", "", value === OTHER_VALUE ? "その他" : value));
      list.append(label);
    });
    wrapper.append(list);
    dom.withPartsOptions.append(wrapper);
  });
}

function setPartValue(select, otherInput, value) {
  const other = parseOtherValue(value);
  if (other === null) select.value = value;
  else {
    select.value = OTHER_VALUE;
    otherInput.value = other;
  }
}

function setWithPartsValues(values) {
  dom.withPartsOptions.querySelectorAll("input").forEach((input) => {
    input.checked = false;
  });
  dom.withOther.value = "";
  values.forEach((value) => {
    const other = parseOtherValue(value);
    const targetValue = other === null ? value : OTHER_VALUE;
    const input = [...dom.withPartsOptions.querySelectorAll("input")].find((item) => item.value === targetValue);
    if (input) input.checked = true;
    if (other !== null) dom.withOther.value = other;
  });
}

function setRoomValue(value) {
  const other = parseOtherValue(value);
  if (other === null) dom.room.value = value;
  else {
    dom.room.value = OTHER_VALUE;
    dom.roomOther.value = other;
  }
}

function handleOwnerPartChange() {
  const isOther = dom.ownerPart.value === OTHER_VALUE;
  dom.ownerOtherWrap.hidden = !isOther;
  dom.ownerOther.required = isOther;
  const selected = dom.ownerPart.value;
  dom.withPartsOptions.querySelectorAll("input").forEach((input) => {
    input.disabled = Boolean(selected) && input.value === selected && selected !== OTHER_VALUE;
    if (input.disabled) input.checked = false;
  });
}

function handleWithPartsChange() {
  const other = dom.withPartsOptions.querySelector(`input[value="${OTHER_VALUE}"]`);
  dom.withOtherWrap.hidden = !other?.checked;
  dom.withOther.required = Boolean(other?.checked);
}

function handleRoomChange() {
  const isOther = dom.room.value === OTHER_VALUE;
  dom.roomOtherWrap.hidden = !isOther;
  dom.roomOther.required = isOther;
}

function updateContentCount() {
  dom.contentCount.textContent = `${dom.content.value.length} / 120`;
}

function togglePasswordVisibility() {
  const visible = dom.password.type === "text";
  dom.password.type = visible ? "password" : "text";
  dom.passwordToggle.textContent = visible ? "表示" : "隠す";
  dom.passwordToggle.setAttribute("aria-label", visible ? "パスワードを表示" : "パスワードを隠す");
}

function closeOnBackdrop(event) {
  const dialog = event.currentTarget;
  if (event.target === dialog) dialog.close();
}

function setSyncStatus(status, label) {
  dom.syncStatus.classList.toggle("is-online", status === "online");
  dom.syncStatus.classList.toggle("is-error", status === "error");
  dom.syncStatus.lastElementChild.textContent = label;
}

function startPolling() {
  stopPolling();
  state.pollTimer = window.setInterval(() => {
    if (!document.hidden && state.currentView === "today") void loadToday({ silent: true });
  }, config.pollIntervalMs);
}

function stopPolling() {
  if (state.pollTimer) window.clearInterval(state.pollTimer);
  state.pollTimer = null;
}

function handleApiFailure(error, fallback) {
  if (error.code === "AUTH_REQUIRED") {
    clearSession();
    stopPolling();
    showLogin("ログインの有効期限が切れました。もう一度パスワードを入力してください。");
    return;
  }
  setSyncStatus("error", "更新失敗");
  showToast(error.message || fallback, { type: "error" });
}

function showError(elementNode, message) {
  elementNode.textContent = message;
  elementNode.hidden = false;
}

function hideError(elementNode) {
  elementNode.hidden = true;
  elementNode.textContent = "";
}

function showToast(message, { type = "success", duration = 4_000, actionLabel = "", onAction = null } = {}) {
  if (state.toastTimer) window.clearTimeout(state.toastTimer);
  dom.toastRegion.replaceChildren();
  const toast = element("div", `toast${type === "error" ? " is-error" : ""}`);
  toast.append(element("div", "toast-message", message));
  if (actionLabel && onAction) {
    const action = element("button", "toast-action", actionLabel);
    action.type = "button";
    action.addEventListener("click", () => {
      dom.toastRegion.replaceChildren();
      onAction();
    });
    toast.append(action);
  }
  dom.toastRegion.append(toast);
  state.toastTimer = window.setTimeout(() => {
    dom.toastRegion.replaceChildren();
    if (actionLabel) localStorage.removeItem(config.undoStorageKey);
  }, duration);
}
