const form = document.getElementById("setup-generator");
const password = document.getElementById("setup-password");
const passwordConfirm = document.getElementById("setup-password-confirm");
const hostname = document.getElementById("setup-hostname");
const errorBox = document.getElementById("setup-error");
const output = document.getElementById("generated-values");
const list = document.getElementById("generated-list");
const copyAll = document.getElementById("copy-all");

let generated = {};

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideError();

  if (password.value.length < 10) {
    showError("共有パスワードは10文字以上にしてください。");
    return;
  }
  if (password.value !== passwordConfirm.value) {
    showError("確認用パスワードが一致しません。");
    return;
  }
  const cleanHostname = hostname.value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!/^[a-z0-9.-]+$/.test(cleanHostname)) {
    showError("GitHub Pagesのホスト名を正しく入力してください。");
    return;
  }

  const salt = randomBase64(16);
  const hash = await sha256Base64(`${salt}:${password.value}`);
  generated = {
    PASSWORD_SALT: salt,
    PASSWORD_HASH: hash,
    SESSION_SECRET: randomBase64Url(32),
    SESSION_VERSION: "1",
    ALLOWED_HOSTNAME: cleanHostname,
  };
  renderGenerated();
  password.value = "";
  passwordConfirm.value = "";
});

copyAll.addEventListener("click", async () => {
  const text = Object.entries(generated).map(([key, value]) => `${key}=${value}`).join("\n");
  await navigator.clipboard.writeText(text);
  const original = copyAll.textContent;
  copyAll.textContent = "コピーしました";
  window.setTimeout(() => { copyAll.textContent = original; }, 1400);
});

function renderGenerated() {
  list.replaceChildren();
  Object.entries(generated).forEach(([key, value]) => {
    const wrapper = document.createElement("div");
    wrapper.className = "generated-row";
    const term = document.createElement("dt");
    term.textContent = key;
    const description = document.createElement("dd");
    description.className = "generated-value-line";
    const code = document.createElement("code");
    code.textContent = value;
    code.title = value;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "copy-value";
    button.textContent = "コピー";
    button.addEventListener("click", async () => {
      await navigator.clipboard.writeText(value);
      button.textContent = "完了";
      window.setTimeout(() => { button.textContent = "コピー"; }, 1200);
    });
    description.append(code, button);
    wrapper.append(term, description);
    list.append(wrapper);
  });
  output.hidden = false;
  output.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function sha256Base64(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return bytesToBase64(digest);
}

function randomBase64(length) {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(length)));
}

function randomBase64Url(length) {
  return randomBase64(length).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function bytesToBase64(bytes) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function hideError() {
  errorBox.textContent = "";
  errorBox.hidden = true;
}
