import { api, setToken } from "./api.js";
import { qrSvg } from "./qr.js";
import { digitsFrom, looksLikeRecovery, recoveryFileText } from "./totp-format.js";

export { digitsFrom, looksLikeRecovery, recoveryFileText };

export const TOTP_GENERIC = "That code did not work.";

export function bindCodeInput(input, { numeric = true, onComplete } = {}) {
  if (!input) return;
  input.setAttribute("autocapitalize", "none");
  input.setAttribute("autocorrect", "off");
  input.setAttribute("spellcheck", "false");
  if (numeric) {
    input.setAttribute("inputmode", "numeric");
    input.setAttribute("autocomplete", "one-time-code");
    input.setAttribute("maxlength", "8");
  } else {
    input.setAttribute("inputmode", "text");
    input.setAttribute("autocomplete", "off");
    input.setAttribute("maxlength", "16");
  }
  input.addEventListener("paste", (ev) => {
    const text = ev.clipboardData?.getData("text") || "";
    const digits = digitsFrom(text);
    if (digits.length === 6) {
      ev.preventDefault();
      input.value = digits;
      onComplete?.(digits);
    }
  });
}

function show(el, on) {
  if (!el) return;
  el.classList.toggle("hidden", !on);
}

function setNotice(el, text) {
  if (!el) return;
  el.textContent = text || "";
  show(el, Boolean(text));
}

function friendlyTotpError(err) {
  if (err?.status === 429) return "Too many attempts. Try again later.";
  if (err?.status === 401 && /expired/i.test(err.message || "")) return "This sign-in step expired. Start again.";
  return TOTP_GENERIC;
}

export function showTotpChallenge({ form, token, next = "/account.html", setTokenFn = setToken }) {
  if (!form || !token) return false;
  const input = form.querySelector("[name=code], #totp-code");
  const error = form.querySelector("[data-totp-error], #totp-error");
  show(form, true);
  bindCodeInput(input, {
    numeric: true,
    onComplete: () => input?.form?.requestSubmit?.(),
  });
  const recoveryToggle = form.querySelector("[data-recovery-toggle]");
  recoveryToggle?.addEventListener("click", (ev) => {
    ev.preventDefault();
    const recovery = form.dataset.recovery === "1";
    form.dataset.recovery = recovery ? "0" : "1";
    bindCodeInput(input, { numeric: recovery });
    recoveryToggle.textContent = recovery ? "Use a recovery code" : "Use a six-digit code";
    input.value = "";
    input.focus();
  });
  queueMicrotask(() => input?.focus());
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const code = String(input?.value || "").trim();
    if (!code) {
      setNotice(error, TOTP_GENERIC);
      input?.focus();
      return;
    }
    try {
      const data = await api("/api/auth/totp/verify", { method: "POST", jsonBody: { totp_token: token, code } });
      if (data.access_token) setTokenFn(data.access_token);
      location.href = next;
    } catch (err) {
      setNotice(error, friendlyTotpError(err));
      input.value = "";
      input.focus();
    }
  });
  return true;
}

