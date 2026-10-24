#include "ota_web_server.h"
#ifdef USE_WEBSERVER_OTA

#include "esphome/components/ota/ota_backend_factory.h"
#include "esphome/core/application.h"
#include "esphome/core/log.h"

#ifdef USE_CAPTIVE_PORTAL
#include "esphome/components/captive_portal/captive_portal.h"
#endif

// Shroom Labs: only images signed with the release key are installed from the local
// network. The final LAN_TRAILER_SIZE bytes of an upload carry the signature and are
// held back, so they are never written to flash. USB stays the unrestricted path.
#include <cstring>
#include "mbedtls/sha256.h"
#ifdef USE_SIGNED_UPDATE
#include "esphome/components/signed_update/signed_update.h"
#endif

#ifdef USE_ARDUINO
#if defined(USE_LIBRETINY)
#include <Update.h>
#endif
#endif  // USE_ARDUINO

#if USE_ESP32
using PlatformString = std::string;
#elif USE_ARDUINO
using PlatformString = String;
#endif

namespace esphome::web_server {

static const char *const TAG = "web_server.ota";

class OTARequestHandler : public AsyncWebHandler {
 public:
  OTARequestHandler(WebServerOTAComponent *parent) : parent_(parent) {}
  void handleRequest(AsyncWebServerRequest *request) override;
  void handleUpload(AsyncWebServerRequest *request, const PlatformString &filename, size_t index, uint8_t *data,
                    size_t len, bool final) override;
  bool canHandle(AsyncWebServerRequest *request) const override {
    if (request->method() != HTTP_POST)
      return false;
      // Check if this is an OTA update request
#ifdef USE_ESP32
    char url_buf[AsyncWebServerRequest::URL_BUF_SIZE];
    bool is_ota_request = request->url_to(url_buf) == "/update";
#else
    bool is_ota_request = request->url() == ESPHOME_F("/update");
#endif

#if defined(USE_WEBSERVER_OTA_DISABLED) && defined(USE_CAPTIVE_PORTAL)
    // IMPORTANT: USE_WEBSERVER_OTA_DISABLED only disables OTA for the web_server component
    // Captive portal can still perform OTA updates - check if request is from active captive portal
    // Note: global_captive_portal is the standard way components communicate in ESPHome
    return is_ota_request && captive_portal::global_captive_portal != nullptr &&
           captive_portal::global_captive_portal->is_active();
#elif defined(USE_WEBSERVER_OTA_DISABLED)
    // OTA disabled for web_server and no captive portal compiled in
    return false;
#else
    // OTA enabled for web_server
    return is_ota_request;
#endif
  }

  // NOLINTNEXTLINE(readability-identifier-naming)
  bool isRequestHandlerTrivial() const override { return false; }

 protected:
  void report_ota_progress_(AsyncWebServerRequest *request);
  void schedule_ota_reboot_();
  void ota_init_(const char *filename);

  ota::OTAResponseTypes write_held_back_(const uint8_t *data, size_t len);
  bool signature_ok_();

  uint32_t last_ota_progress_{0};
  uint32_t ota_read_length_{0};
  WebServerOTAComponent *parent_;
  bool ota_success_{false};
  const char *failure_{nullptr};
  static constexpr size_t TRAILER_SIZE = 512;
  uint8_t held_[TRAILER_SIZE];
  size_t held_len_{0};
  uint32_t image_len_{0};
  mbedtls_sha256_context sha_;

