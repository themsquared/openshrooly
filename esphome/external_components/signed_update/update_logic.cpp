#include "update_logic.h"

#include <cstring>

extern "C" {
#include "monocypher.h"
}

#ifdef ESP_PLATFORM
#include "mbedtls/sha512.h"
#else
// Host tests hash with Monocypher's portable SHA-512 (scripts/host_vendor).
extern "C" {
#include "monocypher-ed25519.h"
}
#endif

namespace esphome {
namespace signed_update {

static bool parse_uint(const std::string &s, size_t *pos, uint32_t *out) {
  size_t start = *pos;
  uint64_t v = 0;
  while (*pos < s.size() && s[*pos] >= '0' && s[*pos] <= '9') {
    v = v * 10 + (s[*pos] - '0');
    if (v > 0xFFFFFFu)
      return false;
    (*pos)++;
  }
  if (*pos == start || *pos - start > 7)
    return false;
  if (*pos - start > 1 && s[start] == '0')
    return false;  // no leading zeros
  *out = static_cast<uint32_t>(v);
  return true;
}

bool parse_version(const std::string &text, Version *out) {
  Version v;
  size_t pos = 0;
  if (!parse_uint(text, &pos, &v.major) || pos >= text.size() || text[pos++] != '.')
    return false;
  if (!parse_uint(text, &pos, &v.minor) || pos >= text.size() || text[pos++] != '.')
    return false;
  if (!parse_uint(text, &pos, &v.patch))
    return false;
  if (pos != text.size()) {
    if (text.compare(pos, 4, "-sl.") != 0)
      return false;
    pos += 4;
    if (!parse_uint(text, &pos, &v.build) || pos != text.size())
      return false;
    v.has_build = true;
  }
  *out = v;
  return true;
}

int compare_versions(const Version &a, const Version &b) {
  const uint32_t av[4] = {a.major, a.minor, a.patch, a.has_build ? a.build + 1 : 0};
  const uint32_t bv[4] = {b.major, b.minor, b.patch, b.has_build ? b.build + 1 : 0};
  for (int i = 0; i < 4; i++) {
    if (av[i] < bv[i])
      return -1;
    if (av[i] > bv[i])
      return 1;
  }
  return 0;
}

bool url_allowed(const std::string &url, const std::string &prefix) {
  if (prefix.compare(0, 8, "https://") != 0 || prefix.back() != '/')
    return false;
  if (url.size() <= prefix.size() || url.size() > 200 || url.compare(0, prefix.size(), prefix) != 0)
    return false;
  for (size_t i = prefix.size(); i < url.size(); i++) {
    const char c = url[i];
    const bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' ||
                    c == '_' || c == '.' || c == '/';
    if (!ok)
      return false;
  }
  return url.find("..") == std::string::npos && url.find("//", 8) == std::string::npos;
}

bool is_sha256_hex(const std::string &hex) {
  if (hex.size() != 64)
    return false;
  for (char c : hex) {
    if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')))
      return false;
  }
  return true;
}

std::string signed_message(const std::string &product, const std::string &channel, const std::string &version,
                           uint32_t size, const std::string &sha256_hex, const std::string &url) {
  std::string m = "openshrooly-release-v1\n";
  m += "product=" + product + "\n";
  m += "channel=" + channel + "\n";
  m += "version=" + version + "\n";
  m += "size=" + std::to_string(size) + "\n";
  m += "sha256=" + sha256_hex + "\n";
  m += "url=" + url + "\n";
  return m;
}

static int b64_value(char c) {
  if (c >= 'A' && c <= 'Z')
    return c - 'A';
  if (c >= 'a' && c <= 'z')
    return c - 'a' + 26;
  if (c >= '0' && c <= '9')
    return c - '0' + 52;
  if (c == '+')
    return 62;
  if (c == '/')
    return 63;
  return -1;
}

bool base64_decode(const std::string &in, uint8_t *out, size_t out_cap, size_t *out_len) {
  if (in.empty() || in.size() % 4 != 0)
    return false;
  size_t n = 0;
  for (size_t i = 0; i < in.size(); i += 4) {
    int v[4];
    int pad = 0;
    for (int j = 0; j < 4; j++) {
      const char c = in[i + j];
      if (c == '=') {
        if (i + 4 != in.size() || j < 2)
          return false;
        pad++;
        v[j] = 0;
      } else {
        if (pad)
          return false;
        v[j] = b64_value(c);
        if (v[j] < 0)
          return false;
      }
    }
    const uint32_t triple = (v[0] << 18) | (v[1] << 12) | (v[2] << 6) | v[3];
    const uint8_t bytes[3] = {static_cast<uint8_t>(triple >> 16), static_cast<uint8_t>(triple >> 8),
                              static_cast<uint8_t>(triple)};
    for (int k = 0; k < 3 - pad; k++) {
      if (n >= out_cap)
        return false;
      out[n++] = bytes[k];
    }
  }
  *out_len = n;
  return true;
}

bool signature_valid(const uint8_t public_key[32], const std::string &msg, const std::string &signature_b64) {
  uint8_t sig[64];
  size_t len = 0;
  if (!base64_decode(signature_b64, sig, sizeof(sig), &len) || len != sizeof(sig))
    return false;
  // Ed25519 (RFC 8032): accept only if [S]B == R + [SHA-512(R || A || M)]A.
  // Same steps as Monocypher's crypto_ed25519_check, with SHA-512 from the
  // chip's hardware-accelerated mbedTLS so the firmware carries one SHA-512.
  uint8_t hash[64];
  const auto *m = reinterpret_cast<const uint8_t *>(msg.data());
#ifdef ESP_PLATFORM
  mbedtls_sha512_context ctx;
  mbedtls_sha512_init(&ctx);
  bool ok = mbedtls_sha512_starts(&ctx, 0) == 0 && mbedtls_sha512_update(&ctx, sig, 32) == 0 &&
            mbedtls_sha512_update(&ctx, public_key, 32) == 0 && mbedtls_sha512_update(&ctx, m, msg.size()) == 0 &&
            mbedtls_sha512_finish(&ctx, hash) == 0;
  mbedtls_sha512_free(&ctx);
  if (!ok)
    return false;
#else
  crypto_sha512_ctx ctx;
  crypto_sha512_init(&ctx);
  crypto_sha512_update(&ctx, sig, 32);
  crypto_sha512_update(&ctx, public_key, 32);
  crypto_sha512_update(&ctx, m, msg.size());
  crypto_sha512_final(&ctx, hash);
#endif
  uint8_t h_ram[32];
  crypto_eddsa_reduce(h_ram, hash);
  return crypto_eddsa_check_equation(sig, public_key, h_ram) == 0;
}

}  // namespace signed_update
}  // namespace esphome
