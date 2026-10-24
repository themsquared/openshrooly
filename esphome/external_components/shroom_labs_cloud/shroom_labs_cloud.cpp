#include "shroom_labs_cloud.h"

#include "esphome/core/application.h"
#include "esphome/core/hal.h"
#include "esphome/core/log.h"
#include "../web_server_idf/web_server_idf.h"

#include <esp_crt_bundle.h>
#include <esp_http_client.h>
#include <esp_mac.h>
#include <esp_random.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <mbedtls/ctr_drbg.h>
#include <mbedtls/ecdsa.h>
#include <mbedtls/entropy.h>
#include <mbedtls/sha256.h>
#include <nvs.h>
#include <nvs_flash.h>

#if __has_include(<esp_flash_encrypt.h>)
#include <esp_flash_encrypt.h>
#define SHL_HAS_FLASH_ENC 1
#endif

#include <cstring>
#include <ctime>
#include <memory>

namespace esphome {
namespace shroom_labs {

static const char *const TAG = "shroom_labs_cloud";
static const char *const NVS_NS = "shlcloud";
static constexpr uint32_t MAGIC = 0x53484c32;  // SHL2

ShroomLabsCloud *global_shroom_labs_cloud = nullptr;  // NOLINT

struct SavedIdentity {
  uint32_t magic;
  uint8_t d[32];
  uint8_t x[32];
  uint8_t y[32];
  char device_id[40];
  char enroll_token[96];
  char claim_code[8];
  char claim_url[160];
  char claim_expires[32];
  char serial[48];
  char fingerprint[80];
  char not_after[32];
  int64_t rotate_after_ms;
  int64_t issued_ms;
  int64_t claim_deadline_ms;
  uint8_t state;
  uint8_t enabled;
  uint8_t has_key;
  uint8_t has_cert;
} __attribute__((packed));

static void nvs_put_blob(nvs_handle_t h, const char *key, const void *data, size_t len) {
  nvs_set_blob(h, key, data, len);
}

static bool nvs_get_blob(nvs_handle_t h, const char *key, void *data, size_t len) {
  size_t n = len;
  return nvs_get_blob(h, key, data, &n) == ESP_OK && n == len;
}

using web_server_idf::AsyncWebHandler;
using web_server_idf::AsyncWebServerRequest;

class CloudPage : public AsyncWebHandler {
 public:
  explicit CloudPage(ShroomLabsCloud *c) : cloud_(c) {}
  bool canHandle(AsyncWebServerRequest *request) const override {
    char buf[AsyncWebServerRequest::URL_BUF_SIZE];
    auto url = request->url_to(buf);
    return url == "/cloud" || url == "/cloud/connect" || url == "/cloud/refresh" || url == "/cloud/disconnect";
  }
  void handleRequest(AsyncWebServerRequest *request) override {
    char buf[AsyncWebServerRequest::URL_BUF_SIZE];
    auto url = request->url_to(buf);
    const auto method = request->method();
    if (url == "/cloud" && method == HTTP_GET) {
      auto *res = request->beginResponse(200, "application/json", this->cloud_->status_json());
      res->addHeader("Cache-Control", "no-store");
      request->send(res);
      return;
    }
    if (url == "/cloud/connect" && method == HTTP_POST) {
      this->cloud_->connect();
    } else if (url == "/cloud/refresh" && method == HTTP_POST) {
      this->cloud_->refresh();
    } else if (url == "/cloud/disconnect" && method == HTTP_POST) {
      this->cloud_->disconnect();
    } else {
      request->send(404, "text/plain", "not found");
      return;
    }
    auto *res = request->beginResponse(200, "application/json", this->cloud_->status_json());
    res->addHeader("Cache-Control", "no-store");
    request->send(res);
  }

 protected:
  ShroomLabsCloud *cloud_;
};

}  // namespace shroom_labs
}  // namespace esphome

