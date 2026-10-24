#pragma once

#include <array>
#include <atomic>
#include <mutex>
#include <string>

#include "esphome/core/component.h"
#include "esphome/components/text_sensor/text_sensor.h"

namespace esphome {
namespace signed_update {

// Code values published on the "Update State" text sensor for the web app.
enum class State : uint8_t {
  IDLE,
  CHECKING,
  CURRENT,
  AVAILABLE,
  OLDER,
  DOWNLOADING,
  VERIFYING,
  RESTARTING,
  FAILED,
};

// User-initiated signed update. Nothing happens until check() or install() is called
// from a button. The release manifest is fetched over HTTPS from a compiled-in
// shroomlabs.io URL, its Ed25519 signature is checked against the compiled-in public
// key, and the image is streamed into the spare app slot while hashing. The boot slot
// only changes when the signed size and SHA-256 match exactly.
class SignedUpdate : public Component {
 public:
  void setup() override;
  void loop() override;
  void dump_config() override;
  float get_setup_priority() const override { return setup_priority::AFTER_WIFI; }

  void set_manifest_url(const char *url) { this->manifest_url_ = url; }
  void set_download_prefix(const char *prefix) { this->download_prefix_ = prefix; }
  void set_public_key(const std::array<uint8_t, 32> &key) { this->public_key_ = key; }
  void set_current_version(const char *version) { this->current_version_ = version; }
  void set_product(const char *product) { this->product_ = product; }
  void set_channel(const char *channel) { this->channel_ = channel; }
  void set_status_sensor(text_sensor::TextSensor *s) { this->status_sensor_ = s; }
  void set_state_sensor(text_sensor::TextSensor *s) { this->state_sensor_ = s; }
  void set_available_sensor(text_sensor::TextSensor *s) { this->available_sensor_ = s; }
  void set_installed_sensor(text_sensor::TextSensor *s) { this->installed_sensor_ = s; }

  void set_allow_older(bool allow) { this->allow_older_ = allow; }
  void check();
  void install();

 protected:
  struct Release {
    std::string version;
    std::string url;
    std::string sha256;
    uint32_t size{0};
  };

  static void task_entry_(void *arg);
  void run_(bool install);
  bool fetch_release_(Release *out);
  bool download_and_apply_(const Release &rel);
  void report_(State state, const std::string &message, const std::string &available = "");

  const char *manifest_url_{""};
  const char *download_prefix_{""};
  const char *current_version_{""};
  const char *product_{"openshrooly"};
  const char *channel_{"stable"};
  std::array<uint8_t, 32> public_key_{};

  text_sensor::TextSensor *status_sensor_{nullptr};
  text_sensor::TextSensor *state_sensor_{nullptr};
  text_sensor::TextSensor *available_sensor_{nullptr};
  text_sensor::TextSensor *installed_sensor_{nullptr};

  std::atomic<bool> busy_{false};
  std::atomic<bool> allow_older_{false};
  std::atomic<bool> pending_publish_{false};
  std::atomic<bool> reboot_requested_{false};
  bool install_mode_{false};
  std::mutex lock_;
  State state_{State::IDLE};
  std::string message_;
  std::string available_;
};

}  // namespace signed_update
}  // namespace esphome
