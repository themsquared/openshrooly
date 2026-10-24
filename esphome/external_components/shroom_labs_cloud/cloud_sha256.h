#pragma once

#include <mbedtls/sha256.h>
#include <mbedtls/version.h>

#include <cstddef>
#include <cstdint>

namespace esphome {
namespace shroom_labs {

/** Same wrapper the firmware uses: mbedtls 3.x `mbedtls_sha256`, 2.x `mbedtls_sha256_ret`. */
inline int shl_mbedtls_sha256(const uint8_t *data, size_t len, uint8_t out[32]) {
#if defined(MBEDTLS_VERSION_MAJOR) && MBEDTLS_VERSION_MAJOR >= 3
  return mbedtls_sha256(data, len, out, 0);
#else
  return mbedtls_sha256_ret(data, len, out, 0);
#endif
}

}  // namespace shroom_labs
}  // namespace esphome
