#include "cloud_qr.h"

#include <cstring>
#include <vector>

namespace esphome {
namespace shroom_labs {

namespace {

struct Ver {
  int version;
  int size;
  int data_cw;
  int ecc_cw;
  int align;
  int rem_bits;
};

// ECC L only. Byte-mode capacities: v2=32, v3=53, v4=78.
static const Ver VERS[] = {
    {2, 25, 34, 10, 18, 7},
    {3, 29, 55, 15, 22, 7},
    {4, 33, 80, 20, 26, 7},
};

// Format bits for ECC L + mask 0..7 (ISO/IEC 18004).
static const uint16_t FORMAT_L[8] = {0x77C4, 0x72F3, 0x7D5A, 0x789D, 0x662F, 0x6318, 0x6C41, 0x6976};

uint8_t gf_exp[512];
uint8_t gf_log[256];
bool gf_ready = false;

void gf_init() {
  if (gf_ready)
    return;
  uint8_t x = 1;
  for (int i = 0; i < 255; i++) {
    gf_exp[i] = x;
    gf_log[x] = static_cast<uint8_t>(i);
    x = static_cast<uint8_t>((x << 1) ^ ((x & 0x80) ? 0x11d : 0));
  }
  for (int i = 255; i < 512; i++)
    gf_exp[i] = gf_exp[i - 255];
  gf_ready = true;
}

uint8_t gf_mul(uint8_t a, uint8_t b) {
  if (a == 0 || b == 0)
    return 0;
  return gf_exp[gf_log[a] + gf_log[b]];
}

void rs_encode(const uint8_t *data, int data_len, int nsym, uint8_t *ecc) {
  gf_init();
  std::vector<uint8_t> gen(nsym + 1);
  gen[0] = 1;
  for (int i = 0; i < nsym; i++) {
    uint8_t next[32];
    std::memset(next, 0, sizeof(next));
    for (int j = 0; j <= i; j++) {
      next[j] ^= gen[j];
      next[j + 1] ^= gf_mul(gen[j], gf_exp[i]);
    }
    std::memcpy(gen.data(), next, nsym + 1);
  }
  std::memset(ecc, 0, nsym);
  for (int i = 0; i < data_len; i++) {
    uint8_t factor = data[i] ^ ecc[0];
    std::memmove(ecc, ecc + 1, nsym - 1);
    ecc[nsym - 1] = 0;
    if (factor == 0)
      continue;
    for (int j = 0; j < nsym; j++)
      ecc[j] ^= gf_mul(gen[j + 1], factor);
  }
}

bool in_finder(int x, int y, int size) {
  auto box = [](int x, int y, int ox, int oy) { return x >= ox && x < ox + 8 && y >= oy && y < oy + 8; };
  return box(x, y, 0, 0) || box(x, y, size - 8, 0) || box(x, y, 0, size - 8);
}

bool is_function(int x, int y, int size, int align) {
  if (x < 0 || y < 0 || x >= size || y >= size)
    return true;
  if (in_finder(x, y, size))
    return true;
  if (x == 6 || y == 6)
    return true;
  if (x >= align - 2 && x <= align + 2 && y >= align - 2 && y <= align + 2)
    return true;
  if (x == 8 && y == size - 8)
    return true;
  // format info
  if (y == 8 && (x <= 8 || x >= size - 8))
    return true;
  if (x == 8 && (y <= 8 || y >= size - 8))
    return true;
  return false;
}

void set_mod(QrCode *qr, int x, int y, bool dark) {
  if (x < 0 || y < 0 || x >= qr->size || y >= qr->size)
    return;
  qr->modules[y * QR_MAX + x] = dark ? 1 : 0;
}

bool get_mod(const QrCode *qr, int x, int y) {
  if (x < 0 || y < 0 || x >= qr->size || y >= qr->size)
    return false;
  return qr->modules[y * QR_MAX + x] != 0;
}

void draw_finder(QrCode *qr, int ox, int oy) {
  for (int y = -1; y <= 7; y++) {
    for (int x = -1; x <= 7; x++) {
      bool dark = x >= 0 && x <= 6 && y >= 0 && y <= 6 && (x == 0 || x == 6 || y == 0 || y == 6 || (x >= 2 && x <= 4 && y >= 2 && y <= 4));
      int xx = ox + x, yy = oy + y;
      if (xx >= 0 && yy >= 0 && xx < qr->size && yy < qr->size)
        set_mod(qr, xx, yy, dark);
    }
  }
}

void draw_align(QrCode *qr, int cx, int cy) {
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      bool dark = x == -2 || x == 2 || y == -2 || y == 2 || (x == 0 && y == 0);
      set_mod(qr, cx + x, cy + y, dark);
    }
  }
}

void draw_function(QrCode *qr, int align) {
  std::memset(qr->modules, 0, sizeof(qr->modules));
  draw_finder(qr, 0, 0);
  draw_finder(qr, qr->size - 7, 0);
  draw_finder(qr, 0, qr->size - 7);
  for (int i = 8; i < qr->size - 8; i++) {
    set_mod(qr, i, 6, i % 2 == 0);
    set_mod(qr, 6, i, i % 2 == 0);
  }
  draw_align(qr, align, align);
  set_mod(qr, 8, qr->size - 8, true);
}

void draw_format(QrCode *qr, int mask) {
  uint16_t bits = FORMAT_L[mask & 7];
  for (int i = 0; i < 15; i++) {
    bool dark = (bits >> (14 - i)) & 1;
    // around top-left finder
    if (i < 6)
      set_mod(qr, i, 8, dark);
    else if (i < 8)
      set_mod(qr, i + 1, 8, dark);
    else if (i < 9)
      set_mod(qr, 8, 7, dark);
    else
      set_mod(qr, 8, 14 - i, dark);
    // Mirror: 7 bits up the left, 8 bits along the top-right. The dark
    // module at (8, size-8) is not a format bit.
    if (i < 7)
      set_mod(qr, 8, qr->size - 1 - i, dark);
    else
      set_mod(qr, qr->size - 15 + i, 8, dark);
  }
}

bool mask_bit(int mask, int y, int x) {
  switch (mask) {
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
    case 7:
      return (((y + x) % 2 + (y * x) % 3) & 1) == 0;
    default:
      return false;
  }
}

void place_data(QrCode *qr, const uint8_t *bits, int nbits, int align, int mask) {
  int size = qr->size;
  int bi = 0;
  int upward = 1;
  for (int col = size - 1; col > 0; col -= 2) {
    if (col == 6)
      col--;
    for (int i = 0; i < size; i++) {
      int y = upward ? size - 1 - i : i;
      for (int dx = 0; dx < 2; dx++) {
        int x = col - dx;
        if (is_function(x, y, size, align))
          continue;
        bool dark = false;
        if (bi < nbits)
          dark = bits[bi++] != 0;
        if (mask_bit(mask, y, x))
          dark = !dark;
        set_mod(qr, x, y, dark);
      }
    }
    upward = !upward;
  }
}

int penalty(const QrCode *qr) {
  int size = qr->size;
  int score = 0;
  for (int y = 0; y < size; y++) {
    int run = 1;
    bool last = get_mod(qr, 0, y);
    for (int x = 1; x < size; x++) {
      bool v = get_mod(qr, x, y);
      if (v == last)
        run++;
      else {
        if (run >= 5)
          score += 3 + (run - 5);
        run = 1;
        last = v;
      }
    }
    if (run >= 5)
      score += 3 + (run - 5);
  }
  for (int x = 0; x < size; x++) {
    int run = 1;
    bool last = get_mod(qr, x, 0);
    for (int y = 1; y < size; y++) {
      bool v = get_mod(qr, x, y);
      if (v == last)
        run++;
      else {
        if (run >= 5)
          score += 3 + (run - 5);
        run = 1;
        last = v;
      }
    }
    if (run >= 5)
      score += 3 + (run - 5);
  }
  for (int y = 0; y < size - 1; y++) {
    for (int x = 0; x < size - 1; x++) {
      bool a = get_mod(qr, x, y);
      if (a == get_mod(qr, x + 1, y) && a == get_mod(qr, x, y + 1) && a == get_mod(qr, x + 1, y + 1))
        score += 3;
    }
  }
  auto pattern = [&](bool a0, bool a1, bool a2, bool a3, bool a4, bool a5, bool a6, bool a7, bool a8, bool a9, bool a10) {
    return a0 && !a1 && a2 && a3 && a4 && !a5 && a6 && !a7 && !a8 && !a9 && !a10;
  };
  for (int y = 0; y < size; y++) {
    for (int x = 0; x + 10 < size; x++) {
      bool v[11];
      for (int k = 0; k < 11; k++)
        v[k] = get_mod(qr, x + k, y);
      if (pattern(v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8], v[9], v[10]) ||
          pattern(v[10], v[9], v[8], v[7], v[6], v[5], v[4], v[3], v[2], v[1], v[0]))
        score += 40;
    }
  }
  for (int x = 0; x < size; x++) {
    for (int y = 0; y + 10 < size; y++) {
      bool v[11];
      for (int k = 0; k < 11; k++)
        v[k] = get_mod(qr, x, y + k);
      if (pattern(v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8], v[9], v[10]) ||
          pattern(v[10], v[9], v[8], v[7], v[6], v[5], v[4], v[3], v[2], v[1], v[0]))
        score += 40;
    }
  }
  int dark = 0;
  for (int y = 0; y < size; y++)
    for (int x = 0; x < size; x++)
      if (get_mod(qr, x, y))
        dark++;
  int percent = (dark * 100) / (size * size);
  int k = percent / 5;
  if (k > 10)
    k = 10;
  // N4: 10 points per 5% away from 50
  int d = percent > 50 ? percent - 50 : 50 - percent;
  score += (d / 5) * 10;
  (void) k;
  return score;
}

