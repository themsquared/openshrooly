#include "status_json.h"

#include <cmath>
#include <cstdio>
#include <cstring>
#include <strings.h>

namespace sl_local {

static bool eq_ci(const char *a, const char *b) {
  if (a == nullptr || b == nullptr)
    return a == b;
  return strcasecmp(a, b) == 0;
}

const char *normalize_stage(const char *native) {
  if (native == nullptr || native[0] == '\0')
    return "unknown";
  if (eq_ci(native, "Colonization") || eq_ci(native, "Colonizing"))
    return "colonization";
  if (eq_ci(native, "Pinning"))
    return "pinning";
  if (eq_ci(native, "Fruiting"))
    return "fruiting";
  if (eq_ci(native, "Harvest"))
    return "harvest";
  if (eq_ci(native, "Idle"))
    return "idle";
  if (eq_ci(native, "Custom"))
    return "custom";
  return "unknown";
}

static bool finite_f(float v) { return std::isfinite(v); }

static void append_escaped(std::string *out, const char *s) {
  if (s == nullptr) {
    out->append("null");
    return;
  }
  out->push_back('"');
  for (const char *p = s; *p != '\0'; p++) {
    const unsigned char c = static_cast<unsigned char>(*p);
    switch (c) {
      case '"':
        out->append("\\\"");
        break;
      case '\\':
        out->append("\\\\");
        break;
      case '\b':
        out->append("\\b");
        break;
      case '\f':
        out->append("\\f");
        break;
      case '\n':
        out->append("\\n");
        break;
      case '\r':
        out->append("\\r");
        break;
      case '\t':
        out->append("\\t");
        break;
      default:
        if (c < 0x20) {
          char buf[8];
          snprintf(buf, sizeof(buf), "\\u%04x", c);
          out->append(buf);
        } else {
          out->push_back(static_cast<char>(c));
        }
        break;
    }
  }
  out->push_back('"');
}

static void append_escaped_s(std::string *out, const std::string &s) { append_escaped(out, s.c_str()); }

static void append_float(std::string *out, float v, int decimals) {
  if (!finite_f(v)) {
    out->append("null");
    return;
  }
  char buf[32];
  snprintf(buf, sizeof(buf), "%.*f", decimals, v);
  out->append(buf);
}

static void append_opt_f(std::string *out, const char *key, const OptF &v, int decimals, bool *first) {
  if (*first)
    *first = false;
  else
    out->push_back(',');
  out->push_back('"');
  out->append(key);
  out->append("\":");
  if (!v.has || !finite_f(v.value))
    out->append("null");
  else
    append_float(out, v.value, decimals);
}

static void append_opt_i(std::string *out, const char *key, const OptI &v, bool *first) {
  if (*first)
    *first = false;
  else
    out->push_back(',');
  out->push_back('"');
  out->append(key);
  out->append("\":");
  if (!v.has)
    out->append("null");
  else
    out->append(std::to_string(v.value));
}

static void append_opt_u(std::string *out, const char *key, const OptU &v, bool *first) {
  if (*first)
    *first = false;
  else
    out->push_back(',');
  out->push_back('"');
  out->append(key);
  out->append("\":");
  if (!v.has)
    out->append("null");
  else
    out->append(std::to_string(v.value));
}

static void append_opt_b(std::string *out, const char *key, const OptB &v, bool *first) {
  if (*first)
    *first = false;
  else
    out->push_back(',');
  out->push_back('"');
  out->append(key);
  out->append("\":");
  if (!v.has)
    out->append("null");
  else
    out->append(v.value ? "true" : "false");
}

static void append_opt_s(std::string *out, const char *key, const OptS &v, bool *first) {
  if (*first)
    *first = false;
  else
    out->push_back(',');
  out->push_back('"');
  out->append(key);
  out->append("\":");
  if (!v.has)
    out->append("null");
  else
    append_escaped_s(out, v.value);
}

static void append_reading(std::string *out, const char *key, const Reading &r, int decimals, bool *first) {
  if (*first)
    *first = false;
  else
    out->push_back(',');
  out->push_back('"');
  out->append(key);
  out->append("\":{");
  bool f = true;
  append_opt_f(out, "value", r.value, decimals, &f);
  append_opt_u(out, "age_ms", r.age_ms, &f);
  append_opt_i(out, "ts_unix", r.ts_unix, &f);
  out->push_back('}');
}

static void append_errors(std::string *out, const OptS &errors, bool is_json_array, bool *first) {
  if (*first)
    *first = false;
  else
    out->push_back(',');
  out->append("\"errors\":");
  if (!errors.has || errors.value.empty()) {
    out->append("[]");
    return;
  }
  if (is_json_array) {
    out->append(errors.value);
    return;
  }
  out->push_back('[');
  append_escaped_s(out, errors.value);
  out->push_back(']');
}

std::string status_json(const Snapshot &s) {
  std::string out;
  out.reserve(1600);
  out.append("{\"api_version\":");
  out.append(std::to_string(kApiVersion));

  out.append(",\"device\":{");
  bool f = true;
  auto req_s = [&](const char *key, const std::string &v) {
    if (f)
      f = false;
    else
      out.push_back(',');
    out.push_back('"');
    out.append(key);
    out.append("\":");
    append_escaped_s(&out, v);
  };
  req_s("type", s.device_type);
  req_s("model", s.model);
  req_s("name", s.name);
  req_s("firmware", s.firmware);
  append_opt_u(&out, "uptime_s", s.uptime_s, &f);
  out.append("}");

  out.append(",\"readings\":{");
  f = true;
  append_reading(&out, "temperature_c", s.temperature_c, 2, &f);
  append_reading(&out, "humidity_pct", s.humidity_pct, 2, &f);
  append_reading(&out, "fan_rpm", s.fan_rpm, 0, &f);
  append_reading(&out, "co2_ppm", s.co2_ppm, 0, &f);
  out.append("}");

  out.append(",\"targets\":{");
  f = true;
  append_opt_f(&out, "temperature_c", s.temperature_target_c, 1, &f);
  append_opt_f(&out, "temperature_tolerance_c", s.temperature_tolerance_c, 1, &f);
  append_opt_f(&out, "humidity_pct", s.humidity_target_pct, 1, &f);
  append_opt_f(&out, "humidity_tolerance_pct", s.humidity_tolerance_pct, 1, &f);
  out.append("}");

  out.append(",\"stage\":{");
  f = true;
  const char *norm = normalize_stage(s.stage_native.has ? s.stage_native.value.c_str() : nullptr);
  if (f)
    f = false;
  else
    out.push_back(',');
  out.append("\"normalized\":");
  append_escaped(&out, norm);
  append_opt_s(&out, "native", s.stage_native, &f);
  out.append("}");

  out.append(",\"light\":{");
  f = true;
  append_opt_b(&out, "enabled", s.light_enabled, &f);
  append_opt_b(&out, "on", s.light_on, &f);
  if (f)
    f = false;
  else
    out.push_back(',');
  out.append("\"schedule\":{");
  bool sf = true;
  append_opt_i(&out, "sunrise_hour", s.sunrise_hour, &sf);
  append_opt_i(&out, "hours", s.light_hours, &sf);
  out.append("},\"mix\":{");
  bool mf = true;
  append_opt_f(&out, "r", s.light_r, 0, &mf);
  append_opt_f(&out, "g", s.light_g, 0, &mf);
  append_opt_f(&out, "b", s.light_b, 0, &mf);
  append_opt_f(&out, "white", s.light_white, 0, &mf);
  append_opt_f(&out, "brightness", s.light_brightness, 0, &mf);
  out.append("}");
  append_opt_s(&out, "status", s.light_status, &f);
  out.append("}");

  out.append(",\"fans\":{");
  f = true;
  append_opt_f(&out, "in_pct", s.fan_in_pct, 0, &f);
  append_opt_f(&out, "out_pct", s.fan_out_pct, 0, &f);
  append_opt_f(&out, "speed_set_pct", s.fan_speed_set_pct, 0, &f);
  append_opt_b(&out, "on", s.fan_on, &f);
  append_opt_b(&out, "boost", s.fan_boost, &f);
  append_opt_s(&out, "status", s.fan_status, &f);
  out.append("}");

  out.append(",\"humidifier\":{");
  f = true;
  append_opt_b(&out, "on", s.humidifier_on, &f);
  append_opt_f(&out, "level_pct", s.humidifier_level_pct, 0, &f);
  append_opt_s(&out, "status", s.humidifier_status, &f);
  out.append("}");

  out.append(",\"fae\":{");
  f = true;
  append_opt_i(&out, "every_min", s.fae_every_min, &f);
  append_opt_i(&out, "run_s", s.fae_run_s, &f);
  append_opt_f(&out, "speed_pct", s.fae_speed_pct, 0, &f);
  out.append("}");

  out.append(",\"climate\":{");
  f = true;
  append_opt_s(&out, "mode", s.climate_mode, &f);
  append_opt_b(&out, "fan_boost", s.fan_boost, &f);
  out.append("}");

  out.append(",\"coach\":{");
  f = true;
  append_opt_b(&out, "linked", s.coach_linked, &f);
  append_opt_b(&out, "enabled", s.coach_enabled, &f);
  append_opt_b(&out, "remote_apply", s.coach_remote_apply, &f);
  append_opt_s(&out, "state", s.coach_state, &f);
  append_opt_u(&out, "last_check_in_age_s", s.last_check_in_age_s, &f);
  out.append("}");

  out.append(",\"health\":{");
  f = true;
  append_opt_b(&out, "sensor_stale", s.sensor_stale, &f);
  append_opt_b(&out, "wifi_connected", s.wifi_connected, &f);
  append_opt_i(&out, "wifi_rssi_dbm", s.wifi_rssi_dbm, &f);
  append_errors(&out, s.health_errors, s.health_errors_is_json_array, &f);
  out.append("}}");
  return out;
}

const char *status_schema_json() {
  // Compact field guide, not a full JSON Schema draft. Same keys as GET /api/status.
  return R"JSON({"api_version":1,"title":"Shroom Labs local status","read_only":true,"notes":"Missing capabilities are JSON null, never omitted. No secrets, no Wi-Fi credentials, no MAC, no claim code. Temperature is Celsius. Readings include age_ms when the firmware knows it, and ts_unix only when the clock is synced. stage.normalized is colonization, pinning, fruiting, harvest, idle, custom, or unknown. stage.native is the device's own name (Colonization on Lykyn, Colonizing on Shrooly).","properties":{"api_version":"number","device":{"type":"string","model":"string","name":"string","firmware":"string","uptime_s":"number|null"},"readings":{"temperature_c":{"value":"number|null","age_ms":"number|null","ts_unix":"number|null"},"humidity_pct":{"value":"number|null","age_ms":"number|null","ts_unix":"number|null"},"fan_rpm":{"value":"number|null","age_ms":"number|null","ts_unix":"number|null"},"co2_ppm":{"value":"number|null","age_ms":"number|null","ts_unix":"number|null"}},"targets":{"temperature_c":"number|null","temperature_tolerance_c":"number|null","humidity_pct":"number|null","humidity_tolerance_pct":"number|null"},"stage":{"normalized":"string","native":"string|null"},"light":{"enabled":"boolean|null","on":"boolean|null","schedule":{"sunrise_hour":"number|null","hours":"number|null"},"mix":{"r":"number|null","g":"number|null","b":"number|null","white":"number|null","brightness":"number|null"},"status":"string|null"},"fans":{"in_pct":"number|null","out_pct":"number|null","speed_set_pct":"number|null","on":"boolean|null","boost":"boolean|null","status":"string|null"},"humidifier":{"on":"boolean|null","level_pct":"number|null","status":"string|null"},"fae":{"every_min":"number|null","run_s":"number|null","speed_pct":"number|null"},"climate":{"mode":"string|null","fan_boost":"boolean|null"},"coach":{"linked":"boolean|null","enabled":"boolean|null","remote_apply":"boolean|null","state":"string|null","last_check_in_age_s":"number|null"},"health":{"sensor_stale":"boolean|null","wifi_connected":"boolean|null","wifi_rssi_dbm":"number|null","errors":["string"]}}})JSON";
}

}  // namespace sl_local
