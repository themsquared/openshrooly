#pragma once
// Per-device secrets, local web login and Wi-Fi setup mode. See __init__.py.
#include <string>

#include "esphome/core/component.h"
#include "esphome/core/preferences.h"
#include "esphome/components/web_server_base/web_server_base.h"

namespace esphome {
namespace device_security {

class DeviceSecurity : public Component {
 public:
  explicit DeviceSecurity(web_server_base::WebServerBase *base) : base_(base) {}
  // Before captive_portal (WIFI + 1) and wifi, so the setup network never starts open.
  float get_setup_priority() const override { return setup_priority::WIFI + 2.0f; }
  void setup() override;
  void loop() override;
  void dump_config() override;

  void set_ap_ssid_prefix(const char *prefix) { this->ap_ssid_prefix_ = prefix; }
  void set_setup_timeout(uint32_t ms) { this->setup_timeout_ms_ = ms; }

  const std::string &web_password() const { return this->web_password_; }
  const std::string &ap_ssid() const { return this->ap_ssid_; }
  const std::string &ap_password() const { return this->ap_password_; }
  bool in_setup() const { return this->in_setup_; }
  // Whole minutes left before setup mode ends by itself, or 0 when it has no limit.
  uint32_t setup_minutes_left() const;

  // Turns on the Wi-Fi setup network until new Wi-Fi details work, it times out, or exit_setup().
  void enter_setup();
  void exit_setup();

  // Base64 Home Assistant encryption key, or empty before it exists.
  std::string api_key() const;
  // Constant-time check of an "Authorization" header value against the web login.
  bool basic_auth_ok(const std::string &header) const;

 protected:
  void load_or_create_secrets_();

  web_server_base::WebServerBase *base_;
  ESPPreferenceObject pref_;
  const char *ap_ssid_prefix_{"OpenShrooly"};
  uint32_t setup_timeout_ms_{600000};
  std::string web_password_;
  std::string ap_ssid_;
  std::string ap_password_;
  std::string expected_basic_;
  bool in_setup_{false};
  bool timed_setup_{false};
  bool psk_checked_{false};
  bool seen_ap_{false};
  uint32_t setup_started_ms_{0};
};

extern DeviceSecurity *global_device_security;  // NOLINT

}  // namespace device_security
}  // namespace esphome