const Ver *pick_version(size_t nbytes) {
  for (const Ver &v : VERS) {
    // 4 mode + 8 count + 8*n + 4 term, rounded up, plus padding to data_cw
    size_t bits = 4 + 8 + 8 * nbytes + 4;
    size_t bytes = (bits + 7) / 8;
    if (bytes <= static_cast<size_t>(v.data_cw))
      return &v;
  }
  return nullptr;
}

}  // namespace

bool qr_encode(const char *text, QrCode *out) {
  if (text == nullptr || out == nullptr)
    return false;
  size_t n = std::strlen(text);
  const Ver *ver = pick_version(n);
  if (ver == nullptr)
    return false;

  std::vector<uint8_t> data(ver->data_cw, 0);
  int bit = 0;
  auto put = [&](unsigned v, int nbits) {
    for (int i = nbits - 1; i >= 0; i--) {
      if (v & (1u << i))
        data[bit / 8] |= 1 << (7 - (bit % 8));
      bit++;
    }
  };
  put(0x4, 4);  // byte mode
  put(static_cast<unsigned>(n), 8);
  for (size_t i = 0; i < n; i++)
    put(static_cast<unsigned char>(text[i]), 8);
  int leftover = ver->data_cw * 8 - bit;
  put(0, leftover > 4 ? 4 : leftover);
  while (bit % 8)
    put(0, 1);
  uint8_t pads[2] = {0xEC, 0x11};
  int pi = 0;
  while (bit / 8 < ver->data_cw)
    put(pads[(pi++) & 1], 8);

  uint8_t ecc[32];
  rs_encode(data.data(), ver->data_cw, ver->ecc_cw, ecc);

  std::vector<uint8_t> stream;
  stream.reserve(ver->data_cw + ver->ecc_cw);
  stream.insert(stream.end(), data.begin(), data.end());
  stream.insert(stream.end(), ecc, ecc + ver->ecc_cw);

  std::vector<uint8_t> bits;
  bits.reserve(stream.size() * 8 + ver->rem_bits);
  for (uint8_t b : stream) {
    for (int i = 7; i >= 0; i--)
      bits.push_back((b >> i) & 1);
  }
  for (int i = 0; i < ver->rem_bits; i++)
    bits.push_back(0);

  out->size = ver->size;
  out->version = ver->version;
  int best_mask = 0;
  int best_score = 1 << 30;
  QrCode trial = *out;
  for (int mask = 0; mask < 8; mask++) {
    trial.size = ver->size;
    draw_function(&trial, ver->align);
    place_data(&trial, bits.data(), static_cast<int>(bits.size()), ver->align, mask);
    draw_format(&trial, mask);
    int s = penalty(&trial);
    if (s < best_score) {
      best_score = s;
      best_mask = mask;
      *out = trial;
      out->mask = mask;
      out->version = ver->version;
      out->size = ver->size;
    }
  }
  (void) best_mask;
  return out->size > 0;
}

std::string qr_modules_string(const QrCode &qr) {
  std::string s;
  s.reserve(qr.size * qr.size);
  for (int y = 0; y < qr.size; y++)
    for (int x = 0; x < qr.size; x++)
      s.push_back(qr_module(qr, x, y) ? '1' : '0');
  return s;
}

}  // namespace shroom_labs
}  // namespace esphome
