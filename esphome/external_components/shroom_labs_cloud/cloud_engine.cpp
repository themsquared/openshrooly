#include "cloud_engine.h"

#ifdef USE_ESP32
#include "esphome/core/log.h"
static const char *const TAG = "shroom_labs_cloud";
#else
#define ESP_LOGI(...)
#define ESP_LOGW(...)
#define ESP_LOGD(...)
#endif

#include <cmath>
#include <cstdio>
#include <cstring>

namespace esphome {
namespace shroom_labs {

void CloudEngine::load() {
  SavedIdentity s{};
  std::string pem;
  if (store_ == nullptr || !store_->load(&s, &pem) || s.magic != MAGIC) {
    secure_clear(&s, sizeof(s));
    return;
  }
  if (s.has_key) {
    std::memcpy(priv_, s.d, 32);
    std::memcpy(pub_x_, s.x, 32);
    std::memcpy(pub_y_, s.y, 32);
    has_key_ = true;
  }
  device_id_ = s.device_id;
  enroll_token_ = s.enroll_token;
  claim_code_ = s.claim_code;
  claim_url_ = s.claim_url;
  claim_expires_ = s.claim_expires;
  serial_ = s.serial;
  fingerprint_ = s.fingerprint;
  not_after_ = s.not_after;
  rotate_after_ms_ = s.rotate_after_ms ? s.rotate_after_ms : ROTATE_AFTER_MS;
  issued_ms_ = s.issued_ms;
  claim_cycles_ = s.claim_cycles;
  cert_pem_ = pem;
  has_cert_ = s.has_cert && !cert_pem_.empty() && !serial_.empty();
  cloud_enabled_ = s.enabled != 0;
  state_ = persist_state(static_cast<CloudState>(s.state));
  if (!cloud_enabled_ && state_ != CloudState::Relink)
    state_ = CloudState::Off;
  if (state_ == CloudState::PendingClaim) {
    const int64_t exp = parse_iso8601_ms(claim_expires_.c_str());
    const int64_t wall = wall_();
    if (exp > 0 && wall > 0 && exp > wall) {
      claim_deadline_mono_ = now_() + static_cast<uint32_t>(exp - wall);
    } else {
      claim_code_.clear();
      claim_url_.clear();
      claim_expires_.clear();
      claim_deadline_mono_ = 0;
      apply_(CloudEvent::Expired);
    }
  }
  secure_clear(&s, sizeof(s));
}

void CloudEngine::save_identity_() {
  SavedIdentity s{};
  s.magic = MAGIC;
  if (has_key_) {
    std::memcpy(s.d, priv_, 32);
    std::memcpy(s.x, pub_x_, 32);
    std::memcpy(s.y, pub_y_, 32);
    s.has_key = 1;
  }
  std::snprintf(s.device_id, sizeof(s.device_id), "%s", device_id_.c_str());
  std::snprintf(s.enroll_token, sizeof(s.enroll_token), "%s", enroll_token_.c_str());
  std::snprintf(s.claim_code, sizeof(s.claim_code), "%s", claim_code_.c_str());
  std::snprintf(s.claim_url, sizeof(s.claim_url), "%s", claim_url_.c_str());
  std::snprintf(s.claim_expires, sizeof(s.claim_expires), "%s", claim_expires_.c_str());
  std::snprintf(s.serial, sizeof(s.serial), "%s", serial_.c_str());
  std::snprintf(s.fingerprint, sizeof(s.fingerprint), "%s", fingerprint_.c_str());
  std::snprintf(s.not_after, sizeof(s.not_after), "%s", not_after_.c_str());
  s.rotate_after_ms = rotate_after_ms_;
  s.issued_ms = issued_ms_;
  s.claim_deadline_mono = claim_deadline_mono_;
  s.claim_cycles = claim_cycles_;
  s.state = static_cast<uint8_t>(persist_state(state_));
  s.enabled = cloud_enabled_ ? 1 : 0;
  s.has_cert = has_cert_ ? 1 : 0;
  if (store_)
    store_->save_identity(s);
  secure_clear(&s, sizeof(s));
}

void CloudEngine::save_cert_(const std::string &pem) {
  cert_pem_ = pem;
  has_cert_ = !pem.empty();
  if (store_)
    store_->save_cert(pem);
  save_identity_();
}

void CloudEngine::clear_cert_() {
  serial_.clear();
  fingerprint_.clear();
  not_after_.clear();
  issued_ms_ = 0;
  save_cert_("");
}

void CloudEngine::zero_key_() {
  secure_clear(priv_, sizeof(priv_));
  secure_clear(pub_x_, sizeof(pub_x_));
  secure_clear(pub_y_, sizeof(pub_y_));
  has_key_ = false;
}

void CloudEngine::relink_() {
  if (!enroll_token_.empty())
    secure_clear(&enroll_token_[0], enroll_token_.size());
  enroll_token_.clear();
  claim_code_.clear();
  claim_url_.clear();
  claim_expires_.clear();
  claim_deadline_mono_ = 0;
  cert_pem_.clear();
  serial_.clear();
  fingerprint_.clear();
  not_after_.clear();
  has_cert_ = false;
  issued_ms_ = 0;
  cloud_enabled_ = true;
  state_ = CloudState::Relink;
  if (store_)
    store_->save_cert("");
  save_identity_();
}

void CloudEngine::wipe_() {
  zero_key_();
  device_id_.clear();
  if (!enroll_token_.empty())
    secure_clear(&enroll_token_[0], enroll_token_.size());
  enroll_token_.clear();
  claim_code_.clear();
  claim_url_.clear();
  claim_expires_.clear();
  claim_deadline_mono_ = 0;
  claim_cycles_ = 0;
  cert_pem_.clear();
  serial_.clear();
  fingerprint_.clear();
  not_after_.clear();
  has_cert_ = false;
  issued_ms_ = 0;
  cloud_enabled_ = false;
  state_ = CloudState::Off;
  reset_relink_();
  if (store_)
    store_->erase_all();
}

CloudEngine::JobSnap CloudEngine::snap_() const {
  JobSnap s;
  s.device_id = device_id_;
  s.enroll_token = enroll_token_;
  s.serial = serial_;
  if (has_key_) {
    std::memcpy(s.pub_x, pub_x_, 32);
    std::memcpy(s.pub_y, pub_y_, 32);
    std::memcpy(s.priv, priv_, 32);
    s.has_key = true;
  }
  s.has_cert = has_cert_;
  return s;
}

void CloudEngine::apply_(CloudEvent event) {
  CloudState next = next_state(state_, event);
  if (next != state_) {
    ESP_LOGI(TAG, "Cloud state %s -> %s", state_name(state_), state_name(next));
    state_ = persist_state(next);
    save_identity_();
  } else if (event == CloudEvent::Disable) {
    state_ = CloudState::Off;
    save_identity_();
  }
}

void CloudEngine::bump_backoff_(int retry_after_s) {
  backoff_ms_ = retry_after_backoff_ms(retry_after_s, backoff_ms_, clock_->random());
  const uint32_t when = now_() + backoff_ms_;
  next_retry_ms_ = when;
  next_csr_ms_ = when;
  next_rotate_ms_ = when;
}

void CloudEngine::schedule_probe_error_(int retry_after_s) {
  bump_backoff_(retry_after_s);
  const uint32_t wait = backoff_ms_ > PROBE_INTERVAL_MS ? backoff_ms_ : PROBE_INTERVAL_MS;
  next_probe_ms_ = now_() + wait;
}

void CloudEngine::schedule_telemetry_error_(int retry_after_s) {
  bump_backoff_(retry_after_s);
  const uint32_t wait = backoff_ms_ > TELEMETRY_INTERVAL_MS ? backoff_ms_ : TELEMETRY_INTERVAL_MS;
  next_telemetry_ms_ = now_() + wait;
}

void CloudEngine::note_connect_() {
  const uint32_t now = now_();
  uint8_t kept = 0;
  for (uint8_t i = 0; i < connect_n_ && i < CONNECT_HOUR_RING; i++) {
    if (!time_reached(now, connect_times_[i] + CONNECT_HOUR_MS))
      connect_times_[kept++] = connect_times_[i];
  }
  connect_n_ = kept;
  if (connect_n_ < CONNECT_HOUR_RING)
    connect_times_[connect_n_++] = now;
  request_count_++;
}

bool CloudEngine::allow_connect_() {
  const uint32_t now = now_();
  uint8_t n = 0;
  for (uint8_t i = 0; i < connect_n_ && i < CONNECT_HOUR_RING; i++) {
    if (!time_reached(now, connect_times_[i] + CONNECT_HOUR_MS))
      n++;
  }
  return n < CONNECT_HOUR_CAP;
}

void CloudEngine::set_claim_poll_() { next_csr_ms_ = now_() + claim_poll_ms(clock_->random()); }

bool CloudEngine::rotate_slot_open_() {
  const uint32_t now = now_();
  if (rotate_hour_start_ms_ == 0 || time_reached(now, rotate_hour_start_ms_ + ROTATE_HOUR_MS)) {
    rotate_hour_start_ms_ = now;
    rotate_attempts_hour_ = 0;
  }
  return rotate_allowed(rotate_attempts_hour_);
}

bool CloudEngine::try_begin(CloudJob job) {
  if (busy_.exchange(true))
    return false;
  job_ = job;
  return true;
}

void CloudEngine::finish() {
  job_ = CloudJob::NONE;
  busy_ = false;
}

void CloudEngine::drain_queued_() {
  if (pending_wipe_) {
    CloudJob after = queued_;
    queued_ = CloudJob::NONE;
    if (!try_begin(CloudJob::REVOKE)) {
      queued_ = after;
      return;
    }
    handle_revoke_();
    finish();
    if (after != CloudJob::NONE && after != CloudJob::REVOKE)
      queue_(after);
    return;
  }
  CloudJob next = queued_;
  queued_ = CloudJob::NONE;
  if (next != CloudJob::NONE)
    queue_(next);
}

bool CloudEngine::queue_(CloudJob job) {
  if (job == CloudJob::ENROLL) {
    std::lock_guard<std::mutex> g(lock_);
    if (state_ == CloudState::Off) {
      cloud_enabled_ = true;
      apply_(CloudEvent::Enable);
    }
  }
  if (start_job_ != nullptr) {
    if (start_job_(start_ctx_, job))
      return true;
    if (job != CloudJob::REVOKE)
      queued_ = job;
    return false;
  }
  if (!try_begin(job)) {
    if (job != CloudJob::REVOKE)
      queued_ = job;
    return false;
  }
  if (sync_jobs_) {
    run_job(job);
    finish();
    drain_queued_();
    return true;
  }
  finish();
  return false;
}

bool CloudEngine::run_job(CloudJob job) {
  bool ok = false;
  switch (job) {
    case CloudJob::ENROLL:
      ok = handle_enroll_();
      break;
    case CloudJob::CSR:
      ok = handle_csr_();
      break;
    case CloudJob::ROTATE:
      ok = handle_rotate_();
      break;
    case CloudJob::RECLAIM:
      ok = handle_reclaim_();
      break;
    case CloudJob::PROBE:
      ok = handle_probe_();
      break;
    case CloudJob::TELEMETRY:
      ok = handle_telemetry_();
      break;
    case CloudJob::REVOKE:
      ok = handle_revoke_();
      break;
    default:
      break;
  }
  if (pending_wipe_.exchange(false) && job != CloudJob::REVOKE)
    handle_revoke_();
  return ok;
}

bool CloudEngine::enroll_now() { return handle_enroll_(); }
bool CloudEngine::csr_now() { return handle_csr_(); }
bool CloudEngine::rotate_now() { return handle_rotate_(); }
bool CloudEngine::reclaim_now() { return handle_reclaim_(); }
bool CloudEngine::probe_now() { return handle_probe_(); }
bool CloudEngine::revoke_now() { return handle_revoke_(); }

void CloudEngine::connect() {
  CloudJob job = CloudJob::ENROLL;
  {
    std::lock_guard<std::mutex> g(lock_);
    cloud_enabled_ = true;
    claim_cycles_ = 0;
    backoff_ms_ = BACKOFF_MIN_MS;
    show_claim_ = true;
    revoke_failed_ = false;
    if (pending_wipe_ || job_ == CloudJob::REVOKE) {
      queued_ = CloudJob::ENROLL;
      save_identity_();
      return;
    }
    if (state_ == CloudState::Linked) {
      save_identity_();
      return;
    }
    apply_(CloudEvent::Enable);
    job = CloudJob::ENROLL;
    next_retry_ms_ = now_() + backoff_ms_;
    save_identity_();
  }
  queue_(job);
}

void CloudEngine::disconnect() {
  {
    std::lock_guard<std::mutex> g(lock_);
    pending_wipe_ = true;
    queued_ = CloudJob::NONE;
    claim_code_.clear();
    claim_url_.clear();
    claim_expires_.clear();
    claim_deadline_mono_ = 0;
  }
  if (sync_jobs_ && start_job_ == nullptr) {
    if (!try_begin(CloudJob::REVOKE))
      return;
    handle_revoke_();
    finish();
    drain_queued_();
    return;
  }
  queue_(CloudJob::REVOKE);
}

void CloudEngine::refresh() {
  CloudJob job = CloudJob::ENROLL;
  {
    std::lock_guard<std::mutex> g(lock_);
    if (!cloud_enabled_)
      return;
    if (state_ == CloudState::Linked) {
      next_probe_ms_ = now_();
      job = CloudJob::PROBE;
    } else {
      claim_cycles_ = 0;
      backoff_ms_ = BACKOFF_MIN_MS;
      show_claim_ = true;
      apply_(CloudEvent::Refresh);
      job = CloudJob::ENROLL;
      next_retry_ms_ = now_() + backoff_ms_;
    }
  }
  queue_(job);
}

CloudState CloudEngine::state() const {
  std::lock_guard<std::mutex> g(lock_);
  return state_;
}
bool CloudEngine::cloud_enabled() const {
  std::lock_guard<std::mutex> g(lock_);
  return cloud_enabled_;
}
bool CloudEngine::linked() const {
  std::lock_guard<std::mutex> g(lock_);
  return state_ == CloudState::Linked && has_cert_;
}
bool CloudEngine::has_key() const {
  std::lock_guard<std::mutex> g(lock_);
  return has_key_;
}
bool CloudEngine::has_cert() const {
  std::lock_guard<std::mutex> g(lock_);
  return has_cert_;
}
std::string CloudEngine::device_id() const {
  std::lock_guard<std::mutex> g(lock_);
  return device_id_;
}
std::string CloudEngine::cert_pem() const {
  std::lock_guard<std::mutex> g(lock_);
  return cert_pem_;
}
uint8_t CloudEngine::claim_cycles() const {
  std::lock_guard<std::mutex> g(lock_);
  return claim_cycles_;
}
uint32_t CloudEngine::next_csr_ms() const {
  std::lock_guard<std::mutex> g(lock_);
  return next_csr_ms_;
}
uint32_t CloudEngine::next_rotate_ms() const {
  std::lock_guard<std::mutex> g(lock_);
  return next_rotate_ms_;
}
uint32_t CloudEngine::next_probe_ms() const {
  std::lock_guard<std::mutex> g(lock_);
  return next_probe_ms_;
}
uint32_t CloudEngine::next_telemetry_ms() const {
  std::lock_guard<std::mutex> g(lock_);
  return next_telemetry_ms_;
}
bool CloudEngine::take_show_claim() { return show_claim_.exchange(false); }

std::string CloudEngine::claim_code() const {
  std::lock_guard<std::mutex> g(lock_);
  return claim_code_;
}
std::string CloudEngine::claim_url() const {
  std::lock_guard<std::mutex> g(lock_);
  return claim_url_;
}

uint32_t CloudEngine::claim_seconds_left() const {
  std::lock_guard<std::mutex> g(lock_);
  if (claim_deadline_mono_ == 0)
    return 0;
  const uint32_t now = now_();
  if (time_reached(now, claim_deadline_mono_))
    return 0;
  return (claim_deadline_mono_ - now) / 1000;
}

std::string CloudEngine::display_title() const {
  if (pending_wipe_)
    return "Disconnecting...";
  switch (state()) {
    case CloudState::Linked:
      return "Linked";
    case CloudState::Revoked:
    case CloudState::Relink:
      return "Unlinked";
    case CloudState::Owned:
      return "Remove first";
    case CloudState::WaitClaim:
      return "Wait";
    case CloudState::Off:
      return "Cloud off";
    default:
      return "Claim";
  }
}

std::string CloudEngine::display_code() const {
  std::lock_guard<std::mutex> g(lock_);
  if (pending_wipe_)
    return "";
  if (state_ == CloudState::Linked)
    return "OK";
  if (state_ == CloudState::Off || state_ == CloudState::Owned || state_ == CloudState::WaitClaim ||
      state_ == CloudState::Relink)
    return "";
  if (claim_deadline_mono_ != 0 && time_reached(now_(), claim_deadline_mono_))
    return "";
  return format_claim_code(claim_code_.c_str());
}

std::string CloudEngine::display_hint() const {
  std::lock_guard<std::mutex> g(lock_);
  if (pending_wipe_)
    return "Disconnecting...";
  if (revoke_failed_ && state_ == CloudState::Off)
    return "Also remove it on shroomlabs.io if it still appears.";
  return state_message(state_);
}

std::string CloudEngine::display_expiry() const {
  if (pending_wipe_ || state() != CloudState::PendingClaim)
    return "";
  uint32_t s = claim_seconds_left();
  if (s == 0)
    return "Code expired. Press Refresh.";
  char buf[40];
  std::snprintf(buf, sizeof(buf), "Expires in %u min", static_cast<unsigned>((s + 59) / 60));
  return buf;
}

std::string CloudEngine::status_json() const {
  std::lock_guard<std::mutex> g(lock_);
  std::string url = claim_url_;
  if (url.empty() && !claim_code_.empty() && claim_deadline_mono_ != 0 && !time_reached(now_(), claim_deadline_mono_))
    url = claim_url_for(site_origin_.c_str(), claim_code_.c_str());
  const bool live = !pending_wipe_ && state_ == CloudState::PendingClaim && !claim_code_.empty() &&
                    (claim_deadline_mono_ == 0 || !time_reached(now_(), claim_deadline_mono_));
  uint32_t left = 0;
  if (live && claim_deadline_mono_ != 0 && !time_reached(now_(), claim_deadline_mono_))
    left = (claim_deadline_mono_ - now_()) / 1000;
  std::string out = "{";
  out += "\"enabled\":";
  out += cloud_enabled_ ? "true" : "false";
  out += ",\"state\":\"";
  out += pending_wipe_ ? "disconnecting" : state_name(state_);
  out += "\",\"linked\":";
  out += (!pending_wipe_ && state_ == CloudState::Linked && has_cert_) ? "true" : "false";
  out += ",\"claim_code\":\"";
  out += live ? format_claim_code(claim_code_.c_str()) : "";
  out += "\",\"claim_url\":\"";
  out += live ? url : "";
  out += "\",\"claim_expires_at\":\"";
  out += live ? claim_expires_ : "";
  out += "\",\"expires_in_s\":";
  out += std::to_string(left);
  out += ",\"remote_apply\":";
  out += remote_apply_ ? "true" : "false";
  out += ",\"message\":\"";
  if (pending_wipe_)
    out += "Disconnecting...";
  else if (revoke_failed_ && state_ == CloudState::Off)
    out += "Also remove it on shroomlabs.io if it still appears.";
  else
    out += state_message(state_);
  out += "\"}";
  return out;
}

bool CloudEngine::ensure_key_() {
  if (has_key_)
    return true;
  if (crypto_ == nullptr || !crypto_->ensure_key(priv_, pub_x_, pub_y_))
    return false;
  has_key_ = true;
  save_identity_();
  return true;
}

bool CloudEngine::sign_(const uint8_t *data, size_t len, uint8_t sig[64]) {
  uint8_t priv[32];
  {
    std::lock_guard<std::mutex> g(lock_);
    if (!has_key_)
      return false;
    std::memcpy(priv, priv_, 32);
  }
  const bool ok = crypto_ != nullptr && crypto_->sign(priv, data, len, sig);
  secure_clear(priv, sizeof(priv));
  return ok;
}

bool CloudEngine::make_csr_(std::string *pem) {
  if (!ensure_key_())
    return false;
  uint8_t priv[32], x[32], y[32];
  std::string cn;
  {
    std::lock_guard<std::mutex> g(lock_);
    std::memcpy(priv, priv_, 32);
    std::memcpy(x, pub_x_, 32);
    std::memcpy(y, pub_y_, 32);
    cn = device_id_.empty() ? "chamber" : device_id_;
  }
  const bool ok = crypto_ != nullptr && crypto_->make_csr(priv, x, y, cn.c_str(), pem);
  secure_clear(priv, sizeof(priv));
  return ok;
}

HttpResponse CloudEngine::http_(const char *method, const char *path, const std::string &body, bool pop,
                                bool with_serial, const char *query) {
  HttpResponse fail;
  fail.ok = false;
  if (transport_ == nullptr)
    return fail;
  if (!allow_connect_())
    return fail;
  std::string url = https_url(api_host_.c_str(), path);
  if (query != nullptr && query[0]) {
    url += '?';
    url += query[0] == '?' ? query + 1 : query;
  }
  if (!api_url_allowed(url.c_str(), api_host_.c_str()))
    return fail;
  JobSnap snap;
  {
    std::lock_guard<std::mutex> g(lock_);
    snap = snap_();
  }
  HttpRequest req;
  req.method = method;
  req.url = url;
  req.body = body;
  req.headers.emplace_back("Content-Type", "application/json");
  if (pop) {
    std::string nonce;
    std::string nonce_body;
    const int nonce_status = fetch_nonce_(&nonce, &nonce_body);
    if (nonce_status != 200) {
      fail.status = nonce_status;
      fail.body = nonce_body;
      return fail;
    }
    char body_hex[65];
    uint8_t digest[32];
    if (crypto_ == nullptr || !crypto_->sha256(reinterpret_cast<const uint8_t *>(body.data()), body.size(), digest))
      return fail;
    hex_encode_to(digest, 32, body_hex);
    std::string payload = proof_payload(snap.device_id.c_str(), nonce.c_str(), method, path, body_hex);
    uint8_t sig[64];
    if (!sign_(reinterpret_cast<const uint8_t *>(payload.data()), payload.size(), sig))
      return fail;
    req.headers.emplace_back("x-device-nonce", nonce);
    req.headers.emplace_back("x-device-proof", base64_encode(sig, 64));
    secure_clear(sig, sizeof(sig));
    secure_clear(digest, sizeof(digest));
  }
  if (with_serial && !snap.serial.empty())
    req.headers.emplace_back("x-device-cert-serial", snap.serial);
  if (!allow_connect_())
    return fail;
  note_connect_();
  HttpResponse r = transport_->execute(req);
  if (!response_usable(r)) {
    r.ok = false;
    return r;
  }
  return r;
}

int CloudEngine::fetch_nonce_(std::string *nonce, std::string *body) {
  std::string id;
  {
    std::lock_guard<std::mutex> g(lock_);
    id = device_id_;
  }
  if (id.empty())
    return 0;
  if (!allow_connect_())
    return 0;
  std::string path = "/api/devices/" + id + "/nonce";
  note_connect_();
  HttpResponse r = transport_->execute({"POST", https_url(api_host_.c_str(), path.c_str()), "", {}});
  if (body != nullptr)
    *body = r.body;
  if (!response_usable(r))
    return r.status > 0 ? r.status : 0;
  if (r.status != 200)
    return r.status;
  if (!json_get_string(r.body.c_str(), "nonce", nonce) || nonce->empty())
    return 0;
  return 200;
}

bool CloudEngine::store_enroll_(const std::string &body) {
  if (discard_job_() || !enroll_fields_ok(body.c_str()))
    return false;
  device_id_.clear();
  claim_code_.clear();
  if (!enroll_token_.empty())
    secure_clear(&enroll_token_[0], enroll_token_.size());
  enroll_token_.clear();
  claim_url_.clear();
  claim_expires_.clear();
  json_get_string(body.c_str(), "device_id", &device_id_);
  json_get_string(body.c_str(), "claim_code", &claim_code_);
  claim_code_ = format_claim_code(claim_code_.c_str());
  json_get_string(body.c_str(), "enroll_token", &enroll_token_);
  json_get_string(body.c_str(), "claim_url", &claim_url_);
  if (claim_url_.empty())
    json_get_string(body.c_str(), "qr", &claim_url_);
  if (claim_url_.empty() && !claim_code_.empty())
    claim_url_ = claim_url_for(site_origin_.c_str(), claim_code_.c_str());
  json_get_string(body.c_str(), "claim_expires_at", &claim_expires_);
  claim_deadline_mono_ = now_() + CLAIM_MS;
  return true;
}

bool CloudEngine::store_cert_(const std::string &body) {
  if (discard_job_() || !cert_fields_ok(body.c_str()))
    return false;
  std::string pem;
  json_get_string(body.c_str(), "certificate", &pem);
  json_get_string(body.c_str(), "serial", &serial_);
  json_get_string(body.c_str(), "fingerprint", &fingerprint_);
  json_get_string(body.c_str(), "not_after", &not_after_);
  int64_t rot = 0;
  if (json_get_int64(body.c_str(), "rotate_after_ms", &rot) && rot > 0)
    rotate_after_ms_ = rot;
  const int64_t wall = wall_();
  if (wall > 0)
    issued_ms_ = wall;
  else {
    const int64_t exp = parse_iso8601_ms(not_after_.c_str());
    issued_ms_ = exp > (7LL * 24 * 3600 * 1000) ? exp - (7LL * 24 * 3600 * 1000) : 0;
  }
  save_cert_(pem);
  reset_relink_();
  return true;
}

bool CloudEngine::handle_enroll_() {
  if (!ensure_key_()) {
    std::lock_guard<std::mutex> g(lock_);
    apply_(CloudEvent::EnrollFail);
    return false;
  }
  JobSnap snap;
  {
    std::lock_guard<std::mutex> g(lock_);
    snap = snap_();
  }
  std::string jwk = jwk_json(snap.pub_x, snap.pub_y);
  std::string body = enroll_body_json(crypto_->hardware_id().c_str(), jwk.c_str(), "Chamber");
  bool pop = snap.has_key && !snap.device_id.empty();
  HttpResponse r = http_("POST", "/api/devices/enroll", body, pop, false);
  if (pop && !r.ok && r.status == 404 && r.body.find("device not found") != std::string::npos) {
    {
      std::lock_guard<std::mutex> g(lock_);
      device_id_.clear();
      save_identity_();
    }
    pop = false;
    r = http_("POST", "/api/devices/enroll", body, false, false);
  }
  std::lock_guard<std::mutex> g(lock_);
  if (discard_job_()) {
    if (response_usable(r) && r.status == 200 && enroll_fields_ok(r.body.c_str())) {
      device_id_.clear();
      json_get_string(r.body.c_str(), "device_id", &device_id_);
      if (!enroll_token_.empty())
        secure_clear(&enroll_token_[0], enroll_token_.size());
      enroll_token_.clear();
      json_get_string(r.body.c_str(), "enroll_token", &enroll_token_);
    }
    return false;
  }
  const HttpOutcome o = enroll_outcome(response_usable(r), r.status, r.body.c_str());
  if (o == HttpOutcome::Success) {
    if (!store_enroll_(r.body)) {
      apply_(CloudEvent::NetworkFail);
      bump_backoff_(0);
      return false;
    }
    if (claim_cycles_ < 255)
      claim_cycles_++;
    backoff_ms_ = BACKOFF_MIN_MS;
    apply_(CloudEvent::EnrollOk);
    set_claim_poll_();
    save_identity_();
    return true;
  }
  apply_(event_for_enroll(o));
  if (o == HttpOutcome::AlreadyOwned || o == HttpOutcome::ClaimBusy)
    return false;
  bump_backoff_(r.retry_after_s);
  return false;
}

bool CloudEngine::handle_csr_() {
  JobSnap snap;
  {
    std::lock_guard<std::mutex> g(lock_);
    snap = snap_();
  }
  if (discard_job_() || snap.device_id.empty() || snap.enroll_token.empty()) {
    std::lock_guard<std::mutex> g(lock_);
    apply_(CloudEvent::NetworkFail);
    bump_backoff_(0);
    return false;
  }
  std::string status_path = "/api/devices/" + snap.device_id + "/claim-status";
  std::string status_body = claim_status_body_json(snap.enroll_token.c_str());
  HttpResponse st = http_("POST", status_path.c_str(), status_body, false, false);
  if (!status_body.empty())
    secure_clear(&status_body[0], status_body.size());
  {
    std::lock_guard<std::mutex> g(lock_);
    if (discard_job_())
      return false;
    if (!response_usable(st) || st.status == 429 || st.status >= 500) {
      apply_(st.status == 429 ? CloudEvent::RateLimited : CloudEvent::NetworkFail);
      bump_backoff_(st.retry_after_s);
      return false;
    }
    bool claimed = false;
    json_get_bool(st.body.c_str(), "claimed", &claimed);
    if (!claimed) {
      apply_(CloudEvent::CsrWaiting);
      backoff_ms_ = BACKOFF_MIN_MS;
      set_claim_poll_();
      return true;
    }
  }
  std::string csr;
  if (!make_csr_(&csr)) {
    std::lock_guard<std::mutex> g(lock_);
    apply_(CloudEvent::NetworkFail);
    bump_backoff_(0);
    return false;
  }
  std::string path = "/api/devices/" + snap.device_id + "/csr";
  std::string body = csr_body_json(csr.c_str(), snap.enroll_token.c_str());
  secure_clear(&snap.enroll_token[0], snap.enroll_token.size());
  HttpResponse r = http_("POST", path.c_str(), body, true, false);
  if (!body.empty())
    secure_clear(&body[0], body.size());
  std::lock_guard<std::mutex> g(lock_);
  if (discard_job_())
    return false;
  const HttpOutcome o = csr_outcome(response_usable(r), r.status, r.body.c_str());
  if (o == HttpOutcome::Success) {
    if (!store_cert_(r.body)) {
      apply_(CloudEvent::NetworkFail);
      bump_backoff_(0);
      return false;
    }
    claim_code_.clear();
    claim_url_.clear();
    claim_expires_.clear();
    claim_deadline_mono_ = 0;
    backoff_ms_ = BACKOFF_MIN_MS;
    apply_(CloudEvent::CsrOk);
    next_probe_ms_ = now_() + PROBE_INTERVAL_MS;
    next_telemetry_ms_ = now_() + TELEMETRY_INTERVAL_MS;
    return true;
  }
  apply_(event_for_csr(o));
  if (o == HttpOutcome::AuthFail) {
    wipe_();
    state_ = CloudState::Revoked;
    cloud_enabled_ = true;
    save_identity_();
    return false;
  }
  if (o == HttpOutcome::WaitingClaim) {
    backoff_ms_ = BACKOFF_MIN_MS;
    set_claim_poll_();
  } else {
    bump_backoff_(r.retry_after_s);
  }
  return o == HttpOutcome::WaitingClaim || o == HttpOutcome::RateLimited || o == HttpOutcome::TransientFail;
}

bool CloudEngine::handle_rotate_() {
  JobSnap snap;
  {
    std::lock_guard<std::mutex> g(lock_);
    snap = snap_();
  }
  if (snap.device_id.empty() || !snap.has_key) {
    std::lock_guard<std::mutex> g(lock_);
    apply_(CloudEvent::CsrFail);
    bump_backoff_(0);
    return false;
  }
  std::string csr;
  if (!make_csr_(&csr)) {
    std::lock_guard<std::mutex> g(lock_);
    apply_(CloudEvent::CsrFail);
    bump_backoff_(0);
    return false;
  }
  std::string path = "/api/devices/" + snap.device_id + "/rotate";
  std::string body = rotate_body_json(csr.c_str());
  HttpResponse r = http_("POST", path.c_str(), body, true, true);
  std::lock_guard<std::mutex> g(lock_);
  if (discard_job_())
    return false;
  const HttpOutcome o = rotate_outcome(response_usable(r), r.status, r.body.c_str());
  if (o == HttpOutcome::Success) {
    if (!store_cert_(r.body)) {
      apply_(CloudEvent::NetworkFail);
      bump_backoff_(0);
      return false;
    }
    backoff_ms_ = BACKOFF_MIN_MS;
    apply_(CloudEvent::RotateOk);
    return true;
  }
  if (o == HttpOutcome::AuthFail) {
    apply_(event_for_rotate(o));
    wipe_();
    state_ = CloudState::Revoked;
    cloud_enabled_ = true;
    save_identity_();
    return false;
  }
  if (o == HttpOutcome::RelinkRequired) {
    if (!confirm_relink_()) {
      apply_(CloudEvent::CertExpired);
      bump_backoff_(r.retry_after_s);
      return false;
    }
    apply_(CloudEvent::RelinkRequired);
    relink_();
    return false;
  }
  apply_(event_for_rotate(o));
  bump_backoff_(r.retry_after_s);
  return false;
}

bool CloudEngine::handle_reclaim_() {
  std::lock_guard<std::mutex> g(lock_);
  apply_(CloudEvent::ReclaimFail);
  wipe_();
  state_ = CloudState::Revoked;
  cloud_enabled_ = true;
  save_identity_();
  return false;
}

bool CloudEngine::handle_probe_() {
  JobSnap snap;
  uint32_t local_ms = 0;
  {
    std::lock_guard<std::mutex> g(lock_);
    snap = snap_();
    local_ms = chamber_ ? chamber_->last_local_change_ms() : last_local_change_ms_;
  }
  if (snap.device_id.empty() || !snap.has_key)
    return false;
  std::string path = "/api/devices/" + snap.device_id + "/inbox";
  std::string query;
  const int64_t wall = wall_();
  const uint32_t now = now_();
  if (local_ms != 0 && wall > 0) {
    const int32_t age = static_cast<int32_t>(now - local_ms);
    if (age >= 0)
      query = "last_local_change=" + format_iso8601_ms(wall - static_cast<int64_t>(age));
  }
  HttpResponse r = http_("GET", path.c_str(), "", true, true, query.empty() ? nullptr : query.c_str());
  const HttpOutcome o = probe_outcome(response_usable(r), r.status, r.body.c_str());
  {
    std::lock_guard<std::mutex> g(lock_);
    if (o == HttpOutcome::AuthFail) {
      apply_(CloudEvent::LinkRevoked);
      wipe_();
      state_ = CloudState::Revoked;
      cloud_enabled_ = true;
      save_identity_();
      return false;
    }
    if (o == HttpOutcome::CertExpired) {
      apply_(CloudEvent::CertExpired);
      next_rotate_ms_ = now_();
      return false;
    }
    if (o == HttpOutcome::RelinkRequired) {
      if (!confirm_relink_()) {
        apply_(CloudEvent::CertExpired);
        schedule_probe_error_(r.retry_after_s);
        return false;
      }
      apply_(CloudEvent::RelinkRequired);
      relink_();
      return false;
    }
    if (o == HttpOutcome::ProofInvalid) {
      apply_(CloudEvent::ProofInvalid);
      schedule_probe_error_(r.retry_after_s);
      return false;
    }
    if (o != HttpOutcome::Success) {
      schedule_probe_error_(r.retry_after_s);
      return false;
    }
    reset_relink_();
    backoff_ms_ = BACKOFF_MIN_MS;
    next_probe_ms_ = now_() + PROBE_INTERVAL_MS + (clock_->random() % (PROBE_JITTER_MS + 1));
  }
  process_inbox_(r.body);
  return true;
}

bool CloudEngine::process_inbox_(const std::string &body) {
  InboxCommand cmds[MAX_INBOX_COMMANDS];
  const size_t n = parse_inbox_commands(body.c_str(), cmds, MAX_INBOX_COMMANDS);
  ChamberReading reading{};
  uint32_t local_ms = last_local_change_ms_;
  const bool apply_on = remote_apply_enabled_();
  if (chamber_) {
    reading = chamber_->read();
    local_ms = chamber_->last_local_change_ms();
  }
  int64_t ack_id = 0;
  std::string ack_status;
  std::string ack_reason;
  for (size_t i = 0; i < n; i++) {
    if (cmds[i].id != 0 && cmds[i].id == last_applied_command_id_)
      continue;
    const SetpointPlan plan = plan_setpoint_command(cmds[i], wall_(), local_ms, now_(), apply_on);
    if (plan.decision == SetpointDecision::Skip)
      continue;
    if (plan.decision == SetpointDecision::Apply && chamber_ == nullptr)
      continue;
    if (plan.decision == SetpointDecision::Refuse || plan.decision == SetpointDecision::Fail) {
      ack_id = cmds[i].id;
      ack_status = plan.ack_status ? plan.ack_status : "failed";
      ack_reason = plan.reason ? plan.reason : "";
      break;
    }
    if (!sync_jobs_) {
      std::lock_guard<std::mutex> g(lock_);
      pending_apply_.ready = true;
      pending_apply_.command_id = cmds[i].id;
      pending_apply_.plan = plan;
      return true;
    }
    ChamberReading after = reading;
    std::string reason;
    const bool ok = apply_plan_now_(plan, cmds[i].id, &after, &reason);
    reading = after;
    ack_id = cmds[i].id;
    ack_status = ok ? "applied" : "failed";
    ack_reason = reason;
    break;
  }
  const bool heartbeat = chamber_ != nullptr && next_telemetry_ms_ != 0 && time_reached(now_(), next_telemetry_ms_);
  if (!ack_status.empty() || heartbeat) {
    if (post_telemetry_(reading, ack_id, ack_status.empty() ? nullptr : ack_status.c_str(),
                        ack_reason.empty() ? nullptr : ack_reason.c_str())) {
      std::lock_guard<std::mutex> g(lock_);
      next_telemetry_ms_ = now_() + TELEMETRY_INTERVAL_MS;
    } else {
      schedule_telemetry_error_(0);
    }
  }
  return true;
}

bool CloudEngine::apply_plan_now_(const SetpointPlan &plan, int64_t command_id, ChamberReading *after,
                                 std::string *reason) {
  if (chamber_ == nullptr) {
    if (reason)
      *reason = "no chamber";
    return false;
  }
  const ChamberReading before = chamber_->read();
  const EntityRange tr = chamber_->temperature_range();
  const EntityRange hr = chamber_->humidity_range();
  float t = plan.temperature_c;
  float h = plan.humidity_percent;
  if (plan.write_temp) {
    if (tr.has) {
      if (!value_in_entity_range(t, tr)) {
        if (reason)
          *reason = "temperature outside entity range";
        if (after)
          *after = before;
        return false;
      }
      t = snap_entity_value(t, tr);
    } else {
      t = clamp_setpoint_temp(t);
    }
  }
  if (plan.write_rh) {
    if (hr.has) {
      if (!value_in_entity_range(h, hr)) {
        if (reason)
          *reason = "humidity outside entity range";
        if (after)
          *after = before;
        return false;
      }
      h = snap_entity_value(h, hr);
    } else {
      h = clamp_setpoint_rh(h);
    }
  }
  bool ok_t = true;
  bool ok_h = true;
  if (plan.write_temp)
    ok_t = chamber_->write_temperature(t);
  if (ok_t && plan.write_rh)
    ok_h = chamber_->write_humidity(h);
  ChamberReading now = chamber_->read();
  if (ok_t && plan.write_temp && now.has_temperature_target && std::fabs(now.temperature_target - t) > 0.15f)
    ok_t = false;
  if (ok_h && plan.write_rh && now.has_target_humidity && std::fabs(now.target_humidity - h) > 0.6f)
    ok_h = false;
  if (!ok_t || !ok_h) {
    if (plan.write_temp && before.has_temperature_target)
      chamber_->write_temperature(before.temperature_target);
    if (plan.write_rh && before.has_target_humidity)
      chamber_->write_humidity(before.target_humidity);
    if (after)
      *after = chamber_->read();
    if (reason)
      *reason = "write failed";
    return false;
  }
  last_applied_command_id_ = command_id;
  if (after)
    *after = now;
  return true;
}

bool CloudEngine::take_pending_apply(PendingApply *out) {
  std::lock_guard<std::mutex> g(lock_);
  if (out == nullptr || !pending_apply_.ready)
    return false;
  *out = pending_apply_;
  pending_apply_.ready = false;
  return true;
}

bool CloudEngine::apply_now(const PendingApply &pending, ChamberReading *after, std::string *reason) {
  return apply_plan_now_(pending.plan, pending.command_id, after, reason);
}

void CloudEngine::complete_apply(int64_t command_id, bool ok, const char *status, const char *reason,
                                const ChamberReading &reading) {
  std::lock_guard<std::mutex> g(lock_);
  if (ok && command_id != 0)
    last_applied_command_id_ = command_id;
  pending_ack_ = true;
  pending_ack_id_ = command_id;
  pending_ack_status_ = status ? status : (ok ? "applied" : "failed");
  pending_ack_reason_ = reason ? reason : "";
  pending_ack_reading_ = reading;
}

bool CloudEngine::apply_waiting() const {
  std::lock_guard<std::mutex> g(lock_);
  return pending_apply_.ready;
}

bool CloudEngine::ack_waiting() const {
  std::lock_guard<std::mutex> g(lock_);
  return pending_ack_;
}

int64_t CloudEngine::last_applied_command_id() const {
  std::lock_guard<std::mutex> g(lock_);
  return last_applied_command_id_;
}

bool CloudEngine::telemetry_now() { return queue_(CloudJob::TELEMETRY); }

bool CloudEngine::handle_telemetry_() {
  ChamberReading reading{};
  int64_t ack_id = 0;
  std::string status;
  std::string reason;
  {
    std::lock_guard<std::mutex> g(lock_);
    if (pending_ack_) {
      reading = pending_ack_reading_;
      ack_id = pending_ack_id_;
      status = pending_ack_status_;
      reason = pending_ack_reason_;
      pending_ack_ = false;
    } else if (chamber_) {
      reading = chamber_->read();
    }
  }
  if (post_telemetry_(reading, ack_id, status.empty() ? nullptr : status.c_str(),
                      reason.empty() ? nullptr : reason.c_str())) {
    std::lock_guard<std::mutex> g(lock_);
    next_telemetry_ms_ = now_() + TELEMETRY_INTERVAL_MS;
    return true;
  }
  schedule_telemetry_error_(0);
  return false;
}

bool CloudEngine::post_telemetry_(const ChamberReading &reading, int64_t ack_id, const char *ack_status,
                                 const char *ack_reason) {
  std::string id;
  {
    std::lock_guard<std::mutex> g(lock_);
    id = device_id_;
  }
  if (id.empty())
    return false;
  std::string path = "/api/devices/" + id + "/telemetry";
  const EntityRange tr = chamber_ ? chamber_->temperature_range() : EntityRange{};
  const EntityRange hr = chamber_ ? chamber_->humidity_range() : EntityRange{};
  std::string body = telemetry_body_json(reading, ack_id, ack_status, ack_reason, &tr, &hr);
  HttpResponse r = http_("POST", path.c_str(), body, true, true);
  return response_usable(r) && r.status == 200;
}

bool CloudEngine::handle_revoke_() {
  JobSnap snap;
  {
    std::lock_guard<std::mutex> g(lock_);
    snap = snap_();
  }
  bool ok = true;
  if (!snap.device_id.empty() && snap.has_key) {
    std::string path = "/api/devices/" + snap.device_id + "/self-revoke";
    HttpResponse r = http_("POST", path.c_str(), "{}", true, snap.has_cert);
    ok = response_usable(r) && r.status == 200;
  }
  std::lock_guard<std::mutex> g(lock_);
  revoke_failed_ = !ok;
  wipe_();
  pending_wipe_ = false;
  return ok;
}

void CloudEngine::reset_relink_() { relink_seen_ms_ = 0; }

bool CloudEngine::confirm_relink_() {
  const uint32_t now = now_() == 0 ? 1 : now_();
  if (relink_seen_ms_ == 0) {
    relink_seen_ms_ = now;
    return false;
  }
  const uint32_t dt = now - relink_seen_ms_;
  if (dt < RELINK_CONFIRM_MS)
    return false;
  if (dt > RELINK_WINDOW_MS) {
    relink_seen_ms_ = now;
    return false;
  }
  return true;
}

void CloudEngine::maybe_fill_issued_() {
  if (issued_ms_ > 0 || !has_cert_)
    return;
  const int64_t wall = wall_();
  if (wall > 0)
    issued_ms_ = wall;
  else {
    const int64_t exp = parse_iso8601_ms(not_after_.c_str());
    if (exp > (7LL * 24 * 3600 * 1000))
      issued_ms_ = exp - (7LL * 24 * 3600 * 1000);
  }
  if (issued_ms_ > 0)
    save_identity_();
}

void CloudEngine::loop() {
  if (busy_)
    return;
  if (pending_wipe_) {
    queue_(CloudJob::REVOKE);
    return;
  }
  const uint32_t now = now_();
  CloudState st;
  bool enabled = false;
  bool poll_due = false;
  bool enroll_due = false;
  bool probe_due = false;
  bool telemetry_due = false;
  bool rotate_due = false;
  bool expired_again = false;
  {
    std::lock_guard<std::mutex> g(lock_);
    enabled = cloud_enabled_;
    st = persist_state(state_);
    state_ = st;
    maybe_fill_issued_();
    if (!enabled)
      return;
    if (st == CloudState::Connecting && job_ != CloudJob::ENROLL && time_reached(now, next_retry_ms_)) {
      next_retry_ms_ = now + backoff_ms_;
      enroll_due = true;
    } else if (st == CloudState::PendingClaim || st == CloudState::Issuing) {
      const bool expired = claim_deadline_mono_ != 0 && time_reached(now, claim_deadline_mono_);
      if (st == CloudState::PendingClaim && expired) {
        expired_again = should_auto_enroll(claim_cycles_);
        if (expired_again)
          apply_(CloudEvent::Expired);
        else {
          claim_code_.clear();
          claim_url_.clear();
        }
      } else if (time_reached(now, next_csr_ms_)) {
        next_csr_ms_ = now + CLAIM_POLL_MS;
        poll_due = true;
      }
    } else if (st == CloudState::Linked || st == CloudState::Rotating) {
      maybe_fill_issued_();
      const int64_t wall = wall_();
      rotate_due = wall > 0 && issued_ms_ > 0 && wall >= issued_ms_ + rotate_after_ms_ &&
                   time_reached(now, next_rotate_ms_) && rotate_slot_open_();
      if (rotate_due) {
        rotate_attempts_hour_++;
        next_rotate_ms_ = now + backoff_ms_;
        apply_(CloudEvent::RotateDue);
      } else if (time_reached(now, next_probe_ms_)) {
        next_probe_ms_ = now + PROBE_INTERVAL_MS;
        probe_due = true;
      } else if (next_telemetry_ms_ != 0 && time_reached(now, next_telemetry_ms_)) {
        next_telemetry_ms_ = now + TELEMETRY_INTERVAL_MS;
        telemetry_due = true;
      }
    }
  }
  if (enroll_due || expired_again)
    queue_(CloudJob::ENROLL);
  else if (poll_due)
    queue_(CloudJob::CSR);
  else if (rotate_due)
    queue_(CloudJob::ROTATE);
  else if (probe_due)
    queue_(CloudJob::PROBE);
  else if (telemetry_due)
    queue_(CloudJob::TELEMETRY);
}

}  // namespace shroom_labs
}  // namespace esphome
