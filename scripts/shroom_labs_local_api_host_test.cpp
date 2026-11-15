#include "status_json.h"
#include "status_paths.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

using sl_local::Snapshot;
using sl_local::status_json;
using sl_local::status_schema_json;
using sl_local::normalize_stage;

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

static void test_paths() {
  expect(sl_local::status_url("/api/status"), "owns /api/status");
  expect(sl_local::schema_url("/api/status/schema"), "owns schema");
  expect(sl_local::owns_url("/api/status"), "owns_url status");
  expect(sl_local::owns_url("/api/status/schema"), "owns_url schema");
  expect(!sl_local::owns_url("/api"), "does not own /api");
  expect(!sl_local::owns_url("/api/status/"), "does not own trailing slash");
  expect(!sl_local::owns_url("/api/status/extra"), "does not own extra segment");
  expect(!sl_local::owns_url("/cloud"), "does not own /cloud");
  expect(!sl_local::owns_url("/text_sensor/status_json"), "does not own entity route");
  expect(!sl_local::owns_url(nullptr), "null url");
}

static void test_stages() {
  expect(std::strcmp(normalize_stage("Colonization"), "colonization") == 0, "Lykyn Colonization");
  expect(std::strcmp(normalize_stage("Colonizing"), "colonization") == 0, "Shrooly Colonizing");
  expect(std::strcmp(normalize_stage("colonizing"), "colonization") == 0, "case insensitive");
  expect(std::strcmp(normalize_stage("Pinning"), "pinning") == 0, "Pinning");
  expect(std::strcmp(normalize_stage("Fruiting"), "fruiting") == 0, "Fruiting");
  expect(std::strcmp(normalize_stage("Harvest"), "harvest") == 0, "Harvest");
  expect(std::strcmp(normalize_stage("Idle"), "idle") == 0, "Idle");
  expect(std::strcmp(normalize_stage("Custom"), "custom") == 0, "Custom");
  expect(std::strcmp(normalize_stage("SomethingElse"), "unknown") == 0, "unknown native");
  expect(std::strcmp(normalize_stage(""), "unknown") == 0, "empty");
  expect(std::strcmp(normalize_stage(nullptr), "unknown") == 0, "null native");
}

static Snapshot lykyn_colonization() {
  Snapshot s;
  s.device_type = "lykyn_chamber";
  s.model = "Lykyn";
  s.name = "lykyn";
  s.firmware = "0.2.0";
  s.uptime_s.has = true;
  s.uptime_s.value = 3600;
  s.temperature_c.value.has = true;
  s.temperature_c.value.value = 24.15f;
  s.temperature_c.age_ms.has = true;
  s.temperature_c.age_ms.value = 800;
  s.humidity_pct.value.has = true;
  s.humidity_pct.value.value = 89.6f;
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
  s.stage_native.has = true;
  s.stage_native.value = "Colonization";
  s.light_enabled.has = true;
  s.light_enabled.value = true;
  s.light_on.has = true;
  s.light_on.value = false;
  s.sunrise_hour.has = true;
  s.sunrise_hour.value = 8;
  s.light_hours.has = true;
  s.light_hours.value = 0;
  s.fan_boost.has = true;
  s.fan_boost.value = false;
  s.climate_mode.has = true;
  s.climate_mode.value = "SMART";
  s.coach_linked.has = true;
  s.coach_linked.value = true;
  s.coach_enabled.has = true;
  s.coach_enabled.value = true;
  s.coach_remote_apply.has = true;
  s.coach_remote_apply.value = true;
  s.coach_state.has = true;
  s.coach_state.value = "linked";
  s.sensor_stale.has = true;
  s.sensor_stale.value = false;
  s.wifi_connected.has = true;
  s.wifi_connected.value = true;
  s.wifi_rssi_dbm.has = true;
  s.wifi_rssi_dbm.value = -52;
  return s;
}

static void test_lykyn_json() {
  const std::string js = status_json(lykyn_colonization());
  expect(contains(js, "\"api_version\":1"), "api_version 1");
  expect(contains(js, "\"type\":\"lykyn_chamber\""), "type");
  expect(contains(js, "\"normalized\":\"colonization\""), "normalized colonization");
  expect(contains(js, "\"native\":\"Colonization\""), "native Colonization");
  expect(contains(js, "\"humidity_pct\":{\"value\":89.60"), "humidity value");
  expect(contains(js, "\"age_ms\":800"), "age_ms");
  expect(contains(js, "\"ts_unix\":null"), "no clock, ts_unix null");
  expect(contains(js, "\"fan_rpm\":{\"value\":null"), "missing fan_rpm is null");
  expect(contains(js, "\"co2_ppm\":{\"value\":null"), "missing co2 is null");
  expect(contains(js, "\"last_check_in_age_s\":null"), "reserved last check-in is null");
  expect(contains(js, "\"fan_boost\":false"), "fan_boost false");
  expect(contains(js, "\"errors\":[]"), "no errors");
  expect(!contains(js, "mac"), "no mac key");
  expect(!contains(js, "ssid"), "no ssid");
  expect(!contains(js, "password"), "no password");
  expect(!contains(js, "claim_code"), "no claim code");
  expect(!contains(js, "-----BEGIN"), "no pem");
}

static void test_shrooly_stage_and_escape() {
  Snapshot s;
  s.device_type = "shrooly_chamber";
  s.model = "OpenShrooly";
  s.name = "openshrooly";
  s.firmware = "1.0.6-sl.2";
  s.stage_native.has = true;
  s.stage_native.value = "Colonizing";
  s.health_errors.has = true;
  s.health_errors.value = "sensor \"A\" offline";
  const std::string js = status_json(s);
  expect(contains(js, "\"normalized\":\"colonization\""), "Shrooly Colonizing normalizes");
  expect(contains(js, "\"native\":\"Colonizing\""), "Shrooly native kept");
  expect(contains(js, "\"type\":\"shrooly_chamber\""), "shrooly type");
  expect(contains(js, "sensor \\\"A\\\" offline"), "errors are escaped");
  expect(contains(js, "\"errors\":[\"sensor \\\"A\\\" offline\"]"), "plain error becomes array");
}

static void test_nan_and_schema() {
  Snapshot s;
  s.device_type = "lykyn_chamber";
  s.model = "Lykyn";
  s.name = "lykyn";
  s.firmware = "0.2.0";
  s.temperature_c.value.has = true;
  s.temperature_c.value.value = 0.0f / 0.0f;  // NaN
  const std::string js = status_json(s);
  expect(contains(js, "\"temperature_c\":{\"value\":null"), "NaN reading is null");
  expect(!contains(js, "nan"), "no nan token");
  expect(!contains(js, "NaN"), "no NaN token");

  const char *schema = status_schema_json();
  expect(schema != nullptr && std::strstr(schema, "\"api_version\":1") != nullptr, "schema api_version");
  expect(std::strstr(schema, "last_check_in_age_s") != nullptr, "schema mentions last check-in");
  expect(std::strstr(schema, "read_only") != nullptr, "schema says read_only");
}

int main() {
  test_paths();
  test_stages();
  test_lykyn_json();
  test_shrooly_stage_and_escape();
  test_nan_and_schema();
  if (failed != 0) {
    std::fprintf(stderr, "%d checks failed\n", failed);
    return 1;
  }
  std::puts("shroom_labs_local_api host tests passed");
  return 0;
}
