#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

namespace esphome {
namespace shroom_labs {

static constexpr const char *PROOF_VERSION = "shroomlabs-device-pop-v1";
static constexpr const char *DEFAULT_API_HOST = "api.shroomlabs.io";
static constexpr const char *DEFAULT_SITE = "https://shroomlabs.io";
static constexpr const char *CLAIM_PATH = "/claim.html?code=";
static constexpr uint32_t CLAIM_MS = 15 * 60 * 1000;
static constexpr uint32_t NONCE_MS = 2 * 60 * 1000;
static constexpr int64_t ROTATE_AFTER_MS = 302400000;  // 3.5 days, Worker contract
static constexpr size_t MAX_CSR_PEM = 4096;
static constexpr size_t MAX_DEVICE_BODY = 16 * 1024;

enum class CloudState : uint8_t {
  Off = 0,
  Connecting,
  PendingClaim,
  Issuing,
  Linked,
  Rotating,
  Revoked,
  Owned,
  WaitClaim,
  Relink,
  Error,
};

enum class CloudEvent : uint8_t {
  Enable,
  Disable,
  EnrollOk,
  EnrollOwned,  // 409 already_claimed. Stop.
  EnrollBusy,   // 409 claim_in_progress
  EnrollFail,
  CsrWaiting,  // 403: not claimed yet
  CsrOk,
  CsrAuthFail,  // 401
  CsrFail,
  NetworkFail,  // transport or 5xx. Stay and back off.
  RateLimited,
  RotateDue,
  RotateOk,
  LinkAuthFail,  // legacy wipe
  LinkRevoked,   // explicit revoked
  CertExpired,
  RelinkRequired,
  ProofInvalid,
  ReclaimOk,
  ReclaimFail,
  Refresh,
  Expired,
};

const char *state_name(CloudState state);
const char *state_message(CloudState state);
CloudState next_state(CloudState state, CloudEvent event);

std::string base64_encode(const uint8_t *data, size_t len);
std::string base64url_encode(const uint8_t *data, size_t len);
bool base64url_decode(const char *text, uint8_t *out, size_t out_len);
std::string hex_encode(const uint8_t *data, size_t len);
void hex_encode_to(const uint8_t *data, size_t len, char *out);  // 2*len + NUL

std::string jwk_json(const uint8_t x[32], const uint8_t y[32]);
std::string pem_wrap(const uint8_t *der, size_t len, const char *label);
std::string claim_url_for(const char *site, const char *code);
bool claim_url_ok(const char *url, const char *code);
bool claim_code_ok(const char *code);
std::string format_claim_code(const char *code);  // "AB2C3D" as received, uppercased

// Worker PoP: SHA-256 of the body is lowercase hex (see docs/DEVICES.md).
std::string proof_payload(const char *device_id, const char *nonce, const char *method, const char *path,
                          const char *body_sha256_hex);

std::string enroll_body_json(const char *hardware_id, const char *jwk, const char *name);
std::string csr_body_json(const char *csr_pem, const char *enroll_token);
std::string rotate_body_json(const char *csr_pem);
std::string reclaim_body_json(const char *jwk);

bool json_get_string(const char *json, const char *key, std::string *out);
bool json_get_int64(const char *json, const char *key, int64_t *out);
bool json_get_bool(const char *json, const char *key, bool *out);
bool json_get_double(const char *json, const char *key, double *out);

static constexpr uint8_t MAX_INBOX_COMMANDS = 8;
static constexpr float SETPOINT_TEMP_MIN = 10.0f;
static constexpr float SETPOINT_TEMP_MAX = 32.0f;
static constexpr float SETPOINT_RH_MIN = 60.0f;
static constexpr float SETPOINT_RH_MAX = 98.0f;

// Cloud-writable chamber numbers beyond the temperature and humidity targets. The payload and
// telemetry key for each is KNOB_KEYS[k], the same as the ESPHome entity id.
enum : uint8_t {
  KNOB_FAN = 0,     // air_exchange_speed, %
  KNOB_AIR_PERIOD,  // air_exchange_period_min
  KNOB_AIR_RUN,     // air_exchange_run_sec
  KNOB_SUNRISE,     // sunrise_hour
  KNOB_LIGHT_HOURS, // light_hours
  KNOB_WHITE,       // white_intensity, lux
  KNOB_RED,         // color_r, %
  KNOB_GREEN,       // color_g, %
  KNOB_BLUE,        // color_b, %
  KNOB_GROW_DAY,    // grow_day (display)
  KNOB_COUNT,
};
extern const char *const KNOB_KEYS[KNOB_COUNT];
static constexpr size_t MAX_PHASE_LEN = 15;

struct InboxCommand {
  int64_t id{0};
  std::string kind;
  std::string issued_at;
  std::string expires_at;
  bool apply{false};
  bool has_apply{false};
  bool has_temp{false};
  bool has_rh{false};
  double temperature_c{0};
  double humidity_percent{0};
  uint16_t knob_mask{0};
  float knob[KNOB_COUNT]{};
  std::string grow_phase;
};

size_t parse_inbox_commands(const char *json, InboxCommand *out, size_t max);

enum class SetpointDecision : uint8_t { Skip = 0, Apply, Refuse, Fail };

struct SetpointPlan {
  SetpointDecision decision{SetpointDecision::Skip};
  const char *ack_status{nullptr};
  const char *reason{nullptr};
  bool write_temp{false};
  bool write_rh{false};
  float temperature_c{0};
  float humidity_percent{0};
  uint16_t knob_mask{0};
  float knob[KNOB_COUNT]{};
  std::string grow_phase;
};

struct ChamberReading {
  bool has_temperature{false};
  bool has_humidity{false};
  bool has_temperature_target{false};
  bool has_target_humidity{false};
  float temperature{0};
  float humidity{0};
  float temperature_target{0};
  float target_humidity{0};
  uint16_t knob_mask{0};
  float knob[KNOB_COUNT]{};
  std::string grow_phase;
};

struct EntityRange {
  bool has{false};
  float min{0};
  float max{0};
  float step{0};
};

class CloudChamber {
 public:
  virtual ~CloudChamber() = default;
  virtual ChamberReading read() { return {}; }
  virtual EntityRange temperature_range() { return {}; }
  virtual EntityRange humidity_range() { return {}; }
  virtual bool write_temperature(float) { return false; }
  virtual bool write_humidity(float) { return false; }
  virtual uint32_t last_local_change_ms() { return 0; }
  virtual EntityRange knob_range(uint8_t) { return {}; }
  virtual bool write_knob(uint8_t, float) { return false; }
  // Writes the grow_phase select. False for an option the select does not have.
  virtual bool write_grow_phase(const std::string &) { return false; }
};

// Firmware version, capability list (a JSON array) and knob ranges for telemetry.
struct TelemetryExtras {
  const char *firmware_version{nullptr};
  const char *capabilities{nullptr};
  const EntityRange *ranges{nullptr};  // KNOB_COUNT entries
};

bool value_in_entity_range(float v, const EntityRange &range);
float snap_entity_value(float v, const EntityRange &range);

SetpointPlan plan_setpoint_command(const InboxCommand &cmd, int64_t wall_ms, uint32_t last_local_ms, uint32_t now_ms,
                                   bool remote_apply);
std::string telemetry_body_json(const ChamberReading &reading, int64_t ack_id, const char *ack_status,
                                const char *ack_reason = nullptr, const EntityRange *temp_range = nullptr,
                                const EntityRange *rh_range = nullptr, const TelemetryExtras *extras = nullptr);
float clamp_setpoint_temp(float c);
float clamp_setpoint_rh(float rh);
bool setpoint_object_id(const char *object_id);
bool sensor_is_temperature(const char *object_id);
bool sensor_is_humidity(const char *object_id);
std::string claim_status_body_json(const char *enroll_token);

// PKCS#10 for P-256 + ecdsa-with-SHA256. sign() must write raw 64-byte r||s over SHA-256(info).
using SignSha256 = bool (*)(const uint8_t *data, size_t len, uint8_t sig_raw[64], void *ctx);
bool build_p256_csr_pem(const uint8_t x[32], const uint8_t y[32], const char *cn, SignSha256 sign, void *ctx,
                        std::string *pem);

void ecdsa_raw_to_der(const uint8_t raw[64], uint8_t *der, size_t *der_len);

int64_t parse_iso8601_ms(const char *iso);
std::string format_iso8601_ms(int64_t ms);
std::string https_url(const char *host, const char *path);
bool api_url_allowed(const char *url, const char *host);

}  // namespace shroom_labs
}  // namespace esphome
