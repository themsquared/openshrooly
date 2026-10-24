#pragma once

#include "esphome/core/component.h"
#include "esphome/core/helpers.h"
#include <string>

namespace esphome {
namespace shroom_labs {

/** Opt-in outbound mTLS client. Private key stays in encrypted NVS. */
class ShroomLabsCloud : public Component {
 public:
  void set_api_host(const std::string &host) { api_host_ = host; }
  void setup() override;
  void loop() override;
  float get_setup_priority() const override { return setup_priority::AFTER_WIFI; }
  std::string claim_code() const { return claim_code_; }

 protected:
  std::string api_host_;
  std::string claim_code_;
  bool cloud_enabled_{false};
  uint32_t last_local_change_ms_{0};
};

}  // namespace shroom_labs
}  // namespace esphome
