#include "signed_update.h"
#include "update_logic.h"

#include "esphome/core/application.h"
#include "esphome/core/hal.h"
#include "esphome/core/log.h"
#include "esphome/components/json/json_util.h"

#include <esp_crt_bundle.h>
#include <esp_http_client.h>
#include <esp_ota_ops.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <mbedtls/sha256.h>

#include <cstdio>
#include <cstring>
#include <memory>

#if defined(USE_ARDUINO) && defined(USE_OTA_ROLLBACK)
// The Arduino core marks a freshly installed image as good while it starts,
// before anything has run. Leave that to safe_mode instead, which confirms the
// image only after a good boot, so the bootloader can still go back to the
// previous version when a new one fails to start.
extern "C" bool verifyRollbackLater() { return true; }
#endif

namespace esphome {
namespace signed_update {

static const char *const TAG = "signed_update";
static const size_t MAX_MANIFEST_BYTES = 4096;
static const size_t CHUNK_BYTES = 4096;

static const char *state_code(State s) {
  switch (s) {
    case State::IDLE:
      return "idle";
    case State::CHECKING:
      return "checking";
    case State::CURRENT:
      return "current";
    case State::AVAILABLE:
      return "available";
    case State::OLDER:
      return "older";
    case State::DOWNLOADING:
      return "downloading";
    case State::VERIFYING:
      return "verifying";
    case State::RESTARTING:
      return "restarting";
    case State::FAILED:
    default:
      return "failed";
  }
}

static const char *rollback_support() {
  esp_ota_img_states_t st;
  if (esp_ota_get_state_partition(esp_ota_get_running_partition(), &st) != ESP_OK)
    return "unknown";
  if (st == ESP_OTA_IMG_PENDING_VERIFY)
    return "on trial (not yet confirmed)";
  if (st == ESP_OTA_IMG_VALID)
    return "confirmed";
  return "not reported";
}

void SignedUpdate::setup() {
  if (this->installed_sensor_ != nullptr)
    this->installed_sensor_->publish_state(this->current_version_);
  if (esp_ota_get_last_invalid_partition() != nullptr) {
    this->report_(State::IDLE, std::string("The last update did not start correctly, so this Shrooly went back to version ") +
                                   this->current_version_ + ".");
  } else {
    this->report_(State::IDLE, "Not checked yet.");
  }
}

void SignedUpdate::dump_config() {
  ESP_LOGCONFIG(TAG,
                "Signed update:\n"
                "  Installed version: %s\n"
                "  Release info: %s\n"
                "  Downloads allowed under: %s\n"
                "  Release key starts: %02x%02x%02x%02x\n"
                "  Running image: %s",
                this->current_version_, this->manifest_url_, this->download_prefix_, this->public_key_[0],
                this->public_key_[1], this->public_key_[2], this->public_key_[3], rollback_support());
}

void SignedUpdate::loop() {
  if (this->pending_publish_.exchange(false)) {
    State state;
    std::string message, available;
    {
      std::lock_guard<std::mutex> guard(this->lock_);
      state = this->state_;
      message = this->message_;
      available = this->available_;
    }
    if (this->state_sensor_ != nullptr)
      this->state_sensor_->publish_state(state_code(state));
    if (this->status_sensor_ != nullptr)
      this->status_sensor_->publish_state(message);
    if (this->available_sensor_ != nullptr)
      this->available_sensor_->publish_state(available);
  }
  if (this->reboot_requested_.exchange(false)) {
    this->set_timeout(2000, []() { App.safe_reboot(); });
  }
}

void SignedUpdate::report_(State state, const std::string &message, const std::string &available) {
  {
    std::lock_guard<std::mutex> guard(this->lock_);
    this->state_ = state;
    this->message_ = message;
    if (!available.empty() || state == State::CURRENT || state == State::FAILED || state == State::CHECKING)
      this->available_ = available;
  }
  this->pending_publish_ = true;
  if (state == State::FAILED) {
    ESP_LOGW(TAG, "%s", message.c_str());
  } else {
    ESP_LOGI(TAG, "%s", message.c_str());
  }
}

void SignedUpdate::check() {
  if (this->busy_.exchange(true)) {
    ESP_LOGW(TAG, "Already busy");
    return;
  }
  this->install_mode_ = false;
  if (xTaskCreate(task_entry_, "signed_update", 10240, this, 1, nullptr) != pdPASS) {
    this->busy_ = false;
    this->report_(State::FAILED, "The update check could not start. Restart the Shrooly and try again.");
  }
}

void SignedUpdate::install() {
  if (this->busy_.exchange(true)) {
    ESP_LOGW(TAG, "Already busy");
    return;
  }
  this->install_mode_ = true;
  if (xTaskCreate(task_entry_, "signed_update", 10240, this, 1, nullptr) != pdPASS) {
    this->busy_ = false;
    this->report_(State::FAILED, "The update could not start. Restart the Shrooly and try again.");
  }
}

void SignedUpdate::task_entry_(void *arg) {
  auto *self = static_cast<SignedUpdate *>(arg);
  self->run_(self->install_mode_);
  self->busy_ = false;
  vTaskDelete(nullptr);
}

static std::string still_on(const char *version) {
  return std::string(" Your Shrooly is still on version ") + version + ".";
}

void SignedUpdate::run_(bool install) {
  this->report_(State::CHECKING, "Checking for updates.");
  ESP_LOGI(TAG, "Running image: %s", rollback_support());

  Release rel;
  if (!this->fetch_release_(&rel))
    return;  // fetch_release_ already reported why

  Version current, offered;
  const bool current_ok = parse_version(this->current_version_, &current);
  parse_version(rel.version, &offered);  // already validated in fetch_release_
  const int cmp = current_ok ? compare_versions(offered, current) : 1;

  if (cmp == 0) {
    this->report_(State::CURRENT, "You have the latest version (" + rel.version + ").");
    return;
  }
  if (cmp < 0 && !this->allow_older_) {
    this->report_(State::OLDER, "The newest release, version " + rel.version +
                                    ", is older than the one on this Shrooly, so it was not offered." +
                                    still_on(this->current_version_));
    return;
  }
  if (!install) {
    if (cmp > 0) {
      this->report_(State::AVAILABLE, "Version " + rel.version + " is available.", rel.version);
    } else {
      this->report_(State::AVAILABLE,
                    "Version " + rel.version + " is older than this one. Install it only if you meant to go back.",
                    rel.version);
    }
    return;
  }
  // A version that just started is confirmed by safe_mode after a minute of
  // good running. Until then the bootloader keeps the previous version as the
  // way back, and an install would be refused, so say so plainly.
  esp_ota_img_states_t running_state;
  if (esp_ota_get_state_partition(esp_ota_get_running_partition(), &running_state) == ESP_OK &&
      running_state == ESP_OTA_IMG_PENDING_VERIFY) {
    this->report_(State::FAILED, std::string("Your Shrooly restarted less than a minute ago and is still checking itself. "
                                             "Try again in a minute.") + still_on(this->current_version_));
    return;
  }
  this->download_and_apply_(rel);
}

struct HttpClientDeleter {
  void operator()(esp_http_client_handle_t c) const {
    esp_http_client_close(c);
    esp_http_client_cleanup(c);
  }
};
using HttpClient = std::unique_ptr<std::remove_pointer<esp_http_client_handle_t>::type, HttpClientDeleter>;

// Opens an HTTPS GET with certificate checking against the built-in CA bundle.
// Redirects are not followed, so the response always comes from the URL asked for.
static HttpClient open_https(const char *url, int *status, int64_t *length) {
  esp_http_client_config_t cfg = {};
  cfg.url = url;
  cfg.crt_bundle_attach = esp_crt_bundle_attach;
  cfg.timeout_ms = 15000;
  cfg.disable_auto_redirect = true;
  cfg.buffer_size = 2048;
  cfg.user_agent = "OpenShrooly";
  HttpClient client(esp_http_client_init(&cfg));
  if (!client)
    return nullptr;
  if (esp_http_client_open(client.get(), 0) != ESP_OK)
    return nullptr;
  *length = esp_http_client_fetch_headers(client.get());
  *status = esp_http_client_get_status_code(client.get());
  return client;
}

bool SignedUpdate::fetch_release_(Release *out) {
  const std::string net_fail = "Could not reach shroomlabs.io. Check the Wi-Fi connection and try again.";
  const std::string unsafe = "This update failed the safety check and was not installed." + still_on(this->current_version_);

  int status = 0;
  int64_t length = 0;
  HttpClient client = open_https(this->manifest_url_, &status, &length);
  if (!client) {
    this->report_(State::FAILED, net_fail);
    return false;
  }
  if (status != 200) {
    ESP_LOGW(TAG, "Release info returned HTTP %d", status);
    this->report_(State::FAILED, "No update information was found on shroomlabs.io. Try again later.");
    return false;
  }
  if (length > static_cast<int64_t>(MAX_MANIFEST_BYTES)) {
    this->report_(State::FAILED, unsafe);
    return false;
  }
  std::string body;
  body.resize(MAX_MANIFEST_BYTES);
  size_t got = 0;
  while (got < MAX_MANIFEST_BYTES) {
    int r = esp_http_client_read(client.get(), &body[got], MAX_MANIFEST_BYTES - got);
    if (r < 0) {
      this->report_(State::FAILED, net_fail);
      return false;
    }
    if (r == 0)
      break;
    got += r;
  }
  if (got == MAX_MANIFEST_BYTES || got == 0) {
    this->report_(State::FAILED, unsafe);
    return false;
  }
  body.resize(got);
  client.reset();

  std::string product, channel, version, url, sha256, signature;
  int64_t size = -1;
  bool parsed = json::parse_json(body, [&](JsonObject root) -> bool {
    product = root["product"] | "";
    channel = root["channel"] | "";
    version = root["version"] | "";
    url = root["url"] | "";
    sha256 = root["sha256"] | "";
    signature = root["signature"] | "";
    size = root["size"] | static_cast<int64_t>(-1);
    return true;
  });

  const esp_partition_t *spare = esp_ota_get_next_update_partition(nullptr);
  Version v;
  const char *why = nullptr;
  if (!parsed)
    why = "not valid JSON";
  else if (product != this->product_ || channel != this->channel_)
    why = "wrong product or channel";
  else if (!parse_version(version, &v))
    why = "bad version";
  else if (!is_sha256_hex(sha256))
    why = "bad sha256";
  else if (!url_allowed(url, this->download_prefix_))
    why = "download URL not allowed";
  else if (spare == nullptr || size <= 0 || size > static_cast<int64_t>(spare->size))
    why = "bad size";
  else if (!signature_valid(this->public_key_.data(),
                            signed_message(product, channel, version, static_cast<uint32_t>(size), sha256, url),
                            signature))
    why = "signature does not match the release key";
  if (why != nullptr) {
    ESP_LOGW(TAG, "Release info refused: %s", why);
    this->report_(State::FAILED, unsafe);
    return false;
  }
  ESP_LOGI(TAG, "Release info signature OK: version %s, %lld bytes", version.c_str(), static_cast<long long>(size));
  out->version = version;
  out->url = url;
  out->sha256 = sha256;
  out->size = static_cast<uint32_t>(size);
  return true;
}

bool SignedUpdate::download_and_apply_(const Release &rel) {
  const std::string net_fail = "The download stopped before it finished. Nothing was changed." + still_on(this->current_version_);
  const std::string unsafe = "This update failed the safety check and was not installed." + still_on(this->current_version_);
  const std::string save_fail = "The update could not be saved. Nothing was changed." + still_on(this->current_version_);

  const esp_partition_t *spare = esp_ota_get_next_update_partition(nullptr);
  if (spare == nullptr || rel.size > spare->size) {
    this->report_(State::FAILED, save_fail);
    return false;
  }

  this->report_(State::DOWNLOADING, "Downloading the update: 0%", rel.version);
  int status = 0;
  int64_t length = 0;
  HttpClient client = open_https(rel.url.c_str(), &status, &length);
  if (!client || status != 200) {
    ESP_LOGW(TAG, "Download returned HTTP %d", status);
    this->report_(State::FAILED, net_fail);
    return false;
  }
  if (length > 0 && length != static_cast<int64_t>(rel.size)) {
    ESP_LOGW(TAG, "Download length %lld does not match signed size %u", static_cast<long long>(length),
             static_cast<unsigned>(rel.size));
    this->report_(State::FAILED, unsafe);
    return false;
  }

  esp_ota_handle_t ota = 0;
  if (esp_ota_begin(spare, OTA_WITH_SEQUENTIAL_WRITES, &ota) != ESP_OK) {
    this->report_(State::FAILED, save_fail);
    return false;
  }

  std::unique_ptr<uint8_t[]> buf(new uint8_t[CHUNK_BYTES]);
  mbedtls_sha256_context sha;
  mbedtls_sha256_init(&sha);
  mbedtls_sha256_starts(&sha, 0);
  uint32_t total = 0;
  int last_pct = 0;
  bool ok = true;
  const char *why = nullptr;
  while (true) {
    int r = esp_http_client_read(client.get(), reinterpret_cast<char *>(buf.get()), CHUNK_BYTES);
    if (r < 0) {
      ok = false;
      why = "read error";
      break;
    }
    if (r == 0)
      break;
    if (total + static_cast<uint32_t>(r) > rel.size) {
      ok = false;
      why = "longer than the signed size";
      break;
    }
    mbedtls_sha256_update(&sha, buf.get(), r);
    if (esp_ota_write(ota, buf.get(), r) != ESP_OK) {
      ok = false;
      why = "flash write failed";
      break;
    }
    total += r;
    const int pct = static_cast<int>((static_cast<uint64_t>(total) * 100) / rel.size);
    if (pct >= last_pct + 5) {
      last_pct = pct - (pct % 5);
      this->report_(State::DOWNLOADING, "Downloading the update: " + std::to_string(last_pct) + "%", rel.version);
    }
  }
  client.reset();
  uint8_t digest[32];
  mbedtls_sha256_finish(&sha, digest);
  mbedtls_sha256_free(&sha);

  if (ok && total != rel.size) {
    ok = false;
    why = "shorter than the signed size";
  }
  if (!ok) {
    esp_ota_abort(ota);
    ESP_LOGW(TAG, "Download refused: %s", why);
    this->report_(State::FAILED, strcmp(why, "read error") == 0 ? net_fail
                                 : strcmp(why, "flash write failed") == 0 ? save_fail
                                                                         : unsafe);
    return false;
  }

  this->report_(State::VERIFYING, "Checking the download.", rel.version);
  char hex[65];
  for (int i = 0; i < 32; i++)
    snprintf(hex + i * 2, 3, "%02x", digest[i]);
  if (rel.sha256 != hex) {
    esp_ota_abort(ota);
    ESP_LOGW(TAG, "Download refused: SHA-256 %s does not match the signed %s", hex, rel.sha256.c_str());
    this->report_(State::FAILED, unsafe);
    return false;
  }
  if (esp_ota_end(ota) != ESP_OK) {
    ESP_LOGW(TAG, "Download refused: image check failed");
    this->report_(State::FAILED, unsafe);
    return false;
  }
  if (esp_ota_set_boot_partition(spare) != ESP_OK) {
    this->report_(State::FAILED, save_fail);
    return false;
  }
  ESP_LOGI(TAG, "SHA-256 and signature OK; version %s will start from %s", rel.version.c_str(), spare->label);
  this->report_(State::RESTARTING, "Update installed. Restarting now.", rel.version);
  this->reboot_requested_ = true;
  return true;
}

}  // namespace signed_update
}  // namespace esphome
