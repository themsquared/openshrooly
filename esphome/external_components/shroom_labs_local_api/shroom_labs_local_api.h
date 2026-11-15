#pragma once

#include "esphome/core/component.h"
#include "esphome/components/web_server_base/web_server_base.h"

#include <cstdint>
#include <string>

namespace esphome {

namespace sensor {
class Sensor;
}
namespace number {
class Number;
}
namespace select {
class Select;
}
namespace switch_ {
class Switch;
}
namespace binary_sensor {
class BinarySensor;
}
namespace text_sensor {
class TextSensor;
}

namespace shroom_labs {
class ShroomLabsCloud;
}

namespace shroom_labs_local_api {

class ShroomLabsLocalApi : public Component {
 public:
  explicit ShroomLabsLocalApi(web_server_base::WebServerBase *base) : base_(base) {}

  void setup() override;
  // Higher than web_server (WIFI - 1) so this handler is first and wins /api/status
  // on OpenShrooly, whose SPA catch-all would otherwise claim any two-segment path.
  float get_setup_priority() const override { return setup_priority::WIFI - 0.4f; }

  void set_device_type(const std::string &v) { device_type_ = v; }
  void set_model(const std::string &v) { model_ = v; }
  void set_firmware(const std::string &v) { firmware_ = v; }

  void set_temperature(sensor::Sensor *s) { temperature_ = s; }
  void set_humidity(sensor::Sensor *s) { humidity_ = s; }
  void set_fan_rpm(sensor::Sensor *s) { fan_rpm_ = s; }
  void set_co2(sensor::Sensor *s) { co2_ = s; }
  void set_wifi_rssi_sensor(sensor::Sensor *s) { wifi_rssi_sensor_ = s; }

  void set_temperature_target(number::Number *n) { temperature_target_ = n; }
  void set_temperature_tolerance(number::Number *n) { temperature_tolerance_ = n; }
  void set_humidity_target(number::Number *n) { humidity_target_ = n; }
  void set_humidity_tolerance(number::Number *n) { humidity_tolerance_ = n; }
  void set_sunrise_hour(number::Number *n) { sunrise_hour_ = n; }
  void set_light_hours(number::Number *n) { light_hours_ = n; }
  void set_light_r(number::Number *n) { light_r_ = n; }
  void set_light_g(number::Number *n) { light_g_ = n; }
  void set_light_b(number::Number *n) { light_b_ = n; }
  void set_light_white(number::Number *n) { light_white_ = n; }
  void set_light_brightness(number::Number *n) { light_brightness_ = n; }
  void set_humidifier_level(number::Number *n) { humidifier_level_ = n; }
  void set_fae_period_min(number::Number *n) { fae_period_min_ = n; }
  void set_fae_run_s(number::Number *n) { fae_run_s_ = n; }
  void set_fae_speed(number::Number *n) { fae_speed_ = n; }

  void set_stage(select::Select *s) { stage_ = s; }
  void set_climate_mode(select::Select *s) { climate_mode_ = s; }

  void set_light_enabled(switch_::Switch *s) { light_enabled_ = s; }
  void set_humidifier_switch(switch_::Switch *s) { humidifier_switch_ = s; }

  void set_light_on(binary_sensor::BinarySensor *s) { light_on_ = s; }
  void set_humidifier_on(binary_sensor::BinarySensor *s) { humidifier_on_ = s; }
  void set_fae_on(binary_sensor::BinarySensor *s) { fae_on_ = s; }

  void set_light_status(text_sensor::TextSensor *s) { light_status_ = s; }
  void set_humidifier_status(text_sensor::TextSensor *s) { humidifier_status_ = s; }
  void set_fae_status(text_sensor::TextSensor *s) { fae_status_ = s; }
  void set_alerts(text_sensor::TextSensor *s) { alerts_ = s; }

  void set_cloud(shroom_labs::ShroomLabsCloud *c) { cloud_ = c; }

  void set_last_good_ms(uint32_t *v) { last_good_ms_ = v; }
  void set_sensor_stale_after_ms(uint32_t v) { sensor_stale_after_ms_ = v; }
  void set_fan_boost(bool *v) { fan_boost_ = v; }
  void set_fan_in_pct(float *v) { fan_in_pct_ = v; }
  void set_fan_out_pct(float *v) { fan_out_pct_ = v; }
  void set_light_white_is_lux(bool v) { light_white_is_lux_ = v; }

  std::string status_body() const;

 protected:
  web_server_base::WebServerBase *base_;
  std::string device_type_;
  std::string model_;
  std::string firmware_;

  sensor::Sensor *temperature_{nullptr};
  sensor::Sensor *humidity_{nullptr};
  sensor::Sensor *fan_rpm_{nullptr};
  sensor::Sensor *co2_{nullptr};
  sensor::Sensor *wifi_rssi_sensor_{nullptr};

  number::Number *temperature_target_{nullptr};
  number::Number *temperature_tolerance_{nullptr};
  number::Number *humidity_target_{nullptr};
  number::Number *humidity_tolerance_{nullptr};
  number::Number *sunrise_hour_{nullptr};
  number::Number *light_hours_{nullptr};
  number::Number *light_r_{nullptr};
  number::Number *light_g_{nullptr};
  number::Number *light_b_{nullptr};
  number::Number *light_white_{nullptr};
  number::Number *light_brightness_{nullptr};
  number::Number *humidifier_level_{nullptr};
  number::Number *fae_period_min_{nullptr};
  number::Number *fae_run_s_{nullptr};
  number::Number *fae_speed_{nullptr};

  select::Select *stage_{nullptr};
  select::Select *climate_mode_{nullptr};

  switch_::Switch *light_enabled_{nullptr};
  switch_::Switch *humidifier_switch_{nullptr};

  binary_sensor::BinarySensor *light_on_{nullptr};
  binary_sensor::BinarySensor *humidifier_on_{nullptr};
  binary_sensor::BinarySensor *fae_on_{nullptr};

  text_sensor::TextSensor *light_status_{nullptr};
  text_sensor::TextSensor *humidifier_status_{nullptr};
  text_sensor::TextSensor *fae_status_{nullptr};
  text_sensor::TextSensor *alerts_{nullptr};

  shroom_labs::ShroomLabsCloud *cloud_{nullptr};

  uint32_t *last_good_ms_{nullptr};
  uint32_t sensor_stale_after_ms_{60000};
  bool *fan_boost_{nullptr};
  float *fan_in_pct_{nullptr};
  float *fan_out_pct_{nullptr};
  bool light_white_is_lux_{false};
};

}  // namespace shroom_labs_local_api
}  // namespace esphome
