#include "cloud_format.h"

#include <algorithm>
#include <cmath>
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
    case CloudState::Owned:
      return "owned";
    case CloudState::WaitClaim:
      return "wait_claim";
    case CloudState::Relink:
      return "relink";
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
      return "Scan the QR code. Or type the letters at shroomlabs.io/claim.html";
    case CloudState::Issuing:
      return "Finishing the link.";
    case CloudState::Linked:
      return "Linked to your Shroom Labs account.";
    case CloudState::Rotating:
      return "Refreshing the cloud link.";
    case CloudState::Revoked:
      return "Unlinked from the account. Refresh on this chamber to claim it again.";
    case CloudState::Owned:
      return "Already linked to an account. Remove it at shroomlabs.io, then press Refresh.";
    case CloudState::WaitClaim:
      return "Wait a few minutes, then press Refresh.";
    case CloudState::Relink:
      return "This chamber was offline too long. Press Connect to link it again.";
    case CloudState::Error:
    default:
      return "Could not reach Shroom Labs. Press Refresh to try again. Your chamber still works on its own.";
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
      if (event == CloudEvent::EnrollOk || event == CloudEvent::ReclaimOk)
        return CloudState::PendingClaim;
      if (event == CloudEvent::EnrollOwned)
        return CloudState::Owned;
      if (event == CloudEvent::EnrollBusy)
        return CloudState::WaitClaim;
      if (event == CloudEvent::NetworkFail || event == CloudEvent::RateLimited)
        return CloudState::Connecting;
      if (event == CloudEvent::EnrollFail || event == CloudEvent::ReclaimFail)
        return CloudState::Error;
      break;
    case CloudState::PendingClaim:
      if (event == CloudEvent::CsrWaiting || event == CloudEvent::RateLimited || event == CloudEvent::NetworkFail ||
          event == CloudEvent::CsrFail)
        return CloudState::PendingClaim;
      if (event == CloudEvent::CsrOk)
        return CloudState::Linked;
      if (event == CloudEvent::CsrAuthFail || event == CloudEvent::LinkRevoked)
        return CloudState::Revoked;
      if (event == CloudEvent::Refresh || event == CloudEvent::Expired || event == CloudEvent::Enable)
        return CloudState::Connecting;
      break;
    case CloudState::Issuing:
      if (event == CloudEvent::CsrOk)
        return CloudState::Linked;
      if (event == CloudEvent::CsrWaiting || event == CloudEvent::NetworkFail || event == CloudEvent::CsrFail)
        return CloudState::PendingClaim;
      if (event == CloudEvent::CsrAuthFail || event == CloudEvent::LinkRevoked)
        return CloudState::Revoked;
      if (event == CloudEvent::RateLimited)
        return CloudState::Issuing;
      break;
    case CloudState::Linked:
      if (event == CloudEvent::RotateDue)
        return CloudState::Rotating;
      if (event == CloudEvent::LinkAuthFail || event == CloudEvent::LinkRevoked)
        return CloudState::Revoked;
      if (event == CloudEvent::CertExpired || event == CloudEvent::ProofInvalid || event == CloudEvent::Enable)
        return CloudState::Linked;
      if (event == CloudEvent::RelinkRequired)
        return CloudState::Relink;
      break;
    case CloudState::Rotating:
      if (event == CloudEvent::RotateOk)
        return CloudState::Linked;
      if (event == CloudEvent::LinkAuthFail || event == CloudEvent::LinkRevoked)
        return CloudState::Revoked;
      if (event == CloudEvent::RelinkRequired)
        return CloudState::Relink;
      if (event == CloudEvent::CsrFail || event == CloudEvent::RateLimited || event == CloudEvent::NetworkFail ||
          event == CloudEvent::CertExpired || event == CloudEvent::ProofInvalid)
        return CloudState::Linked;
      break;
    case CloudState::Relink:
      if (event == CloudEvent::Refresh || event == CloudEvent::Enable)
        return CloudState::Connecting;
      break;
    case CloudState::Revoked:
      if (event == CloudEvent::ReclaimOk)
        return CloudState::PendingClaim;
      if (event == CloudEvent::Refresh || event == CloudEvent::Enable)
        return CloudState::Connecting;
      if (event == CloudEvent::ReclaimFail || event == CloudEvent::NetworkFail)
        return CloudState::Revoked;
      break;
    case CloudState::Owned:
    case CloudState::WaitClaim:
      if (event == CloudEvent::Refresh || event == CloudEvent::Enable)
        return CloudState::Connecting;
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

