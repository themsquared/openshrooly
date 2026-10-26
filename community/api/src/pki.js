/** Minimal ECDSA P-256 CSR + X.509 CA for Workers (WebCrypto only). */

const te = new TextEncoder();

export const P256 = { name: "ECDSA", namedCurve: "P-256" };
export const ECDSA_SHA256 = { name: "ECDSA", hash: "SHA-256" };
const OID_EC = [1, 2, 840, 10045, 2, 1];
const OID_P256 = [1, 2, 840, 10045, 3, 1, 7];
const OID_ECDSA_SHA256 = [1, 2, 840, 10045, 4, 3, 2];
const OID_CN = [2, 5, 4, 3];
const OID_BASIC = [2, 5, 29, 19];
const OID_EXT_KU = [2, 5, 29, 37];
const OID_CLIENT_AUTH = [1, 3, 6, 1, 5, 5, 7, 3, 2];
const OID_KEY_USAGE = [2, 5, 29, 15];

function concat(...chunks) {
  const list = chunks.filter(Boolean);
  const out = new Uint8Array(list.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of list) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

function lenBytes(n) {
  if (n < 128) return Uint8Array.of(n);
  if (n < 256) return Uint8Array.of(0x81, n);
  return Uint8Array.of(0x82, (n >> 8) & 0xff, n & 0xff);
}

function tlv(tag, body) {
  return concat(Uint8Array.of(tag), lenBytes(body.length), body);
}

function seq(...parts) {
  return tlv(0x30, concat(...parts));
}

function setOf(...parts) {
  return tlv(0x31, concat(...parts));
}

function oid(ids) {
  const body = [40 * ids[0] + ids[1]];
  for (const n of ids.slice(2)) {
    const stack = [];
    let v = n;
    stack.push(v & 0x7f);
    v >>= 7;
    while (v) {
      stack.push(0x80 | (v & 0x7f));
      v >>= 7;
    }
    while (stack.length) body.push(stack.pop());
  }
  return tlv(0x06, Uint8Array.from(body));
}

function integerFromBytes(bytes) {
  let i = 0;
  while (i < bytes.length - 1 && bytes[i] === 0) i += 1;
  let v = bytes.slice(i);
  if (v[0] & 0x80) v = concat(Uint8Array.of(0), v);
  return tlv(0x02, v);
}

function integerFromNumber(n) {
  if (n === 0) return Uint8Array.of(0x02, 0x01, 0x00);
  const bytes = [];
  let v = n;
  while (v) {
    bytes.unshift(v & 0xff);
    v = Math.floor(v / 256);
  }
  if (bytes[0] & 0x80) bytes.unshift(0);
  return tlv(0x02, Uint8Array.from(bytes));
}

function bitString(bytes, unused = 0) {
  return tlv(0x03, concat(Uint8Array.of(unused), bytes));
}

function utf8(value) {
  return tlv(0x0c, te.encode(value));
}

function utcTime(date) {
  const pad = (n) => String(n).padStart(2, "0");
  const yy = pad(date.getUTCFullYear() % 100);
  const s = `${yy}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
  return tlv(0x17, te.encode(s));
}

function nameCn(cn) {
  return seq(setOf(seq(oid(OID_CN), utf8(cn))));
}

function algId() {
  return seq(oid(OID_ECDSA_SHA256));
}

function spkiFromRaw(xy) {
  return seq(seq(oid(OID_EC), oid(OID_P256)), bitString(xy));
}

export function pemToDer(pem) {
  const b64 = String(pem)
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export function derToPem(der, label) {
  let b64 = "";
  for (const b of der) b64 += String.fromCharCode(b);
  const lines = btoa(b64).match(/.{1,64}/g) || [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

function walk(view) {
  const out = [];
  let i = 0;
  while (i < view.length) {
    const tag = view[i];
    let len = view[i + 1];
    let header = 2;
    if (len & 0x80) {
      const n = len & 0x7f;
      len = 0;
      for (let k = 0; k < n; k += 1) len = (len << 8) | view[i + 2 + k];
      header = 2 + n;
    }
    const start = i + header;
    const end = start + len;
    out.push({ tag, start, end, body: view.subarray(start, end), raw: view.subarray(i, end) });
    i = end;
  }
  return out;
}

function ecdsaRawToDer(raw) {
  const r = integerFromBytes(raw.subarray(0, 32));
  const s = integerFromBytes(raw.subarray(32, 64));
  return seq(r, s);
}

function ecdsaDerToRaw(der) {
  const inner = der[0] === 0x30 ? walk(der)[0].body : der;
  const parts = walk(inner);
  const to32 = (body) => {
    let v = body;
    while (v.length > 32 && v[0] === 0) v = v.subarray(1);
    if (v.length < 32) {
      const p = new Uint8Array(32);
      p.set(v, 32 - v.length);
      return p;
    }
    return v.subarray(v.length - 32);
  };
  return concat(to32(parts[0].body), to32(parts[1].body));
}

export async function generateP256() {
  return crypto.subtle.generateKey(P256, true, ["sign", "verify"]);
}

export async function jwkOf(key) {
  return crypto.subtle.exportKey("jwk", key);
}

export async function keyFromJwk(jwk, usages) {
  return crypto.subtle.importKey("jwk", jwk, P256, true, usages);
}

export async function rawPublic(key) {
  const jwk = await jwkOf(key);
  const x = b64urlToBytes(jwk.x);
  const y = b64urlToBytes(jwk.y);
  return concat(Uint8Array.of(0x04), x, y);
}

function b64urlToBytes(value) {
  const b64 = value.replaceAll("-", "+").replaceAll("_", "/") + "==".slice((value.length * 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export async function buildCsr(privateKey, publicKey, cn) {
  const xy = await rawPublic(publicKey);
  const info = seq(integerFromNumber(0), nameCn(cn), spkiFromRaw(xy), tlv(0xa0, new Uint8Array()));
  const rawSig = new Uint8Array(await crypto.subtle.sign(ECDSA_SHA256, privateKey, info));
  const csr = seq(info, algId(), bitString(ecdsaRawToDer(rawSig)));
  return derToPem(csr, "CERTIFICATE REQUEST");
}

export const MAX_CSR_PEM = 4096;
const CSR_LABELS = new Set(["CERTIFICATE REQUEST", "NEW CERTIFICATE REQUEST"]);

/** Strict DER reader: definite lengths only, no trailing bytes, every node inside its parent. */
function derNodes(view) {
  const out = [];
  let i = 0;
  while (i < view.length) {
    if (i + 2 > view.length) throw new Error("CSR is truncated");
    const tag = view[i];
    let len = view[i + 1];
    let header = 2;
    if (len & 0x80) {
      const n = len & 0x7f;
      if (n < 1 || n > 2) throw new Error("CSR length encoding not allowed");
      if (i + 2 + n > view.length) throw new Error("CSR is truncated");
      len = 0;
      for (let k = 0; k < n; k += 1) len = (len << 8) | view[i + 2 + k];
      if (len < 128 || (n === 2 && len < 256)) throw new Error("CSR length is not minimal DER");
      header = 2 + n;
    }
    const start = i + header;
    const end = start + len;
    if (end > view.length) throw new Error("CSR is truncated");
    out.push({ tag, body: view.subarray(start, end), raw: view.subarray(i, end) });
    i = end;
  }
  return out;
}

function expectNodes(view, tags, what) {
  const nodes = derNodes(view);
  if (nodes.length !== tags.length || nodes.some((n, k) => n.tag !== tags[k])) throw new Error(`CSR ${what} is malformed`);
  return nodes;
}

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

export function pemBody(pem, labels) {
  const text = String(pem || "").trim();
  const m = text.match(/^-----BEGIN ([A-Z ]+)-----\r?\n([A-Za-z0-9+/=\r\n]+)\r?\n-----END ([A-Z ]+)-----$/);
  if (!m || m[1] !== m[3] || !labels.has(m[1])) throw new Error("expected a PEM certificate request");
  return pemToDer(text);
}

const SPKI_P256_ALG = seq(oid(OID_EC), oid(OID_P256));

/** Parse a PKCS#10 CSR, accepting only ECDSA P-256 keys signed with ecdsa-with-SHA256. */
export function parseCsr(pem) {
  if (typeof pem !== "string" || !pem) throw new Error("csr required");
  if (pem.length > MAX_CSR_PEM) throw new Error("CSR is too large");
  const der = pemBody(pem, CSR_LABELS);
  const [csr] = expectNodes(der, [0x30], "envelope");
  const [info, alg, sig] = expectNodes(csr.body, [0x30, 0x30, 0x03], "structure");
  const kids = derNodes(info.body);
  if (kids.length !== 4 || kids[0].tag !== 0x02 || kids[1].tag !== 0x30 || kids[2].tag !== 0x30 || kids[3].tag !== 0xa0) {
    throw new Error("CSR info is malformed");
  }
  if (kids[0].body.length !== 1 || kids[0].body[0] !== 0) throw new Error("CSR version must be 1");
  derNodes(kids[1].body);
  derNodes(kids[3].body);
  const [spkiAlg, spkiBits] = expectNodes(kids[2].body, [0x30, 0x03], "public key");
  if (!sameBytes(spkiAlg.raw, SPKI_P256_ALG)) throw new Error("CSR must be ECDSA P-256");
  if (spkiBits.body.length !== 66 || spkiBits.body[0] !== 0 || spkiBits.body[1] !== 0x04) {
    throw new Error("CSR must be an uncompressed P-256 key");
  }
  if (!sameBytes(alg.raw, algId())) throw new Error("CSR must be signed with ecdsa-with-SHA256");
  if (sig.body.length < 2 || sig.body[0] !== 0) throw new Error("CSR signature is malformed");
  return { info: info.raw, xy: spkiBits.body.subarray(1), signatureDer: sig.body.subarray(1) };
}

/** Strict DER ECDSA signature to raw r||s (64 bytes). */
export function ecdsaSigToRaw(sigDer) {
  const [s] = expectNodes(sigDer, [0x30], "signature");
  const parts = expectNodes(s.body, [0x02, 0x02], "signature");
  const to32 = (body) => {
    if (body.length < 1 || body.length > 33 || (body.length === 33 && body[0] !== 0)) throw new Error("signature integer out of range");
    const v = body.length === 33 ? body.subarray(1) : body;
    const p = new Uint8Array(32);
    p.set(v, 32 - v.length);
    return p;
  };
  return concat(to32(parts[0].body), to32(parts[1].body));
}

export async function verifyCsr(pem) {
  const parsed = parseCsr(pem);
  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: bytesToB64url(parsed.xy.subarray(1, 33)),
    y: bytesToB64url(parsed.xy.subarray(33, 65)),
  };
  const pub = await keyFromJwk(jwk, ["verify"]);
  const ok = await crypto.subtle.verify(ECDSA_SHA256, pub, ecdsaSigToRaw(parsed.signatureDer), parsed.info);
  if (!ok) throw new Error("CSR signature invalid");
  return { jwk, xy: parsed.xy, spki: spkiFromRaw(parsed.xy) };
}

export function bytesToB64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function randomSerial() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[0] &= 0x7f;
  if (bytes[0] === 0) bytes[0] = 1;
  return bytes;
}

export function serialHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function extensions(isCa) {
  const basic = seq(oid(OID_BASIC), tlv(0x01, Uint8Array.of(0xff)), tlv(0x04, seq(tlv(0x01, Uint8Array.of(isCa ? 0xff : 0x00)))));
  const eku = seq(oid(OID_EXT_KU), tlv(0x04, seq(oid(OID_CLIENT_AUTH))));
  // KeyUsage bits count from the MSB: digitalSignature = bit 0 (0x80), keyCertSign = bit 5 (0x04),
  // cRLSign = bit 6 (0x02). DER drops trailing zero bits, so the unused-bit count depends on the value.
  const usage = seq(
    oid(OID_KEY_USAGE),
    tlv(0x01, Uint8Array.of(0xff)),
    tlv(0x04, isCa ? bitString(Uint8Array.of(0x06), 1) : bitString(Uint8Array.of(0x80), 7))
  );
  return tlv(0xa3, seq(basic, usage, ...(isCa ? [] : [eku])));
}

async function signTbs(key, tbs) {
  const raw = new Uint8Array(await crypto.subtle.sign(ECDSA_SHA256, key, tbs));
  return seq(tbs, algId(), bitString(ecdsaRawToDer(raw)));
}

export async function issueCertificate({ issuerKey, issuerCn, issuerName, subjectCn, subjectSpki, serial, notBefore, notAfter, isCa = false }) {
  const tbs = seq(
    tlv(0xa0, integerFromNumber(2)),
    integerFromBytes(serial),
    algId(),
    issuerName || nameCn(issuerCn),
    seq(utcTime(notBefore), utcTime(notAfter)),
    nameCn(subjectCn),
    subjectSpki[0] === 0x30 ? subjectSpki : spkiFromRaw(subjectSpki),
    extensions(isCa)
  );
  const der = await signTbs(issuerKey, tbs);
  return { der, pem: derToPem(der, "CERTIFICATE"), serial: serialHex(serial) };
}

export async function createWorkerCa(cn = "Shroom Labs Device CA") {
  const pair = await generateP256();
  const serial = randomSerial();
  const now = new Date();
  const later = new Date(now.getTime() + 10 * 365 * 24 * 3600 * 1000);
  const xy = await rawPublic(pair.publicKey);
  const issued = await issueCertificate({
    issuerKey: pair.privateKey,
    issuerCn: cn,
    subjectCn: cn,
    subjectSpki: xy,
    serial,
    notBefore: now,
    notAfter: later,
    isCa: true,
  });
  // Ephemeral dev-only CA: the private key is never exported.
  return { cn, privateKey: pair.privateKey, publicKey: pair.publicKey, certPem: issued.pem };
}

/** Subject Name DER and raw public point of a CA certificate (used as the issuer of device certs). */
export function caCertInfo(certPem) {
  const der = pemToDer(certPem);
  const [cert] = derNodes(der);
  const [tbs] = derNodes(cert.body);
  const kids = derNodes(tbs.body);
  const k = kids[0].tag === 0xa0 ? 1 : 0;
  const subject = kids[k + 4];
  const [, bits] = derNodes(kids[k + 5].body);
  return { subjectDer: subject.raw, xy: bits.body.subarray(1) };
}

/**
 * Import the CA private key as a non-extractable signing key.
 * When a CA certificate is given, the key must match the certificate's public key.
 */
export async function importCaKey(pkcs8Pem, certPem) {
  const der = pemToDer(pkcs8Pem);
  if (certPem) {
    const probe = await crypto.subtle.importKey("pkcs8", der, P256, true, ["sign"]);
    const jwk = await crypto.subtle.exportKey("jwk", probe);
    const { xy } = caCertInfo(certPem);
    const match = jwk.x === bytesToB64url(xy.subarray(1, 33)) && jwk.y === bytesToB64url(xy.subarray(33, 65));
    if (!match) throw new Error("DEVICE_CA_KEY does not match DEVICE_CA_CERT");
  }
  return crypto.subtle.importKey("pkcs8", der, P256, false, ["sign"]);
}

export async function issueDeviceCertificate(ca, csrPem, { cn, days = 7 } = {}) {
  const verified = await verifyCsr(csrPem);
  const serial = randomSerial();
  const now = new Date(Date.now() - 60 * 1000);
  const later = new Date(Date.now() + days * 24 * 3600 * 1000);
  const issued = await issueCertificate({
    issuerKey: ca.privateKey,
    issuerCn: ca.cn,
    issuerName: ca.certPem ? caCertInfo(ca.certPem).subjectDer : undefined,
    subjectCn: cn,
    subjectSpki: verified.spki,
    serial,
    notBefore: now,
    notAfter: later,
    isCa: false,
  });
  const fingerprint = await sha256HexBytes(issued.der);
  return {
    pem: issued.pem,
    serial: issued.serial,
    fingerprint,
    notBefore: now.toISOString().replace(/\.\d+Z$/, "Z"),
    notAfter: later.toISOString().replace(/\.\d+Z$/, "Z"),
    jwk: verified.jwk,
  };
}

async function sha256HexBytes(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function fingerprintPem(pem) {
  return sha256HexBytes(pemToDer(pem));
}

export function parseCertMeta(pem) {
  const der = pemToDer(pem);
  const cert = walk(der)[0];
  const tbs = walk(cert.body)[0];
  const kids = walk(tbs.body);
  const serialNode = kids[0].tag === 0xa0 ? kids[1] : kids[0];
  return { serial: serialHex(serialNode.body[0] === 0 ? serialNode.body.subarray(1) : serialNode.body), der };
}
