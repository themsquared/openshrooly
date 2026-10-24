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

struct HttpResponse {
  bool ok = false;
  int status = 0;
  std::string body;
  int retry_after_s = 0;
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

/** Append one chunk. False if this would pass max (body is left unchanged then). */
bool append_body(std::string *out, const char *data, int len, size_t max);

using BodyReadFn = int (*)(void *ctx, char *buf, int max);

/** Read until EOF (0), error (<0), or max. False on error or overflow. */
bool read_capped_body(BodyReadFn read, void *ctx, size_t max, std::string *out);

int parse_retry_after(const char *value);

enum class HttpOutcome : uint8_t {
  Success = 0,
  WaitingClaim,
  RateLimited,
  AuthFail,
  AlreadyOwned,
  TransientFail,
  HardFail,
};

HttpOutcome enroll_outcome(bool transport_ok, int status);
HttpOutcome csr_outcome(bool transport_ok, int status);
HttpOutcome rotate_outcome(bool transport_ok, int status);
HttpOutcome reclaim_outcome(bool transport_ok, int status);
HttpOutcome probe_outcome(bool transport_ok, int status);

CloudEvent event_for_enroll(HttpOutcome o);
CloudEvent event_for_csr(HttpOutcome o);
CloudEvent event_for_rotate(HttpOutcome o);
CloudEvent event_for_reclaim(HttpOutcome o);
CloudEvent event_for_probe(HttpOutcome o);

uint32_t next_backoff_ms(uint32_t current_ms, uint32_t jitter);
uint32_t retry_after_backoff_ms(int retry_after_s, uint32_t current_ms, uint32_t jitter);

CloudState persist_state(CloudState state);
bool state_has_retry(CloudState state);
bool should_auto_enroll(uint8_t claim_cycles);
bool rotate_allowed(uint8_t attempts_this_hour);

void secure_clear(void *p, size_t n);

}  // namespace shroom_labs
}  // namespace esphome
