#include "cloud_engine.h"
#include "cloud_format.h"
#include "cloud_http.h"
#include "cloud_qr.h"

#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

using namespace esphome::shroom_labs;

static int fails = 0;

static void expect(bool ok, const char *name) {
  if (!ok) {
    std::fprintf(stderr, "FAIL %s\n", name);
    fails++;
  } else {
    std::printf("ok %s\n", name);
  }
}

static bool dummy_sign(const uint8_t *data, size_t len, uint8_t sig[64], void *) {
  (void) data;
  for (size_t i = 0; i < 64; i++)
    sig[i] = static_cast<uint8_t>((i + len) & 0xff);
  return true;
}

static bool recover_qr_text(const QrCode &qr, std::string *out) {
  if (qr.size < 25 || qr.version < 2)
    return false;
  // Read format bits along the top-left to recover the mask, then walk data.
  uint16_t bits = 0;
  for (int i = 0; i < 15; i++) {
    bool dark = false;
    if (i < 6)
      dark = qr_module(qr, i, 8);
    else if (i < 8)
      dark = qr_module(qr, i + 1, 8);
    else if (i < 9)
      dark = qr_module(qr, 8, 7);
    else
      dark = qr_module(qr, 8, 14 - i);
    if (dark)
      bits |= static_cast<uint16_t>(1 << (14 - i));
  }
  int mask = -1;
  static const uint16_t FORMAT_L[8] = {0x77C4, 0x72F3, 0x7D5A, 0x789D, 0x662F, 0x6318, 0x6C41, 0x6976};
  for (int m = 0; m < 8; m++) {
    if (FORMAT_L[m] == bits)
      mask = m;
  }
  if (mask < 0)
    return false;
  if (qr.mask != mask)
    return false;

  auto mask_bit = [](int m, int y, int x) {
    switch (m) {
      case 0:
        return ((y + x) & 1) == 0;
      case 1:
        return (y & 1) == 0;
      case 2:
        return x % 3 == 0;
      case 3:
        return (y + x) % 3 == 0;
      case 4:
        return ((y / 2 + x / 3) & 1) == 0;
      case 5:
        return (y * x) % 2 + (y * x) % 3 == 0;
      case 6:
        return (((y * x) % 2 + (y * x) % 3) & 1) == 0;
      default:
        return (((y + x) % 2 + (y * x) % 3) & 1) == 0;
    }
  };
  auto is_fn = [&](int x, int y) {
    int size = qr.size;
    int align = qr.version == 2 ? 18 : qr.version == 3 ? 22 : 26;
    auto box = [&](int ox, int oy) { return x >= ox && x < ox + 8 && y >= oy && y < oy + 8; };
    if (box(0, 0) || box(size - 8, 0) || box(0, size - 8))
      return true;
    if (x == 6 || y == 6)
      return true;
    if (x >= align - 2 && x <= align + 2 && y >= align - 2 && y <= align + 2)
      return true;
    if (x == 8 && y == size - 8)
      return true;
    if (y == 8 && (x <= 8 || x >= size - 8))
      return true;
    if (x == 8 && (y <= 8 || y >= size - 8))
      return true;
    return false;
  };

  std::string raw;
  int upward = 1;
  for (int col = qr.size - 1; col > 0; col -= 2) {
    if (col == 6)
      col--;
    for (int i = 0; i < qr.size; i++) {
      int y = upward ? qr.size - 1 - i : i;
      for (int dx = 0; dx < 2; dx++) {
        int x = col - dx;
        if (is_fn(x, y))
          continue;
        bool dark = qr_module(qr, x, y);
        if (mask_bit(mask, y, x))
          dark = !dark;
        raw.push_back(dark ? 1 : 0);
      }
    }
    upward = !upward;
  }
  if (raw.size() < 16)
    return false;
  auto take = [&](int n) {
    unsigned v = 0;
    for (int i = 0; i < n && !raw.empty(); i++) {
      v = (v << 1) | static_cast<unsigned char>(raw[0]);
      raw.erase(raw.begin());
    }
    return v;
  };
  if (take(4) != 4)
    return false;
  unsigned n = take(8);
  out->clear();
  for (unsigned i = 0; i < n; i++)
    out->push_back(static_cast<char>(take(8)));
  return out->size() == n;
}