std::string claim_status_body_json(const char *enroll_token) {
  return std::string("{\"enroll_token\":\"") + json_escape(enroll_token) + "\"}";
}

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

/** Match "key": only at object depth 1 so nested from.temperature_c is ignored. */
static const char *find_key_top(const char *json, const char *key) {
  if (json == nullptr || key == nullptr)
    return nullptr;
  const size_t klen = std::strlen(key);
  int depth = 0;
  bool in_str = false;
  bool esc = false;
  for (const char *p = json; *p; p++) {
    if (in_str) {
      if (esc)
        esc = false;
      else if (*p == '\\')
        esc = true;
      else if (*p == '"')
        in_str = false;
      continue;
    }
    if (*p == '"') {
      const char *q = p + 1;
      if (depth == 1 && std::strncmp(q, key, klen) == 0 && q[klen] == '"') {
        const char *c = q + klen + 1;
        while (*c == ' ' || *c == '\n' || *c == '\t')
          c++;
        if (*c == ':')
          return c + 1;
      }
      in_str = true;
      continue;
    }
    if (*p == '{' || *p == '[')
      depth++;
    else if (*p == '}' || *p == ']')
      depth--;
  }
  return nullptr;
}

static bool json_get_double_top(const char *json, const char *key, double *out) {
  const char *p = find_key_top(json, key);
  if (p == nullptr || out == nullptr)
    return false;
  while (*p == ' ' || *p == '\n' || *p == '\t')
    p++;
  char *end = nullptr;
  double v = std::strtod(p, &end);
  if (end == p)
    return false;
  *out = v;
  return true;
}

