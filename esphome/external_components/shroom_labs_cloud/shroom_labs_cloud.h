#pragma once

#include "cloud_format.h"
#include "cloud_http.h"
#include "cloud_qr.h"
#include "esphome/core/component.h"
#include "esphome/components/web_server_base/web_server_base.h"

#include <atomic>
#include <mutex>
#include <string>

namespace esphome {
namespace shroom_labs {

/** Opt-in outbound Shroom Labs link. The P-256 key is born on the device and never leaves NVS. */
class ShroomLabsCloud : public Component {
 public:
  explicit ShroomLabsCloud(web_server_base::WebServerBase *base) : base_(base) {}
  void set_api_host(const std::string &host) { api_host_ = host.empty() ? DEFAULT_API_HOST : host; }
  void set_site_origin(const std::string &site) { site_origin_ = site.empty() ? DEFAULT_SITE : site; }

  void setup() override;
  void loop() override;
  void dump_config() override;
  float get_setup_priority() const override { return setup_priority::AFTER_WIFI; }

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
  bool fill_qr(QrCode *out) const;
  bool nvs_encrypted() const { return nvs_encrypted_; }
  bool flash_encrypted() const { return flash_encrypted_; }

  // Phase 2 hooks. Inbox is probed only to notice revoke. Commands are not applied.
  void note_local_change();
  bool cloud_ready() const;
  uint32_t last_local_change_ms() const { return last_local_change_ms_; }

 protected:
  enum class Job : uint8_t { NONE, ENROLL, CSR, ROTATE, RECLAIM, PROBE, REVOKE };

  struct JobSnap {
    std::string device_id;
    std::string enroll_token;
    std::string serial;
    uint8_t pub_x[32]{};
    uint8_t pub_y[32]{};
    bool has_key{false};
    bool has_cert{false};
  };

  void load_();
  void save_identity_();
  void save_cert_(const std::string &pem);
  void clear_cert_();
  void wipe_();
  void zero_key_();
  bool ensure_key_();
  bool sign_(const uint8_t *data, size_t len, uint8_t sig[64]);
  bool make_csr_(std::string *pem);
  std::string hardware_id_() const;
  JobSnap snap_() const;
  void apply_(CloudEvent event);
  bool queue_(Job job);
  void bump_backoff_(int retry_after_s);
  bool rotate_slot_open_();
  static void task_entry_(void *arg);
  void run_job_();
  bool http_(const char *method, const char *path, const std::string &body, bool pop, bool with_serial, int *status,
             std::string *response, int *retry_after_s);
  bool fetch_nonce_(std::string *nonce);
  bool handle_enroll_();
  bool handle_csr_();
  bool handle_rotate_();
  bool handle_reclaim_();
  bool handle_probe_();
  bool handle_revoke_();
  void store_enroll_(const std::string &body);
  void store_cert_(const std::string &body);
  uint32_t claim_seconds_left_() const;

  web_server_base::WebServerBase *base_;
  std::string api_host_{DEFAULT_API_HOST};
  std::string site_origin_{DEFAULT_SITE};

  uint8_t priv_[32]{};
  uint8_t pub_x_[32]{};
  uint8_t pub_y_[32]{};
  bool has_key_{false};
  bool has_cert_{false};
  bool nvs_encrypted_{false};
  bool flash_encrypted_{false};

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
  uint32_t last_local_change_ms_{0};
  uint32_t next_csr_ms_{0};
  uint32_t next_probe_ms_{0};
  uint32_t next_rotate_ms_{0};
  uint32_t next_retry_ms_{0};
  uint32_t backoff_ms_{BACKOFF_MIN_MS};
  uint32_t rotate_hour_start_ms_{0};
  uint8_t rotate_attempts_hour_{0};
  int last_retry_after_s_{0};

  std::atomic<bool> busy_{false};
  std::atomic<bool> show_claim_{false};
  std::atomic<bool> pending_wipe_{false};
  Job job_{Job::NONE};
  mutable std::mutex lock_;
};

extern ShroomLabsCloud *global_shroom_labs_cloud;  // NOLINT

}  // namespace shroom_labs
}  // namespace esphome