int main() {
  expect(claim_code_ok("AB2C3D"), "claim_code_ok good");
  expect(!claim_code_ok("AB0C3D"), "claim_code_ok rejects 0");
  expect(!claim_code_ok("ABC"), "claim_code_ok length");
  expect(format_claim_code("ab2c3d") == "AB2C3D", "format_claim_code");

  std::string url = claim_url_for("https://shroomlabs.io", "AB2C3D");
  expect(url == "https://shroomlabs.io/claim.html?code=AB2C3D", "claim_url_for");
  expect(claim_url_ok(url.c_str(), "AB2C3D"), "claim_url_ok");
  expect(!claim_url_ok("http://shroomlabs.io/claim.html?code=AB2C3D", "AB2C3D"), "claim_url https only");

  uint8_t x[32], y[32];
  for (int i = 0; i < 32; i++) {
    x[i] = static_cast<uint8_t>(i + 1);
    y[i] = static_cast<uint8_t>(255 - i);
  }
  std::string jwk = jwk_json(x, y);
  expect(jwk.find("\"kty\":\"EC\"") != std::string::npos, "jwk kty");
  expect(jwk.find("\"crv\":\"P-256\"") != std::string::npos, "jwk crv");
  expect(jwk.find("\"d\"") == std::string::npos, "jwk has no private field");

  std::string payload = proof_payload("sldev_abc", "nonce-1", "post", "/api/devices/sldev_abc/csr",
                                      "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff");
  expect(payload.find(PROOF_VERSION) == 0, "proof version");
  expect(payload.find("\nPOST\n") != std::string::npos, "proof method upper");
  expect(payload.find("001122") != std::string::npos, "proof body is hex");
  expect(payload.find("=") == std::string::npos, "proof body is not base64");

  expect(next_state(CloudState::Off, CloudEvent::Enable) == CloudState::Connecting, "off enable");
  expect(next_state(CloudState::Connecting, CloudEvent::EnrollOk) == CloudState::PendingClaim, "enroll ok");
  expect(next_state(CloudState::Connecting, CloudEvent::EnrollOwned) == CloudState::Owned, "409 owned");
  expect(next_state(CloudState::Owned, CloudEvent::Refresh) == CloudState::Connecting, "owned retry");
  expect(next_state(CloudState::PendingClaim, CloudEvent::CsrWaiting) == CloudState::PendingClaim, "wait");
  expect(next_state(CloudState::PendingClaim, CloudEvent::NetworkFail) == CloudState::PendingClaim, "poll net stays");
  expect(next_state(CloudState::PendingClaim, CloudEvent::CsrFail) == CloudState::PendingClaim, "poll fail stays");
  expect(next_state(CloudState::PendingClaim, CloudEvent::CsrOk) == CloudState::Linked, "claimed");
  expect(next_state(CloudState::Linked, CloudEvent::RotateDue) == CloudState::Rotating, "rotate due");
  expect(next_state(CloudState::Rotating, CloudEvent::RotateOk) == CloudState::Linked, "rotate ok");
  expect(next_state(CloudState::Rotating, CloudEvent::RateLimited) == CloudState::Linked, "rotate 429");
  expect(next_state(CloudState::Rotating, CloudEvent::NetworkFail) == CloudState::Linked, "rotate 5xx");
  expect(next_state(CloudState::Linked, CloudEvent::LinkAuthFail) == CloudState::Revoked, "revoke");
  expect(next_state(CloudState::Revoked, CloudEvent::ReclaimOk) == CloudState::PendingClaim, "reclaim");
  expect(next_state(CloudState::Linked, CloudEvent::Disable) == CloudState::Off, "disconnect");
  expect(next_state(CloudState::Rotating, CloudEvent::CsrFail) == CloudState::Linked, "bad rotate keeps cert");
  expect(next_state(CloudState::Error, CloudEvent::Refresh) == CloudState::Connecting, "error retry");
  expect(persist_state(CloudState::Rotating) == CloudState::Linked, "persist rotating");
  expect(persist_state(CloudState::Issuing) == CloudState::PendingClaim, "persist issuing");
  expect(enroll_outcome(true, 409) == HttpOutcome::AlreadyOwned, "enroll 409");
  expect(event_for_enroll(HttpOutcome::AlreadyOwned) == CloudEvent::EnrollOwned, "enroll 409 event");
  expect(csr_outcome(false, 0) == HttpOutcome::TransientFail, "csr transport");
  expect(event_for_csr(HttpOutcome::TransientFail) == CloudEvent::NetworkFail, "csr net event");
  expect(rotate_outcome(true, 429) == HttpOutcome::RateLimited, "rotate 429");
  expect(rotate_outcome(true, 503) == HttpOutcome::TransientFail, "rotate 5xx");
  expect(!should_auto_enroll(MAX_CLAIM_CYCLES), "claim cycle cap");
  expect(should_auto_enroll(0), "claim cycle first");
  expect(rotate_allowed(0) && !rotate_allowed(MAX_ROTATE_PER_HOUR), "rotate hour cap");
  expect(parse_retry_after("120") == 120, "retry after");
  expect(parse_retry_after("nope") == 0, "retry after junk");
  uint32_t bo = next_backoff_ms(BACKOFF_MIN_MS, 0);
  expect(bo >= BACKOFF_MIN_MS && bo <= BACKOFF_MAX_MS, "backoff range");
  expect(retry_after_backoff_ms(400, BACKOFF_MIN_MS, 0) >= 400000, "retry after wins");

  std::string acc;
  expect(append_body(&acc, "{\"ok\":", 6, 32), "append start");
  expect(append_body(&acc, "true}", 5, 32) && acc == "{\"ok\":true}", "append rest");
  expect(!append_body(&acc, "overflow-overflow-overflow", 25, 16), "append cap");

  struct Chunks {
    const char *parts[4];
    int n;
    int i;
  };
  auto read_chunks = [](void *ctx, char *buf, int max) -> int {
    auto *c = static_cast<Chunks *>(ctx);
    if (c->i >= c->n)
      return 0;
    const char *p = c->parts[c->i++];
    int len = static_cast<int>(std::strlen(p));
    if (len > max)
      return -1;
    std::memcpy(buf, p, static_cast<size_t>(len));
    return len;
  };
  Chunks chunks{{"{\"device_id\":\"sldev_1\",", "\"claim_code\":\"AB2C3D\"}"}, 2, 0};
  std::string assembled;
  expect(read_capped_body(read_chunks, &chunks, MAX_DEVICE_BODY, &assembled), "read body");
  expect(assembled.find("sldev_1") != std::string::npos, "read body json");
  expect(assembled.find("AB2C3D") != std::string::npos, "read body code");
  Chunks empty{{}, 0, 0};
  std::string empty_body;
  expect(read_capped_body(read_chunks, &empty, MAX_DEVICE_BODY, &empty_body) && empty_body.empty(), "read empty");
  Chunks too_big{{"0123456789abcdef0123456789abcdef"}, 1, 0};
  std::string overflow;
  expect(!read_capped_body(read_chunks, &too_big, 16, &overflow), "read body cap");

  struct FakeTransport : CloudTransport {
    std::vector<std::string> paths;
    std::vector<HttpResponse> replies;
    size_t i = 0;
    HttpResponse execute(const HttpRequest &req) override {
      paths.push_back(req.url);
      if (i >= replies.size()) {
        HttpResponse miss;
        miss.ok = false;
        return miss;
      }
      return replies[i++];
    }
  };
  auto reply = [](int status, const char *body) {
    HttpResponse r;
    r.ok = true;
    r.status = status;
    r.body = body ? body : "";
    return r;
  };
  FakeTransport fake;
  fake.replies = {
      reply(200, "{\"device_id\":\"sldev_x\",\"claim_code\":\"AB2C3D\",\"enroll_token\":\"tok\",\"claim_url\":\"https://shroomlabs.io/claim.html?code=AB2C3D\"}"),
      reply(403, "{\"error\":\"claim this device\"}"),
      reply(200, "{\"certificate\":\"-----BEGIN CERTIFICATE-----\\nM\\n-----END CERTIFICATE-----\\n\",\"serial\":\"aa\",\"rotate_after_ms\":302400000}"),
      reply(429, "{}"),
      reply(503, "{}"),
      reply(200, "{\"certificate\":\"-----BEGIN CERTIFICATE-----\\nN\\n-----END CERTIFICATE-----\\n\",\"serial\":\"bb\"}"),
      reply(403, "{\"code\":\"revoked\",\"status\":\"revoked\"}"),
      reply(409, "{\"error\":\"device already claimed\",\"code\":\"already_claimed\"}"),
  };
  CloudState st = next_state(CloudState::Off, CloudEvent::Enable);
  HttpResponse r = fake.execute({"POST", "https://api.shroomlabs.io/api/devices/enroll", "{}", {}});
  st = next_state(st, event_for_enroll(enroll_outcome(r.ok, r.status, r.body.c_str())));
  expect(st == CloudState::PendingClaim, "flow enroll");
  r = fake.execute({"POST", "https://api.shroomlabs.io/api/devices/sldev_x/csr", "{}", {}});
  st = next_state(st, event_for_csr(csr_outcome(r.ok, r.status, r.body.c_str())));
  expect(st == CloudState::PendingClaim, "flow poll");
  r = fake.execute({"POST", "https://api.shroomlabs.io/api/devices/sldev_x/csr", "{}", {}});
  st = next_state(st, event_for_csr(csr_outcome(r.ok, r.status, r.body.c_str())));
  expect(st == CloudState::Linked, "flow csr");
  st = next_state(st, CloudEvent::RotateDue);
  r = fake.execute({"POST", "https://api.shroomlabs.io/api/devices/sldev_x/rotate", "{}", {}});
  st = next_state(st, event_for_rotate(rotate_outcome(r.ok, r.status, r.body.c_str())));
  expect(st == CloudState::Linked, "flow rotate 429 stays linked");
  expect(retry_after_backoff_ms(120, BACKOFF_MIN_MS, 0) >= 120000, "flow rotate 429 backs off");
  st = next_state(st, CloudEvent::RotateDue);
  r = fake.execute({"POST", "https://api.shroomlabs.io/api/devices/sldev_x/rotate", "{}", {}});
  st = next_state(st, event_for_rotate(rotate_outcome(r.ok, r.status, r.body.c_str())));
  expect(st == CloudState::Linked, "flow rotate 5xx stays linked");
  st = next_state(st, CloudEvent::RotateDue);
  r = fake.execute({"POST", "https://api.shroomlabs.io/api/devices/sldev_x/rotate", "{}", {}});
  st = next_state(st, event_for_rotate(rotate_outcome(r.ok, r.status, r.body.c_str())));
  expect(st == CloudState::Linked, "flow rotate ok");
  r = fake.execute({"GET", "https://api.shroomlabs.io/api/devices/sldev_x/inbox", "", {}});
  st = next_state(st, event_for_probe(probe_outcome(r.ok, r.status, r.body.c_str())));
  expect(st == CloudState::Revoked, "flow revoke notice");
  r = fake.execute({"POST", "https://api.shroomlabs.io/api/devices/enroll", "{}", {}});
  st = next_state(CloudState::Connecting, event_for_enroll(enroll_outcome(r.ok, r.status, r.body.c_str())));
  expect(st == CloudState::Owned, "flow factory 409");
  expect(next_state(st, CloudEvent::EnrollOk) == CloudState::Owned, "409 does not enroll again");
  expect(next_state(st, CloudEvent::ReclaimOk) == CloudState::Owned, "409 does not reclaim");
  expect(next_state(st, CloudEvent::Refresh) == CloudState::Connecting, "409 refresh after remove");
  expect(fake.paths.size() == 8, "fake transport consumed script");
  expect(std::strstr(state_message(CloudState::PendingClaim), "Scan the QR") == state_message(CloudState::PendingClaim),
         "hint scan first");
  expect(std::strstr(state_message(CloudState::Owned), "Remove it") != nullptr, "owned copy");

  expect(api_url_allowed("https://api.shroomlabs.io/api/devices/enroll", "api.shroomlabs.io"), "url allow");
  expect(!api_url_allowed("https://evil.example/api/devices/enroll", "api.shroomlabs.io"), "url deny host");
  expect(!api_url_allowed("http://api.shroomlabs.io/api/devices/enroll", "api.shroomlabs.io"), "url deny http");
  expect(!api_url_allowed("https://api.shroomlabs.io/api/../secret", "api.shroomlabs.io"), "url deny dotdot");

  std::string enroll = enroll_body_json("aabbccddeeff", jwk.c_str(), "Chamber");
  expect(enroll.find("\"hardware_id\":\"aabbccddeeff\"") != std::string::npos, "enroll hardware");
  expect(enroll.find("\"name\":\"Chamber\"") != std::string::npos, "enroll name");

  const char *sample = "{\"claim_code\":\"AB2C3D\",\"enroll_token\":\"tok\",\"rotate_after_ms\":302400000}";
  std::string got;
  int64_t n = 0;
  expect(json_get_string(sample, "claim_code", &got) && got == "AB2C3D", "json string");
  expect(json_get_int64(sample, "rotate_after_ms", &n) && n == ROTATE_AFTER_MS, "json int");

  expect(parse_iso8601_ms("2026-10-24T18:00:00Z") > 0, "parse iso");

  std::string pem;
  expect(build_p256_csr_pem(x, y, "sldev_test", dummy_sign, nullptr, &pem), "csr builds");
  expect(pem.find("-----BEGIN CERTIFICATE REQUEST-----") == 0, "csr header");
  expect(pem.find("-----END CERTIFICATE REQUEST-----") != std::string::npos, "csr footer");
  expect(pem.size() <= MAX_CSR_PEM, "csr size");

  QrCode qr{};
  expect(qr_encode(url.c_str(), &qr), "qr encode");
  expect(qr.size == 29, "qr version 3 size");
  expect(qr_module(qr, 0, 0), "finder dark");
  expect(!qr_module(qr, 1, 1), "finder ring");
  std::string recovered;
  expect(recover_qr_text(qr, &recovered), "qr recover");
  expect(recovered == url, "qr payload matches claim url");

  std::string bits = qr_modules_string(qr);
  expect(bits.size() == static_cast<size_t>(qr.size * qr.size), "qr string size");

  expect(event_for_probe(probe_outcome(true, 403, "{\"code\":\"revoked\"}")) == CloudEvent::LinkRevoked, "revoked code");
  expect(event_for_probe(probe_outcome(true, 401, "{\"code\":\"proof_invalid\"}")) == CloudEvent::ProofInvalid,
         "proof code");
  expect(event_for_enroll(enroll_outcome(true, 409, "{\"code\":\"claim_in_progress\"}")) == CloudEvent::EnrollBusy,
         "busy code");
  expect(csr_outcome(true, 403, "{\"error\":\"claim this device\"}") == HttpOutcome::WaitingClaim, "csr 403 wait");
  expect(csr_outcome(true, 403, "{\"code\":\"revoked\"}") == HttpOutcome::AuthFail, "csr 403 revoked");
  expect(csr_outcome(true, 401, "{\"code\":\"proof_invalid\"}") == HttpOutcome::ProofInvalid, "csr 401 proof");
  expect(csr_outcome(true, 401, "{\"code\":\"cert_expired\"}") == HttpOutcome::CertExpired, "csr 401 expired");
  expect(!idf_headers_ok(-1, 200), "header timeout");
  expect(!idf_headers_ok(10, 0), "header no status");
  expect(time_reached(10, 0xfffffff0u), "millis wrap reached");
  expect(!time_reached(0xfffffff0u, 10), "millis wrap not yet");
  expect(next_backoff_ms(BACKOFF_MAX_MS, 0xffffffffu) <= BACKOFF_MAX_MS, "jitter cap");

  struct HostClock : CloudClock {
    uint32_t now = 1;
    int64_t wall = 1700000000000;
    uint32_t rng = 1;
    uint32_t now_ms() override { return now; }
    int64_t wall_ms() override { return wall; }
    uint32_t random() override { return rng; }
  };
  struct HostStore : CloudStore {
    SavedIdentity id{};
    std::string pem;
    bool have = false;
    bool load(SavedIdentity *out, std::string *p) override {
      if (!have)
        return false;
      *out = id;
      if (p)
        *p = pem;
      return true;
    }
    bool save_identity(const SavedIdentity &s) override {
      id = s;
      have = true;
      return true;
    }
    bool save_cert(const std::string &p) override {
      pem = p;
      return true;
    }
    bool erase_all() override {
      have = false;
      pem.clear();
      std::memset(&id, 0, sizeof(id));
      return true;
    }
  };
  struct HostCrypto : CloudCrypto {
    bool ensure_key(uint8_t priv[32], uint8_t x[32], uint8_t y[32]) override {
      for (int i = 0; i < 32; i++) {
        priv[i] = static_cast<uint8_t>(i + 1);
        x[i] = static_cast<uint8_t>(32 + i);
        y[i] = static_cast<uint8_t>(64 + i);
      }
      return true;
    }
    bool sign(const uint8_t *, const uint8_t *, size_t, uint8_t sig[64]) override {
      for (int i = 0; i < 64; i++)
        sig[i] = static_cast<uint8_t>(i);
      return true;
    }
    bool make_csr(const uint8_t *, const uint8_t *x, const uint8_t *y, const char *cn, std::string *pem) override {
      return build_p256_csr_pem(x, y, cn, dummy_sign, nullptr, pem);
    }
    std::string hardware_id() override { return "aabbccddeeff"; }
  };
  struct ScriptTransport : CloudTransport {
    struct Step {
      std::string contains;
      HttpResponse r;
    };
    std::vector<Step> steps;
    std::vector<std::string> urls;
    size_t i = 0;
    bool auto_nonce = true;
    HttpResponse execute(const HttpRequest &req) override {
      urls.push_back(req.url);
      if (auto_nonce && req.url.find("/nonce") != std::string::npos) {
        HttpResponse n;
        n.ok = true;
        n.status = 200;
        n.body = "{\"nonce\":\"n1\"}";
        n.complete = true;
        return n;
      }
      if (i >= steps.size()) {
        HttpResponse miss;
        return miss;
      }
      if (!steps[i].contains.empty() && req.url.find(steps[i].contains) == std::string::npos) {
        HttpResponse miss;
        return miss;
      }
      return steps[i++].r;
    }
  };
  auto ok_body = [](int status, const char *body, bool complete = true, int retry = 0) {
    HttpResponse r;
    r.ok = true;
    r.status = status;
    r.body = body ? body : "";
    r.complete = complete;
    r.retry_after_s = retry;
    return r;
  };
  const char *enroll_ok =
      "{\"device_id\":\"sldev_x\",\"claim_code\":\"AB2C3D\",\"enroll_token\":\"tok\",\"claim_url\":\"https://"
      "shroomlabs.io/claim.html?code=AB2C3D\",\"claim_expires_at\":\"2099-01-01T00:00:00Z\"}";
  const char *cert_ok =
      "{\"certificate\":\"-----BEGIN CERTIFICATE-----\\nMIIB\\n-----END CERTIFICATE-----\\n\",\"serial\":\"aa\","
      "\"rotate_after_ms\":302400000,\"not_after\":\"2099-01-08T00:00:00Z\"}";

  HostClock clk;
  HostStore store;
  HostCrypto crypto;
  ScriptTransport tr;
  tr.steps = {{"/enroll", ok_body(200, enroll_ok)}};
  CloudEngine eng(&tr, &clk, &store, &crypto);
  eng.connect();
  expect(eng.state() == CloudState::PendingClaim, "engine enroll");
  expect(eng.claim_code() == "AB2C3D", "engine stores code");
  expect(eng.device_id() == "sldev_x", "engine stores id");

  tr.steps = {{"/csr", ok_body(403, "{\"error\":\"claim this device\"}")}};
  tr.i = 0;
  clk.now = 1000;
  eng.csr_now();
  expect(eng.state() == CloudState::PendingClaim, "engine poll stays");
  uint32_t poll_at = eng.next_csr_ms();
  expect(poll_at >= 1000 + CLAIM_POLL_MS && poll_at <= 1000 + CLAIM_POLL_MS + CLAIM_POLL_JITTER_MS, "engine poll 5s");

  tr.steps = {{"/csr", ok_body(503, "{}")}};
  tr.i = 0;
  clk.now = 2000;
  eng.csr_now();
  expect(eng.state() == CloudState::PendingClaim, "engine poll fail stays");
  expect(eng.next_csr_ms() >= 2000 + BACKOFF_MIN_MS, "engine fail backoff");

  tr.steps = {{"/csr", ok_body(200, cert_ok)}};
  tr.i = 0;
  eng.csr_now();
  expect(eng.state() == CloudState::Linked, "engine claimed");
  expect(eng.has_cert(), "engine has cert");
  expect(eng.cert_pem().find("BEGIN CERTIFICATE") != std::string::npos, "engine cert pem");

  tr.steps = {{"/rotate", ok_body(429, "{}", true, 120)}};
  tr.i = 0;
  clk.now = 5000;
  eng.rotate_now();
  expect(eng.state() == CloudState::Linked, "engine rotate 429");
  expect(eng.next_rotate_ms() >= 5000 + 120000, "engine retry-after");

  tr.steps = {{"/rotate", ok_body(503, "{}")}};
  tr.i = 0;
  clk.now = 6000;
  eng.rotate_now();
  expect(eng.state() == CloudState::Linked, "engine rotate 5xx");

  tr.steps = {{"/inbox", ok_body(403, "{\"code\":\"revoked\",\"status\":\"revoked\"}")}};
  tr.i = 0;
  CloudEngine eng2(&tr, &clk, &store, &crypto);
  // reuse linked store
  eng2.load();
  if (eng2.state() != CloudState::Linked) {
    // store may have been wiped by nothing; re-seed via first engine cert
  }
  tr.steps = {{"/inbox", ok_body(403, "{\"code\":\"revoked\",\"status\":\"revoked\"}")}};
  tr.i = 0;
  eng.probe_now();
  expect(eng.state() == CloudState::Revoked, "engine probe revoked");
  expect(!eng.has_key(), "engine wiped key on revoke");

  HostStore store3;
  ScriptTransport tr3;
  tr3.steps = {{"/enroll", ok_body(409, "{\"code\":\"already_claimed\"}")}};
  CloudEngine eng3(&tr3, &clk, &store3, &crypto);
  eng3.connect();
  expect(eng3.state() == CloudState::Owned, "engine factory 409");
  expect(eng3.request_count() <= 2, "engine 409 one enroll");

  HostStore store4;
  ScriptTransport tr4;
  HttpResponse timeout;
  timeout.ok = false;
  timeout.status = 0;
  timeout.complete = false;
  tr4.steps = {{"/enroll", timeout}};
  CloudEngine eng4(&tr4, &clk, &store4, &crypto);
  eng4.connect();
  expect(eng4.state() == CloudState::Connecting, "engine header timeout not Error");

  HostStore store5;
  ScriptTransport tr5;
  tr5.steps = {{"/enroll", ok_body(200, "{\"device_id\":\"sldev_x\"}", false)}};
  CloudEngine eng5(&tr5, &clk, &store5, &crypto);
  eng5.connect();
  expect(eng5.state() != CloudState::PendingClaim, "engine truncated not pending");
  expect(eng5.claim_code().empty(), "engine truncated no code");

  HostStore store6;
  ScriptTransport tr6;
  tr6.steps = {{"/enroll", ok_body(200, "{\"device_id\":\"sldev_x\"}")}};
  CloudEngine eng6(&tr6, &clk, &store6, &crypto);
  eng6.connect();
  expect(eng6.state() == CloudState::Connecting, "engine missing fields");

  HostStore store7;
  ScriptTransport tr7;
  tr7.steps = {{"/enroll", ok_body(200, enroll_ok)}, {"/csr", ok_body(200, "{\"serial\":\"aa\"}")}};
  CloudEngine eng7(&tr7, &clk, &store7, &crypto);
  eng7.connect();
  eng7.csr_now();
  expect(eng7.state() != CloudState::Linked, "engine csr missing cert");

  HostStore store8;
  ScriptTransport tr8;
  tr8.steps = {{"/enroll", ok_body(200, enroll_ok)}, {"/csr", ok_body(403, "{\"error\":\"claim\"}")}};
  CloudEngine eng8(&tr8, &clk, &store8, &crypto);
  clk.now = 1000;
  eng8.connect();
  expect(eng8.state() == CloudState::PendingClaim, "engine wrap enroll");
  clk.now = 0xfffffff0u;
  tr8.i = 1;
  tr8.steps = {{"/csr", ok_body(403, "{\"error\":\"claim\"}")}, {"/csr", ok_body(403, "{\"error\":\"claim\"}")}};
  tr8.i = 0;
  eng8.csr_now();
  size_t before = eng8.request_count();
  for (int i = 0; i < 20; i++)
    eng8.loop();
  expect(eng8.request_count() == before, "engine wrap no tight loop");

  HostStore store9;
  ScriptTransport tr9;
  tr9.steps = {{"/enroll", ok_body(200, enroll_ok)},
               {"/csr", ok_body(200, cert_ok)},
               {"/self-revoke", ok_body(200, "{\"ok\":true}")}};
  CloudEngine eng9(&tr9, &clk, &store9, &crypto);
  eng9.connect();
  eng9.csr_now();
  expect(eng9.state() == CloudState::Linked, "engine before disconnect");
  eng9.disconnect();
  expect(eng9.state() == CloudState::Off, "engine disconnect wipe");
  expect(!eng9.has_key(), "engine disconnect zeros key");
  bool saw_self = false;
  for (const auto &u : tr9.urls)
    saw_self = saw_self || u.find("/self-revoke") != std::string::npos;
  expect(saw_self, "engine called self-revoke");

  HostStore store10;
  ScriptTransport tr10;
  tr10.steps = {{"/enroll", ok_body(200, enroll_ok)}, {"/csr", ok_body(403, "{\"error\":\"claim\"}")},
                {"/csr", ok_body(200, cert_ok)}};
  CloudEngine eng10(&tr10, &clk, &store10, &crypto);
  clk.now = 10000;
  eng10.connect();
  expect(eng10.state() == CloudState::PendingClaim, "loop enroll");
  clk.now = eng10.next_csr_ms();
  size_t before_loop = eng10.request_count();
  eng10.loop();
  expect(eng10.request_count() > before_loop, "loop fires poll");
  expect(eng10.state() == CloudState::PendingClaim, "loop poll not claimed");
  clk.now = eng10.next_csr_ms();
  eng10.loop();
  expect(eng10.state() == CloudState::Linked, "loop claim within 10s");

  HostStore store11;
  ScriptTransport tr11;
  tr11.steps = {{"/enroll", ok_body(200, enroll_ok)}, {"/csr", ok_body(200, cert_ok)},
                {"/inbox", ok_body(200, "{\"commands\":[]}")}};
  CloudEngine eng11(&tr11, &clk, &store11, &crypto);
  eng11.connect();
  eng11.csr_now();
  expect(eng11.state() == CloudState::Linked, "refresh linked start");
  size_t urls_before = tr11.urls.size();
  eng11.refresh();
  bool saw_inbox = false, saw_enroll = false;
  for (size_t i = urls_before; i < tr11.urls.size(); i++) {
    saw_inbox = saw_inbox || tr11.urls[i].find("/inbox") != std::string::npos;
    saw_enroll = saw_enroll || tr11.urls[i].find("/enroll") != std::string::npos;
  }
  expect(saw_inbox && !saw_enroll, "refresh while linked is probe");
  expect(eng11.state() == CloudState::Linked, "refresh linked stays");

  HostStore store12;
  ScriptTransport tr12;
  tr12.steps = {{"/enroll", ok_body(409, "{\"code\":\"claim_in_progress\"}")}};
  CloudEngine eng12(&tr12, &clk, &store12, &crypto);
  eng12.connect();
  expect(eng12.state() == CloudState::WaitClaim, "engine claim in progress");
  expect(eng12.display_code().empty(), "wait claim hides code");
  expect(std::strstr(eng12.display_hint().c_str(), "Wait a few minutes") != nullptr, "wait claim copy");

  HostStore store13;
  ScriptTransport tr13;
  tr13.steps = {{"/enroll", ok_body(200, enroll_ok)}};
  CloudEngine eng13(&tr13, &clk, &store13, &crypto);
  clk.now = 20000;
  clk.wall = 1700000000000;
  eng13.connect();
  expect(eng13.claim_code() == "AB2C3D", "boot expiry has code");
  CloudEngine eng13b(&tr13, &clk, &store13, &crypto);
  clk.wall = 1700000000000;
  store13.id.claim_expires[0] = 0;
  std::snprintf(store13.id.claim_expires, sizeof(store13.id.claim_expires), "%s", "2020-01-01T00:00:00Z");
  eng13b.load();
  expect(eng13b.claim_code().empty(), "boot expired code hidden");
  expect(eng13b.state() == CloudState::Connecting, "boot expired re-enrolls");

  HostStore store14;
  ScriptTransport tr14;
  tr14.steps = {{"/enroll", ok_body(200, enroll_ok)}, {"/csr", ok_body(200, cert_ok)},
                {"/inbox", ok_body(401, "{\"code\":\"proof_invalid\"}")}};
  CloudEngine eng14(&tr14, &clk, &store14, &crypto);
  eng14.connect();
  eng14.csr_now();
  eng14.probe_now();
  expect(eng14.state() == CloudState::Linked, "proof invalid stays linked");
  expect(eng14.has_key(), "proof invalid keeps key");

  HostStore store15;
  ScriptTransport tr15;
  tr15.steps = {{"/enroll", ok_body(200, enroll_ok)}, {"/csr", ok_body(200, cert_ok)},
                {"/inbox", ok_body(401, "{\"code\":\"cert_expired\"}")}};
  CloudEngine eng15(&tr15, &clk, &store15, &crypto);
  eng15.connect();
  eng15.csr_now();
  eng15.probe_now();
  expect(eng15.state() == CloudState::Linked, "cert expired stays linked");
  expect(eng15.has_key(), "cert expired keeps key");

  HostStore store16;
  ScriptTransport tr16;
  tr16.steps = {{"/enroll", ok_body(200, enroll_ok)}, {"/csr", ok_body(403, "{\"code\":\"revoked\"}")}};
  CloudEngine eng16(&tr16, &clk, &store16, &crypto);
  eng16.connect();
  eng16.csr_now();
  expect(eng16.state() == CloudState::Revoked, "csr revoked");
  expect(!eng16.has_key(), "csr revoked wipes");
  expect(eng16.display_code().empty(), "revoked hides code");

  clk.now = 30000;
  HostStore store17;
  ScriptTransport tr17;
  tr17.steps = {{"/enroll", ok_body(200, enroll_ok)}};
  CloudEngine eng17(&tr17, &clk, &store17, &crypto);
  eng17.connect();
  expect(!eng17.display_code().empty(), "live code shown");
  clk.now = 30000 + CLAIM_MS + 1;
  expect(eng17.display_code().empty(), "expired code hidden");
  expect(std::strstr(eng17.display_expiry().c_str(), "expired") != nullptr, "expired copy");

  return fails ? 1 : 0;
}
