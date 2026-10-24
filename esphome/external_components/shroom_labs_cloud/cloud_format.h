#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

namespace esphome {
namespace shroom_labs {

static constexpr const char *PROOF_VERSION = "shroomlabs-device-pop-v1";
static constexpr const char *DEFAULT_API_HOST = "api.shroomlabs.io";
static constexpr const char *DEFAULT_SITE = "https://shroomlabs.io";
static constexpr const char *CLAIM_PATH = "/claim.html?code=";
static constexpr uint32_t CLAIM_MS = 15 * 60 * 1000;
static constexpr uint32_t NONCE_MS = 2 * 60 * 1000;
static constexpr int64_t ROTATE_AFTER_MS = 302400000;  // 3.5 days, Worker contract
static constexpr size_t MAX_CSR_PEM = 4096;
static constexpr size_t MAX_DEVICE_BODY = 16 * 1024;

enum class CloudState : uint8_t {
  Off = 0,
  Connecting,
  PendingClaim,
  Issuing,
  Linked,
  Rotating,
  Revoked,
  Error,
};

enum class CloudEvent : uint8_t {
  Enable,
  Disable,
  EnrollOk,
  EnrollOwned,
  EnrollFail,
  CsrWaiting,  // 403: not claimed yet
  CsrOk,
  CsrAuthFail,  // 401
  CsrFail,
  RateLimited,
  RotateDue,
  RotateOk,
  LinkAuthFail,  // 401 on rotate or inbox probe
  ReclaimOk,
  ReclaimFail,
  Refresh,
  Expired,
};

const char *state_name(CloudState state);
const char *state_message(CloudState state);
CloudState next_state(CloudState state, CloudEvent event);

std::string base64_encode(const uint8_t *data, size_t len);
std::string base64url_encode(const uint8_t *data, size_t len);
bool base64url_decode(const char *text, uint8_t *out, size_t out_len);
std::string hex_encode(const uint8_t *data, size_t len);
void hex_encode_to(const uint8_t *data, size_t len, char *out);  // 2*len + NUL

std::string jwk_json(const uint8_t x[32], const uint8_t y[32]);
std::string pem_wrap(const uint8_t *der, size_t len, const char *label);
std::string claim_url_for(const char *site, const char *code);
bool claim_url_ok(const char *url, const char *code);
bool claim_code_ok(const char *code);
std::string format_claim_code(const char *code);  // "AB2C3D" as received, uppercased

// Worker PoP: SHA-256 of the body is lowercase hex, not base64url (docs/DEVICES.md is wrong here).
std::string proof_payload(const char *device_id, const char *nonce, const char *method, const char *path,
                          const char *body_sha256_hex);

std::string enroll_body_json(const char *hardware_id, const char *jwk, const char *name);
std::string csr_body_json(const char *csr_pem, const char *enroll_token);
std::string rotate_body_json(const char *csr_pem);
std::string reclaim_body_json(const char *jwk);

bool json_get_string(const char *json, const char *key, std::string *out);
bool json_get_int64(const char *json, const char *key, int64_t *out);

// PKCS#10 for P-256 + ecdsa-with-SHA256. sign() must write raw 64-byte r||s over SHA-256(info).
using SignSha256 = bool (*)(const uint8_t *data, size_t len, uint8_t sig_raw[64], void *ctx);
bool build_p256_csr_pem(const uint8_t x[32], const uint8_t y[32], const char *cn, SignSha256 sign, void *ctx,
                        std::string *pem);

void ecdsa_raw_to_der(const uint8_t raw[64], uint8_t *der, size_t *der_len);

int64_t parse_iso8601_ms(const char *iso);
std::string https_url(const char *host, const char *path);
bool api_url_allowed(const char *url, const char *host);

}  // namespace shroom_labs
}  // namespace esphome
