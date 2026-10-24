#pragma once

#include "cloud_format.h"

#include <cstddef>
#include <cstdint>
#include <string>
#include <utility>
#include <vector>

namespace esphome {
namespace shroom_labs {

static constexpr uint32_t BACKOFF_MIN_MS = 20000;
static constexpr uint32_t BACKOFF_MAX_MS = 300000;
static constexpr uint8_t MAX_CLAIM_CYCLES = 4;
static constexpr uint8_t MAX_ROTATE_PER_HOUR = 8;
static constexpr uint32_t ROTATE_HOUR_MS = 3600000;
static constexpr uint32_t CLAIM_POLL_MS = 5000;
static constexpr uint32_t CLAIM_POLL_JITTER_MS = 1500;
static constexpr uint32_t RELINK_CONFIRM_MS = 3600u * 1000u;
static constexpr uint32_t RELINK_WINDOW_MS = 24u * 3600u * 1000u;
static constexpr uint32_t MAGIC = 0x53484c34;  // SHL4
static constexpr int64_t CERT_GRACE_MS = 30LL * 24 * 3600 * 1000;

inline bool time_reached(uint32_t now, uint32_t deadline) {
  return static_cast<int32_t>(now - deadline) >= 0;
}

struct HttpResponse {
  bool ok = false;
  int status = 0;
  std::string body;
  int retry_after_s = 0;
  bool complete = true;
};

struct HttpRequest {
  const char *method = "POST";
  std::string url;
  std::string body;
  std::vector<std::pair<std::string, std::string>> headers;
};

class CloudTransport {
 public:
  virtual ~CloudTransport() = default;
  virtual HttpResponse execute(const HttpRequest &req) = 0;
};

class CloudClock {
 public:
  virtual ~CloudClock() = default;
  virtual uint32_t now_ms() = 0;
  virtual int64_t wall_ms() = 0;
  virtual uint32_t random() = 0;
};

struct SavedIdentity {
  uint32_t magic;
  uint8_t d[32];
  uint8_t x[32];
  uint8_t y[32];
  char device_id[40];
  char enroll_token[96];
  char claim_code[8];
  char claim_url[160];
  char claim_expires[32];
  char serial[48];
  char fingerprint[80];
  char not_after[32];
  int64_t rotate_after_ms;
  int64_t issued_ms;
  uint32_t claim_deadline_mono;
  uint8_t claim_cycles;
  uint8_t state;
  uint8_t enabled;
  uint8_t has_key;
  uint8_t has_cert;
} __attribute__((packed));

class CloudStore {
 public:
  virtual ~CloudStore() = default;
  virtual bool load(SavedIdentity *id, std::string *pem) = 0;
  virtual bool save_identity(const SavedIdentity &id) = 0;
  virtual bool save_cert(const std::string &pem) = 0;
  virtual bool erase_all() = 0;
};

class CloudCrypto {
 public:
  virtual ~CloudCrypto() = default;
  virtual bool ensure_key(uint8_t priv[32], uint8_t x[32], uint8_t y[32]) = 0;
  virtual bool sign(const uint8_t priv[32], const uint8_t *data, size_t len, uint8_t sig[64]) = 0;
  virtual bool make_csr(const uint8_t priv[32], const uint8_t x[32], const uint8_t y[32], const char *cn,
                        std::string *pem) = 0;
  virtual bool sha256(const uint8_t *data, size_t len, uint8_t out[32]) = 0;
  virtual std::string hardware_id() = 0;
};

/** Append one chunk. False if this would pass max (body is left unchanged then). */
bool append_body(std::string *out, const char *data, int len, size_t max);

using BodyReadFn = int (*)(void *ctx, char *buf, int max);

/** Read until EOF (0), error (<0), or max. False on error or overflow. */
bool read_capped_body(BodyReadFn read, void *ctx, size_t max, std::string *out);

int parse_retry_after(const char *value);

/** False when headers failed, status is missing, or the body was cut off. */
bool response_usable(const HttpResponse &r);

/** Adapter rule for fetch_headers + complete-body. */
bool idf_headers_ok(int64_t fetch_headers_len, int status);

std::string json_code(const char *body);

enum class HttpOutcome : uint8_t {
  Success = 0,
  WaitingClaim,
  RateLimited,
  AuthFail,
  AlreadyOwned,
  ClaimBusy,
  TransientFail,
  HardFail,
  CertExpired,
  ProofInvalid,
  RelinkRequired,
};

HttpOutcome enroll_outcome(bool transport_ok, int status, const char *body = nullptr);
HttpOutcome csr_outcome(bool transport_ok, int status, const char *body = nullptr);
HttpOutcome rotate_outcome(bool transport_ok, int status, const char *body = nullptr);
HttpOutcome reclaim_outcome(bool transport_ok, int status, const char *body = nullptr);
HttpOutcome probe_outcome(bool transport_ok, int status, const char *body = nullptr);

CloudEvent event_for_enroll(HttpOutcome o);
CloudEvent event_for_csr(HttpOutcome o);
CloudEvent event_for_rotate(HttpOutcome o);
CloudEvent event_for_reclaim(HttpOutcome o);
CloudEvent event_for_probe(HttpOutcome o);

uint32_t next_backoff_ms(uint32_t current_ms, uint32_t jitter);
uint32_t retry_after_backoff_ms(int retry_after_s, uint32_t current_ms, uint32_t jitter);
uint32_t claim_poll_ms(uint32_t jitter);

CloudState persist_state(CloudState state);
bool state_has_retry(CloudState state);
bool should_auto_enroll(uint8_t claim_cycles);
bool rotate_allowed(uint8_t attempts_this_hour);
bool enroll_fields_ok(const char *body);
bool cert_fields_ok(const char *body);

void secure_clear(void *p, size_t n);

}  // namespace shroom_labs
}  // namespace esphome