function b64urlToBytes(value) {
  const raw = String(value || "")
    .replaceAll("-", "+")
    .replaceAll("_", "/");
  const pad = raw + "=".repeat((4 - (raw.length % 4)) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64url(bytes) {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export async function finishPasskeyLogin() {
  if (!window.PublicKeyCredential) throw new Error("This browser cannot use a passkey.");
  const begin = await api("/api/auth/webauthn/login/begin", { method: "POST", jsonBody: {} });
  const cred = await navigator.credentials.get({
    publicKey: {
      challenge: b64urlToBytes(begin.challenge),
      rpId: begin.rpId,
      timeout: begin.timeout || 60000,
      userVerification: begin.userVerification || "preferred",
    },
  });
  if (!cred) throw new Error("Passkey sign-in was cancelled.");
  const response = cred.response;
  return api("/api/auth/webauthn/login/finish", {
    method: "POST",
    jsonBody: {
      challenge: begin.challenge,
      credentialId: bytesToB64url(new Uint8Array(cred.rawId)),
      clientDataJSON: bytesToB64url(new Uint8Array(response.clientDataJSON)),
      authenticatorData: bytesToB64url(new Uint8Array(response.authenticatorData)),
      signature: bytesToB64url(new Uint8Array(response.signature)),
    },
  });
}

export async function finishPasswordLogin(email, password) {
  return api("/api/auth/login", { method: "POST", jsonBody: { email, password } });
}

export function handleFirstFactorResult(data, { form, next, setTokenFn = setToken } = {}) {
  if (data?.totp_required && data.totp_token) {
    return showTotpChallenge({ form, token: data.totp_token, next, setTokenFn });
  }
  if (data?.access_token) setTokenFn(data.access_token);
  location.href = next || "/account.html";
  return false;
}

function renderRecovery(box, codes) {
  if (!box) return;
  box.innerHTML = `
    <p>Save these recovery codes. Each works once. We will not show them again.</p>
    <ul class="recovery-list">${codes.map((c) => `<li><code>${c}</code></li>`).join("")}</ul>
    <div class="form-actions">
      <button type="button" class="secondary" data-copy-recovery>Copy</button>
      <button type="button" class="secondary" data-download-recovery>Download</button>
    </div>
    <p data-recovery-copied class="muted" role="status"></p>`;
  show(box, true);
  const text = recoveryFileText(codes);
  box.querySelector("[data-copy-recovery]")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      const status = box.querySelector("[data-recovery-copied]");
      if (status) status.textContent = "Copied.";
    } catch {
      const status = box.querySelector("[data-recovery-copied]");
      if (status) status.textContent = "Copy failed. Select the list and copy it yourself.";
    }
  });
  box.querySelector("[data-download-recovery]")?.addEventListener("click", () => {
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "shroom-labs-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  });
}

export function bindAccountTotp(root, me) {
  if (!root) return;
  const enabled = Boolean(me?.user?.totp_enabled);
  const remaining = Number(me?.user?.totp_recovery_remaining || 0);
  const off = root.querySelector("[data-totp-off]");
  const setup = root.querySelector("[data-totp-setup]");
  const on = root.querySelector("[data-totp-on]");
  const qr = root.querySelector("[data-totp-qr]");
  const secretEl = root.querySelector("[data-totp-secret]");
  const setupForm = root.querySelector("[data-totp-confirm]");
  const setupError = root.querySelector("[data-totp-setup-error]");
  const recoveryBox = root.querySelector("[data-totp-recovery]");
  const disableForm = root.querySelector("[data-totp-disable]");
  const disableError = root.querySelector("[data-totp-disable-error]");
  const remainingEl = root.querySelector("[data-totp-remaining]");
  const startBtn = root.querySelector("[data-totp-start]");

  show(off, !enabled);
  show(on, enabled);
  show(setup, false);
  show(recoveryBox, false);

  if (remainingEl) {
    remainingEl.textContent =
      remaining > 0
        ? `You have ${remaining} unused recovery ${remaining === 1 ? "code" : "codes"}.`
        : "You have no unused recovery codes. Turn this off and on again to make a new set.";
  }

  const confirmInput = setupForm?.querySelector("[name=code]");
  const disableInput = disableForm?.querySelector("[name=code]");
  bindCodeInput(confirmInput, { numeric: true });
  bindCodeInput(disableInput, { numeric: true });
  disableForm?.querySelector("[data-recovery-toggle]")?.addEventListener("click", (ev) => {
    ev.preventDefault();
    const recovery = disableForm.dataset.recovery === "1";
    disableForm.dataset.recovery = recovery ? "0" : "1";
    bindCodeInput(disableInput, { numeric: recovery });
    ev.currentTarget.textContent = recovery ? "Use a recovery code" : "Use a six-digit code";
    disableInput.value = "";
    disableInput.focus();
  });

  startBtn?.addEventListener("click", async () => {
    setNotice(setupError, "");
    try {
      const data = await api("/api/auth/totp/begin", { method: "POST", jsonBody: {} });
      if (qr) qr.innerHTML = qrSvg(data.otpauth, { size: 196, alt: "Scan with your authenticator app" });
      if (secretEl) secretEl.textContent = data.secret;
      show(off, false);
      show(on, false);
      show(setup, true);
      confirmInput?.focus();
    } catch (err) {
      setNotice(setupError, friendlyTotpError(err));
    }
  });

  setupForm?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    setNotice(setupError, "");
    try {
      const data = await api("/api/auth/totp/confirm", {
        method: "POST",
        jsonBody: { code: String(confirmInput?.value || "").trim() },
      });
      show(setup, false);
      show(on, true);
      renderRecovery(recoveryBox, data.recovery_codes || []);
      if (remainingEl) remainingEl.textContent = "You have 10 unused recovery codes.";
    } catch (err) {
      setNotice(setupError, friendlyTotpError(err));
      if (confirmInput) confirmInput.value = "";
      confirmInput?.focus();
    }
  });

  disableForm?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    setNotice(disableError, "");
    try {
      await api("/api/auth/totp/disable", {
        method: "POST",
        jsonBody: { code: String(disableInput?.value || "").trim() },
      });
      location.reload();
    } catch (err) {
      setNotice(disableError, friendlyTotpError(err));
      if (disableInput) disableInput.value = "";
      disableInput?.focus();
    }
  });
}
