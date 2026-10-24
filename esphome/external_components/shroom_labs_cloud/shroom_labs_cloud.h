#pragma once

#include "cloud_engine.h"
#include "cloud_qr.h"
#include "esphome/core/component.h"
#include "esphome/components/web_server_base/web_server_base.h"

#include <atomic>

namespace esphome {
namespace shroom_labs {

class IdfTransport : public CloudTransport {
 public:
  HttpResponse execute(const HttpRequest &req) override;
};

class EspClock : public CloudClock {
 public:
  uint32_t now_ms() override;
  int64_t wall_ms() override;
  uint32_t random() override;
};

class EspStore : public CloudStore {
 public:
  bool load(SavedIdentity *id, std::string *pem) override;
  bool save_identity(const SavedIdentity &id) override;
  bool save_cert(const std::string &pem) override;
  bool erase_all() override;
};

class EspCrypto : public CloudCrypto {
 public:
  bool ensure_key(uint8_t priv[32], uint8_t x[32], uint8_t y[32]) override;
  bool sign(const uint8_t priv[32], const uint8_t *data, size_t len, uint8_t sig[64]) override;
  bool make_csr(const uint8_t priv[32], const uint8_t x[32], const uint8_t y[32], const char *cn,
                std::string *pem) override;
  std::string hardware_id() override;
};

/** Opt-in outbound Shroom Labs link. The P-256 key is born on the device and never leaves NVS. */
class ShroomLabsCloud : public Component {
 public:
  explicit ShroomLabsCloud(web_server_base::WebServerBase *base);
  void set_api_host(const std::string &host) { engine_.set_api_host(host); }
  void set_site_origin(const std::string &site) { engine_.set_site_origin(site); }

  void setup() override;
  void loop() override;
  void dump_config() override;
  float get_setup_priority() const override { return setup_priority::AFTER_WIFI; }

  void connect() { engine_.connect(); }
  void disconnect() { engine_.disconnect(); }
  void refresh() { engine_.refresh(); }

  CloudState state() const { return engine_.state(); }
  bool cloud_enabled() const { return engine_.cloud_enabled(); }
  bool linked() const { return engine_.linked(); }
  std::string claim_code() const { return engine_.claim_code(); }
  std::string claim_url() const { return engine_.claim_url(); }
  std::string status_json() const;
  std::string display_code() const { return engine_.display_code(); }
  std::string display_hint() const { return engine_.display_hint(); }
  std::string display_expiry() const { return engine_.display_expiry(); }
  std::string display_title() const { return engine_.display_title(); }
  bool take_show_claim() { return engine_.take_show_claim(); }
  bool fill_qr(QrCode *out) const;
  bool nvs_encrypted() const { return nvs_encrypted_; }
  bool flash_encrypted() const { return flash_encrypted_; }

  void note_local_change() { last_local_change_ms_ = millis(); }
  bool cloud_ready() const { return linked() && cloud_enabled(); }
  uint32_t last_local_change_ms() const { return last_local_change_ms_; }

  static bool start_job(void *ctx, CloudJob job);

 protected:
  static void task_entry_(void *arg);

  web_server_base::WebServerBase *base_;
  IdfTransport transport_;
  EspClock clock_;
  EspStore store_;
  EspCrypto crypto_;
  CloudEngine engine_;
  bool nvs_encrypted_{false};
  bool flash_encrypted_{false};
  uint32_t last_local_change_ms_{0};
  CloudJob pending_job_{CloudJob::NONE};
  std::atomic<bool> busy_{false};
};

extern ShroomLabsCloud *global_shroom_labs_cloud;  // NOLINT

}  // namespace shroom_labs
}  // namespace esphome
