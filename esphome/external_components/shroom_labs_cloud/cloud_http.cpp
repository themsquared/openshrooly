#include "cloud_http.h"

#include <cstdlib>
#include <cstring>

namespace esphome {
namespace shroom_labs {

bool append_body(std::string *out, const char *data, int len, size_t max) {
  if (out == nullptr)
    return false;
  if (len < 0)
    return false;
  if (len == 0)
    return true;
  if (data == nullptr)
    return false;
  if (out->size() + static_cast<size_t>(len) > max)
    return false;
  out->append(data, static_cast<size_t>(len));
  return true;
}

bool read_capped_body(BodyReadFn read, void *ctx, size_t max, std::string *out) {
  if (read == nullptr || out == nullptr)
    return false;
  out->clear();
  char buf[256];
  for (;;) {
    int n = read(ctx, buf, static_cast<int>(sizeof(buf)));
    if (n < 0)
      return false;
    if (n == 0)
      return true;
    if (!append_body(out, buf, n, max))
      return false;
  }
}

int parse_retry_after(const char *value) {
  if (value == nullptr || !value[0])
    return 0;
  char *end = nullptr;
  long v = std::strtol(value, &end, 10);
  if (end == value || v <= 0 || v > 86400)
    return 0;
  return static_cast<int>(v);
}

static bool server_error(int status) { return status >= 500 && status <= 599; }

HttpOutcome enroll_outcome(bool transport_ok, int status) {
  if (!transport_ok || server_error(status))
    return HttpOutcome::TransientFail;
  if (status == 200)
    return HttpOutcome::Success;
  if (status == 409)
    return HttpOutcome::AlreadyOwned;
  if (status == 429)
    return HttpOutcome::RateLimited;
  return HttpOutcome::HardFail;
}

HttpOutcome csr_outcome(bool transport_ok, int status) {
  if (!transport_ok || server_error(status))
    return HttpOutcome::TransientFail;
  if (status == 200)
    return HttpOutcome::Success;
  if (status == 403)
    return HttpOutcome::WaitingClaim;
  if (status == 429)
    return HttpOutcome::RateLimited;
  if (status == 401)
    return HttpOutcome::AuthFail;
  return HttpOutcome::HardFail;
}

HttpOutcome rotate_outcome(bool transport_ok, int status) {
  if (!transport_ok || server_error(status))
    return HttpOutcome::TransientFail;
  if (status == 200)
    return HttpOutcome::Success;
  if (status == 429)
    return HttpOutcome::RateLimited;
  if (status == 401)
    return HttpOutcome::AuthFail;
  return HttpOutcome::HardFail;
}

HttpOutcome reclaim_outcome(bool transport_ok, int status) {
  if (!transport_ok || server_error(status))
    return HttpOutcome::TransientFail;
  if (status == 200)
    return HttpOutcome::Success;
  if (status == 429)
    return HttpOutcome::RateLimited;
  if (status == 401)
    return HttpOutcome::AuthFail;
  return HttpOutcome::HardFail;
}

HttpOutcome probe_outcome(bool transport_ok, int status) {
  if (!transport_ok || server_error(status))
    return HttpOutcome::TransientFail;
  if (status == 200)
    return HttpOutcome::Success;
  if (status == 401)
    return HttpOutcome::AuthFail;
  if (status == 429)
    return HttpOutcome::RateLimited;
  return HttpOutcome::HardFail;
}

CloudEvent event_for_enroll(HttpOutcome o) {
  switch (o) {
    case HttpOutcome::Success:
      return CloudEvent::EnrollOk;
    case HttpOutcome::AlreadyOwned:
      return CloudEvent::EnrollOwned;
    case HttpOutcome::RateLimited:
      return CloudEvent::RateLimited;
    case HttpOutcome::TransientFail:
      return CloudEvent::NetworkFail;
    default:
      return CloudEvent::EnrollFail;
  }
}

CloudEvent event_for_csr(HttpOutcome o) {
  switch (o) {
    case HttpOutcome::Success:
      return CloudEvent::CsrOk;
    case HttpOutcome::WaitingClaim:
      return CloudEvent::CsrWaiting;
    case HttpOutcome::RateLimited:
      return CloudEvent::RateLimited;
    case HttpOutcome::AuthFail:
      return CloudEvent::CsrAuthFail;
    case HttpOutcome::TransientFail:
      return CloudEvent::NetworkFail;
    default:
      return CloudEvent::CsrFail;
  }
}

CloudEvent event_for_rotate(HttpOutcome o) {
  switch (o) {
    case HttpOutcome::Success:
      return CloudEvent::RotateOk;
    case HttpOutcome::AuthFail:
      return CloudEvent::LinkAuthFail;
    case HttpOutcome::RateLimited:
      return CloudEvent::RateLimited;
    case HttpOutcome::TransientFail:
      return CloudEvent::NetworkFail;
    default:
      return CloudEvent::CsrFail;
  }
}

CloudEvent event_for_reclaim(HttpOutcome o) {
  switch (o) {
    case HttpOutcome::Success:
      return CloudEvent::ReclaimOk;
    case HttpOutcome::RateLimited:
    case HttpOutcome::TransientFail:
      return CloudEvent::NetworkFail;
    default:
      return CloudEvent::ReclaimFail;
  }
}

CloudEvent event_for_probe(HttpOutcome o) {
  switch (o) {
    case HttpOutcome::AuthFail:
      return CloudEvent::LinkAuthFail;
    default:
      return CloudEvent::NetworkFail;
  }
}

uint32_t next_backoff_ms(uint32_t current_ms, uint32_t jitter) {
  uint32_t n = current_ms < BACKOFF_MIN_MS ? BACKOFF_MIN_MS : current_ms;
  if (n > BACKOFF_MAX_MS / 2)
    n = BACKOFF_MAX_MS;
  else
    n *= 2;
  if (n > BACKOFF_MAX_MS)
    n = BACKOFF_MAX_MS;
  const uint32_t span = n / 5 + 1;
  return n - span / 2 + (jitter % span);
}

uint32_t retry_after_backoff_ms(int retry_after_s, uint32_t current_ms, uint32_t jitter) {
  uint32_t from_header = 0;
  if (retry_after_s > 0)
    from_header = static_cast<uint32_t>(retry_after_s) * 1000;
  uint32_t exp = next_backoff_ms(current_ms, jitter);
  return from_header > exp ? from_header : exp;
}

CloudState persist_state(CloudState state) {
  switch (state) {
    case CloudState::Rotating:
      return CloudState::Linked;
    case CloudState::Issuing:
      return CloudState::PendingClaim;
    case CloudState::Connecting:
      return CloudState::Connecting;
    default:
      return state;
  }
}

bool state_has_retry(CloudState state) {
  return state == CloudState::Connecting || state == CloudState::PendingClaim || state == CloudState::Issuing ||
         state == CloudState::Error || state == CloudState::Rotating || state == CloudState::Linked;
}

bool should_auto_enroll(uint8_t claim_cycles) { return claim_cycles < MAX_CLAIM_CYCLES; }

bool rotate_allowed(uint8_t attempts_this_hour) { return attempts_this_hour < MAX_ROTATE_PER_HOUR; }

void secure_clear(void *p, size_t n) {
  if (p == nullptr || n == 0)
    return;
  volatile uint8_t *v = static_cast<volatile uint8_t *>(p);
  while (n--)
    *v++ = 0;
}

}  // namespace shroom_labs
}  // namespace esphome
