#include "shroom_labs_local_api.h"

#include "status_json.h"
#include "status_paths.h"

#include "esphome/core/application.h"
#include "esphome/core/hal.h"
#include "esphome/core/log.h"
#ifdef USE_BINARY_SENSOR
#include "esphome/components/binary_sensor/binary_sensor.h"
#endif
#ifdef USE_NUMBER
#include "esphome/components/number/number.h"
#endif
#ifdef USE_SELECT
#include "esphome/components/select/select.h"
#endif
#ifdef USE_SENSOR
#include "esphome/components/sensor/sensor.h"
#endif
#ifdef USE_SWITCH
#include "esphome/components/switch/switch.h"
#endif
#ifdef USE_TEXT_SENSOR
#include "esphome/components/text_sensor/text_sensor.h"
#endif
#include "esphome/components/web_server_idf/web_server_idf.h"
#include "esphome/components/wifi/wifi_component.h"

#ifdef USE_SHROOM_LABS_CLOUD
#include "../shroom_labs_cloud/shroom_labs_cloud.h"
#endif

#include <cmath>
#include <ctime>

namespace esphome {
namespace shroom_labs_local_api {

static const char *const TAG = "shroom_labs_local_api";

using web_server_idf::AsyncWebHandler;
using web_server_idf::AsyncWebServerRequest;
using ::sl_local::OptB;
using ::sl_local::OptF;
using ::sl_local::OptI;
using ::sl_local::OptS;
using ::sl_local::OptU;
using ::sl_local::Reading;
using ::sl_local::Snapshot;

static void add_cors(AsyncWebServerRequest *request, AsyncWebServerResponse *res) {
  res->addHeader("Access-Control-Allow-Origin", "*");
  res->addHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res->addHeader("Access-Control-Allow-Headers", "Content-Type");
  res->addHeader("Cache-Control", "no-store");
  (void) request;
}

#ifdef USE_NUMBER
static OptF from_number(number::Number *n) {
  OptF o;
  if (n != nullptr && n->has_state() && std::isfinite(n->state)) {
    o.has = true;
    o.value = n->state;
  }
  return o;
}
#else
static OptF from_number(number::Number *) { return OptF{}; }
#endif

#ifdef USE_SENSOR
static OptF from_sensor(sensor::Sensor *s) {
  OptF o;
  if (s != nullptr && s->has_state() && std::isfinite(s->state)) {
    o.has = true;
    o.value = s->state;
  }
  return o;
}
#else
static OptF from_sensor(sensor::Sensor *) { return OptF{}; }
#endif

#ifdef USE_NUMBER
static OptI from_number_i(number::Number *n) {
  OptI o;
  if (n != nullptr && n->has_state() && std::isfinite(n->state)) {
    o.has = true;
    o.value = static_cast<int32_t>(lroundf(n->state));
  }
  return o;
}
#else
static OptI from_number_i(number::Number *) { return OptI{}; }
#endif

#ifdef USE_SWITCH
static OptB from_switch(switch_::Switch *s) {
  OptB o;
  if (s != nullptr) {
    o.has = true;
    o.value = s->state;
  }
  return o;
}
#else
static OptB from_switch(switch_::Switch *) { return OptB{}; }
#endif

#ifdef USE_BINARY_SENSOR
static OptB from_binary(binary_sensor::BinarySensor *s) {
  OptB o;
  if (s != nullptr && s->has_state()) {
    o.has = true;
    o.value = s->state;
  }
  return o;
}
#else
static OptB from_binary(binary_sensor::BinarySensor *) { return OptB{}; }
#endif

#ifdef USE_TEXT_SENSOR
static OptS from_text(text_sensor::TextSensor *s) {
  OptS o;
  if (s != nullptr && s->has_state()) {
    o.has = true;
    o.value = s->state;
  }
  return o;
}
#else
static OptS from_text(text_sensor::TextSensor *) { return OptS{}; }
#endif

#ifdef USE_SELECT
static OptS from_select(select::Select *s) {
  OptS o;
  if (s != nullptr) {
    const std::string opt = s->current_option();
    if (!opt.empty()) {
      o.has = true;
      o.value = opt;
    }
  }
  return o;
}
#else
static OptS from_select(select::Select *) { return OptS{}; }
#endif

static Reading reading_from(sensor::Sensor *s, uint32_t *last_good_ms, int64_t ts_unix) {
  Reading r;
  r.value = from_sensor(s);
  if (last_good_ms != nullptr && *last_good_ms != 0) {
    r.age_ms.has = true;
    r.age_ms.value = millis() - *last_good_ms;
  }
  if (ts_unix > 0 && r.value.has) {
    r.ts_unix.has = true;
    r.ts_unix.value = static_cast<int32_t>(ts_unix);
  }
  return r;
}

static bool alert_is_empty(const std::string &s) {
  if (s.empty())
    return true;
  return s == "OK" || s == "ok" || s == "none" || s == "None" || s == "-" || s == "[]";
}

class StatusPage : public AsyncWebHandler {
 public:
  explicit StatusPage(ShroomLabsLocalApi *api) : api_(api) {}

