// Host unit test for esphome/external_components/signed_update/update_logic.cpp.
// Built and run by scripts/test_signed_update.py.
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

#include "update_logic.h"

using namespace esphome::signed_update;

static int failures = 0;
#define CHECK(cond)                                              \
  do {                                                           \
    if (!(cond)) {                                               \
      std::fprintf(stderr, "FAIL %s:%d %s\n", __FILE__, __LINE__, #cond); \
      failures++;                                                \
    }                                                            \
  } while (0)

static bool hex32(const char *hex, uint8_t out[32]) {
  if (std::strlen(hex) != 64)
    return false;
  for (int i = 0; i < 32; i++) {
    unsigned v;
    if (std::sscanf(hex + i * 2, "%2x", &v) != 1)
      return false;
    out[i] = static_cast<uint8_t>(v);
  }
  return true;
}

static int cmp(const char *a, const char *b) {
  Version va, vb;
  if (!parse_version(a, &va) || !parse_version(b, &vb))
    return 99;
  return compare_versions(va, vb);
}

static void unit_tests() {
  // Versions: X.Y.Z < X.Y.Z-sl.0 < X.Y.Z-sl.1 < X.Y.(Z+1)
  CHECK(cmp("1.0.3-sl.1", "1.0.2") == 1);
  CHECK(cmp("1.0.2", "1.0.3-sl.1") == -1);
  CHECK(cmp("1.0.3", "1.0.3-sl.1") == -1);
  CHECK(cmp("1.0.3-sl.2", "1.0.3-sl.10") == -1);
  CHECK(cmp("1.0.3-sl.1", "1.0.3-sl.1") == 0);
  CHECK(cmp("1.0.4", "1.0.3-sl.9") == 1);
  CHECK(cmp("2.0.0", "1.99.99") == 1);
  CHECK(cmp("1.10.0", "1.9.0") == 1);
  Version v;
  CHECK(!parse_version("", &v));
  CHECK(!parse_version("1.0", &v));
  CHECK(!parse_version("1.0.3-beta", &v));
  CHECK(!parse_version("1.0.3-sl.", &v));
  CHECK(!parse_version("01.0.3", &v));
  CHECK(!parse_version("1.0.3 ", &v));
  CHECK(!parse_version("1.0.3-sl.1x", &v));
  CHECK(!parse_version("99999999.0.0", &v));

  const std::string p = "https://shroomlabs.io/firmware/stable/";
  CHECK(url_allowed(p + "openshrooly-1.0.3-sl.1.ota.bin", p));
  CHECK(!url_allowed(p, p));
  CHECK(!url_allowed("http://shroomlabs.io/firmware/stable/a.bin", p));
  CHECK(!url_allowed("https://shroomlabs.io.evil.com/firmware/stable/a.bin", p));
  CHECK(!url_allowed("https://evil.com/firmware/stable/a.bin", p));
  CHECK(!url_allowed(p + "../../x.bin", p));
  CHECK(!url_allowed(p + "a.bin?x=1", p));
  CHECK(!url_allowed(p + "a.bin#x", p));
  CHECK(!url_allowed(p + "a@b.bin", p));
  CHECK(!url_allowed(p + "a//b.bin", p));
  CHECK(!url_allowed(p + "a%2e%2e.bin", p));
  CHECK(!url_allowed("https://shroomlabs.io/firmware/stable/a.bin", "http://shroomlabs.io/firmware/stable/"));

  CHECK(is_sha256_hex(std::string(64, 'a')));
  CHECK(!is_sha256_hex(std::string(64, 'A')));
  CHECK(!is_sha256_hex(std::string(63, 'a')));

  uint8_t buf[8];
  size_t n = 0;
  CHECK(base64_decode("aGk=", buf, sizeof(buf), &n) && n == 2 && buf[0] == 'h' && buf[1] == 'i');
  CHECK(!base64_decode("aGk", buf, sizeof(buf), &n));
  CHECK(!base64_decode("a=Gk", buf, sizeof(buf), &n));
  CHECK(!base64_decode("aGk*", buf, sizeof(buf), &n));
  CHECK(!base64_decode("AAAAAAAAAAAA", buf, sizeof(buf), &n));  // 9 bytes > cap

  CHECK(signed_message("openshrooly", "stable", "1.0.3-sl.1", 10, std::string(64, 'a'), p + "x.bin") ==
        "openshrooly-release-v1\nproduct=openshrooly\nchannel=stable\nversion=1.0.3-sl.1\nsize=10\nsha256=" +
            std::string(64, 'a') + "\nurl=" + p + "x.bin\n");

  // RFC 8032 section 7.1, test 1 (empty message).
  uint8_t pub[32];
  hex32("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a", pub);
  const std::string sig =
      "5VZDAMNgrHKQhuLMgG6CioSHfx645dl02HPgZSJJAVVfuIIVkKM7rMYeOXAc+bRr0lv18FlbviRlUUFDjnoQCw==";
  CHECK(signature_valid(pub, "", sig));
  CHECK(!signature_valid(pub, "x", sig));
  pub[0] ^= 1;
  CHECK(!signature_valid(pub, "", sig));

  // Signature block on files installed from the chamber page.
  auto block = [](const std::string &text) {
    std::string b(LAN_TRAILER_SIZE, '\0');
    b.replace(0, text.size(), text);
    b.replace(LAN_TRAILER_SIZE - 8, 8, "OSSIGNv1");
    return b;
  };
  auto parse = [](const std::string &b, LanTrailer *t) {
    return parse_lan_trailer(reinterpret_cast<const uint8_t *>(b.data()), b.size(), t);
  };
  LanTrailer t;
  const std::string good = "channel=stable\nversion=1.0.3-sl.2\nurl=" + p + "x.ota.bin\nsig=AAAA\n";
  CHECK(parse(block(good), &t) && t.channel == "stable" && t.version == "1.0.3-sl.2" && t.signature == "AAAA");
  std::string bad = block(good);
  bad[LAN_TRAILER_SIZE - 1] = '2';
  CHECK(!parse(bad, &t));                                          // wrong magic
  bad = block(good);
  bad[good.size() + 4] = 'x';
  CHECK(!parse(bad, &t));                                          // junk after the text
  CHECK(!parse(block(good).substr(1), &t));                        // wrong length
  CHECK(!parse(block("version=1\nchannel=stable\nurl=u\nsig=s\n"), &t));  // wrong order
  CHECK(!parse(block("channel=\nversion=1\nurl=u\nsig=s\n"), &t));        // empty value
  CHECK(!parse(block("channel=a b\nversion=1\nurl=u\nsig=s\n"), &t));     // space
  CHECK(!parse(block("channel=a\nversion=1\nurl=u\nsig=s"), &t));          // no final newline
  CHECK(!parse(block(good + "x=1\n"), &t));                       // extra field
  CHECK(!parse(block(""), &t));                                    // unsigned
  CHECK(!parse(std::string(LAN_TRAILER_SIZE, '\0'), &t));
}

int main(int argc, char **argv) {
  if (argc == 5 && std::string(argv[1]) == "lan") {
    // lan mode: <pub hex> <file> <sha256 hex of all but the last 512 bytes>
    uint8_t pub[32];
    if (!hex32(argv[2], pub))
      return 2;
    FILE *f = std::fopen(argv[3], "rb");
    if (!f)
      return 2;
    std::string data;
    char b[4096];
    size_t r;
    while ((r = std::fread(b, 1, sizeof(b), f)) > 0)
      data.append(b, r);
    std::fclose(f);
    if (data.size() <= LAN_TRAILER_SIZE)
      return 1;
    const size_t image = data.size() - LAN_TRAILER_SIZE;
    std::string version;
    return lan_image_valid(pub, "openshrooly", "stable", "https://shroomlabs.io/firmware/stable/",
                           reinterpret_cast<const uint8_t *>(data.data()) + image, LAN_TRAILER_SIZE, image, argv[4],
                           &version)
               ? 0
               : 1;
  }
  if (argc == 4) {
    // verify mode: <pub hex> <message file> <signature base64>
    uint8_t pub[32];
    if (!hex32(argv[1], pub))
      return 2;
    FILE *f = std::fopen(argv[2], "rb");
    if (!f)
      return 2;
    std::string msg;
    char b[4096];
    size_t r;
    while ((r = std::fread(b, 1, sizeof(b), f)) > 0)
      msg.append(b, r);
    std::fclose(f);
    return signature_valid(pub, msg, argv[3]) ? 0 : 1;
  }
  unit_tests();
  if (failures) {
    std::fprintf(stderr, "%d failure(s)\n", failures);
    return 1;
  }
  std::printf("update_logic unit tests passed\n");
  return 0;
}
