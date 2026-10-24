#pragma once
// Pure update-trust logic with no ESPHome or ESP-IDF dependencies, so it can be
// unit tested on the host (see scripts/test_signed_update.py).
#include <cstddef>
#include <cstdint>
#include <string>

namespace esphome {
namespace signed_update {

// Release versions look like "1.0.3" or "1.0.3-sl.1". The "-sl.N" suffix marks a
// Shroom Labs build of that upstream version, so 1.0.3 < 1.0.3-sl.1 < 1.0.3-sl.2 < 1.0.4.
struct Version {
  uint32_t major{0}, minor{0}, patch{0}, build{0};
  bool has_build{false};
};

bool parse_version(const std::string &text, Version *out);
// Returns -1, 0 or 1. Callers must only compare versions that parsed.
int compare_versions(const Version &a, const Version &b);

// A download URL is allowed only when it is HTTPS, starts with the compiled-in
// prefix, and contains nothing that could change the host or path meaning.
bool url_allowed(const std::string &url, const std::string &prefix);

// Lower-case hex SHA-256 check.
bool is_sha256_hex(const std::string &hex);

// The exact text the release key signs. Every field the device acts on is bound.
std::string signed_message(const std::string &product, const std::string &channel, const std::string &version,
                           uint32_t size, const std::string &sha256_hex, const std::string &url);

// Standard base64 (RFC 4648, with padding). Returns false on any malformed input.
bool base64_decode(const std::string &in, uint8_t *out, size_t out_cap, size_t *out_len);

// Ed25519 (RFC 8032) check of a base64 signature over msg with a 32 byte public key.
bool signature_valid(const uint8_t public_key[32], const std::string &msg, const std::string &signature_b64);

}  // namespace signed_update
}  // namespace esphome