  bool canHandle(AsyncWebServerRequest *request) const override {
    char buf[AsyncWebServerRequest::URL_BUF_SIZE];
    return ::sl_local::owns_url(request->url_to(buf).c_str());
  }

  void handleRequest(AsyncWebServerRequest *request) override {
    char buf[AsyncWebServerRequest::URL_BUF_SIZE];
    const std::string url(request->url_to(buf));
    const auto method = request->method();

    if (method == HTTP_OPTIONS) {
      auto *res = request->beginResponse(200, "text/plain", "");
      add_cors(request, res);
      res->addHeader("Access-Control-Max-Age", "86400");
      request->send(res);
      return;
    }
    if (method != HTTP_GET) {
      auto *res = request->beginResponse(405, "text/plain", "Method Not Allowed");
      add_cors(request, res);
      res->addHeader("Allow", "GET, OPTIONS");
      request->send(res);
      return;
    }
    if (::sl_local::schema_url(url.c_str())) {
      auto *res = request->beginResponse(200, "application/json", ::sl_local::status_schema_json());
      add_cors(request, res);
      request->send(res);
      return;
    }
    auto *res = request->beginResponse(200, "application/json", this->api_->status_body());
    add_cors(request, res);
    request->send(res);
  }

 protected:
  ShroomLabsLocalApi *api_;
};

void ShroomLabsLocalApi::setup() {
  this->base_->add_handler_without_auth(new StatusPage(this));  // NOLINT(cppcoreguidelines-owning-memory)
  ESP_LOGI(TAG, "Read-only local status is at GET /api/status");
}

std::string ShroomLabsLocalApi::status_body() const {
  Snapshot snap;
  snap.device_type = this->device_type_;
  snap.model = this->model_;
  snap.name = App.get_name();
  {
    const auto friendly = App.get_friendly_name();
    if (friendly.size() > 0)
      snap.name.assign(friendly.c_str(), friendly.size());
  }
  snap.firmware = this->firmware_;
  snap.light_white_is_lux = this->light_white_is_lux_;
  snap.uptime_s.has = true;
  snap.uptime_s.value = millis() / 1000;

  time_t now = time(nullptr);
  const int64_t ts_unix = (now >= 1700000000) ? static_cast<int64_t>(now) : 0;

  snap.temperature_c = reading_from(this->temperature_, this->last_good_ms_, ts_unix);
  snap.humidity_pct = reading_from(this->humidity_, this->last_good_ms_, ts_unix);
  snap.fan_rpm = reading_from(this->fan_rpm_, nullptr, ts_unix);
  snap.co2_ppm = reading_from(this->co2_, nullptr, ts_unix);

  snap.temperature_target_c = from_number(this->temperature_target_);
  snap.temperature_tolerance_c = from_number(this->temperature_tolerance_);
  snap.humidity_target_pct = from_number(this->humidity_target_);
  snap.humidity_tolerance_pct = from_number(this->humidity_tolerance_);

  snap.stage_native = from_select(this->stage_);

  snap.light_enabled = from_switch(this->light_enabled_);
  snap.light_on = from_binary(this->light_on_);
  if (!snap.light_on.has && this->light_enabled_ != nullptr)
    snap.light_on = from_switch(this->light_enabled_);
  snap.sunrise_hour = from_number_i(this->sunrise_hour_);
  snap.light_hours = from_number_i(this->light_hours_);
  snap.light_r = from_number(this->light_r_);
  snap.light_g = from_number(this->light_g_);
  snap.light_b = from_number(this->light_b_);
  snap.light_white = from_number(this->light_white_);
  snap.light_brightness = from_number(this->light_brightness_);
  snap.light_status = from_text(this->light_status_);

  if (this->fan_in_pct_ != nullptr) {
    snap.fan_in_pct.has = true;
    snap.fan_in_pct.value = *this->fan_in_pct_;
  }
  if (this->fan_out_pct_ != nullptr) {
    snap.fan_out_pct.has = true;
    snap.fan_out_pct.value = *this->fan_out_pct_;
  }
  snap.fan_speed_set_pct = from_number(this->fae_speed_);
  snap.fan_on = from_binary(this->fae_on_);
  if (this->fan_boost_ != nullptr) {
    snap.fan_boost.has = true;
    snap.fan_boost.value = *this->fan_boost_;
  }
  snap.fan_status = from_text(this->fae_status_);
  if (!snap.fan_on.has) {
    bool moving = false;
    if (snap.fan_in_pct.has && snap.fan_in_pct.value > 0.5f)
      moving = true;
    if (snap.fan_out_pct.has && snap.fan_out_pct.value > 0.5f)
      moving = true;
    if (moving) {
      snap.fan_on.has = true;
      snap.fan_on.value = true;
    }
  }

  snap.humidifier_on = from_binary(this->humidifier_on_);
  if (!snap.humidifier_on.has)
    snap.humidifier_on = from_switch(this->humidifier_switch_);
  snap.humidifier_level_pct = from_number(this->humidifier_level_);
  snap.humidifier_status = from_text(this->humidifier_status_);

  snap.fae_every_min = from_number_i(this->fae_period_min_);
  snap.fae_run_s = from_number_i(this->fae_run_s_);
  snap.fae_speed_pct = from_number(this->fae_speed_);

  snap.climate_mode = from_select(this->climate_mode_);

#ifdef USE_SHROOM_LABS_CLOUD
  if (this->cloud_ != nullptr) {
    snap.coach_linked.has = true;
    snap.coach_linked.value = this->cloud_->linked();
    snap.coach_enabled.has = true;
    snap.coach_enabled.value = this->cloud_->cloud_enabled();
    snap.coach_remote_apply.has = true;
    snap.coach_remote_apply.value = this->cloud_->remote_apply();
    snap.coach_state.has = true;
    if (this->cloud_->linked())
      snap.coach_state.value = "linked";
    else if (this->cloud_->cloud_enabled())
      snap.coach_state.value = "enabled";
    else
      snap.coach_state.value = "off";
    snap.growing_id = this->cloud_->grow_id();
    snap.growing_name = this->cloud_->grow_name();
    snap.growing_image_url = this->cloud_->grow_image_url();
  }
#endif

  bool stale = false;
  bool stale_known = false;
  if (this->last_good_ms_ != nullptr) {
    stale_known = true;
    stale = (millis() - *this->last_good_ms_) > this->sensor_stale_after_ms_ || *this->last_good_ms_ == 0;
  } else if (this->temperature_ != nullptr || this->humidity_ != nullptr) {
    stale_known = true;
    const bool t_ok = this->temperature_ == nullptr || from_sensor(this->temperature_).has;
    const bool h_ok = this->humidity_ == nullptr || from_sensor(this->humidity_).has;
    stale = !(t_ok && h_ok);
  }
  if (stale_known) {
    snap.sensor_stale.has = true;
    snap.sensor_stale.value = stale;
  }

  if (wifi::global_wifi_component != nullptr) {
    snap.wifi_connected.has = true;
    snap.wifi_connected.value = wifi::global_wifi_component->is_connected();
    if (snap.wifi_connected.value) {
      snap.wifi_rssi_dbm.has = true;
      snap.wifi_rssi_dbm.value = wifi::global_wifi_component->wifi_rssi();
    }
  }
  if (!snap.wifi_rssi_dbm.has) {
    OptF rssi = from_sensor(this->wifi_rssi_sensor_);
    if (rssi.has) {
      snap.wifi_rssi_dbm.has = true;
      snap.wifi_rssi_dbm.value = static_cast<int32_t>(lroundf(rssi.value));
    }
  }

  OptS alerts = from_text(this->alerts_);
  if (alerts.has && !alert_is_empty(alerts.value)) {
    snap.health_errors.has = true;
    snap.health_errors.value = alerts.value;
  }

  return ::sl_local::status_json(snap);
}

}  // namespace shroom_labs_local_api
}  // namespace esphome