namespace esphome {
namespace shroom_labs {

bool ShroomLabsCloud::sign_(const uint8_t *data, size_t len, uint8_t sig[64]) {
  if (!this->has_key_ || data == nullptr || sig == nullptr)
    return false;
  uint8_t hash[32];
  if (mbedtls_sha256(data, len, hash, 0) != 0)
    return false;
  mbedtls_entropy_context entropy;
  mbedtls_ctr_drbg_context ctr;
  mbedtls_ecp_group grp;
  mbedtls_mpi priv, r, s;
  mbedtls_entropy_init(&entropy);
  mbedtls_ctr_drbg_init(&ctr);
  mbedtls_ecp_group_init(&grp);
  mbedtls_mpi_init(&priv);
  mbedtls_mpi_init(&r);
  mbedtls_mpi_init(&s);
  bool ok = false;
  do {
    if (mbedtls_ctr_drbg_seed(&ctr, mbedtls_entropy_func, &entropy, reinterpret_cast<const uint8_t *>("shl-pop"), 7) !=
        0)
      break;
    if (mbedtls_ecp_group_load(&grp, MBEDTLS_ECP_DP_SECP256R1) != 0)
      break;
    if (mbedtls_mpi_read_binary(&priv, this->priv_, 32) != 0)
      break;
    if (mbedtls_ecdsa_sign(&grp, &r, &s, &priv, hash, 32, mbedtls_ctr_drbg_random, &ctr) != 0)
      break;
    if (mbedtls_mpi_write_binary(&r, sig, 32) != 0)
      break;
    if (mbedtls_mpi_write_binary(&s, sig + 32, 32) != 0)
      break;
    ok = true;
  } while (false);
  mbedtls_mpi_free(&s);
  mbedtls_mpi_free(&r);
  mbedtls_mpi_free(&priv);
  mbedtls_ecp_group_free(&grp);
  mbedtls_ctr_drbg_free(&ctr);
  mbedtls_entropy_free(&entropy);
  return ok;
}

bool ShroomLabsCloud::ensure_key_() {
  if (this->has_key_)
    return true;
  mbedtls_entropy_context entropy;
  mbedtls_ctr_drbg_context ctr;
  mbedtls_ecp_group grp;
  mbedtls_mpi priv;
  mbedtls_ecp_point Q;
  mbedtls_entropy_init(&entropy);
  mbedtls_ctr_drbg_init(&ctr);
  mbedtls_ecp_group_init(&grp);
  mbedtls_mpi_init(&priv);
  mbedtls_ecp_point_init(&Q);
  bool ok = false;
  do {
    if (mbedtls_ctr_drbg_seed(&ctr, mbedtls_entropy_func, &entropy, reinterpret_cast<const uint8_t *>("shl-key"), 7) !=
        0)
      break;
    if (mbedtls_ecp_group_load(&grp, MBEDTLS_ECP_DP_SECP256R1) != 0)
      break;
    if (mbedtls_ecp_gen_keypair(&grp, &priv, &Q, mbedtls_ctr_drbg_random, &ctr) != 0)
      break;
    if (mbedtls_mpi_write_binary(&priv, this->priv_, 32) != 0)
      break;
    uint8_t xy[65];
    size_t olen = 0;
    if (mbedtls_ecp_point_write_binary(&grp, &Q, MBEDTLS_ECP_PF_UNCOMPRESSED, &olen, xy, sizeof(xy)) != 0 || olen != 65)
      break;
    std::memcpy(this->pub_x_, xy + 1, 32);
    std::memcpy(this->pub_y_, xy + 33, 32);
    this->has_key_ = true;
    ok = true;
    ESP_LOGI(TAG, "Created this chamber's cloud key");
  } while (false);
  mbedtls_ecp_point_free(&Q);
  mbedtls_mpi_free(&priv);
  mbedtls_ecp_group_free(&grp);
  mbedtls_ctr_drbg_free(&ctr);
  mbedtls_entropy_free(&entropy);
  if (ok)
    this->save_identity_();
  return ok;
}

bool ShroomLabsCloud::make_csr_(std::string *pem) {
  if (!this->ensure_key_())
    return false;
  auto cb = [](const uint8_t *data, size_t len, uint8_t sig[64], void *ctx) {
    return static_cast<ShroomLabsCloud *>(ctx)->sign_(data, len, sig);
  };
  const char *cn = this->device_id_.empty() ? "chamber" : this->device_id_.c_str();
  return build_p256_csr_pem(this->pub_x_, this->pub_y_, cn, cb, this, pem);
}

std::string ShroomLabsCloud::hardware_id_() const {
  uint8_t mac[6] = {};
  esp_read_mac(mac, ESP_MAC_WIFI_STA);
  char id[13];
  hex_encode_to(mac, 6, id);
  return std::string(id, 12);
}

void ShroomLabsCloud::load_() {
#ifdef SHL_HAS_FLASH_ENC
  this->flash_encrypted_ = esp_flash_encryption_enabled();
#endif
#ifdef CONFIG_NVS_ENCRYPTION
  this->nvs_encrypted_ = true;
#else
  this->nvs_encrypted_ = this->flash_encrypted_;
#endif
  nvs_handle_t h;
  if (nvs_open(NVS_NS, NVS_READONLY, &h) != ESP_OK)
    return;
  SavedIdentity s{};
  bool have = nvs_get_blob(h, "id", &s, sizeof(s));
  size_t pem_len = 0;
  if (nvs_get_str(h, "pem", nullptr, &pem_len) == ESP_OK && pem_len > 1 && pem_len < 2048) {
    this->cert_pem_.assign(pem_len, '\0');
    if (nvs_get_str(h, "pem", this->cert_pem_.data(), &pem_len) == ESP_OK) {
      if (!this->cert_pem_.empty() && this->cert_pem_.back() == '\0')
        this->cert_pem_.pop_back();
    } else {
      this->cert_pem_.clear();
    }
  }
  nvs_close(h);
  if (!have || s.magic != MAGIC)
    return;
  if (s.has_key) {
    std::memcpy(this->priv_, s.d, 32);
    std::memcpy(this->pub_x_, s.x, 32);
    std::memcpy(this->pub_y_, s.y, 32);
    this->has_key_ = true;
  }
  this->device_id_ = s.device_id;
  this->enroll_token_ = s.enroll_token;
  this->claim_code_ = s.claim_code;
  this->claim_url_ = s.claim_url;
  this->claim_expires_ = s.claim_expires;
  this->serial_ = s.serial;
  this->fingerprint_ = s.fingerprint;
  this->not_after_ = s.not_after;
  this->rotate_after_ms_ = s.rotate_after_ms ? s.rotate_after_ms : ROTATE_AFTER_MS;
  this->issued_ms_ = s.issued_ms;
  this->claim_deadline_ms_ = s.claim_deadline_ms;
  this->has_cert_ = s.has_cert && !this->cert_pem_.empty() && !this->serial_.empty();
  this->cloud_enabled_ = s.enabled != 0;
  this->state_ = static_cast<CloudState>(s.state);
  if (!this->cloud_enabled_)
    this->state_ = CloudState::Off;
}

void ShroomLabsCloud::save_identity_() {
  SavedIdentity s{};
  s.magic = MAGIC;
  if (this->has_key_) {
    std::memcpy(s.d, this->priv_, 32);
    std::memcpy(s.x, this->pub_x_, 32);
    std::memcpy(s.y, this->pub_y_, 32);
    s.has_key = 1;
  }
  std::snprintf(s.device_id, sizeof(s.device_id), "%s", this->device_id_.c_str());
  std::snprintf(s.enroll_token, sizeof(s.enroll_token), "%s", this->enroll_token_.c_str());
  std::snprintf(s.claim_code, sizeof(s.claim_code), "%s", this->claim_code_.c_str());
  std::snprintf(s.claim_url, sizeof(s.claim_url), "%s", this->claim_url_.c_str());
  std::snprintf(s.claim_expires, sizeof(s.claim_expires), "%s", this->claim_expires_.c_str());
  std::snprintf(s.serial, sizeof(s.serial), "%s", this->serial_.c_str());
  std::snprintf(s.fingerprint, sizeof(s.fingerprint), "%s", this->fingerprint_.c_str());
  std::snprintf(s.not_after, sizeof(s.not_after), "%s", this->not_after_.c_str());
  s.rotate_after_ms = this->rotate_after_ms_;
  s.issued_ms = this->issued_ms_;
  s.claim_deadline_ms = this->claim_deadline_ms_;
  s.state = static_cast<uint8_t>(this->state_);
  s.enabled = this->cloud_enabled_ ? 1 : 0;
  s.has_cert = this->has_cert_ ? 1 : 0;
  nvs_handle_t h;
  if (nvs_open(NVS_NS, NVS_READWRITE, &h) != ESP_OK)
    return;
  nvs_put_blob(h, "id", &s, sizeof(s));
  nvs_commit(h);
  nvs_close(h);
}

void ShroomLabsCloud::save_cert_(const std::string &pem) {
  this->cert_pem_ = pem;
  this->has_cert_ = !pem.empty();
  nvs_handle_t h;
  if (nvs_open(NVS_NS, NVS_READWRITE, &h) != ESP_OK)
    return;
  if (pem.empty())
    nvs_erase_key(h, "pem");
  else
    nvs_set_str(h, "pem", pem.c_str());
  nvs_commit(h);
  nvs_close(h);
  this->save_identity_();
}

void ShroomLabsCloud::clear_cert_() {
  this->serial_.clear();
  this->fingerprint_.clear();
  this->not_after_.clear();
  this->issued_ms_ = 0;
  this->save_cert_("");
}

void ShroomLabsCloud::setup() {
  global_shroom_labs_cloud = this;
  this->load_();
  this->base_->add_handler(new CloudPage(this));  // NOLINT(cppcoreguidelines-owning-memory)
  ESP_LOGI(TAG, "Cloud link %s. Host=%s. Flash encryption %s. NVS encryption %s.",
           this->cloud_enabled_ ? "on" : "off (opt-in)", this->api_host_.c_str(),
           this->flash_encrypted_ ? "on" : "off", this->nvs_encrypted_ ? "on" : "off");
  if (!this->flash_encrypted_ && !this->nvs_encrypted_) {
    ESP_LOGW(TAG, "The cloud private key is in NVS without flash encryption on this build");
  }
  if (this->cloud_enabled_ && this->state_ == CloudState::PendingClaim)
    this->show_claim_ = true;
  if (this->cloud_enabled_ && this->state_ == CloudState::Linked)
    this->next_probe_ms_ = millis() + 60000;
}

void ShroomLabsCloud::dump_config() {
  ESP_LOGCONFIG(TAG, "Shroom Labs cloud:");
  ESP_LOGCONFIG(TAG, "  Enabled: %s", YESNO(this->cloud_enabled_));
  ESP_LOGCONFIG(TAG, "  State: %s", state_name(this->state_));
  ESP_LOGCONFIG(TAG, "  Host: %s", this->api_host_.c_str());
  ESP_LOGCONFIG(TAG, "  Device id present: %s", YESNO(!this->device_id_.empty()));
  ESP_LOGCONFIG(TAG, "  Linked: %s", YESNO(this->linked()));
  ESP_LOGCONFIG(TAG, "  Flash encryption: %s", YESNO(this->flash_encrypted_));
}

void ShroomLabsCloud::apply_(CloudEvent event) {
  CloudState next = next_state(this->state_, event);
  if (next != this->state_) {
    ESP_LOGI(TAG, "Cloud state %s -> %s", state_name(this->state_), state_name(next));
    this->state_ = next;
    if (next == CloudState::PendingClaim)
      this->show_claim_ = true;
    this->save_identity_();
  } else if (event == CloudEvent::Disable) {
    this->state_ = CloudState::Off;
    this->save_identity_();
  }
}

void ShroomLabsCloud::queue_(Job job) {
  if (this->busy_.exchange(true)) {
    ESP_LOGD(TAG, "Cloud job already running");
    return;
  }
  this->job_ = job;
  if (xTaskCreate(task_entry_, "shl_cloud", 16384, this, 1, nullptr) != pdPASS) {
    this->busy_ = false;
    ESP_LOGW(TAG, "Could not start the cloud task");
  }
}

void ShroomLabsCloud::task_entry_(void *arg) {
  static_cast<ShroomLabsCloud *>(arg)->run_job_();
  static_cast<ShroomLabsCloud *>(arg)->busy_ = false;
  vTaskDelete(nullptr);
}

void ShroomLabsCloud::run_job_() {
  Job job;
  {
    std::lock_guard<std::mutex> g(this->lock_);
    job = this->job_;
    this->job_ = Job::NONE;
  }
  bool ok = false;
  switch (job) {
    case Job::ENROLL:
      ok = this->handle_enroll_();
      break;
    case Job::CSR:
      ok = this->handle_csr_();
      break;
    case Job::ROTATE:
      ok = this->handle_rotate_();
      break;
    case Job::RECLAIM:
      ok = this->handle_reclaim_();
      break;
    case Job::PROBE:
      ok = this->handle_probe_();
      break;
    default:
      break;
  }
  (void) ok;
}

void ShroomLabsCloud::connect() {
  std::lock_guard<std::mutex> g(this->lock_);
  this->cloud_enabled_ = true;
  this->apply_(CloudEvent::Enable);
  this->backoff_ms_ = 20000;
  this->save_identity_();
  if (this->state_ == CloudState::Linked)
    return;
  if (this->state_ == CloudState::Revoked)
    this->queue_(Job::RECLAIM);
  else
    this->queue_(Job::ENROLL);
}

void ShroomLabsCloud::disconnect() {
  std::lock_guard<std::mutex> g(this->lock_);
  this->cloud_enabled_ = false;
  this->claim_code_.clear();
  this->claim_url_.clear();
  this->claim_expires_.clear();
  this->claim_deadline_ms_ = 0;
  this->clear_cert_();
  this->apply_(CloudEvent::Disable);
  ESP_LOGI(TAG, "Cloud disconnected locally. Growing still works here.");
}

void ShroomLabsCloud::refresh() {
  std::lock_guard<std::mutex> g(this->lock_);
  if (!this->cloud_enabled_)
    return;
  this->backoff_ms_ = 20000;
  if (this->state_ == CloudState::Revoked) {
    this->queue_(Job::RECLAIM);
    return;
  }
  this->apply_(CloudEvent::Refresh);
  this->queue_(Job::ENROLL);
}

CloudState ShroomLabsCloud::state() const {
  std::lock_guard<std::mutex> g(this->lock_);
  return this->state_;
}

bool ShroomLabsCloud::cloud_enabled() const {
  std::lock_guard<std::mutex> g(this->lock_);
  return this->cloud_enabled_;
}

bool ShroomLabsCloud::linked() const {
  std::lock_guard<std::mutex> g(this->lock_);
  return this->state_ == CloudState::Linked && this->has_cert_;
}

bool ShroomLabsCloud::cloud_ready() const { return this->linked() && this->cloud_enabled(); }

void ShroomLabsCloud::note_local_change() { this->last_local_change_ms_ = millis(); }

std::string ShroomLabsCloud::claim_code() const {
  std::lock_guard<std::mutex> g(this->lock_);
  return this->claim_code_;
}

std::string ShroomLabsCloud::claim_url() const {
  std::lock_guard<std::mutex> g(this->lock_);
  return this->claim_url_;
}

bool ShroomLabsCloud::take_show_claim() { return this->show_claim_.exchange(false); }

std::string ShroomLabsCloud::display_title() const {
  switch (this->state()) {
    case CloudState::Linked:
      return "Linked";
    case CloudState::Revoked:
      return "Unlinked";
    case CloudState::Off:
      return "Cloud off";
    default:
      return "Claim";
  }
}

std::string ShroomLabsCloud::display_code() const {
  std::lock_guard<std::mutex> g(this->lock_);
  if (this->state_ == CloudState::Linked)
    return "OK";
  if (this->state_ == CloudState::Off)
    return "";
  return format_claim_code(this->claim_code_.c_str());
}

std::string ShroomLabsCloud::display_hint() const {
  std::lock_guard<std::mutex> g(this->lock_);
  return state_message(this->state_);
}

std::string ShroomLabsCloud::display_expiry() const {
  uint32_t s = this->claim_seconds_left_();
  if (this->state() != CloudState::PendingClaim)
    return "";
  if (s == 0)
    return "Code expired. Press Refresh.";
  char buf[40];
  std::snprintf(buf, sizeof(buf), "Expires in %u min", static_cast<unsigned>((s + 59) / 60));
  return buf;
}

uint32_t ShroomLabsCloud::claim_seconds_left_() const {
  std::lock_guard<std::mutex> g(this->lock_);
  int64_t now = this->now_ms_();
  if (this->claim_deadline_ms_ <= 0)
    return 0;
  if (now <= 0) {
    // No wall clock yet: use the stored remaining window from enroll time if we can.
    return CLAIM_MS / 1000;
  }
  if (now >= this->claim_deadline_ms_)
    return 0;
  return static_cast<uint32_t>((this->claim_deadline_ms_ - now) / 1000);
}

int64_t ShroomLabsCloud::now_ms_() const {
  time_t t = time(nullptr);
  if (t < 1700000000)
    return 0;
  return static_cast<int64_t>(t) * 1000;
}

bool ShroomLabsCloud::fill_qr(QrCode *out) const {
  std::string url;
  {
    std::lock_guard<std::mutex> g(this->lock_);
    url = this->claim_url_;
    if (url.empty() && !this->claim_code_.empty())
      url = claim_url_for(this->site_origin_.c_str(), this->claim_code_.c_str());
  }
  if (url.empty())
    return false;
  return qr_encode(url.c_str(), out);
}

std::string ShroomLabsCloud::status_json() const {
  std::lock_guard<std::mutex> g(this->lock_);
  QrCode qr{};
  std::string url = this->claim_url_;
  if (url.empty() && !this->claim_code_.empty())
    url = claim_url_for(this->site_origin_.c_str(), this->claim_code_.c_str());
  std::string qr_bits;
  int qr_size = 0;
  if (!url.empty() && this->state_ == CloudState::PendingClaim && qr_encode(url.c_str(), &qr)) {
    qr_size = qr.size;
    qr_bits = qr_modules_string(qr);
  }
  uint32_t left = 0;
  if (this->claim_deadline_ms_ > 0) {
    int64_t now = this->now_ms_();
    if (now > 0 && now < this->claim_deadline_ms_)
      left = static_cast<uint32_t>((this->claim_deadline_ms_ - now) / 1000);
    else if (now <= 0)
      left = CLAIM_MS / 1000;
  }
  std::string out = "{";
  out += "\"enabled\":";
  out += this->cloud_enabled_ ? "true" : "false";
  out += ",\"state\":\"";
  out += state_name(this->state_);
  out += "\",\"linked\":";
  out += (this->state_ == CloudState::Linked && this->has_cert_) ? "true" : "false";
  out += ",\"claim_code\":\"";
  out += format_claim_code(this->claim_code_.c_str());
  out += "\",\"claim_url\":\"";
  out += url;
  out += "\",\"claim_expires_at\":\"";
  out += this->claim_expires_;
  out += "\",\"expires_in_s\":";
  out += std::to_string(left);
  out += ",\"message\":\"";
  out += state_message(this->state_);
  out += "\",\"nvs_encrypted\":";
  out += this->nvs_encrypted_ ? "true" : "false";
  out += ",\"flash_encrypted\":";
  out += this->flash_encrypted_ ? "true" : "false";
  out += ",\"qr_size\":";
  out += std::to_string(qr_size);
  out += ",\"qr\":\"";
  out += qr_bits;
  out += "\"}";
  return out;
}

struct HttpClientDeleter {
  void operator()(esp_http_client_handle_t c) const {
    if (c != nullptr) {
      esp_http_client_close(c);
      esp_http_client_cleanup(c);
    }
  }
};
using HttpClient = std::unique_ptr<std::remove_pointer<esp_http_client_handle_t>::type, HttpClientDeleter>;

bool ShroomLabsCloud::http_(const char *method, const char *path, const std::string &body, bool pop, bool with_serial,
                            int *status, std::string *response) {
  std::string url = https_url(this->api_host_.c_str(), path);
  if (!api_url_allowed(url.c_str(), this->api_host_.c_str())) {
    ESP_LOGW(TAG, "Refusing a cloud URL that is not this host");
    return false;
  }
  std::string nonce, proof;
  if (pop) {
    if (!this->fetch_nonce_(&nonce))
      return false;
    uint8_t hash[32];
    mbedtls_sha256(reinterpret_cast<const uint8_t *>(body.data()), body.size(), hash, 0);
    char hex[65];
    hex_encode_to(hash, 32, hex);
    std::string payload = proof_payload(this->device_id_.c_str(), nonce.c_str(), method, path, hex);
    uint8_t sig[64];
    if (!this->sign_(reinterpret_cast<const uint8_t *>(payload.data()), payload.size(), sig))
      return false;
    proof = base64_encode(sig, 64);
  }

  esp_http_client_config_t cfg = {};
  cfg.url = url.c_str();
  cfg.crt_bundle_attach = esp_crt_bundle_attach;
  cfg.timeout_ms = 20000;
  cfg.disable_auto_redirect = true;
  cfg.buffer_size = 2048;
  cfg.user_agent = "ShroomLabs-chamber";
  cfg.method = (method != nullptr && std::strcmp(method, "GET") == 0) ? HTTP_METHOD_GET : HTTP_METHOD_POST;
  HttpClient client(esp_http_client_init(&cfg));
  if (!client)
    return false;
  esp_http_client_set_header(client.get(), "Content-Type", "application/json");
  if (!nonce.empty())
    esp_http_client_set_header(client.get(), "x-device-nonce", nonce.c_str());
  if (!proof.empty())
    esp_http_client_set_header(client.get(), "x-device-proof", proof.c_str());
  if (with_serial && !this->serial_.empty())
    esp_http_client_set_header(client.get(), "x-device-cert-serial", this->serial_.c_str());
  if (!body.empty())
    esp_http_client_set_post_field(client.get(), body.c_str(), static_cast<int>(body.size()));
  if (esp_http_client_perform(client.get()) != ESP_OK)
    return false;
  int st = esp_http_client_get_status_code(client.get());
  if (status)
    *status = st;
  int64_t length = esp_http_client_get_content_length(client.get());
  if (length < 0)
    length = 0;
  if (length > static_cast<int64_t>(MAX_DEVICE_BODY))
    return false;
  std::string out;
  out.resize(MAX_DEVICE_BODY);
  int got = esp_http_client_read_response(client.get(), out.data(), out.size());
  if (got < 0)
    return false;
  out.resize(static_cast<size_t>(got));
  if (response)
    *response = std::move(out);
  return true;
}

bool ShroomLabsCloud::fetch_nonce_(std::string *nonce) {
  if (this->device_id_.empty())
    return false;
  std::string path = "/api/devices/" + this->device_id_ + "/nonce";
  int status = 0;
  std::string body;
  if (!this->http_("POST", path.c_str(), "", false, false, &status, &body))
    return false;
  if (status != 200)
    return false;
  return json_get_string(body.c_str(), "nonce", nonce) && !nonce->empty();
}

void ShroomLabsCloud::store_enroll_(const std::string &body) {
  json_get_string(body.c_str(), "device_id", &this->device_id_);
  json_get_string(body.c_str(), "claim_code", &this->claim_code_);
  this->claim_code_ = format_claim_code(this->claim_code_.c_str());
  json_get_string(body.c_str(), "enroll_token", &this->enroll_token_);
  json_get_string(body.c_str(), "claim_url", &this->claim_url_);
  if (this->claim_url_.empty())
    json_get_string(body.c_str(), "qr", &this->claim_url_);
  if (this->claim_url_.empty() && !this->claim_code_.empty())
    this->claim_url_ = claim_url_for(this->site_origin_.c_str(), this->claim_code_.c_str());
  json_get_string(body.c_str(), "claim_expires_at", &this->claim_expires_);
  int64_t exp = parse_iso8601_ms(this->claim_expires_.c_str());
  int64_t now = this->now_ms_();
  this->claim_deadline_ms_ = exp > 0 ? exp : (now > 0 ? now + CLAIM_MS : 0);
  if (this->claim_deadline_ms_ == 0)
    this->claim_deadline_ms_ = static_cast<int64_t>(millis()) + CLAIM_MS;  // fallback, not wall time
}

void ShroomLabsCloud::store_cert_(const std::string &body) {
  std::string pem;
  json_get_string(body.c_str(), "certificate", &pem);
  json_get_string(body.c_str(), "serial", &this->serial_);
  json_get_string(body.c_str(), "fingerprint", &this->fingerprint_);
  json_get_string(body.c_str(), "not_after", &this->not_after_);
  int64_t rot = 0;
  if (json_get_int64(body.c_str(), "rotate_after_ms", &rot) && rot > 0)
    this->rotate_after_ms_ = rot;
  this->issued_ms_ = this->now_ms_();
  this->save_cert_(pem);
}

bool ShroomLabsCloud::handle_enroll_() {
  if (!this->ensure_key_()) {
    std::lock_guard<std::mutex> g(this->lock_);
    this->apply_(CloudEvent::EnrollFail);
    return false;
  }
  std::string jwk = jwk_json(this->pub_x_, this->pub_y_);
  std::string body = enroll_body_json(this->hardware_id_().c_str(), jwk.c_str(), "Chamber");
  int status = 0;
  std::string res;
  if (!this->http_("POST", "/api/devices/enroll", body, false, false, &status, &res)) {
    std::lock_guard<std::mutex> g(this->lock_);
    this->apply_(CloudEvent::EnrollFail);
    return false;
  }
  {
    std::lock_guard<std::mutex> g(this->lock_);
    if (status == 200) {
      this->store_enroll_(res);
      this->apply_(CloudEvent::EnrollOk);
      this->next_csr_ms_ = millis() + 3000;
      this->save_identity_();
      return true;
    }
    if (status == 409) {
      this->apply_(CloudEvent::EnrollOwned);
    } else {
      this->apply_(CloudEvent::EnrollFail);
      return false;
    }
  }
  // 409: this MAC is already claimed. Continue inline; busy_ is still held.
  if (!this->enroll_token_.empty())
    return this->handle_csr_();
  return this->handle_reclaim_();
}

bool ShroomLabsCloud::handle_csr_() {
  if (this->device_id_.empty() || this->enroll_token_.empty()) {
    std::lock_guard<std::mutex> g(this->lock_);
    this->apply_(CloudEvent::CsrFail);
    return false;
  }
  std::string csr;
  if (!this->make_csr_(&csr)) {
    std::lock_guard<std::mutex> g(this->lock_);
    this->apply_(CloudEvent::CsrFail);
    return false;
  }
  std::string path = "/api/devices/" + this->device_id_ + "/csr";
  std::string body = csr_body_json(csr.c_str(), this->enroll_token_.c_str());
  int status = 0;
  std::string res;
  if (!this->http_("POST", path.c_str(), body, true, false, &status, &res)) {
    std::lock_guard<std::mutex> g(this->lock_);
    this->apply_(CloudEvent::CsrFail);
    return false;
  }
  std::lock_guard<std::mutex> g(this->lock_);
  if (status == 200) {
    this->store_cert_(res);
    this->claim_code_.clear();
    this->claim_url_.clear();
    this->apply_(CloudEvent::CsrOk);
    this->next_probe_ms_ = millis() + 3600000;
    return true;
  }
  if (status == 403) {
    this->apply_(CloudEvent::CsrWaiting);
    this->next_csr_ms_ = millis() + this->backoff_ms_;
    return true;
  }
  if (status == 429) {
    this->apply_(CloudEvent::RateLimited);
    this->backoff_ms_ = 360000;
    this->next_csr_ms_ = millis() + this->backoff_ms_;
    return true;
  }
  if (status == 401) {
    this->apply_(CloudEvent::CsrAuthFail);
    return false;
  }
  this->apply_(CloudEvent::CsrFail);
  return false;
}

bool ShroomLabsCloud::handle_rotate_() {
  if (this->device_id_.empty() || !this->has_cert_)
    return false;
  std::string csr;
  if (!this->make_csr_(&csr))
    return false;
  std::string path = "/api/devices/" + this->device_id_ + "/rotate";
  std::string body = rotate_body_json(csr.c_str());
  int status = 0;
  std::string res;
  if (!this->http_("POST", path.c_str(), body, true, true, &status, &res))
    return false;
  std::lock_guard<std::mutex> g(this->lock_);
  if (status == 200) {
    this->store_cert_(res);
    this->apply_(CloudEvent::RotateOk);
    return true;
  }
  if (status == 401) {
    this->apply_(CloudEvent::LinkAuthFail);
    return false;
  }
  this->apply_(CloudEvent::CsrFail);
  return false;
}

bool ShroomLabsCloud::handle_reclaim_() {
  if (this->device_id_.empty() && !this->ensure_key_())
    return false;
  if (this->device_id_.empty()) {
    return this->handle_enroll_();
  }
  std::string jwk = jwk_json(this->pub_x_, this->pub_y_);
  std::string path = "/api/devices/" + this->device_id_ + "/reclaim";
  std::string body = reclaim_body_json(jwk.c_str());
  int status = 0;
  std::string res;
  if (!this->http_("POST", path.c_str(), body, true, false, &status, &res)) {
    std::lock_guard<std::mutex> g(this->lock_);
    this->apply_(CloudEvent::ReclaimFail);
    return false;
  }
  std::lock_guard<std::mutex> g(this->lock_);
  if (status == 200) {
    this->clear_cert_();
    this->store_enroll_(res);
    this->apply_(CloudEvent::ReclaimOk);
    this->next_csr_ms_ = millis() + 3000;
    this->save_identity_();
    return true;
  }
  this->apply_(CloudEvent::ReclaimFail);
  return false;
}

bool ShroomLabsCloud::handle_probe_() {
  // Phase 2 hook: read inbox to notice revoke. Do not apply commands.
  if (this->device_id_.empty() || !this->has_cert_)
    return false;
  std::string path = "/api/devices/" + this->device_id_ + "/inbox";
  int status = 0;
  std::string res;
  if (!this->http_("GET", path.c_str(), "", true, true, &status, &res))
    return false;
  if (status == 401) {
    std::lock_guard<std::mutex> g(this->lock_);
    this->apply_(CloudEvent::LinkAuthFail);
    return false;
  }
  return status == 200;
}

void ShroomLabsCloud::loop() {
  if (!this->cloud_enabled_ || this->busy_)
    return;
  const uint32_t now = millis();
  CloudState st;
  {
    std::lock_guard<std::mutex> g(this->lock_);
    st = this->state_;
  }
  if (st == CloudState::PendingClaim || st == CloudState::Issuing) {
    uint32_t left = this->claim_seconds_left_();
    if (st == CloudState::PendingClaim && left == 0 && this->now_ms_() > 0) {
      this->refresh();
      return;
    }
    if (now >= this->next_csr_ms_) {
      this->next_csr_ms_ = now + this->backoff_ms_;
      this->queue_(Job::CSR);
    }
    return;
  }
  if (st == CloudState::Linked) {
    int64_t wall = this->now_ms_();
    if (wall > 0 && this->issued_ms_ > 0 && wall >= this->issued_ms_ + this->rotate_after_ms_) {
      std::lock_guard<std::mutex> g(this->lock_);
      this->apply_(CloudEvent::RotateDue);
      this->queue_(Job::ROTATE);
      return;
    }
    if (now >= this->next_probe_ms_) {
      this->next_probe_ms_ = now + 3600000;
      this->queue_(Job::PROBE);
    }
  }
}

}  // namespace shroom_labs
}  // namespace esphome