 private:
  ota::OTABackendPtr ota_backend_{nullptr};
};

void OTARequestHandler::report_ota_progress_(AsyncWebServerRequest *request) {
  const uint32_t now = millis();
  if (now - this->last_ota_progress_ > 1000) {
    float percentage = 0.0f;
    if (request->contentLength() != 0) {
      // Note: Using contentLength() for progress calculation is technically wrong as it includes
      // multipart headers/boundaries, but it's only off by a small amount and we don't have
      // access to the actual firmware size until the upload is complete. This is intentional
      // as it still gives the user a reasonable progress indication.
      percentage = (this->ota_read_length_ * 100.0f) / request->contentLength();
      ESP_LOGD(TAG, "OTA in progress: %0.1f%%", percentage);
    } else {
      ESP_LOGD(TAG, "OTA in progress: %" PRIu32 " bytes read", this->ota_read_length_);
    }
#ifdef USE_OTA_STATE_LISTENER
    // Report progress - use notify_state_deferred_ since we're in web server task
    this->parent_->notify_state_deferred_(ota::OTA_IN_PROGRESS, percentage, 0);
#endif
    this->last_ota_progress_ = now;
  }
}

void OTARequestHandler::schedule_ota_reboot_() {
  ESP_LOGI(TAG, "OTA update successful!");
  this->parent_->set_timeout(100, []() {
    ESP_LOGI(TAG, "Performing OTA reboot now");
    App.safe_reboot();
  });
}

void OTARequestHandler::ota_init_(const char *filename) {
  ESP_LOGI(TAG, "OTA Update Start: %s", filename);
  this->ota_read_length_ = 0;
  this->ota_success_ = false;
  this->failure_ = nullptr;
  this->held_len_ = 0;
  this->image_len_ = 0;
  mbedtls_sha256_init(&this->sha_);
  mbedtls_sha256_starts(&this->sha_, 0);
}

// Writes everything except the last TRAILER_SIZE bytes seen so far.
ota::OTAResponseTypes OTARequestHandler::write_held_back_(const uint8_t *data, size_t len) {
  const size_t total = this->held_len_ + len;
  if (total <= TRAILER_SIZE) {
    std::memcpy(this->held_ + this->held_len_, data, len);
    this->held_len_ = total;
    return ota::OTA_RESPONSE_OK;
  }
  size_t flush = total - TRAILER_SIZE;
  const size_t from_held = flush < this->held_len_ ? flush : this->held_len_;
  if (from_held > 0) {
    auto err = this->ota_backend_->write(this->held_, from_held);
    if (err != ota::OTA_RESPONSE_OK)
      return err;
    mbedtls_sha256_update(&this->sha_, this->held_, from_held);
    std::memmove(this->held_, this->held_ + from_held, this->held_len_ - from_held);
    this->held_len_ -= from_held;
  }
  const size_t from_data = flush - from_held;
  if (from_data > 0) {
    auto err = this->ota_backend_->write(const_cast<uint8_t *>(data), from_data);
    if (err != ota::OTA_RESPONSE_OK)
      return err;
    mbedtls_sha256_update(&this->sha_, data, from_data);
  }
  std::memcpy(this->held_ + this->held_len_, data + from_data, len - from_data);
  this->held_len_ += len - from_data;
  this->image_len_ += flush;
  return ota::OTA_RESPONSE_OK;
}

bool OTARequestHandler::signature_ok_() {
  uint8_t digest[32];
  mbedtls_sha256_finish(&this->sha_, digest);
  mbedtls_sha256_free(&this->sha_);
  if (this->held_len_ != TRAILER_SIZE) {
    this->failure_ = "Refused: this file is not a signed OpenShrooly release.";
    return false;
  }
#ifdef USE_SIGNED_UPDATE
  char hex[65];
  for (int i = 0; i < 32; i++)
    snprintf(hex + i * 2, 3, "%02x", digest[i]);
  std::string version;
  if (signed_update::global_signed_update != nullptr &&
      signed_update::global_signed_update->lan_image_valid(this->held_, TRAILER_SIZE, this->image_len_, hex,
                                                           &version)) {
    ESP_LOGI(TAG, "Signed release %s accepted", version.c_str());
    return true;
  }
#endif
  this->failure_ = "Refused: this file is not a signed OpenShrooly release.";
  return false;
}

void OTARequestHandler::handleUpload(AsyncWebServerRequest *request, const PlatformString &filename, size_t index,
                                     uint8_t *data, size_t len, bool final) {
  ota::OTAResponseTypes error_code = ota::OTA_RESPONSE_OK;

  // First byte of a new upload: index==0 with actual data. (web_server_idf
  // fires a separate start-marker call with data==nullptr/len==0 before the
  // first real chunk; gate on len>0 so we only trigger once per upload.)
  if (index == 0 && len > 0) {
    // If a previous upload was interrupted (e.g. client closed the tab, TCP
    // reset) the backend from that session may still be open. Tear it down
    // so flash state doesn't get concatenated with the new image (which can
    // produce a technically-valid-sized but corrupted firmware that bricks
    // the device once it reboots).
    if (this->ota_backend_) {
      ESP_LOGW(TAG, "New OTA upload received while previous session was still open; aborting previous session");
      this->ota_backend_->abort();
#ifdef USE_OTA_STATE_LISTENER
      // Notify listeners that the previous session was aborted before the new one starts.
      this->parent_->notify_state_deferred_(ota::OTA_ABORT, 0.0f, 0);
#endif
      this->ota_backend_.reset();
    }

    // Initialize OTA on first call
    this->ota_init_(filename.c_str());

#ifdef USE_OTA_STATE_LISTENER
    // Notify OTA started - use notify_state_deferred_ since we're in web server task
    this->parent_->notify_state_deferred_(ota::OTA_STARTED, 0.0f, 0);
#endif

    // Platform-specific pre-initialization
#ifdef USE_ARDUINO
#if defined(USE_LIBRETINY)
    if (Update.isRunning()) {
      Update.abort();
    }
#endif
#endif  // USE_ARDUINO

    this->ota_backend_ = ota::make_ota_backend();
    if (!this->ota_backend_) {
      ESP_LOGE(TAG, "Failed to create OTA backend");
#ifdef USE_OTA_STATE_LISTENER
      this->parent_->notify_state_deferred_(ota::OTA_ERROR, 0.0f,
                                            static_cast<uint8_t>(ota::OTA_RESPONSE_ERROR_UNKNOWN));
#endif
      return;
    }

    // Web server OTA uses multipart uploads where the actual firmware size
    // is unknown (contentLength includes multipart overhead)
    // Pass 0 to indicate unknown size
    error_code = this->ota_backend_->begin(0);
    if (error_code != ota::OTA_RESPONSE_OK) {
      ESP_LOGE(TAG, "OTA begin failed: %d", error_code);
      this->ota_backend_.reset();
#ifdef USE_OTA_STATE_LISTENER
      this->parent_->notify_state_deferred_(ota::OTA_ERROR, 0.0f, static_cast<uint8_t>(error_code));
#endif
      return;
    }
  }

  if (!this->ota_backend_) {
    return;
  }

  // Process data
  if (len > 0) {
    error_code = this->write_held_back_(data, len);
    if (error_code != ota::OTA_RESPONSE_OK) {
      ESP_LOGE(TAG, "OTA write failed: %d", error_code);
      this->ota_backend_->abort();
      this->ota_backend_.reset();
#ifdef USE_OTA_STATE_LISTENER
      this->parent_->notify_state_deferred_(ota::OTA_ERROR, 0.0f, static_cast<uint8_t>(error_code));
#endif
      return;
    }
    this->ota_read_length_ += len;
    this->report_ota_progress_(request);
  }

  // Finalize
  if (final) {
    ESP_LOGD(TAG, "OTA final chunk: index=%zu, len=%zu, total_read=%" PRIu32 ", contentLength=%zu", index, len,
             this->ota_read_length_, request->contentLength());

    // For Arduino framework, the Update library tracks expected size from firmware header
    // If we haven't received enough data, calling end() will fail
    // This can happen if the upload is interrupted or the client disconnects
    if (!this->signature_ok_()) {
      ESP_LOGW(TAG, "Upload refused: no valid release signature");
      this->ota_backend_->abort();
      this->ota_backend_.reset();
#ifdef USE_OTA_STATE_LISTENER
      this->parent_->notify_state_deferred_(ota::OTA_ERROR, 0.0f,
                                            static_cast<uint8_t>(ota::OTA_RESPONSE_ERROR_UNKNOWN));
#endif
      return;
    }
    error_code = this->ota_backend_->end();
    if (error_code == ota::OTA_RESPONSE_OK) {
      this->ota_success_ = true;
#ifdef USE_OTA_STATE_LISTENER
      // Report completion before reboot - use notify_state_deferred_ since we're in web server task
      this->parent_->notify_state_deferred_(ota::OTA_COMPLETED, 100.0f, 0);
#endif
      this->schedule_ota_reboot_();
    } else {
      ESP_LOGE(TAG, "OTA end failed: %d", error_code);
#ifdef USE_OTA_STATE_LISTENER
      this->parent_->notify_state_deferred_(ota::OTA_ERROR, 0.0f, static_cast<uint8_t>(error_code));
#endif
    }
    this->ota_backend_.reset();
  }
}

void OTARequestHandler::handleRequest(AsyncWebServerRequest *request) {
  AsyncWebServerResponse *response;
  // Use the ota_success_ flag to determine the actual result
#ifdef USE_ESP8266
  static const char UPDATE_SUCCESS[] PROGMEM = "Update Successful!";
  static const char UPDATE_FAILED[] PROGMEM = "Update Failed!";
  static const char TEXT_PLAIN[] PROGMEM = "text/plain";
  static const char CONNECTION_STR[] PROGMEM = "Connection";
  static const char CLOSE_STR[] PROGMEM = "close";
  const char *msg = this->ota_success_ ? UPDATE_SUCCESS : UPDATE_FAILED;
  response = request->beginResponse_P(200, TEXT_PLAIN, msg);
  response->addHeader(CONNECTION_STR, CLOSE_STR);
#else
  const char *msg = this->ota_success_ ? "Update Successful!"
                    : this->failure_ != nullptr ? this->failure_
                                                : "Update Failed!";
  response = request->beginResponse(this->ota_success_ ? 200 : 400, "text/plain", msg);
  response->addHeader("Connection", "close");
#endif
  request->send(response);
}

void WebServerOTAComponent::setup() {
  // Get the global web server base instance and register our handler
  auto *base = web_server_base::global_web_server_base;
  if (base == nullptr) {
    ESP_LOGE(TAG, "WebServerBase not found");
    this->mark_failed();
    return;
  }

  // AsyncWebServer takes ownership of the handler and will delete it when the server is destroyed
  base->add_handler(new OTARequestHandler(this));  // NOLINT
}

void WebServerOTAComponent::dump_config() { ESP_LOGCONFIG(TAG, "Web Server OTA"); }

}  // namespace esphome::web_server

#endif  // USE_WEBSERVER_OTA
