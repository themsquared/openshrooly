export function digitsFrom(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 6);
}

export function looksLikeRecovery(value) {
  const clean = String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return clean.length >= 8 && !/^\d{6}$/.test(String(value || "").replace(/\s+/g, ""));
}

export function recoveryFileText(codes) {
  const list = (codes || []).map((c) => String(c)).join("\n");
  return `Shroom Labs recovery codes\nEach code works once. Keep them somewhere safe.\n\n${list}\n`;
}
