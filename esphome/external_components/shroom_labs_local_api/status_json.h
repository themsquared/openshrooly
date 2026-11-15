#pragma once

#include <cstdint>
#include <string>

namespace sl_local {

constexpr int kApiVersion = 1;

// Canonical stage names: Colonization, Pinning, Fruiting, Custom.
// "Colonizing" (Shrooly native) maps to Colonization.
// Returns nullptr when the native name is not one of those four (Idle, Harvest, empty, unknown).
const char *canonical_stage(const char *native);

// Same curve as community/api/src/profile-schema.js whiteLuxToPercent.
// 0-92 lux is linear to 0-20%. Above that, percent = (lux / 0.02307) ^ (1/2.768), cap 100.
// 4000 lux (the Shrooly white entity max) is about 78%.
float white_lux_to_percent(float lux);

struct OptF {
  bool has = false;
  float value = 0;
};

struct OptI {
  bool has = false;
  int32_t value = 0;
};

struct OptU {
  bool has = false;
  uint32_t value = 0;
};

struct OptB {
  bool has = false;
  bool value = false;
};

struct OptS {
  bool has = false;
  std::string value;
};

struct Reading {
  OptF value;
  OptU age_ms;
  OptI ts_unix;  // seconds since epoch, only when the clock is synced
};

struct Snapshot {
  std::string device_type;
  std::string model;
  std::string name;
  std::string firmware;
  OptU uptime_s;

  std::string growing_id;
  std::string growing_name;
  std::string growing_image_url;

  Reading temperature_c;
  Reading humidity_pct;
  Reading fan_rpm;
  Reading co2_ppm;

  OptF temperature_target_c;
  OptF temperature_tolerance_c;
  OptF humidity_target_pct;
  OptF humidity_tolerance_pct;

  OptS stage_native;

  OptB light_enabled;
  OptB light_on;
  OptI sunrise_hour;
  OptI light_hours;
  OptF light_r;
  OptF light_g;
  OptF light_b;
  OptF light_white;
  OptF light_brightness;
  OptS light_status;
  bool light_white_is_lux = false;

  OptF fan_in_pct;
  OptF fan_out_pct;
  OptF fan_speed_set_pct;
  OptB fan_on;
  OptB fan_boost;
  OptS fan_status;

  OptB humidifier_on;
  OptF humidifier_level_pct;
  OptS humidifier_status;

  OptI fae_every_min;
  OptI fae_run_s;
  OptF fae_speed_pct;

  OptS climate_mode;

  OptB coach_linked;
  OptB coach_enabled;
  OptB coach_remote_apply;
  OptS coach_state;
  OptU last_check_in_age_s;

  OptB sensor_stale;
  OptB wifi_connected;
  OptI wifi_rssi_dbm;
  OptS health_errors;  // already a JSON array string, or a plain message
  bool health_errors_is_json_array = false;
};

std::string status_json(const Snapshot &s);
const char *status_schema_json();

std::string escape_json(const std::string &in);

}  // namespace sl_local
