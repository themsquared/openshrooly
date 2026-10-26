#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

namespace esphome {
namespace shroom_labs {

// Version 4 is 33x33. Claim URLs fit version 3 (29x29) ECC L.
static constexpr int QR_MAX = 33;

struct QrCode {
  int size = 0;
  int version = 0;
  int mask = 0;
  uint8_t modules[QR_MAX * QR_MAX]{};
};

bool qr_encode(const char *text, QrCode *out);
std::string qr_modules_string(const QrCode &qr);
inline bool qr_module(const QrCode &qr, int x, int y) {
  if (x < 0 || y < 0 || x >= qr.size || y >= qr.size)
    return false;
  return qr.modules[y * QR_MAX + x] != 0;
}

}  // namespace shroom_labs
}  // namespace esphome
