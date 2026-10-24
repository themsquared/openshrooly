#include "cloud_format.h"

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

namespace esphome {
namespace shroom_labs {

const char *state_name(CloudState state) {
  switch (state) {
    case CloudState::Off:
      return "off";
    case CloudState::Connecting:
      return "connecting";
    case CloudState::PendingClaim:
      return "pending_claim";
    case CloudState::Issuing:
      return "issuing";
    case CloudState::Linked:
      return "linked";
    case CloudState::Rotating:
      return "rotating";
    case CloudState::Revoked:
      return "revoked";
    case CloudState::Error:
    default:
      return "error";
  }
}

const char *state_message(CloudState state) {
  switch (state) {
    case CloudState::Off:
      return "Cloud is off. Your chamber still works on its own.";
    case CloudState::Connecting:
      return "Connecting to Shroom Labs.";
    case CloudState::PendingClaim:
      return "Scan the code or open shroomlabs.io/claim and type the letters.";
    case CloudState::Issuing:
      return "Finishing the link.";
    case CloudState::Linked:
      return "Linked to your Shroom Labs account.";
    case CloudState::Rotating:
      return "Refreshing the cloud link.";
    case CloudState::Revoked:
      return "Unlinked from the account. Refresh on this chamber to claim it again.";
    case CloudState::Error:
    default:
      return "Could not reach Shroom Labs. Your chamber still works on its own.";
  }
}

CloudState next_state(CloudState state, CloudEvent event) {
  if (event == CloudEvent::Disable)
    return CloudState::Off;
  switch (state) {
    case CloudState::Off:
      if (event == CloudEvent::Enable)
        return CloudState::Connecting;
      break;
    case CloudState::Connecting:
      if (event == CloudEvent::EnrollOk)
        return CloudState::PendingClaim;
      if (event == CloudEvent::EnrollOwned)
        return CloudState::Issuing;
      if (event == CloudEvent::EnrollFail || event == CloudEvent::ReclaimFail)
        return CloudState::Error;
      if (event == CloudEvent::ReclaimOk)
        return CloudState::PendingClaim;
      break;
    case CloudState::PendingClaim:
      if (event == CloudEvent::CsrWaiting || event == CloudEvent::RateLimited)
        return CloudState::PendingClaim;
      if (event == CloudEvent::CsrOk)
        return CloudState::Linked;
      if (event == CloudEvent::CsrAuthFail)
        return CloudState::Revoked;
      if (event == CloudEvent::CsrFail)
        return CloudState::Error;
      if (event == CloudEvent::Refresh || event == CloudEvent::Expired)
        return CloudState::Connecting;
      if (event == CloudEvent::Enable)
        return CloudState::Connecting;
      break;
    case CloudState::Issuing:
      if (event == CloudEvent::CsrOk)
        return CloudState::Linked;
      if (event == CloudEvent::CsrWaiting)
        return CloudState::PendingClaim;
      if (event == CloudEvent::CsrAuthFail)
        return CloudState::Revoked;
      if (event == CloudEvent::CsrFail || event == CloudEvent::EnrollFail)
        return CloudState::Error;
      if (event == CloudEvent::RateLimited)
        return CloudState::Issuing;
      break;
    case CloudState::Linked:
      if (event == CloudEvent::RotateDue)
        return CloudState::Rotating;
      if (event == CloudEvent::LinkAuthFail)
        return CloudState::Revoked;
      if (event == CloudEvent::Enable)
        return CloudState::Linked;
      break;
    case CloudState::Rotating:
      if (event == CloudEvent::RotateOk)
        return CloudState::Linked;
      if (event == CloudEvent::LinkAuthFail)
        return CloudState::Revoked;
      if (event == CloudEvent::CsrFail || event == CloudEvent::RateLimited)
        return CloudState::Linked;  // keep the working cert
      break;
    case CloudState::Revoked:
      if (event == CloudEvent::ReclaimOk)
        return CloudState::PendingClaim;
      if (event == CloudEvent::Refresh || event == CloudEvent::Enable)
        return CloudState::Connecting;
      if (event == CloudEvent::ReclaimFail)
        return CloudState::Revoked;
      break;
    case CloudState::Error:
      if (event == CloudEvent::Enable || event == CloudEvent::Refresh)
        return CloudState::Connecting;
      break;
  }
  return state;
}

static const char B64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

std::string base64_encode(const uint8_t *data, size_t len) {
  std::string out;
  out.reserve(((len + 2) / 3) * 4);
  for (size_t i = 0; i < len; i += 3) {
    unsigned n = data[i] << 16;
    if (i + 1 < len)
      n |= data[i + 1] << 8;
    if (i + 2 < len)
      n |= data[i + 2];
    out.push_back(B64[(n >> 18) & 63]);
    out.push_back(B64[(n >> 12) & 63]);
    out.push_back(i + 1 < len ? B64[(n >> 6) & 63] : '=');
    out.push_back(i + 2 < len ? B64[n & 63] : '=');
  }
  return out;
}

std::string base64url_encode(const uint8_t *data, size_t len) {
  std::string out = base64_encode(data, len);
  for (char &c : out) {
    if (c == '+')
      c = '-';
    else if (c == '/')
      c = '_';
  }
  while (!out.empty() && out.back() == '=')
    out.pop_back();
  return out;
}

static int b64_val(char c) {
  if (c >= 'A' && c <= 'Z')
    return c - 'A';
  if (c >= 'a' && c <= 'z')
    return c - 'a' + 26;
  if (c >= '0' && c <= '9')
    return c - '0' + 52;
  if (c == '+' || c == '-')
    return 62;
  if (c == '/' || c == '_')
    return 63;
  return -1;
}

bool base64url_decode(const char *text, uint8_t *out, size_t out_len) {
  if (text == nullptr)
    return false;
  std::string in(text);
  while (in.size() % 4)
    in.push_back('=');
  size_t o = 0;
  for (size_t i = 0; i + 3 < in.size(); i += 4) {
    int a = b64_val(in[i]), b = b64_val(in[i + 1]);
    int c = in[i + 2] == '=' ? 0 : b64_val(in[i + 2]);
    int d = in[i + 3] == '=' ? 0 : b64_val(in[i + 3]);
    if (a < 0 || b < 0 || (in[i + 2] != '=' && c < 0) || (in[i + 3] != '=' && d < 0))
      return false;
    unsigned n = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < out_len)
      out[o++] = (n >> 16) & 0xff;
    if (in[i + 2] != '=' && o < out_len)
      out[o++] = (n >> 8) & 0xff;
    if (in[i + 3] != '=' && o < out_len)
      out[o++] = n & 0xff;
  }
  return o == out_len;
}

std::string hex_encode(const uint8_t *data, size_t len) {
  std::string out(len * 2, '0');
  hex_encode_to(data, len, &out[0]);
  out.resize(len * 2);
  return out;
}

void hex_encode_to(const uint8_t *data, size_t len, char *out) {
  static const char H[] = "0123456789abcdef";
  for (size_t i = 0; i < len; i++) {
    out[i * 2] = H[data[i] >> 4];
    out[i * 2 + 1] = H[data[i] & 0xf];
  }
  out[len * 2] = 0;
}

std::string jwk_json(const uint8_t x[32], const uint8_t y[32]) {
  return std::string("{\"kty\":\"EC\",\"crv\":\"P-256\",\"x\":\"") + base64url_encode(x, 32) + "\",\"y\":\"" +
         base64url_encode(y, 32) + "\"}";
}

std::string pem_wrap(const uint8_t *der, size_t len, const char *label) {
  std::string b64 = base64_encode(der, len);
  std::string out = "-----BEGIN ";
  out += label;
  out += "-----\n";
  for (size_t i = 0; i < b64.size(); i += 64) {
    out.append(b64, i, std::min<size_t>(64, b64.size() - i));
    out.push_back('\n');
  }
  out += "-----END ";
  out += label;
  out += "-----\n";
  return out;
}

static bool is_claim_char(char c) {
  return (c >= 'A' && c <= 'Z' && c != 'I' && c != 'O') || (c >= '2' && c <= '9' && c != '0');
}

bool claim_code_ok(const char *code) {
  if (code == nullptr || std::strlen(code) != 6)
    return false;
  for (int i = 0; i < 6; i++) {
    char c = code[i];
    if (c >= 'a' && c <= 'z')
      c = static_cast<char>(c - 'a' + 'A');
    if (!is_claim_char(c))
      return false;
  }
  return true;
}

std::string format_claim_code(const char *code) {
  std::string out;
  if (code == nullptr)
    return out;
  for (const char *p = code; *p; p++) {
    char c = *p;
    if (c >= 'a' && c <= 'z')
      c = static_cast<char>(c - 'a' + 'A');
    if ((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9'))
      out.push_back(c);
  }
  if (out.size() > 6)
    out.resize(6);
  return out;
}

std::string claim_url_for(const char *site, const char *code) {
  std::string base = site && site[0] ? site : DEFAULT_SITE;
  while (!base.empty() && base.back() == '/')
    base.pop_back();
  return base + CLAIM_PATH + format_claim_code(code);
}

bool claim_url_ok(const char *url, const char *code) {
  if (url == nullptr || code == nullptr)
    return false;
  std::string want = std::string("claim.html?code=") + format_claim_code(code);
  return std::strstr(url, want.c_str()) != nullptr && std::strncmp(url, "https://", 8) == 0;
}

std::string proof_payload(const char *device_id, const char *nonce, const char *method, const char *path,
                          const char *body_sha256_hex) {
  std::string m = method ? method : "";
  for (char &c : m) {
    if (c >= 'a' && c <= 'z')
      c = static_cast<char>(c - 'a' + 'A');
  }
  std::string p;
  p.reserve(160);
  p += PROOF_VERSION;
  p += '\n';
  p += device_id ? device_id : "";
  p += '\n';
  p += nonce ? nonce : "";
  p += '\n';
  p += m;
  p += '\n';
  p += path ? path : "";
  p += '\n';
  p += body_sha256_hex ? body_sha256_hex : "";
  return p;
}

static std::string json_escape(const char *s) {
  std::string out;
  if (s == nullptr)
    return out;
  out.reserve(std::strlen(s));
  for (const char *p = s; *p; p++) {
    if (*p == '"' || *p == '\\') {
      out.push_back('\\');
      out.push_back(*p);
    } else if (*p == '\n') {
      out += "\\n";
    } else if (*p == '\r') {
      out += "\\r";
    } else if (static_cast<unsigned char>(*p) >= 32) {
      out.push_back(*p);
    }
  }
  return out;
}

std::string enroll_body_json(const char *hardware_id, const char *jwk, const char *name) {
  return std::string("{\"hardware_id\":\"") + json_escape(hardware_id) + "\",\"public_jwk\":" + (jwk ? jwk : "{}") +
         ",\"name\":\"" + json_escape(name && name[0] ? name : "Chamber") + "\"}";
}

std::string csr_body_json(const char *csr_pem, const char *enroll_token) {
  return std::string("{\"csr\":\"") + json_escape(csr_pem) + "\",\"enroll_token\":\"" + json_escape(enroll_token) +
         "\"}";
}

std::string rotate_body_json(const char *csr_pem) { return std::string("{\"csr\":\"") + json_escape(csr_pem) + "\"}"; }

std::string reclaim_body_json(const char *jwk) {
  if (jwk == nullptr || !jwk[0])
    return "{}";
  return std::string("{\"public_jwk\":") + jwk + "}";
}

static const char *find_key(const char *json, const char *key) {
  if (json == nullptr || key == nullptr)
    return nullptr;
  std::string pat = std::string("\"") + key + "\"";
  const char *p = json;
  while ((p = std::strstr(p, pat.c_str())) != nullptr) {
    const char *q = p + pat.size();
    while (*q == ' ' || *q == '\n' || *q == '\t')
      q++;
    if (*q == ':')
      return q + 1;
    p += 1;
  }
  return nullptr;
}

bool json_get_string(const char *json, const char *key, std::string *out) {
  const char *p = find_key(json, key);
  if (p == nullptr || out == nullptr)
    return false;
  while (*p == ' ' || *p == '\n' || *p == '\t')
    p++;
  if (*p != '"')
    return false;
  p++;
  out->clear();
  while (*p && *p != '"') {
    if (*p == '\\' && p[1]) {
      p++;
      out->push_back(*p++);
    } else {
      out->push_back(*p++);
    }
  }
  return *p == '"';
}

bool json_get_int64(const char *json, const char *key, int64_t *out) {
  const char *p = find_key(json, key);
  if (p == nullptr || out == nullptr)
    return false;
  while (*p == ' ' || *p == '\n' || *p == '\t')
    p++;
  char *end = nullptr;
  long long v = std::strtoll(p, &end, 10);
  if (end == p)
    return false;
  *out = static_cast<int64_t>(v);
  return true;
}

static void der_len(std::vector<uint8_t> *out, size_t n) {
  if (n < 128) {
    out->push_back(static_cast<uint8_t>(n));
  } else if (n < 256) {
    out->push_back(0x81);
    out->push_back(static_cast<uint8_t>(n));
  } else {
    out->push_back(0x82);
    out->push_back(static_cast<uint8_t>(n >> 8));
    out->push_back(static_cast<uint8_t>(n));
  }
}

static void tlv(std::vector<uint8_t> *out, uint8_t tag, const uint8_t *body, size_t len) {
  out->push_back(tag);
  der_len(out, len);
  out->insert(out->end(), body, body + len);
}

static void tlv_vec(std::vector<uint8_t> *out, uint8_t tag, const std::vector<uint8_t> &body) {
  tlv(out, tag, body.data(), body.size());
}

static std::vector<uint8_t> oid(const uint8_t *enc, size_t n) {
  std::vector<uint8_t> o;
  tlv(&o, 0x06, enc, n);
  return o;
}

static std::vector<uint8_t> integer_from_bytes(const uint8_t *b, size_t n) {
  size_t i = 0;
  while (i + 1 < n && b[i] == 0)
    i++;
  std::vector<uint8_t> body;
  if (b[i] & 0x80)
    body.push_back(0);
  body.insert(body.end(), b + i, b + n);
  std::vector<uint8_t> out;
  tlv_vec(&out, 0x02, body);
  return out;
}

void ecdsa_raw_to_der(const uint8_t raw[64], uint8_t *der, size_t *der_len) {
  auto r = integer_from_bytes(raw, 32);
  auto s = integer_from_bytes(raw + 32, 32);
  std::vector<uint8_t> seq;
  seq.insert(seq.end(), r.begin(), r.end());
  seq.insert(seq.end(), s.begin(), s.end());
  std::vector<uint8_t> out;
  tlv_vec(&out, 0x30, seq);
  if (der != nullptr && der_len != nullptr) {
    if (out.size() > *der_len) {
      *der_len = 0;
      return;
    }
    std::memcpy(der, out.data(), out.size());
    *der_len = out.size();
  }
}

bool build_p256_csr_pem(const uint8_t x[32], const uint8_t y[32], const char *cn, SignSha256 sign, void *ctx,
                        std::string *pem) {
  if (x == nullptr || y == nullptr || cn == nullptr || sign == nullptr || pem == nullptr)
    return false;
  if (std::strlen(cn) == 0 || std::strlen(cn) > 64)
    return false;

  static const uint8_t OID_EC[] = {0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01};
  static const uint8_t OID_P256[] = {0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07};
  static const uint8_t OID_ECDSA_SHA256[] = {0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02};
  static const uint8_t OID_CN[] = {0x55, 0x04, 0x03};

  std::vector<uint8_t> cn_utf8(cn, cn + std::strlen(cn));
  std::vector<uint8_t> cn_val;
  tlv_vec(&cn_val, 0x0c, cn_utf8);
  std::vector<uint8_t> atv;
  auto cn_oid = oid(OID_CN, sizeof(OID_CN));
  atv.insert(atv.end(), cn_oid.begin(), cn_oid.end());
  atv.insert(atv.end(), cn_val.begin(), cn_val.end());
  std::vector<uint8_t> atv_seq, atv_set, name;
  tlv_vec(&atv_seq, 0x30, atv);
  tlv_vec(&atv_set, 0x31, atv_seq);
  tlv_vec(&name, 0x30, atv_set);

  uint8_t xy[65];
  xy[0] = 0x04;
  std::memcpy(xy + 1, x, 32);
  std::memcpy(xy + 33, y, 32);
  std::vector<uint8_t> alg;
  auto ec = oid(OID_EC, sizeof(OID_EC));
  auto p256 = oid(OID_P256, sizeof(OID_P256));
  alg.insert(alg.end(), ec.begin(), ec.end());
  alg.insert(alg.end(), p256.begin(), p256.end());
  std::vector<uint8_t> alg_seq, bits, spki_body, spki;
  tlv_vec(&alg_seq, 0x30, alg);
  std::vector<uint8_t> bit_body;
  bit_body.push_back(0);
  bit_body.insert(bit_body.end(), xy, xy + 65);
  tlv_vec(&bits, 0x03, bit_body);
  spki_body.insert(spki_body.end(), alg_seq.begin(), alg_seq.end());
  spki_body.insert(spki_body.end(), bits.begin(), bits.end());
  tlv_vec(&spki, 0x30, spki_body);

  std::vector<uint8_t> ver{0x02, 0x01, 0x00};
  std::vector<uint8_t> attrs{0xa0, 0x00};
  std::vector<uint8_t> info_body;
  info_body.insert(info_body.end(), ver.begin(), ver.end());
  info_body.insert(info_body.end(), name.begin(), name.end());
  info_body.insert(info_body.end(), spki.begin(), spki.end());
  info_body.insert(info_body.end(), attrs.begin(), attrs.end());
  std::vector<uint8_t> info;
  tlv_vec(&info, 0x30, info_body);

  uint8_t raw[64];
  if (!sign(info.data(), info.size(), raw, ctx))
    return false;
  uint8_t der[80];
  size_t der_len = sizeof(der);
  ecdsa_raw_to_der(raw, der, &der_len);
  if (der_len == 0)
    return false;

  std::vector<uint8_t> sigalg_body = oid(OID_ECDSA_SHA256, sizeof(OID_ECDSA_SHA256));
  std::vector<uint8_t> sigalg, sigbits, csr_body, csr;
  tlv_vec(&sigalg, 0x30, sigalg_body);
  std::vector<uint8_t> sb;
  sb.push_back(0);
  sb.insert(sb.end(), der, der + der_len);
  tlv_vec(&sigbits, 0x03, sb);
  csr_body.insert(csr_body.end(), info.begin(), info.end());
  csr_body.insert(csr_body.end(), sigalg.begin(), sigalg.end());
  csr_body.insert(csr_body.end(), sigbits.begin(), sigbits.end());
  tlv_vec(&csr, 0x30, csr_body);

  *pem = pem_wrap(csr.data(), csr.size(), "CERTIFICATE REQUEST");
  return pem->size() <= MAX_CSR_PEM;
}

int64_t parse_iso8601_ms(const char *iso) {
  if (iso == nullptr || std::strlen(iso) < 19)
    return 0;
  int y = 0, mo = 0, d = 0, h = 0, mi = 0, s = 0;
  if (std::sscanf(iso, "%d-%d-%dT%d:%d:%d", &y, &mo, &d, &h, &mi, &s) != 6)
    return 0;
  if (y < 1970 || mo < 1 || mo > 12 || d < 1 || d > 31)
    return 0;
  static const int mdays[] = {0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
  int64_t days = 0;
  for (int yy = 1970; yy < y; yy++)
    days += (yy % 4 == 0 && (yy % 100 != 0 || yy % 400 == 0)) ? 366 : 365;
  for (int m = 1; m < mo; m++) {
    days += mdays[m];
    if (m == 2 && (y % 4 == 0 && (y % 100 != 0 || y % 400 == 0)))
      days += 1;
  }
  days += d - 1;
  return (((days * 24 + h) * 60 + mi) * 60 + s) * 1000;
}

std::string https_url(const char *host, const char *path) {
  std::string u = "https://";
  u += host && host[0] ? host : DEFAULT_API_HOST;
  if (path == nullptr || path[0] != '/')
    u += '/';
  u += path ? path : "";
  return u;
}

bool api_url_allowed(const char *url, const char *host) {
  if (url == nullptr || host == nullptr || !host[0])
    return false;
  std::string prefix = std::string("https://") + host + "/";
  if (std::strncmp(url, prefix.c_str(), prefix.size()) != 0)
    return false;
  if (std::strstr(url, "..") != nullptr || std::strchr(url, ' ') != nullptr)
    return false;
  const char *path = url + prefix.size() - 1;
  return std::strncmp(path, "/api/devices", 12) == 0;
}

}  // namespace shroom_labs
}  // namespace esphome