static bool json_get_string_top(const char *json, const char *key, std::string *out) {
  const char *p = find_key_top(json, key);
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

bool json_get_bool(const char *json, const char *key, bool *out) {
  const char *p = find_key(json, key);
  if (p == nullptr || out == nullptr)
    return false;
  while (*p == ' ' || *p == '\n' || *p == '\t')
    p++;
  if (std::strncmp(p, "true", 4) == 0) {
    *out = true;
    return true;
  }
  if (std::strncmp(p, "false", 5) == 0) {
    *out = false;
    return true;
  }
  return false;
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

bool json_get_double(const char *json, const char *key, double *out) {
  const char *p = find_key(json, key);
  if (p == nullptr || out == nullptr)
    return false;
  while (*p == ' ' || *p == '\n' || *p == '\t')
    p++;
  char *end = nullptr;
  double v = std::strtod(p, &end);
  if (end == p)
    return false;
  *out = v;
  return true;
}

static const char *skip_ws(const char *p) {
  while (p != nullptr && (*p == ' ' || *p == '\n' || *p == '\t' || *p == '\r'))
    p++;
  return p;
}

static bool extract_balanced(const char *start, char open, char close, std::string *out) {
  if (start == nullptr || *start != open || out == nullptr)
    return false;
  int depth = 0;
  bool in_str = false;
  bool esc = false;
  for (const char *p = start; *p; p++) {
    if (in_str) {
      if (esc)
        esc = false;
      else if (*p == '\\')
        esc = true;
      else if (*p == '"')
        in_str = false;
      continue;
    }
    if (*p == '"') {
      in_str = true;
      continue;
    }
    if (*p == open)
      depth++;
    else if (*p == close) {
      depth--;
      if (depth == 0) {
        out->assign(start, static_cast<size_t>(p - start + 1));
        return true;
      }
    }
  }
  return false;
}

const char *const KNOB_KEYS[KNOB_COUNT] = {
    "air_exchange_speed", "air_exchange_period_min", "air_exchange_run_sec", "sunrise_hour", "light_hours",
    "white_intensity",    "color_r",                 "color_g",              "color_b",      "grow_day",
};

// Printable ASCII only, and nothing that needs escaping in JSON or HTML.
static std::string grow_text(const std::string &in, size_t max) {
  std::string out;
  for (char ch : in) {
    if (out.size() >= max)
      break;
    if (ch >= 0x20 && ch < 0x7f && ch != '"' && ch != '\\' && ch != '<' && ch != '>')
      out.push_back(ch);
  }
  return out;
}

static std::string grow_link(const std::string &in) {
  std::string s = grow_text(in, 160);
  return s.compare(0, 8, "https://") == 0 && s.find(' ') == std::string::npos ? s : std::string();
}

bool parse_inbox_grow(const char *json, InboxGrow *out) {
  std::string name, url, image;
  if (out == nullptr || !json_get_string_top(json, "grow_name", &name))
    return false;
  json_get_string_top(json, "grow_url", &url);
  json_get_string_top(json, "grow_image", &image);
  out->name = grow_text(name, 48);
  out->url = out->name.empty() ? std::string() : grow_link(url);
  out->image = out->name.empty() ? std::string() : grow_link(image);
  return true;
}

size_t parse_inbox_commands(const char *json, InboxCommand *out, size_t max) {
  if (json == nullptr || out == nullptr || max == 0)
    return 0;
  const char *arr = find_key(json, "commands");
  if (arr == nullptr)
    return 0;
  arr = skip_ws(arr);
  if (*arr != '[')
    return 0;
  arr++;
  size_t n = 0;
  while (*arr && n < max) {
    arr = skip_ws(arr);
    if (*arr == ']' || *arr == '\0')
      break;
    if (*arr == ',') {
      arr++;
      continue;
    }
    std::string obj;
    if (!extract_balanced(arr, '{', '}', &obj))
      break;
    InboxCommand cmd{};
    json_get_int64(obj.c_str(), "id", &cmd.id);
    json_get_string(obj.c_str(), "kind", &cmd.kind);
    json_get_string(obj.c_str(), "issued_at", &cmd.issued_at);
    cmd.has_apply = json_get_bool(obj.c_str(), "apply", &cmd.apply);
    std::string payload;
    const char *pay = find_key_top(obj.c_str(), "payload");
    if (pay != nullptr) {
      pay = skip_ws(pay);
      extract_balanced(pay, '{', '}', &payload);
    }
    const char *src = payload.empty() ? obj.c_str() : payload.c_str();
    json_get_string_top(src, "expires_at", &cmd.expires_at);
    if (cmd.expires_at.empty())
      json_get_string_top(obj.c_str(), "expires_at", &cmd.expires_at);
    double t = 0;
    double h = 0;
    if (json_get_double_top(src, "temperature_target", &t) || json_get_double_top(src, "temperature_c", &t)) {
      cmd.has_temp = true;
      cmd.temperature_c = t;
    }
    if (json_get_double_top(src, "target_humidity", &h) || json_get_double_top(src, "humidity_percent", &h)) {
      cmd.has_rh = true;
      cmd.humidity_percent = h;
    }
    for (uint8_t k = 0; k < KNOB_COUNT; k++) {
      double v = 0;
      if (json_get_double_top(src, KNOB_KEYS[k], &v)) {
        cmd.knob_mask |= static_cast<uint16_t>(1u << k);
        cmd.knob[k] = static_cast<float>(v);
      }
    }
    json_get_string_top(src, "grow_phase", &cmd.grow_phase);
    out[n++] = cmd;
    arr += obj.size();
  }
  return n;
}

float clamp_setpoint_temp(float c) {
  if (c < SETPOINT_TEMP_MIN)
    return SETPOINT_TEMP_MIN;
  if (c > SETPOINT_TEMP_MAX)
    return SETPOINT_TEMP_MAX;
  return c;
}

float clamp_setpoint_rh(float rh) {
  if (rh < SETPOINT_RH_MIN)
    return SETPOINT_RH_MIN;
  if (rh > SETPOINT_RH_MAX)
    return SETPOINT_RH_MAX;
  return rh;
}

bool value_in_entity_range(float v, const EntityRange &range) {
  if (!range.has)
    return true;
  const float slop = range.step > 0 ? range.step / 2.0f + 0.001f : 0.15f;
  return v + slop >= range.min && v - slop <= range.max;
}

float snap_entity_value(float v, const EntityRange &range) {
  if (!range.has)
    return v;
  float out = v;
  if (out < range.min)
    out = range.min;
  if (out > range.max)
    out = range.max;
  if (range.step > 0) {
    const float n = std::round((out - range.min) / range.step);
    out = range.min + n * range.step;
    if (out > range.max)
      out = range.max;
    if (out < range.min)
      out = range.min;
  }
  return out;
}

SetpointPlan plan_setpoint_command(const InboxCommand &cmd, int64_t wall_ms, uint32_t last_local_ms, uint32_t now_ms,
                                   bool remote_apply) {
  SetpointPlan plan{};
  if (!remote_apply)
    return plan;
  const int64_t exp = parse_iso8601_ms(cmd.expires_at.c_str());
  if (exp > 0 && wall_ms >= exp)
    return plan;
  if (cmd.kind != "setpoints") {
    // Answer every command so nothing sits unanswered until it expires.
    plan.decision = SetpointDecision::Refuse;
    plan.ack_status = "refused";
    plan.reason = "Unknown command.";
    return plan;
  }
  if (cmd.has_apply && !cmd.apply) {
    plan.decision = SetpointDecision::Refuse;
    plan.ack_status = "refused";
    plan.reason = "Local change wins.";
    return plan;
  }
  if (!cmd.has_apply)
    return plan;
  const int64_t issued = parse_iso8601_ms(cmd.issued_at.c_str());
  if (last_local_ms != 0 && wall_ms > 0 && issued > 0) {
    const int32_t age = static_cast<int32_t>(now_ms - last_local_ms);
    if (age >= 0) {
      const int64_t local_wall = wall_ms - static_cast<int64_t>(age);
      if (local_wall > issued) {
        plan.decision = SetpointDecision::Refuse;
        plan.ack_status = "refused";
        plan.reason = "Local change after command.";
        return plan;
      }
    }
  }
  if (!cmd.has_temp && !cmd.has_rh && cmd.knob_mask == 0 && cmd.grow_phase.empty()) {
    plan.decision = SetpointDecision::Fail;
    plan.ack_status = "failed";
    plan.reason = "No setpoints.";
    return plan;
  }
  plan.decision = SetpointDecision::Apply;
  plan.ack_status = "applied";
  if (cmd.has_temp) {
    plan.write_temp = true;
    plan.temperature_c = static_cast<float>(cmd.temperature_c);
  }
  if (cmd.has_rh) {
    plan.write_rh = true;
    plan.humidity_percent = static_cast<float>(cmd.humidity_percent);
  }
  plan.knob_mask = cmd.knob_mask;
  for (uint8_t k = 0; k < KNOB_COUNT; k++)
    plan.knob[k] = cmd.knob[k];
  if (cmd.grow_phase.size() <= MAX_PHASE_LEN)
    plan.grow_phase = cmd.grow_phase;
  else {
    plan.decision = SetpointDecision::Fail;
    plan.ack_status = "failed";
    plan.reason = "grow_phase is not an option.";
  }
  return plan;
}

static void append_num(std::string *out, float v) {
  char buf[32];
  std::snprintf(buf, sizeof(buf), "%.2f", static_cast<double>(v));
  *out += buf;
}

std::string telemetry_body_json(const ChamberReading &reading, int64_t ack_id, const char *ack_status,
                                const char *ack_reason, const EntityRange *temp_range, const EntityRange *rh_range,
                                const TelemetryExtras *extras) {
  std::string out = "{";
  bool first = true;
  auto comma = [&]() {
    if (!first)
      out += ",";
    first = false;
  };
  if (reading.has_temperature) {
    comma();
    out += "\"temperature\":";
    append_num(&out, reading.temperature);
    out += ",\"temperature_c\":";
    append_num(&out, reading.temperature);
  }
  if (reading.has_humidity) {
    comma();
    out += "\"humidity\":";
    append_num(&out, reading.humidity);
    out += ",\"humidity_percent\":";
    append_num(&out, reading.humidity);
  }
  if (reading.has_temperature_target) {
    comma();
    out += "\"temperature_target\":";
    append_num(&out, reading.temperature_target);
    out += ",\"temperature_setpoint\":";
    append_num(&out, reading.temperature_target);
  }
  if (reading.has_target_humidity) {
    comma();
    out += "\"target_humidity\":";
    append_num(&out, reading.target_humidity);
    out += ",\"humidity_setpoint\":";
    append_num(&out, reading.target_humidity);
  }
  if (ack_id > 0 && ack_status != nullptr && ack_status[0]) {
    comma();
    out += "\"ack_command_id\":";
    out += std::to_string(ack_id);
    out += ",\"ack_status\":\"";
    out += ack_status;
    out += "\"";
    if (ack_reason != nullptr && ack_reason[0]) {
      out += ",\"ack_reason\":\"";
      out += ack_reason;
      out += "\"";
    }
  }
  if (temp_range != nullptr && temp_range->has) {
    comma();
    out += "\"temperature_target_min\":";
    append_num(&out, temp_range->min);
    out += ",\"temperature_target_max\":";
    append_num(&out, temp_range->max);
  }
  if (rh_range != nullptr && rh_range->has) {
    comma();
    out += "\"target_humidity_min\":";
    append_num(&out, rh_range->min);
    out += ",\"target_humidity_max\":";
    append_num(&out, rh_range->max);
  }
  for (uint8_t k = 0; k < KNOB_COUNT; k++) {
    if (!(reading.knob_mask & (1u << k)))
      continue;
    comma();
    out += "\"";
    out += KNOB_KEYS[k];
    out += "\":";
    append_num(&out, reading.knob[k]);
  }
  if (!reading.grow_phase.empty()) {
    comma();
    out += "\"grow_phase\":\"";
    out += json_escape(reading.grow_phase.c_str());
    out += "\"";
  }
  if (extras != nullptr) {
    if (extras->firmware_version != nullptr && extras->firmware_version[0]) {
      comma();
      out += "\"firmware_version\":\"";
      out += json_escape(extras->firmware_version);
      out += "\"";
    }
    if (extras->capabilities != nullptr && extras->capabilities[0]) {
      comma();
      out += "\"capabilities\":";
      out += extras->capabilities;
    }
    if (extras->ranges != nullptr) {
      bool any = false;
      for (uint8_t k = 0; k < KNOB_COUNT; k++) {
        const EntityRange &r = extras->ranges[k];
        if (!r.has)
          continue;
        if (!any) {
          comma();
          out += "\"ranges\":{";
          any = true;
        } else {
          out += ",";
        }
        out += "\"";
        out += KNOB_KEYS[k];
        out += "\":[";
        append_num(&out, r.min);
        out += ",";
        append_num(&out, r.max);
        out += ",";
        append_num(&out, r.step);
        out += "]";
      }
      if (any)
        out += "}";
    }
  }
  out += "}";
  return out;
}

bool setpoint_object_id(const char *object_id) {
  if (object_id == nullptr)
    return false;
  return std::strcmp(object_id, "temperature_target") == 0 || std::strcmp(object_id, "temperature__target") == 0 ||
         std::strcmp(object_id, "target_humidity") == 0;
}

bool sensor_is_temperature(const char *object_id) {
  if (object_id == nullptr)
    return false;
  return std::strcmp(object_id, "temperature") == 0 || std::strcmp(object_id, "current_temperature") == 0;
}

bool sensor_is_humidity(const char *object_id) {
  if (object_id == nullptr)
    return false;
  return std::strcmp(object_id, "humidity") == 0 || std::strcmp(object_id, "current_humidity") == 0;
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

std::string format_iso8601_ms(int64_t ms) {
  if (ms <= 0)
    return "";
  int64_t sec = ms / 1000;
  int s = static_cast<int>(sec % 60);
  sec /= 60;
  int mi = static_cast<int>(sec % 60);
  sec /= 60;
  int h = static_cast<int>(sec % 24);
  int64_t days = sec / 24;
  int y = 1970;
  while (true) {
    const int dy = (y % 4 == 0 && (y % 100 != 0 || y % 400 == 0)) ? 366 : 365;
    if (days < dy)
      break;
    days -= dy;
    y++;
  }
  static const int mdays[] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
  int m = 1;
  for (; m <= 12; m++) {
    int md = mdays[m - 1];
    if (m == 2 && (y % 4 == 0 && (y % 100 != 0 || y % 400 == 0)))
      md++;
    if (days < md)
      break;
    days -= md;
  }
  char buf[32];
  std::snprintf(buf, sizeof(buf), "%04d-%02d-%02dT%02d:%02d:%02dZ", y, m, static_cast<int>(days) + 1, h, mi, s);
  return buf;
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
