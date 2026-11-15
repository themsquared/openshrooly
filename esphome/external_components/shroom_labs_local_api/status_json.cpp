#include "status_json.h"

#include <cmath>
#include <cstdio>
#include <cstring>

namespace sl_local {

static bool ieq(const char *a, const char *b) {
  if (a == nullptr || b == nullptr)
    return false;
  while (*a && *b) {
    char ca = *a;
    char cb = *b;
    if (ca >= 'A' && ca <= 'Z')
      ca = static_cast<char>(ca - 'A' + 'a');
    if (cb >= 'A' && cb <= 'Z')
      cb = static_cast<char>(cb - 'A' + 'a');
    if (ca != cb)
      return false;
    ++a;
    ++b;
  }
  return *a == 0 && *b == 0;
}

const char *canonical_stage(const char *native) {
  if (native == nullptr || *native == 0)
    return nullptr;
  if (ieq(native, "colonization") || ieq(native, "colonizing"))
    return "Colonization";
  if (ieq(native, "pinning"))
    return "Pinning";
  if (ieq(native, "fruiting"))
    return "Fruiting";
  if (ieq(native, "custom"))
    return "Custom";
  return nullptr;
}

float white_lux_to_percent(float lux) {
  if (!(lux > 0))
    return 0;
  if (lux > 4000.0f)
    lux = 4000.0f;
  if (lux <= 92.0f)
    return (lux / 92.0f) * 20.0f;
  float pct = std::pow(lux / 0.02307f, 1.0f / 2.768f);
  if (pct > 100.0f)
    return 100.0f;
  return pct;
}

std::string escape_json(const std::string &in) {
  std::string out;
  out.reserve(in.size());
  for (unsigned char ch : in) {
    if (ch == '"' || ch == '\\') {
      out.push_back('\\');
      out.push_back(static_cast<char>(ch));
    } else if (ch < 0x20) {
      char buf[8];
      std::snprintf(buf, sizeof(buf), "\\u%04x", ch);
      out += buf;
    } else {
      out.push_back(static_cast<char>(ch));
    }
  }
  return out;
}

static void add_str(std::string &o, const char *key, const std::string &v, bool *first) {
  if (!*first)
    o += ',';
  *first = false;
  o += '"';
  o += key;
  o += "\":\"";
  o += escape_json(v);
  o += '"';
}

static void add_raw(std::string &o, const char *key, const char *raw, bool *first) {
  if (!*first)
    o += ',';
  *first = false;
  o += '"';
  o += key;
  o += "\":";
  o += raw;
}

static void add_null(std::string &o, const char *key, bool *first) { add_raw(o, key, "null", first); }

static void add_bool(std::string &o, const char *key, const OptB &v, bool *first) {
  if (!v.has)
    add_null(o, key, first);
  else
    add_raw(o, key, v.value ? "true" : "false", first);
}

static void add_i(std::string &o, const char *key, int32_t v, bool *first) {
  char buf[16];
  std::snprintf(buf, sizeof(buf), "%d", static_cast<int>(v));
  add_raw(o, key, buf, first);
}

static void add_u(std::string &o, const char *key, uint32_t v, bool *first) {
  char buf[16];
  std::snprintf(buf, sizeof(buf), "%u", static_cast<unsigned>(v));
  add_raw(o, key, buf, first);
}

static void add_fixed(std::string &o, const char *key, float v, int decimals, bool *first) {
  char buf[32];
  if (decimals <= 0)
    std::snprintf(buf, sizeof(buf), "%.0f", v);
  else if (decimals == 1)
    std::snprintf(buf, sizeof(buf), "%.1f", v);
  else
    std::snprintf(buf, sizeof(buf), "%.2f", v);
  add_raw(o, key, buf, first);
}

static bool finite_num(const OptF &v) { return v.has && std::isfinite(v.value); }

static void add_opt_f(std::string &o, const char *key, const OptF &v, int decimals, bool *first) {
  if (!finite_num(v))
    add_null(o, key, first);
  else
    add_fixed(o, key, v.value, decimals, first);
}

static void add_opt_i(std::string &o, const char *key, const OptI &v, bool *first) {
  if (!v.has)
    add_null(o, key, first);
  else
    add_i(o, key, v.value, first);
}

static int clamp_pct(float v) {
  int n = static_cast<int>(std::lroundf(v));
  if (n < 0)
    return 0;
  if (n > 100)
    return 100;
  return n;
}

static void add_pct(std::string &o, const char *key, const OptF &v, bool *first) {
  if (!finite_num(v))
    add_null(o, key, first);
  else
    add_i(o, key, clamp_pct(v.value), first);
}

static void add_opt_str(std::string &o, const char *key, const std::string &v, bool *first) {
  if (v.empty())
    add_null(o, key, first);
  else
    add_str(o, key, v, first);
}

static OptF actual_fan_speed(const Snapshot &s) {
  if (s.fan_in_pct.has || s.fan_out_pct.has) {
    float a = 0;
    bool any = false;
    if (finite_num(s.fan_in_pct)) {
      a = s.fan_in_pct.value;
      any = true;
    }
    if (finite_num(s.fan_out_pct) && s.fan_out_pct.value > a) {
      a = s.fan_out_pct.value;
      any = true;
    }
    OptF out;
    if (any) {
      out.has = true;
      out.value = a;
    }
    return out;
  }
  OptF speed = s.fae_speed_pct.has ? s.fae_speed_pct : s.fan_speed_set_pct;
  if (s.fan_on.has && speed.has) {
    OptF out;
    out.has = true;
    out.value = s.fan_on.value ? speed.value : 0;
    return out;
  }
  return {};
}

static OptF white_as_percent(const Snapshot &s) {
  if (!finite_num(s.light_white))
    return {};
  OptF out;
  out.has = true;
  out.value = s.light_white_is_lux ? white_lux_to_percent(s.light_white.value) : s.light_white.value;
  return out;
}

static void write_errors(std::string &o, const Snapshot &s, bool *first) {
  if (!s.health_errors.has || s.health_errors.value.empty()) {
    add_raw(o, "errors", "[]", first);
    return;
  }
  if (s.health_errors_is_json_array) {
    add_raw(o, "errors", s.health_errors.value.c_str(), first);
    return;
  }
  const std::string &raw = s.health_errors.value;
  if (!raw.empty() && raw.front() == '[') {
    add_raw(o, "errors", raw.c_str(), first);
    return;
  }
  std::string arr = "[\"";
  arr += escape_json(raw);
  arr += "\"]";
  add_raw(o, "errors", arr.c_str(), first);
}

std::string status_json(const Snapshot &s) {
  std::string o;
  o.reserve(900);
  o += '{';
  bool first = true;
  add_i(o, "api_version", kApiVersion, &first);
  add_opt_str(o, "chamber_name", s.name, &first);
  add_opt_str(o, "chamber_type", s.device_type, &first);

  o += ",\"growing\":{";
  bool gfirst = true;
  add_opt_str(o, "id", s.growing_id, &gfirst);
  add_opt_str(o, "name", s.growing_name, &gfirst);
  add_opt_str(o, "image_url", s.growing_image_url, &gfirst);
  o += '}';
  first = false;

  o += ",\"stage\":{";
  bool sfirst = true;
  const char *canon = s.stage_native.has ? canonical_stage(s.stage_native.value.c_str()) : nullptr;
  if (canon == nullptr)
    add_null(o, "name", &sfirst);
  else
    add_str(o, "name", canon, &sfirst);
  if (s.stage_native.has && !s.stage_native.value.empty())
    add_str(o, "native", s.stage_native.value, &sfirst);
  else
    add_null(o, "native", &sfirst);
  o += '}';

  o += ",\"temperature\":{";
  bool tfirst = true;
  add_opt_f(o, "target_c", s.temperature_target_c, 1, &tfirst);
  add_opt_f(o, "tolerance_c", s.temperature_tolerance_c, 1, &tfirst);
  add_opt_f(o, "actual_c", s.temperature_c.value, 1, &tfirst);
  if (s.temperature_c.age_ms.has)
    add_u(o, "age_ms", s.temperature_c.age_ms.value, &tfirst);
  else
    add_null(o, "age_ms", &tfirst);
  o += '}';

  o += ",\"humidity\":{";
  bool hfirst = true;
  add_opt_f(o, "target_pct", s.humidity_target_pct, 1, &hfirst);
  add_opt_f(o, "tolerance_pct", s.humidity_tolerance_pct, 1, &hfirst);
  add_opt_f(o, "actual_pct", s.humidity_pct.value, 1, &hfirst);
  if (s.humidity_pct.age_ms.has)
    add_u(o, "age_ms", s.humidity_pct.age_ms.value, &hfirst);
  else
    add_null(o, "age_ms", &hfirst);
  o += '}';

  o += ",\"fan\":{";
  bool ffirst = true;
  OptF speed = s.fae_speed_pct.has ? s.fae_speed_pct : s.fan_speed_set_pct;
  add_pct(o, "speed_pct", speed, &ffirst);
  add_pct(o, "actual_speed_pct", actual_fan_speed(s), &ffirst);
  add_opt_i(o, "every_min", s.fae_every_min, &ffirst);
  add_opt_i(o, "run_s", s.fae_run_s, &ffirst);
  o += '}';

  o += ",\"light\":{";
  bool lfirst = true;
  add_bool(o, "on", s.light_on, &lfirst);
  add_bool(o, "enabled", s.light_enabled, &lfirst);
  const bool any_rgba = finite_num(s.light_r) || finite_num(s.light_g) || finite_num(s.light_b) || finite_num(s.light_white);
  if (!any_rgba) {
    add_null(o, "rgba", &lfirst);
  } else {
    o += ",\"rgba\":{";
    bool rfirst = true;
    add_pct(o, "r", s.light_r, &rfirst);
    add_pct(o, "g", s.light_g, &rfirst);
    add_pct(o, "b", s.light_b, &rfirst);
    add_pct(o, "a", white_as_percent(s), &rfirst);
    o += '}';
    lfirst = false;
  }
  add_opt_i(o, "sunrise_hour", s.sunrise_hour, &lfirst);
  add_opt_i(o, "hours", s.light_hours, &lfirst);
  add_pct(o, "brightness_pct", s.light_brightness, &lfirst);
  o += '}';

  o += ",\"detail\":{";
  bool dfirst = true;
  add_opt_str(o, "model", s.model, &dfirst);
  add_opt_str(o, "firmware", s.firmware, &dfirst);
  if (s.uptime_s.has)
    add_u(o, "uptime_s", s.uptime_s.value, &dfirst);
  else
    add_null(o, "uptime_s", &dfirst);
  add_opt_f(o, "fan_rpm", s.fan_rpm.value, 0, &dfirst);
  add_opt_f(o, "co2_ppm", s.co2_ppm.value, 0, &dfirst);
  add_pct(o, "fan_in_pct", s.fan_in_pct, &dfirst);
  add_pct(o, "fan_out_pct", s.fan_out_pct, &dfirst);
  add_bool(o, "fan_boost", s.fan_boost, &dfirst);
  add_bool(o, "fan_on", s.fan_on, &dfirst);
  if (s.fan_status.has && !s.fan_status.value.empty())
    add_str(o, "fan_status", s.fan_status.value, &dfirst);
  add_bool(o, "humidifier_on", s.humidifier_on, &dfirst);
  add_pct(o, "humidifier_level_pct", s.humidifier_level_pct, &dfirst);
  if (s.humidifier_status.has && !s.humidifier_status.value.empty())
    add_str(o, "humidifier_status", s.humidifier_status.value, &dfirst);
  if (s.climate_mode.has && !s.climate_mode.value.empty())
    add_str(o, "climate_mode", s.climate_mode.value, &dfirst);
  if (s.light_status.has && !s.light_status.value.empty())
    add_str(o, "light_status", s.light_status.value, &dfirst);
  if (s.light_white_is_lux && finite_num(s.light_white))
    add_fixed(o, "white_lux", s.light_white.value, 0, &dfirst);
  add_bool(o, "coach_linked", s.coach_linked, &dfirst);
  add_bool(o, "coach_enabled", s.coach_enabled, &dfirst);
  add_bool(o, "coach_remote_apply", s.coach_remote_apply, &dfirst);
  if (s.coach_state.has && !s.coach_state.value.empty())
    add_str(o, "coach_state", s.coach_state.value, &dfirst);
  if (s.wifi_rssi_dbm.has)
    add_i(o, "wifi_rssi_dbm", s.wifi_rssi_dbm.value, &dfirst);
  else
    add_null(o, "wifi_rssi_dbm", &dfirst);
  o += '}';

  o += ",\"health\":{";
  bool efirst = true;
  add_bool(o, "sensor_stale", s.sensor_stale, &efirst);
  add_bool(o, "wifi_connected", s.wifi_connected, &efirst);
  write_errors(o, s, &efirst);
  o += '}';

  o += '}';
  return o;
}

static const char *const kSchema = R"({"api_version":1,"units":{"temperature":"celsius","humidity":"percent","fan.speed_pct":"0-100","fan.every_min":"minutes","fan.run_s":"seconds","light.rgba":"0-100 integers, A is the white channel"},"stage_names":["Colonization","Pinning","Fruiting","Custom"],"chamber_types":["shrooly_chamber","lykyn_chamber"],"fields":["chamber_name","chamber_type","growing","stage","temperature","humidity","fan","light","detail","health"]})";

const char *status_schema_json() { return kSchema; }

}  // namespace sl_local
