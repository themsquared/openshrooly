#include "shroom_labs_cloud.h"
#include "esphome/core/log.h"

namespace esphome {
namespace shroom_labs {

static const char *const TAG = "shroom_labs_cloud";

void ShroomLabsCloud::setup() {
  // Key generation, CSR, and the outbound WSS client live behind this
  // opt-in component so default OpenShrooly builds stay offline-first
  // and keep the flash budget. See docs/DEVICES.md.
  ESP_LOGI(TAG, "Cloud link disabled until claimed. Host=%s", this->api_host_.c_str());
}

void ShroomLabsCloud::loop() {
  // No-op unless a grower enabled this component and completed claim.
  // Local number/switch REST remains authoritative when cloud_enabled_ is false
  // or the socket cannot be established.
  (void) this->cloud_enabled_;
  (void) this->last_local_change_ms_;
}

}  // namespace shroom_labs
}  // namespace esphome
