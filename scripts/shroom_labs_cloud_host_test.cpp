#include "cloud_engine.h"
#include "cloud_format.h"
#include "cloud_http.h"
#include "cloud_qr.h"
#include "cloud_sha256.h"

#include <cstdio>
#include <cstring>
#include <functional>
#include <mbedtls/sha256.h>
#include <openssl/sha.h>
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

  expect(cloud_owns_url("/cloud"), "cloud owns /cloud");
  expect(!cloud_owns_url("/cloud/connect"), "cloud does not own two-segment");
  expect(!dashboard_catchall_claims("/cloud"), "catchall skips /cloud");
  expect(!dashboard_catchall_claims("/security"), "catchall skips /security");
  expect(!dashboard_catchall_claims("/update"), "catchall skips /update");
  expect(!dashboard_catchall_claims("/wifisave"), "catchall skips /wifisave");
  expect(dashboard_catchall_claims("/cloud/connect"), "catchall claims /cloud/connect");
  expect(dashboard_catchall_claims("/cloud/refresh"), "catchall claims /cloud/refresh");
  expect(dashboard_catchall_claims("/cloud/disconnect"), "catchall claims /cloud/disconnect");
  expect(std::strcmp(first_local_handler("/cloud"), "cloud") == 0, "order /cloud reaches cloud");
  expect(std::strcmp(first_local_handler("/cloud/connect"), "dashboard") == 0,
         "order /cloud/connect stolen by catchall");
  expect(cloud_action_ok("connect") && cloud_action_ok("refresh") && cloud_action_ok("disconnect"),
         "cloud actions");
  expect(!cloud_action_ok("wipe") && !cloud_action_ok(""), "cloud action reject");
  const char *our_routes[] = {"/cloud", "/security", "/update", "/wifisave"};
  bool stolen = false;
  for (const char *p : our_routes)
    stolen = stolen || dashboard_catchall_claims(p);
  expect(!stolen, "our routes stay single-segment");

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
    int sign_calls = 0;
    int sha_calls = 0;
    bool ensure_key(uint8_t priv[32], uint8_t x[32], uint8_t y[32]) override {
      for (int i = 0; i < 32; i++) {
        priv[i] = static_cast<uint8_t>(i + 1);
        x[i] = static_cast<uint8_t>(32 + i);
        y[i] = static_cast<uint8_t>(64 + i);
      }
      return true;
    }
    bool sign(const uint8_t *, const uint8_t *, size_t, uint8_t sig[64]) override {
      sign_calls++;
      for (int i = 0; i < 64; i++)
        sig[i] = static_cast<uint8_t>(i);
      return true;
    }
    bool make_csr(const uint8_t *, const uint8_t *x, const uint8_t *y, const char *cn, std::string *pem) override {
      return build_p256_csr_pem(x, y, cn, dummy_sign, nullptr, pem);
    }
    bool sha256(const uint8_t *data, size_t len, uint8_t out[32]) override {
      sha_calls++;
      SHA256(data, len, out);
      return true;
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
    bool auto_status = true;
    bool status_claimed = true;
    int nonce_limit = 60;
    int nonce_count = 0;
    int nonce_status = 200;
    std::string nonce_error_body = "{\"error\":\"not found\"}";
    int enroll_with_proof = 0;
    std::function<void(const HttpRequest &)> hook;
    HttpResponse execute(const HttpRequest &req) override {
      urls.push_back(req.url);
      if (hook)
        hook(req);
      if (req.url.find("/enroll") != std::string::npos) {
        for (const auto &h : req.headers) {
          if (h.first == "x-device-proof" && !h.second.empty())
            enroll_with_proof++;
        }
      }
      if (auto_status && req.url.find("/claim-status") != std::string::npos) {
        HttpResponse s;
        s.ok = true;
        s.status = 200;
        s.complete = true;
        s.body = status_claimed ? "{\"claimed\":true}" : "{\"claimed\":false}";
        return s;
      }
      if (auto_nonce && req.url.find("/nonce") != std::string::npos) {
        nonce_count++;
        if (nonce_status != 200) {
          HttpResponse missing;
          missing.ok = true;
          missing.status = nonce_status;
          missing.complete = true;
          missing.body = nonce_error_body;
          return missing;
        }
        if (nonce_count > nonce_limit) {
          HttpResponse limited;
          limited.ok = true;
          limited.status = 429;
          limited.complete = true;
          limited.retry_after_s = 60;
          limited.body = "{\"error\":\"rate limited\"}";
          return limited;
        }
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

  tr.status_claimed = false;
  tr.i = 0;
  clk.now = 1000;
  eng.csr_now();
  expect(eng.state() == CloudState::PendingClaim, "engine poll stays");
  uint32_t poll_at = eng.next_csr_ms();
  expect(poll_at >= 1000 + CLAIM_POLL_MS && poll_at <= 1000 + CLAIM_POLL_MS + CLAIM_POLL_JITTER_MS, "engine poll 5s");
  expect(tr.nonce_count == 0, "engine poll uses no nonce");

  tr.status_claimed = true;
  tr.auto_status = false;
  tr.steps = {{"/claim-status", ok_body(503, "{}")}};
  tr.i = 0;
  clk.now = 2000;
  eng.csr_now();
  expect(eng.state() == CloudState::PendingClaim, "engine poll fail stays");
  expect(eng.next_csr_ms() >= 2000 + BACKOFF_MIN_MS, "engine fail backoff");
  tr.auto_status = true;
  // Backoff reset after a later wait: set claimed false then true.
  tr.status_claimed = false;
  clk.now = 3000;
  eng.csr_now();
  expect(eng.next_csr_ms() <= 3000 + CLAIM_POLL_MS + CLAIM_POLL_JITTER_MS, "engine wait resets backoff");

  tr.status_claimed = true;
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

  HostStore store18;
  ScriptTransport tr18;
  tr18.steps = {{"/enroll", ok_body(200, enroll_ok)},
                {"/csr", ok_body(200, cert_ok)},
                {"/rotate", ok_body(401, "{\"code\":\"relink_required\"}")},
                {"/rotate", ok_body(401, "{\"code\":\"relink_required\"}")},
                {"/enroll", ok_body(200, enroll_ok)}};
  CloudEngine eng18(&tr18, &clk, &store18, &crypto);
  clk.now = 200000;
  clk.wall = 2000000000000;
  eng18.connect();
  eng18.csr_now();
  expect(eng18.state() == CloudState::Linked, "relink start linked");
  eng18.rotate_now();
  expect(eng18.state() == CloudState::Linked, "first relink_required keeps Linked");
  expect(eng18.has_key(), "first relink_required keeps key");
  clk.now = 200000 + RELINK_CONFIRM_MS;
  eng18.rotate_now();
  expect(eng18.state() == CloudState::Relink, "second relink_required is Relink");
  expect(eng18.has_key(), "relink keeps key");
  expect(!eng18.device_id().empty(), "relink keeps device id");
  expect(!eng18.has_cert(), "relink wipes cert");
  expect(eng18.cloud_enabled(), "relink stays enabled");
  expect(eng18.display_title() == "Unlinked", "relink title");
  expect(eng18.display_code().empty(), "relink hides code");
  expect(std::strstr(eng18.display_hint().c_str(), "offline too long") != nullptr, "relink copy");
  expect(std::strstr(eng18.status_json().c_str(), "Press Connect") != nullptr, "relink json copy");
  CloudEngine eng18b(&tr18, &clk, &store18, &crypto);
  eng18b.load();
  expect(eng18b.state() == CloudState::Relink, "relink persists across reboot");
  expect(std::strstr(eng18b.display_hint().c_str(), "offline too long") != nullptr, "relink copy after reboot");
  int proofs_before = tr18.enroll_with_proof;
  eng18.connect();
  expect(eng18.state() == CloudState::PendingClaim, "relink connect enrolls");
  expect(tr18.enroll_with_proof > proofs_before, "relink enroll proves key");

  HostStore store18c;
  ScriptTransport tr18c;
  tr18c.steps = {{"/enroll", ok_body(200, enroll_ok)},
                 {"/csr", ok_body(200, cert_ok)},
                 {"/rotate", ok_body(401, "{\"code\":\"relink_required\"}")},
                 {"/rotate", ok_body(200, cert_ok)},
                 {"/rotate", ok_body(401, "{\"code\":\"relink_required\"}")}};
  CloudEngine eng18c(&tr18c, &clk, &store18c, &crypto);
  clk.now = 300000;
  eng18c.connect();
  eng18c.csr_now();
  eng18c.rotate_now();
  clk.now = 300000 + RELINK_CONFIRM_MS / 2;
  eng18c.rotate_now();
  expect(eng18c.state() == CloudState::Linked, "relink counter resets on success");
  clk.now = 300000 + RELINK_CONFIRM_MS;
  eng18c.rotate_now();
  expect(eng18c.state() == CloudState::Linked, "one sighting after success stays Linked");

  HostStore store18d;
  ScriptTransport tr18d;
  tr18d.steps = {{"/enroll", ok_body(200, enroll_ok)},
                 {"/csr", ok_body(200, cert_ok)},
                 {"/rotate", ok_body(401, "{\"code\":\"relink_required\"}")},
                 {"/rotate", ok_body(401, "{\"code\":\"relink_required\"}")},
                 {"/rotate", ok_body(401, "{\"code\":\"relink_required\"}")}};
  CloudEngine eng18d(&tr18d, &clk, &store18d, &crypto);
  clk.now = 400000;
  eng18d.connect();
  eng18d.csr_now();
  eng18d.rotate_now();
  clk.now = 400000 + RELINK_WINDOW_MS + 1000;
  eng18d.rotate_now();
  expect(eng18d.state() == CloudState::Linked, "sighting after 24h restarts window");
  clk.now = 400000 + RELINK_WINDOW_MS + 1000 + RELINK_CONFIRM_MS;
  eng18d.rotate_now();
  expect(eng18d.state() == CloudState::Relink, "two sightings within 24h relink");

  HostStore store18d2;
  ScriptTransport tr18d2;
  tr18d2.steps = {{"/enroll", ok_body(200, enroll_ok)},
                  {"/csr", ok_body(200, cert_ok)},
                  {"/rotate", ok_body(401, "{\"code\":\"relink_required\"}")},
                  {"/rotate", ok_body(401, "{\"code\":\"relink_required\"}")},
                  {"/rotate", ok_body(401, "{\"code\":\"relink_required\"}")}};
  CloudEngine eng18d2(&tr18d2, &clk, &store18d2, &crypto);
  const uint32_t gap30d = 30u * 86400000u;
  clk.now = 450000;
  eng18d2.connect();
  eng18d2.csr_now();
  eng18d2.rotate_now();
  clk.now = 450000 + gap30d;
  eng18d2.rotate_now();
  expect(eng18d2.state() == CloudState::Linked, "30-day gap restarts window");
  clk.now = 450000 + gap30d + RELINK_CONFIRM_MS;
  eng18d2.rotate_now();
  expect(eng18d2.state() == CloudState::Relink, "hour after 30-day restart relinks");

  HostStore store18e;
  ScriptTransport tr18e;
  tr18e.steps = {{"/enroll", ok_body(200, enroll_ok)},
                 {"/csr", ok_body(200, cert_ok)},
                 {"/rotate", ok_body(401, "{\"code\":\"relink_required\"}")},
                 {"/rotate", ok_body(401, "{\"code\":\"relink_required\"}")}};
  CloudEngine eng18e(&tr18e, &clk, &store18e, &crypto);
  clk.now = 500000;
  clk.wall = 0;
  eng18e.connect();
  eng18e.csr_now();
  eng18e.rotate_now();
  clk.wall = 2000000000000;
  clk.now = 500000 + 120000;
  eng18e.rotate_now();
  expect(eng18e.state() == CloudState::Linked, "wall jump does not confirm relink");

  HostStore store18f;
  ScriptTransport tr18f;
  tr18f.steps = {{"/enroll", ok_body(200, enroll_ok)},
                 {"/csr", ok_body(200, cert_ok)},
                 {"/rotate", ok_body(401, "{\"code\":\"relink_required\"}")},
                 {"/rotate", ok_body(401, "{\"code\":\"relink_required\"}")},
                 {"/enroll", ok_body(200, enroll_ok)}};
  CloudEngine eng18f(&tr18f, &clk, &store18f, &crypto);
  clk.now = 600000;
  clk.wall = 2000000000000;
  eng18f.connect();
  eng18f.csr_now();
  eng18f.rotate_now();
  clk.now = 600000 + RELINK_CONFIRM_MS;
  eng18f.rotate_now();
  expect(eng18f.state() == CloudState::Relink, "gone start Relink");
  tr18f.nonce_status = 404;
  tr18f.nonce_error_body = "{\"error\":\"device not found\"}";
  int proofs_gone = tr18f.enroll_with_proof;
  size_t enrolls_before = 0;
  for (const auto &u : tr18f.urls)
    if (u.find("/enroll") != std::string::npos)
      enrolls_before++;
  eng18f.connect();
  expect(eng18f.state() == CloudState::PendingClaim, "gone row enrolls fresh");
  expect(tr18f.enroll_with_proof == proofs_gone, "gone row enrolls without proof");
  size_t enrolls_after = 0;
  for (const auto &u : tr18f.urls)
    if (u.find("/enroll") != std::string::npos)
      enrolls_after++;
  expect(enrolls_after > enrolls_before, "gone row posted enroll");

  HostStore store18g;
  ScriptTransport tr18g;
  tr18g.steps = {{"/enroll", ok_body(200, enroll_ok)},
                 {"/csr", ok_body(200, cert_ok)},
                 {"/rotate", ok_body(401, "{\"code\":\"relink_required\"}")},
                 {"/rotate", ok_body(401, "{\"code\":\"relink_required\"}")},
                 {"/enroll", ok_body(200, enroll_ok)}};
  CloudEngine eng18g(&tr18g, &clk, &store18g, &crypto);
  clk.now = 650000;
  eng18g.connect();
  eng18g.csr_now();
  eng18g.rotate_now();
  clk.now = 650000 + RELINK_CONFIRM_MS;
  eng18g.rotate_now();
  expect(eng18g.state() == CloudState::Relink, "other-404 start Relink");
  tr18g.nonce_status = 404;
  tr18g.nonce_error_body = "{\"error\":\"not found\"}";
  std::string id_before_404 = eng18g.device_id();
  size_t enrolls_other = 0;
  for (const auto &u : tr18g.urls)
    if (u.find("/enroll") != std::string::npos)
      enrolls_other++;
  eng18g.connect();
  expect(eng18g.device_id() == id_before_404, "other 404 keeps device id");
  size_t enrolls_other_after = 0;
  for (const auto &u : tr18g.urls)
    if (u.find("/enroll") != std::string::npos)
      enrolls_other_after++;
  expect(enrolls_other_after == enrolls_other, "other 404 does not re-enroll");

  HostStore store19;
  ScriptTransport tr19;
  tr19.steps = {{"/enroll", ok_body(200, enroll_ok)},
                {"/csr", ok_body(200, cert_ok)},
                {"/self-revoke", ok_body(200, "{\"ok\":true}")}};
  CloudEngine eng19(&tr19, &clk, &store19, &crypto);
  eng19.connect();
  eng19.csr_now();
  expect(eng19.state() == CloudState::Linked, "busy disconnect start");
  expect(eng19.try_begin(CloudJob::CSR), "busy begin");
  expect(eng19.busy(), "busy flag");
  eng19.disconnect();
  expect(eng19.has_key(), "busy disconnect keeps key");
  expect(eng19.state() != CloudState::Off, "busy disconnect waits");
  eng19.run_job(CloudJob::CSR);
  expect(eng19.state() == CloudState::Off, "busy disconnect wipes after job");
  expect(!eng19.has_key(), "busy disconnect zeros key");
  expect(!eng19.has_cert(), "busy disconnect discards cert");
  bool saw_busy_revoke = false;
  for (const auto &u : tr19.urls)
    saw_busy_revoke = saw_busy_revoke || u.find("/self-revoke") != std::string::npos;
  expect(saw_busy_revoke, "busy disconnect still revokes");
  eng19.finish();
  eng19.drain_queued();

  HostStore store19b;
  ScriptTransport tr19b;
  tr19b.steps = {{"/enroll", ok_body(200, enroll_ok)},
                 {"/csr", ok_body(200, cert_ok)},
                 {"/inbox", ok_body(200, "{\"commands\":[]}")},
                 {"/self-revoke", ok_body(200, "{\"ok\":true}")}};
  CloudEngine eng19b(&tr19b, &clk, &store19b, &crypto);
  eng19b.connect();
  eng19b.csr_now();
  expect(eng19b.try_begin(CloudJob::PROBE), "tail race begin");
  eng19b.run_job(CloudJob::PROBE);
  expect(eng19b.has_key(), "tail race job done still linked");
  eng19b.disconnect();
  expect(eng19b.has_key(), "tail race disconnect waits");
  expect(eng19b.state() != CloudState::Off, "tail race not wiped yet");
  eng19b.finish();
  eng19b.drain_queued();
  expect(eng19b.state() == CloudState::Off, "tail race drain wipes");
  expect(!eng19b.has_key(), "tail race zeros key");
  bool saw_tail_revoke = false;
  for (const auto &u : tr19b.urls)
    saw_tail_revoke = saw_tail_revoke || u.find("/self-revoke") != std::string::npos;
  expect(saw_tail_revoke, "tail race still revokes");

  HostStore store19c;
  ScriptTransport tr19c;
  tr19c.steps = {{"/enroll", ok_body(200, enroll_ok)},
                 {"/csr", ok_body(200, cert_ok)},
                 {"/rotate", ok_body(200, cert_ok)},
                 {"/self-revoke", ok_body(200, "{\"ok\":true}")}};
  CloudEngine eng19c(&tr19c, &clk, &store19c, &crypto);
  eng19c.connect();
  eng19c.csr_now();
  expect(eng19c.try_begin(CloudJob::ROTATE), "rotate discard begin");
  eng19c.disconnect();
  eng19c.run_job(CloudJob::ROTATE);
  expect(eng19c.state() == CloudState::Off, "rotate discard then wipe");
  expect(!eng19c.has_cert(), "rotate discard drops cert write-back");
  eng19c.finish();
  eng19c.drain_queued();

  HostStore store19d;
  ScriptTransport tr19d;
  tr19d.steps = {{"/enroll", ok_body(200, enroll_ok)},
                 {"/csr", ok_body(200, cert_ok)},
                 {"/rotate", ok_body(200, cert_ok)},
                 {"/self-revoke", ok_body(200, "{\"ok\":true}")}};
  CloudEngine eng19d(&tr19d, &clk, &store19d, &crypto);
  eng19d.connect();
  eng19d.csr_now();
  expect(eng19d.try_begin(CloudJob::ROTATE), "midhttp begin");
  tr19d.hook = [&](const HttpRequest &req) {
    if (req.url.find("/rotate") != std::string::npos)
      eng19d.disconnect();
  };
  eng19d.run_job(CloudJob::ROTATE);
  expect(eng19d.state() == CloudState::Off, "midhttp rotate wipes");
  expect(!eng19d.has_key(), "midhttp rotate zeros key");
  expect(!eng19d.has_cert(), "midhttp rotate discards cert");
  eng19d.finish();
  eng19d.drain_queued();
  tr19d.hook = nullptr;

  HostStore store19e;
  ScriptTransport tr19e;
  auto start_false = [](void *, CloudJob) { return false; };
  tr19e.steps = {{"/enroll", ok_body(200, enroll_ok)},
                 {"/csr", ok_body(200, cert_ok)},
                 {"/inbox", ok_body(200, "{\"commands\":[]}")},
                 {"/self-revoke", ok_body(200, "{\"ok\":true}")}};
  CloudEngine eng19e(&tr19e, &clk, &store19e, &crypto);
  eng19e.connect();
  eng19e.csr_now();
  eng19e.set_sync_jobs(false);
  eng19e.set_start_job(+start_false, nullptr);
  expect(eng19e.try_begin(CloudJob::PROBE), "finish-drain begin");
  eng19e.run_job(CloudJob::PROBE);
  eng19e.finish();
  expect(eng19e.has_key(), "finish-drain still linked");
  eng19e.disconnect();
  expect(eng19e.has_key(), "finish-drain disconnect waits");
  expect(eng19e.display_title() == std::string("Disconnecting..."), "finish-drain title");
  expect(std::strstr(eng19e.status_json().c_str(), "disconnecting") != nullptr, "finish-drain json");
  eng19e.drain_queued();
  expect(eng19e.state() == CloudState::Off, "finish-drain wipes");
  expect(!eng19e.has_key(), "finish-drain zeros key");

  HostStore store19f;
  ScriptTransport tr19f;
  tr19f.steps = {{"/enroll", ok_body(200, enroll_ok)},
                 {"/csr", ok_body(200, cert_ok)},
                 {"/self-revoke", ok_body(200, "{\"ok\":true}")}};
  CloudEngine eng19f(&tr19f, &clk, &store19f, &crypto);
  eng19f.connect();
  eng19f.csr_now();
  expect(eng19f.try_begin(CloudJob::REVOKE), "disc-during-revoke begin");
  tr19f.hook = [&](const HttpRequest &req) {
    if (req.url.find("/self-revoke") != std::string::npos)
      eng19f.disconnect();
  };
  eng19f.run_job(CloudJob::REVOKE);
  expect(eng19f.state() == CloudState::Off, "disc-during-revoke wipes");
  expect(!eng19f.has_key(), "disc-during-revoke zeros key");
  eng19f.finish();
  eng19f.drain_queued();
  expect(!eng19f.busy(), "disc-during-revoke busy after drain");
  expect(eng19f.state() == CloudState::Off, "disc-during-revoke stays Off");
  tr19f.hook = nullptr;

  HostStore store19g;
  ScriptTransport tr19g;
  tr19g.steps = {{"/enroll", ok_body(200, enroll_ok)},
                 {"/csr", ok_body(200, cert_ok)},
                 {"/self-revoke", ok_body(200, "{\"ok\":true}")},
                 {"/enroll", ok_body(200, enroll_ok)},
                 {"/csr", ok_body(200, cert_ok)}};
  CloudEngine eng19g(&tr19g, &clk, &store19g, &crypto);
  eng19g.connect();
  eng19g.csr_now();
  expect(eng19g.try_begin(CloudJob::CSR), "disc-then-connect begin");
  eng19g.disconnect();
  eng19g.connect();
  expect(eng19g.has_key(), "disc-then-connect keeps key until wipe");
  eng19g.run_job(CloudJob::CSR);
  expect(eng19g.state() == CloudState::Off, "disc-then-connect wipes first");
  expect(!eng19g.has_key(), "disc-then-connect zeros key");
  eng19g.finish();
  eng19g.drain_queued();
  expect(eng19g.state() == CloudState::PendingClaim, "disc-then-connect enrolls");
  expect(eng19g.cloud_enabled(), "disc-then-connect stays on");
  eng19g.csr_now();
  expect(eng19g.state() == CloudState::Linked, "disc-then-connect ends Linked");

  HostStore store19i;
  ScriptTransport tr19i;
  tr19i.steps = {{"/enroll", ok_body(200, enroll_ok)},
                 {"/csr", ok_body(200, cert_ok)},
                 {"/self-revoke", ok_body(503, "{}")},
                 {"/enroll", ok_body(200, enroll_ok)},
                 {"/csr", ok_body(200, cert_ok)}};
  CloudEngine eng19i(&tr19i, &clk, &store19i, &crypto);
  eng19i.connect();
  eng19i.csr_now();
  eng19i.set_sync_jobs(false);
  eng19i.set_start_job(+start_false, nullptr);
  expect(eng19i.try_begin(CloudJob::CSR), "stale-revoke begin");
  eng19i.disconnect();
  expect(eng19i.has_key(), "stale-revoke waits");
  eng19i.run_job(CloudJob::CSR);
  expect(eng19i.state() == CloudState::Off, "stale-revoke wipes");
  expect(eng19i.revoke_failed(), "stale-revoke flags fail");
  eng19i.finish();
  eng19i.drain_queued();
  expect(eng19i.revoke_failed(), "stale-revoke hint survives drain");
  expect(std::strstr(eng19i.display_hint().c_str(), "shroomlabs.io") != nullptr, "stale-revoke copy survives");
  eng19i.set_start_job(nullptr, nullptr);
  eng19i.set_sync_jobs(true);
  eng19i.connect();
  expect(eng19i.state() == CloudState::PendingClaim, "stale-revoke then connect enrolls");
  eng19i.csr_now();
  expect(eng19i.state() == CloudState::Linked, "stale-revoke then connect ends Linked");

  HostStore store19h;
  ScriptTransport tr19h;
  HostCrypto crypto19h;
  CloudJob handed = CloudJob::NONE;
  auto start_record = [](void *ctx, CloudJob job) {
    *static_cast<CloudJob *>(ctx) = job;
    return true;
  };
  tr19h.steps = {{"/enroll", ok_body(200, enroll_ok)},
                 {"/csr", ok_body(200, cert_ok)},
                 {"/self-revoke", ok_body(200, "{\"ok\":true}")}};
  CloudEngine eng19h(&tr19h, &clk, &store19h, &crypto19h);
  eng19h.connect();
  eng19h.csr_now();
  eng19h.set_sync_jobs(false);
  eng19h.set_start_job(+start_record, &handed);
  size_t urls_idle = tr19h.urls.size();
  int signs_before = crypto19h.sign_calls;
  int shas_before = crypto19h.sha_calls;
  handed = CloudJob::NONE;
  eng19h.disconnect();
  expect(tr19h.urls.size() == urls_idle, "disconnect no TLS on caller");
  expect(crypto19h.sign_calls == signs_before, "disconnect no sign on caller");
  expect(crypto19h.sha_calls == shas_before, "disconnect no sha on caller");
  expect(handed == CloudJob::REVOKE, "disconnect hands REVOKE to cloud task");
  expect(eng19h.has_key(), "disconnect waits for cloud task");
  expect(eng19h.display_title() == std::string("Disconnecting..."), "disconnecting title");
  expect(eng19h.try_begin(CloudJob::REVOKE), "cloud task begin");
  eng19h.run_job(CloudJob::REVOKE);
  eng19h.finish();
  eng19h.drain_queued();
  expect(eng19h.state() == CloudState::Off, "cloud task wipes");
  expect(!eng19h.has_key(), "cloud task zeros key");

  HostStore store20;
  ScriptTransport tr20;
  tr20.nonce_limit = 60;
  tr20.status_claimed = false;
  tr20.steps = {{"/enroll", ok_body(200, enroll_ok)}, {"/csr", ok_body(200, cert_ok)}};
  CloudEngine eng20(&tr20, &clk, &store20, &crypto);
  clk.now = 40000;
  eng20.connect();
  for (int i = 0; i < 80; i++) {
    clk.now = eng20.next_csr_ms();
    eng20.csr_now();
  }
  expect(eng20.state() == CloudState::PendingClaim, "nonce-limit poll stays");
  expect(tr20.nonce_count == 0, "claim-status uses no nonce");
  expect(eng20.next_csr_ms() <= clk.now + CLAIM_POLL_MS + CLAIM_POLL_JITTER_MS, "wait stays at 5s");
  tr20.status_claimed = true;
  clk.now = eng20.next_csr_ms();
  eng20.csr_now();
  expect(eng20.state() == CloudState::Linked, "claim after long wait");
  expect(tr20.nonce_count == 1, "one nonce after claimed");

  HostStore store21a;
  HostStore store21b;
  ScriptTransport tr21;
  tr21.status_claimed = false;
  tr21.nonce_limit = 60;
  tr21.steps = {{"/enroll", ok_body(200, enroll_ok)}};
  CloudEngine a(&tr21, &clk, &store21a, &crypto);
  CloudEngine b(&tr21, &clk, &store21b, &crypto);
  a.connect();
  tr21.steps = {{"/enroll", ok_body(200, enroll_ok)}};
  tr21.i = 0;
  b.connect();
  for (int i = 0; i < 40; i++) {
    clk.now += CLAIM_POLL_MS;
    a.csr_now();
    b.csr_now();
  }
  expect(tr21.nonce_count == 0, "two chambers poll without nonce");
  expect(a.state() == CloudState::PendingClaim && b.state() == CloudState::PendingClaim, "two chambers wait");

  HostStore store22;
  ScriptTransport tr22;
  tr22.steps = {{"/enroll", ok_body(200, enroll_ok)},
                {"/csr", ok_body(200, cert_ok)},
                {"/self-revoke", ok_body(503, "{}")}};
  CloudEngine eng22(&tr22, &clk, &store22, &crypto);
  eng22.connect();
  eng22.csr_now();
  eng22.disconnect();
  expect(eng22.state() == CloudState::Off, "failed revoke still wipes");
  expect(eng22.revoke_failed(), "failed revoke flagged");
  expect(std::strstr(eng22.display_hint().c_str(), "shroomlabs.io") != nullptr, "failed revoke copy");

  HostStore store23;
  ScriptTransport tr23;
  tr23.steps = {{"/enroll", ok_body(200, enroll_ok)}, {"/enroll", ok_body(200, enroll_ok)}};
  CloudEngine eng23(&tr23, &clk, &store23, &crypto);
  eng23.connect();
  expect(eng23.try_begin(CloudJob::CSR), "queue begin");
  size_t queued_before = eng23.request_count();
  eng23.refresh();
  expect(eng23.request_count() == queued_before, "refresh while busy queues");
  eng23.finish();
  eng23.drain_queued();
  expect(eng23.request_count() > queued_before, "queued refresh runs");

  auto count_urls = [](const std::vector<std::string> &urls, const char *part) {
    size_t n = 0;
    for (const auto &u : urls)
      if (u.find(part) != std::string::npos)
        n++;
    return n;
  };

  HostStore store24;
  ScriptTransport tr24;
  struct StartCount {
    int enrolls = 0;
    CloudJob last = CloudJob::NONE;
  } starts24;
  auto start_count = [](void *ctx, CloudJob job) {
    auto *s = static_cast<StartCount *>(ctx);
    s->last = job;
    if (job == CloudJob::ENROLL)
      s->enrolls++;
    return true;
  };
  tr24.steps = {{"/enroll", ok_body(200, enroll_ok)}, {"/enroll", ok_body(200, enroll_ok)}};
  CloudEngine eng24(&tr24, &clk, &store24, &crypto);
  eng24.set_sync_jobs(false);
  eng24.set_start_job(+start_count, &starts24);
  clk.now = 80000;
  eng24.connect();
  expect(starts24.enrolls == 1, "connect-loop one start");
  for (int i = 0; i < 8; i++) {
    clk.now += 1000;
    eng24.loop();
  }
  expect(starts24.enrolls == 1, "connect-loop no second start");
  expect(eng24.try_begin(CloudJob::ENROLL), "connect-loop begin");
  eng24.run_job(CloudJob::ENROLL);
  eng24.finish();
  eng24.drain_queued();
  expect(count_urls(tr24.urls, "/enroll") == 1, "connect-loop one enroll");
  expect(eng24.state() == CloudState::PendingClaim, "connect-loop pending claim");
  eng24.set_start_job(nullptr, nullptr);
  eng24.set_sync_jobs(true);

  HostStore store25;
  ScriptTransport tr25;
  tr25.steps = {{"/enroll", ok_body(200, enroll_ok)}, {"/self-revoke", ok_body(200, "{\"ok\":true}")},
                {"/enroll", ok_body(200, enroll_ok)}};
  CloudEngine eng25(&tr25, &clk, &store25, &crypto);
  expect(eng25.try_begin(CloudJob::ENROLL), "disc-mid-enroll begin");
  eng25.connect();
  eng25.loop();
  eng25.disconnect();
  expect(std::strstr(eng25.status_json().c_str(), "disconnecting") != nullptr, "disc-mid-enroll json");
  expect(std::strstr(eng25.status_json().c_str(), "\"claim_code\":\"\"") != nullptr, "disc-mid-enroll no code");
  expect(eng25.display_code().empty(), "disc-mid-enroll display code");
  expect(eng25.display_expiry().empty(), "disc-mid-enroll expiry");
  eng25.run_job(CloudJob::ENROLL);
  expect(count_urls(tr25.urls, "/self-revoke") == 1, "disc-mid-enroll self-revoke");
  expect(eng25.state() == CloudState::Off, "disc-mid-enroll wipes");
  expect(!eng25.cloud_enabled(), "disc-mid-enroll disabled");
  expect(!eng25.has_key(), "disc-mid-enroll zeros key");
  eng25.finish();
  eng25.drain_queued();
  expect(eng25.state() == CloudState::Off, "disc-mid-enroll stays Off");
  expect(!eng25.cloud_enabled(), "disc-mid-enroll stays disabled");
  expect(count_urls(tr25.urls, "/enroll") == 1, "disc-mid-enroll no re-enroll");

  HostStore store26;
  ScriptTransport tr26;
  tr26.steps = {{"/enroll", ok_body(200, enroll_ok)},
                {"/self-revoke", ok_body(200, "{\"ok\":true}")},
                {"/enroll", ok_body(200, enroll_ok)}};
  CloudEngine eng26(&tr26, &clk, &store26, &crypto);
  expect(eng26.try_begin(CloudJob::ENROLL), "connect-during-disc begin");
  eng26.connect();
  eng26.disconnect();
  eng26.connect();
  expect(eng26.pending_wipe(), "connect-during-disc still wiping");
  eng26.run_job(CloudJob::ENROLL);
  expect(eng26.state() == CloudState::Off, "connect-during-disc wipes first");
  expect(!eng26.has_key(), "connect-during-disc zeros key");
  eng26.finish();
  eng26.drain_queued();
  expect(eng26.state() == CloudState::PendingClaim, "connect-during-disc enrolls");
  expect(eng26.cloud_enabled(), "connect-during-disc stays on");
  expect(count_urls(tr26.urls, "/enroll") == 2, "connect-during-disc one kept enroll");

  HostStore store27;
  ScriptTransport tr27;
  tr27.steps = {{"/enroll", ok_body(200, enroll_ok)}};
  CloudEngine eng27(&tr27, &clk, &store27, &crypto);
  eng27.connect();
  expect(eng27.claim_code() == "AB2C3D", "wipe-status has code");
  expect(eng27.try_begin(CloudJob::CSR), "wipe-status begin");
  eng27.disconnect();
  expect(eng27.pending_wipe(), "wipe-status pending");
  const std::string json27 = eng27.status_json();
  expect(std::strstr(json27.c_str(), "disconnecting") != nullptr, "wipe-status disconnecting");
  expect(std::strstr(json27.c_str(), "\"claim_code\":\"\"") != nullptr, "wipe-status no claim_code");
  expect(std::strstr(json27.c_str(), "\"claim_url\":\"\"") != nullptr, "wipe-status no claim_url");
  expect(std::strstr(json27.c_str(), "\"expires_in_s\":0") != nullptr, "wipe-status no expiry");
  expect(eng27.display_code().empty(), "wipe-status display code");
  expect(eng27.display_expiry().empty(), "wipe-status display expiry");
  expect(eng27.display_title() == std::string("Disconnecting..."), "wipe-status title");
  eng27.finish();

  const char *empty_sha = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  const char *abc_sha = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
  uint8_t digest[32];
  char hex[65];
  expect(shl_mbedtls_sha256(nullptr, 0, digest) == 0, "sha empty call");
  hex_encode_to(digest, 32, hex);
  expect(std::strcmp(hex, empty_sha) == 0, "sha empty FIPS");
  expect(shl_mbedtls_sha256(reinterpret_cast<const uint8_t *>("abc"), 3, digest) == 0, "sha abc call");
  hex_encode_to(digest, 32, hex);
  expect(std::strcmp(hex, abc_sha) == 0, "sha abc FIPS");
  int sha_bad = 0;
  for (int n = 0; n <= 300; n++) {
    std::vector<uint8_t> buf(static_cast<size_t>(n));
    for (int i = 0; i < n; i++)
      buf[static_cast<size_t>(i)] = static_cast<uint8_t>(i & 0xff);
    uint8_t got[32];
    uint8_t exp[32];
    const uint8_t *p = n ? buf.data() : nullptr;
    if (shl_mbedtls_sha256(p, static_cast<size_t>(n), got) != 0) {
      sha_bad++;
      continue;
    }
    SHA256(p, static_cast<size_t>(n), exp);
    if (std::memcmp(got, exp, 32) != 0)
      sha_bad++;
  }
  expect(sha_bad == 0, "sha mbedtls known-answer 0-300");

  return fails ? 1 : 0;
}
