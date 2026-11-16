#include "status_json.h"
#include "status_paths.h"

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

static int failed = 0;

static void expect(bool ok, const char *msg) {
  if (!ok) {
    std::fprintf(stderr, "FAIL: %s\n", msg);
    failed++;
  }
}

static bool contains(const std::string &hay, const char *needle) {
  return hay.find(needle) != std::string::npos;
}

static bool excludes(const std::string &hay, const char *needle) { return !contains(hay, needle); }

int main() {
  expect(sl_local::status_url("/api/status"), "status path");
  expect(sl_local::schema_url("/api/status/schema"), "schema path");
  expect(sl_local::owns_url("/api/status") && sl_local::owns_url("/api/status/schema"), "owns both");
  expect(!sl_local::owns_url("/api/status/"), "no trailing slash");
  expect(!sl_local::owns_url("/cloud") && !sl_local::owns_url("/grow"), "cloud helpers are not this API");
  expect(!sl_local::owns_url("/text_sensor/Status%20JSON"), "legacy status json is not this API");

  expect(std::strcmp(sl_local::canonical_stage("Colonization"), "Colonization") == 0, "Colonization");
  expect(std::strcmp(sl_local::canonical_stage("colonization"), "Colonization") == 0, "colonization");
  expect(std::strcmp(sl_local::canonical_stage("Colonizing"), "Colonization") == 0, "Colonizing");
  expect(std::strcmp(sl_local::canonical_stage("colonizing"), "Colonization") == 0, "colonizing");
  expect(std::strcmp(sl_local::canonical_stage("Pinning"), "Pinning") == 0, "Pinning");
  expect(std::strcmp(sl_local::canonical_stage("fruiting"), "Fruiting") == 0, "fruiting");
  expect(std::strcmp(sl_local::canonical_stage("Custom"), "Custom") == 0, "Custom");
  expect(sl_local::canonical_stage("Idle") == nullptr, "Idle is not canonical");
  expect(sl_local::canonical_stage("Harvest") == nullptr, "Harvest is not canonical");
  expect(sl_local::canonical_stage("") == nullptr, "empty stage");
  expect(sl_local::canonical_stage(nullptr) == nullptr, "null stage");

  expect(sl_local::white_lux_to_percent(0) == 0, "0 lux");
  expect(std::fabs(sl_local::white_lux_to_percent(92) - 2.3f) < 0.001f, "92 lux is 2.3%");
  expect(std::fabs(sl_local::white_lux_to_percent(150) - 3.75f) < 0.001f, "150 lux is 3.75%");
  expect(std::fabs(sl_local::white_lux_to_percent(2000) - 50.0f) < 0.001f, "2000 lux is 50%");
  expect(std::fabs(sl_local::white_lux_to_percent(3984) - 99.6f) < 0.001f, "3984 lux is 99.6%, no cap at 78%");
  expect(sl_local::white_lux_to_percent(4000) == 100.0f, "4000 lux is 100%");
  expect(sl_local::white_lux_to_percent(8000) == 100.0f, "lux cap");

  expect(sl_local::escape_json("A\"B\\C") == "A\\\"B\\\\C", "escape quotes and slashes");
  expect(sl_local::escape_json("ok") == "ok", "plain text");

  sl_local::Snapshot s;
  s.device_type = "lykyn_chamber";
  s.model = "Lykyn";
  s.name = "Kitchen Lykyn";
  s.firmware = "0.2.0";
  s.uptime_s.has = true;
  s.uptime_s.value = 3600;
  s.growing_id = "black-oyster";
  s.growing_name = "Black Oyster";
  s.growing_image_url = "https://shroomlabs.io/img/species/species-oyster-640.webp";
  s.stage_native.has = true;
  s.stage_native.value = "Colonization";
  s.temperature_c.value.has = true;
  s.temperature_c.value.value = 21.4f;
  s.temperature_c.age_ms.has = true;
  s.temperature_c.age_ms.value = 800;
  s.humidity_pct.value.has = true;
  s.humidity_pct.value.value = 87.2f;
  s.humidity_pct.age_ms.has = true;
  s.humidity_pct.age_ms.value = 800;
  s.temperature_target_c.has = true;
  s.temperature_target_c.value = 24.0f;
  s.temperature_tolerance_c.has = true;
  s.temperature_tolerance_c.value = 2.0f;
  s.humidity_target_pct.has = true;
  s.humidity_target_pct.value = 90.0f;
  s.humidity_tolerance_pct.has = true;
  s.humidity_tolerance_pct.value = 3.0f;
  s.fae_speed_pct.has = true;
  s.fae_speed_pct.value = 33;
  s.fan_in_pct.has = true;
  s.fan_in_pct.value = 0;
  s.fan_out_pct.has = true;
  s.fan_out_pct.value = 0;
  s.fae_every_min.has = true;
  s.fae_every_min.value = 30;
  s.fae_run_s.has = true;
  s.fae_run_s.value = 60;
  s.light_on.has = true;
  s.light_on.value = false;
  s.light_enabled.has = true;
  s.light_enabled.value = true;
  s.light_r.has = true;
  s.light_r.value = 0;
  s.light_g.has = true;
  s.light_g.value = 0;
  s.light_b.has = true;
  s.light_b.value = 80;
  s.light_white.has = true;
  s.light_white.value = 20;
  s.sunrise_hour.has = true;
  s.sunrise_hour.value = 8;
  s.light_hours.has = true;
  s.light_hours.value = 12;
  s.light_brightness.has = true;
  s.light_brightness.value = 60;
  s.sensor_stale.has = true;
  s.sensor_stale.value = false;
  s.wifi_connected.has = true;
  s.wifi_connected.value = true;
  s.wifi_rssi_dbm.has = true;
  s.wifi_rssi_dbm.value = -52;
  s.coach_linked.has = true;
  s.coach_linked.value = true;

  const std::string js = sl_local::status_json(s);
  expect(contains(js, "\"api_version\":1"), "api version");
  expect(contains(js, "\"chamber_name\":\"Kitchen Lykyn\""), "chamber name");
  expect(contains(js, "\"chamber_type\":\"lykyn_chamber\""), "chamber type");
  expect(contains(js, "\"id\":\"black-oyster\""), "growing id");
  expect(contains(js, "\"name\":\"Black Oyster\""), "growing name");
  expect(contains(js, "\"image_url\":\"https://shroomlabs.io/img/species/species-oyster-640.webp\""), "image");
  expect(contains(js, "\"stage\":{\"name\":\"Colonization\",\"native\":\"Colonization\"}"), "stage");
  expect(contains(js, "\"target_c\":24.0"), "temp target");
  expect(contains(js, "\"actual_c\":21.4"), "temp actual");
  expect(contains(js, "\"target_pct\":90.0"), "rh target");
  expect(contains(js, "\"actual_pct\":87.2"), "rh actual");
  expect(contains(js, "\"speed_pct\":33"), "fan speed");
  expect(contains(js, "\"actual_speed_pct\":0"), "fan actual");
  expect(contains(js, "\"every_min\":30"), "fae period");
  expect(contains(js, "\"run_s\":60"), "fae run");
  expect(contains(js, "\"rgba\":{\"r\":0.0,\"g\":0.0,\"b\":48.0,\"a\":12.0}"), "rgba is what the ring is driven at: stored value x master brightness 60");
  expect(contains(js, "\"brightness_pct\":60"), "brightness");
  expect(contains(js, "\"coach_linked\":true"), "coach in detail");
  expect(contains(js, "\"wifi_rssi_dbm\":-52"), "rssi in detail");
  expect(contains(js, "\"errors\":[]"), "empty errors");
  expect(excludes(js, "mac"), "no mac");
  expect(excludes(js, "ssid"), "no ssid");
  expect(excludes(js, "password"), "no password");
  expect(excludes(js, "claim_code"), "no claim code");
  expect(excludes(js, "\"readings\""), "old readings block gone");
  expect(excludes(js, "\"targets\""), "old targets block gone");
  expect(excludes(js, "\"device\":"), "old device block gone");

  s.light_brightness.value = 100;
  s.light_white.value = 2.3f;
  const std::string full_js = sl_local::status_json(s);
  expect(contains(full_js, "\"rgba\":{\"r\":0.0,\"g\":0.0,\"b\":80.0,\"a\":2.3}"), "master brightness 100 reports the stored mix as is");
  s.light_brightness.has = false;
  s.light_white.value = 100;
  const std::string nomaster_js = sl_local::status_json(s);
  expect(contains(nomaster_js, "\"a\":100.0"), "no master brightness: full white is 100");

  sl_local::Snapshot idle;
  idle.stage_native.has = true;
  idle.stage_native.value = "Idle";
  const std::string idle_js = sl_local::status_json(idle);
  expect(contains(idle_js, "\"name\":null"), "Idle has null canonical name");
  expect(contains(idle_js, "\"native\":\"Idle\""), "Idle keeps native");
  expect(contains(idle_js, "\"growing\":{\"id\":null,\"name\":null,\"image_url\":null}"), "empty growing");
  expect(contains(idle_js, "\"rgba\":null"), "no light mix");

  sl_local::Snapshot sh;
  sh.device_type = "shrooly_chamber";
  sh.name = "OpenShrooly";
  sh.stage_native.has = true;
  sh.stage_native.value = "Colonizing";
  sh.light_r.has = true;
  sh.light_r.value = 0;
  sh.light_g.has = true;
  sh.light_g.value = 0;
  sh.light_b.has = true;
  sh.light_b.value = 80;
  sh.light_white.has = true;
  sh.light_white.value = 150;  // lux
  sh.light_white_is_lux = true;
  sh.fae_speed_pct.has = true;
  sh.fae_speed_pct.value = 40;
  sh.fan_on.has = true;
  sh.fan_on.value = false;
  const std::string sh_js = sl_local::status_json(sh);
  expect(contains(sh_js, "\"name\":\"Colonization\",\"native\":\"Colonizing\""), "Shrooly stage map");
  expect(contains(sh_js, "\"rgba\":{\"r\":0.0,\"g\":0.0,\"b\":80.0,\"a\":3.8}"), "Shrooly 150 lux is 3.75 percent of 4000 lux");
  expect(contains(sh_js, "\"white_lux\":150"), "raw lux in detail");
  expect(contains(sh_js, "\"actual_speed_pct\":0"), "Shrooly actual is 0 when FAE is off");

  sh.fan_on.value = true;
  const std::string sh_on = sl_local::status_json(sh);
  expect(contains(sh_on, "\"actual_speed_pct\":40"), "Shrooly actual follows setpoint when FAE is on");

  sl_local::Snapshot nan;
  nan.temperature_c.value.has = true;
  nan.temperature_c.value.value = NAN;
  const std::string nan_js = sl_local::status_json(nan);
  expect(contains(nan_js, "\"actual_c\":null"), "NaN becomes null");

  const char *schema = sl_local::status_schema_json();
  expect(contains(schema, "0-100"), "schema documents 0-100");
  expect(contains(schema, "Colonization"), "schema lists stages");
  expect(contains(schema, "lykyn_chamber"), "schema lists types");

  if (failed) {
    std::fprintf(stderr, "%d checks failed\n", failed);
    return 1;
  }
  std::printf("ok\n");
  return 0;
}
