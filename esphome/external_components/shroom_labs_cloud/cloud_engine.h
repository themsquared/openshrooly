#pragma once

#include "cloud_http.h"

#include <atomic>
#include <mutex>
#include <string>

namespace esphome {
namespace shroom_labs {

enum class CloudJob : uint8_t { NONE, ENROLL, CSR, ROTATE, RECLAIM, PROBE, REVOKE };

class CloudEngine {
 public:
  CloudEngine(CloudTransport *transport, CloudClock *clock, CloudStore *store, CloudCrypto *crypto)
      : transport_(transport), clock_(clock), store_(store), crypto_(crypto) {}

  void set_api_host(const std::string &host) { api_host_ = host.empty() ? DEFAULT_API_HOST : host; }
  void set_site_origin(const std::string &site) { site_origin_ = site.empty() ? DEFAULT_SITE : site; }
  void set_sync_jobs(bool sync) { sync_jobs_ = sync; }
  using StartJobFn = bool (*)(void *ctx, CloudJob job);
  void set_start_job(StartJobFn fn, void *ctx) {
    start_job_ = fn;
    start_ctx_ = ctx;
  }

  void load();
  void loop();
  void connect();
  void disconnect();
  void refresh();

  CloudState state() const;
  bool cloud_enabled() const;
  bool linked() const;
  std::string claim_code() const;
  std::string claim_url() const;
  std::string status_json() const;
  std::string display_code() const;
  std::string display_hint() const;
  std::string display_expiry() const;
  std::string display_title() const;
  bool take_show_claim();
  uint32_t claim_seconds_left() const;
  uint32_t next_csr_ms() const;
  uint32_t next_rotate_ms() const;
  uint32_t next_probe_ms() const;
  uint8_t claim_cycles() const;
  bool has_key() const;
  bool has_cert() const;
  std::string device_id() const;
  std::string cert_pem() const;
  size_t request_count() const { return request_count_; }

  bool run_job(CloudJob job);
  bool try_begin(CloudJob job);
  void finish();
  void drain_queued() { drain_queued_(); }
  bool busy() const { return busy_; }
  bool enroll_now();
  bool csr_now();
  bool rotate_now();
  bool reclaim_now();
  bool probe_now();
  bool revoke_now();
  bool revoke_failed() const { return revoke_failed_; }
  bool pending_wipe() const { return pending_wipe_; }

 protected:
  struct JobSnap {
    std::string device_id;
    std::string enroll_token;
    std::string serial;
    uint8_t pub_x[32]{};
    uint8_t pub_y[32]{};
    uint8_t priv[32]{};
    bool has_key{false};
    bool has_cert{false};
  };

  void apply_(CloudEvent event);
  bool queue_(CloudJob job);
  void bump_backoff_(int retry_after_s);
  void set_claim_poll_();
  bool rotate_slot_open_();
  JobSnap snap_() const;
  void save_identity_();
  void save_cert_(const std::string &pem);
  void clear_cert_();
  void wipe_();
  void relink_();
  bool confirm_relink_();
  void reset_relink_();
  void zero_key_();
  bool discard_job_() const { return pending_wipe_; }
  void drain_queued_();
  bool ensure_key_();
  bool sign_(const uint8_t *data, size_t len, uint8_t sig[64]);
  bool make_csr_(std::string *pem);
  HttpResponse http_(const char *method, const char *path, const std::string &body, bool pop, bool with_serial);
  int fetch_nonce_(std::string *nonce);
  bool handle_enroll_();
  bool handle_csr_();
  bool handle_rotate_();
  bool handle_reclaim_();
  bool handle_probe_();
  bool handle_revoke_();
  bool store_enroll_(const std::string &body);
  bool store_cert_(const std::string &body);
  uint32_t now_() const { return clock_->now_ms(); }
  int64_t wall_() const { return clock_->wall_ms(); }
  void maybe_fill_issued_();

  CloudTransport *transport_;
  CloudClock *clock_;
  CloudStore *store_;
  CloudCrypto *crypto_;
  std::string api_host_{DEFAULT_API_HOST};
  std::string site_origin_{DEFAULT_SITE};
  bool sync_jobs_{true};
  StartJobFn start_job_{nullptr};
  void *start_ctx_{nullptr};

  uint8_t priv_[32]{};
  uint8_t pub_x_[32]{};
  uint8_t pub_y_[32]{};
  bool has_key_{false};
  bool has_cert_{false};
  std::string device_id_;
  std::string enroll_token_;
  std::string claim_code_;
  std::string claim_url_;
  std::string claim_expires_;
  std::string cert_pem_;
  std::string serial_;
  std::string fingerprint_;
  std::string not_after_;
  int64_t rotate_after_ms_{ROTATE_AFTER_MS};
  int64_t issued_ms_{0};
  uint32_t claim_deadline_mono_{0};
  uint8_t claim_cycles_{0};
  CloudState state_{CloudState::Off};
  bool cloud_enabled_{false};
  uint32_t next_csr_ms_{0};
  uint32_t next_probe_ms_{0};
  uint32_t next_rotate_ms_{0};
  uint32_t next_retry_ms_{0};
  uint32_t backoff_ms_{BACKOFF_MIN_MS};
  uint32_t rotate_hour_start_ms_{0};
  uint8_t rotate_attempts_hour_{0};
  size_t request_count_{0};
  std::atomic<bool> busy_{false};
  std::atomic<bool> show_claim_{false};
  std::atomic<bool> pending_wipe_{false};
  std::atomic<bool> revoke_failed_{false};
  CloudJob job_{CloudJob::NONE};
  CloudJob queued_{CloudJob::NONE};
  uint32_t relink_seen_ms_{0};
  mutable std::mutex lock_;
};

}  // namespace shroom_labs
}  // namespace esphome
