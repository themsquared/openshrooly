#include "cloud_format.h"
#include "cloud_qr.h"

#include <cstdio>
#include <cstring>
#include <string>

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
  expect(next_state(CloudState::PendingClaim, CloudEvent::CsrWaiting) == CloudState::PendingClaim, "wait");
  expect(next_state(CloudState::PendingClaim, CloudEvent::CsrOk) == CloudState::Linked, "claimed");
  expect(next_state(CloudState::Linked, CloudEvent::RotateDue) == CloudState::Rotating, "rotate due");
  expect(next_state(CloudState::Rotating, CloudEvent::RotateOk) == CloudState::Linked, "rotate ok");
  expect(next_state(CloudState::Linked, CloudEvent::LinkAuthFail) == CloudState::Revoked, "revoke");
  expect(next_state(CloudState::Revoked, CloudEvent::ReclaimOk) == CloudState::PendingClaim, "reclaim");
  expect(next_state(CloudState::Linked, CloudEvent::Disable) == CloudState::Off, "disconnect");
  expect(next_state(CloudState::Rotating, CloudEvent::CsrFail) == CloudState::Linked, "bad rotate keeps cert");

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

  return fails ? 1 : 0;
}
