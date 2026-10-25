#include "shroom_labs_cloud.h"

#include "esphome/core/application.h"
#include "esphome/core/hal.h"
#include "esphome/core/log.h"
#include "esphome/components/number/number.h"
#include "esphome/components/sensor/sensor.h"
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
#include "cloud_sha256.h"
#include <mbedtls/sha256.h>
#include <nvs.h>
#include <nvs_flash.h>

#if __has_include(<esp_flash_encrypt.h>)
#include <esp_flash_encrypt.h>
#define SHL_HAS_FLASH_ENC 1
#endif

#include <cmath>
#include <cstring>
#include <ctime>
#include <memory>
#include <strings.h>

#ifndef SHL_CLOUD_REMOTE_APPLY
#define SHL_CLOUD_REMOTE_APPLY 1
#endif

namespace esphome {
namespace shroom_labs {

static const char *const TAG = "shroom_labs_cloud";
static const char *const NVS_NS = "shlcloud";

ShroomLabsCloud *global_shroom_labs_cloud = nullptr;  // NOLINT

static void nvs_write_blob(nvs_handle_t h, const char *key, const void *data, size_t len) {
  nvs_set_blob(h, key, data, len);
}

static bool nvs_read_blob(nvs_handle_t h, const char *key, void *data, size_t len) {
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
    return cloud_owns_url(std::string(request->url_to(buf)).c_str());
  }
  void handleRequest(AsyncWebServerRequest *request) override {
    const auto method = request->method();
    if (method == HTTP_GET) {
      auto *res = request->beginResponse(200, "application/json", this->cloud_->status_json());
      res->addHeader("Cache-Control", "no-store");
      request->send(res);
      return;
    }
    if (method != HTTP_POST) {
      request->send(404, "text/plain", "not found");
      return;
    }
    const std::string action = request->arg("action");
    if (action == "connect")
      this->cloud_->connect();
    else if (action == "refresh")
      this->cloud_->refresh();
    else if (action == "disconnect")
      this->cloud_->disconnect();
    else if (action == "remote_apply_on")
      this->cloud_->set_remote_apply(true);
    else if (action == "remote_apply_off")
      this->cloud_->set_remote_apply(false);
    else {
      request->send(400, "text/plain", "unknown action");
      return;
    }
    auto *res = request->beginResponse(200, "application/json", this->cloud_->status_json());
    res->addHeader("Cache-Control", "no-store");
    request->send(res);
  }

 protected:
  ShroomLabsCloud *cloud_;
};

uint32_t EspClock::now_ms() { return millis(); }
int64_t EspClock::wall_ms() {
  time_t t = time(nullptr);
  return (t >= 1700000000) ? static_cast<int64_t>(t) * 1000 : 0;
}
uint32_t EspClock::random() { return esp_random(); }

bool EspStore::load(SavedIdentity *id, std::string *pem) {
  nvs_handle_t h;
  if (nvs_open(NVS_NS, NVS_READONLY, &h) != ESP_OK)
    return false;
  bool have = nvs_read_blob(h, "id", id, sizeof(*id));
  size_t pem_len = 0;
  if (pem != nullptr && nvs_get_str(h, "pem", nullptr, &pem_len) == ESP_OK && pem_len > 1 && pem_len < 2048) {
    pem->assign(pem_len, '\0');
    if (nvs_get_str(h, "pem", pem->data(), &pem_len) == ESP_OK) {
      if (!pem->empty() && pem->back() == '\0')
        pem->pop_back();
    } else {
      pem->clear();
    }
  }
  nvs_close(h);
  return have;
}

bool EspStore::save_identity(const SavedIdentity &id) {
  nvs_handle_t h;
  if (nvs_open(NVS_NS, NVS_READWRITE, &h) != ESP_OK)
    return false;
  nvs_write_blob(h, "id", &id, sizeof(id));
  nvs_commit(h);
  nvs_close(h);
  return true;
}

bool EspStore::save_cert(const std::string &pem) {
  nvs_handle_t h;
  if (nvs_open(NVS_NS, NVS_READWRITE, &h) != ESP_OK)
    return false;
  if (pem.empty())
    nvs_erase_key(h, "pem");
  else
    nvs_set_str(h, "pem", pem.c_str());
  nvs_commit(h);
  nvs_close(h);
  return true;
}

bool EspStore::erase_all() {
  nvs_handle_t h;
  if (nvs_open(NVS_NS, NVS_READWRITE, &h) != ESP_OK)
    return false;
  nvs_erase_all(h);
  nvs_commit(h);
  nvs_close(h);
  return true;
}

bool EspCrypto::ensure_key(uint8_t priv[32], uint8_t x[32], uint8_t y[32]) {
  mbedtls_entropy_context entropy;
  mbedtls_ctr_drbg_context ctr;
  mbedtls_ecp_group grp;
  mbedtls_mpi p;
  mbedtls_ecp_point Q;
  mbedtls_entropy_init(&entropy);
  mbedtls_ctr_drbg_init(&ctr);
  mbedtls_ecp_group_init(&grp);
  mbedtls_mpi_init(&p);
  mbedtls_ecp_point_init(&Q);
  bool ok = false;
  uint8_t xy[65]{};
  do {
    if (mbedtls_ctr_drbg_seed(&ctr, mbedtls_entropy_func, &entropy, reinterpret_cast<const uint8_t *>("shl-key"), 7) !=
        0)
      break;
    if (mbedtls_ecp_group_load(&grp, MBEDTLS_ECP_DP_SECP256R1) != 0)
      break;
    if (mbedtls_ecp_gen_keypair(&grp, &p, &Q, mbedtls_ctr_drbg_random, &ctr) != 0)
      break;
    if (mbedtls_mpi_write_binary(&p, priv, 32) != 0)
      break;
    size_t olen = 0;
    if (mbedtls_ecp_point_write_binary(&grp, &Q, MBEDTLS_ECP_PF_UNCOMPRESSED, &olen, xy, sizeof(xy)) != 0 || olen != 65)
      break;
    std::memcpy(x, xy + 1, 32);
    std::memcpy(y, xy + 33, 32);
    ok = true;
    ESP_LOGI(TAG, "Created this chamber's cloud key");
  } while (false);
  secure_clear(xy, sizeof(xy));
  mbedtls_ecp_point_free(&Q);
  mbedtls_mpi_free(&p);
  mbedtls_ecp_group_free(&grp);
  mbedtls_ctr_drbg_free(&ctr);
  mbedtls_entropy_free(&entropy);
  return ok;
}

bool EspCrypto::sign(const uint8_t priv[32], const uint8_t *data, size_t len, uint8_t sig[64]) {
  uint8_t hash[32];
  if (shl_mbedtls_sha256(data, len, hash) != 0)
    return false;
  mbedtls_entropy_context entropy;
  mbedtls_ctr_drbg_context ctr;
  mbedtls_ecp_group grp;
  mbedtls_mpi p, r, s;
  mbedtls_entropy_init(&entropy);
  mbedtls_ctr_drbg_init(&ctr);
  mbedtls_ecp_group_init(&grp);
  mbedtls_mpi_init(&p);
  mbedtls_mpi_init(&r);
  mbedtls_mpi_init(&s);
  bool ok = false;
  do {
    if (mbedtls_ctr_drbg_seed(&ctr, mbedtls_entropy_func, &entropy, reinterpret_cast<const uint8_t *>("shl-pop"), 7) !=
        0)
      break;
    if (mbedtls_ecp_group_load(&grp, MBEDTLS_ECP_DP_SECP256R1) != 0)
      break;
    if (mbedtls_mpi_read_binary(&p, priv, 32) != 0)
      break;
    if (mbedtls_ecdsa_sign(&grp, &r, &s, &p, hash, 32, mbedtls_ctr_drbg_random, &ctr) != 0)
      break;
    if (mbedtls_mpi_write_binary(&r, sig, 32) != 0)
      break;
    if (mbedtls_mpi_write_binary(&s, sig + 32, 32) != 0)
      break;
    ok = true;
  } while (false);
  mbedtls_mpi_free(&s);
  mbedtls_mpi_free(&r);
  mbedtls_mpi_free(&p);
  mbedtls_ecp_group_free(&grp);
  mbedtls_ctr_drbg_free(&ctr);
  mbedtls_entropy_free(&entropy);
  secure_clear(hash, sizeof(hash));
  return ok;
}

bool EspCrypto::make_csr(const uint8_t priv[32], const uint8_t x[32], const uint8_t y[32], const char *cn,
                         std::string *pem) {
  struct Ctx {
    EspCrypto *self;
    const uint8_t *priv;
  } ctx{this, priv};
  auto cb = [](const uint8_t *data, size_t len, uint8_t sig[64], void *p) {
    auto *c = static_cast<Ctx *>(p);
    return c->self->sign(c->priv, data, len, sig);
  };
  return build_p256_csr_pem(x, y, cn, cb, &ctx, pem);
}

bool EspCrypto::sha256(const uint8_t *data, size_t len, uint8_t out[32]) {
  return shl_mbedtls_sha256(data, len, out) == 0;
}

std::string EspCrypto::hardware_id() {
  uint8_t mac[6] = {};
  esp_read_mac(mac, ESP_MAC_WIFI_STA);
  char id[13];
  hex_encode_to(mac, 6, id);
  return std::string(id, 12);
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

static std::string host_of(const std::string &url) {
  if (url.size() < 8 || url.compare(0, 8, "https://") != 0)
    return "";
  const auto slash = url.find('/', 8);
  return url.substr(8, slash == std::string::npos ? std::string::npos : slash - 8);
}

HttpResponse IdfTransport::execute(const HttpRequest &req) {
  HttpResponse out;
  const std::string host = host_of(req.url);
  if (!api_url_allowed(req.url.c_str(), host.c_str()))
    return out;
  struct HdrCtx {
    int retry_after_s = 0;
  } hdr;
  esp_http_client_config_t cfg = {};
  cfg.url = req.url.c_str();
  cfg.crt_bundle_attach = esp_crt_bundle_attach;
  cfg.timeout_ms = 20000;
  cfg.disable_auto_redirect = true;
  cfg.buffer_size = 2048;
  cfg.user_agent = "ShroomLabs-chamber";
  cfg.method = (req.method != nullptr && std::strcmp(req.method, "GET") == 0) ? HTTP_METHOD_GET : HTTP_METHOD_POST;
  cfg.user_data = &hdr;
  cfg.event_handler = [](esp_http_client_event_t *evt) -> esp_err_t {
    if (evt->event_id == HTTP_EVENT_ON_HEADER && evt->header_key != nullptr && evt->header_value != nullptr &&
        strcasecmp(evt->header_key, "Retry-After") == 0) {
      static_cast<HdrCtx *>(evt->user_data)->retry_after_s = parse_retry_after(evt->header_value);
    }
    return ESP_OK;
  };
  HttpClient client(esp_http_client_init(&cfg));
  if (!client)
    return out;
  for (const auto &h : req.headers)
    esp_http_client_set_header(client.get(), h.first.c_str(), h.second.c_str());
  const int wlen = req.body.empty() ? 0 : static_cast<int>(req.body.size());
  if (esp_http_client_open(client.get(), wlen) != ESP_OK)
    return out;
  if (wlen > 0 && esp_http_client_write(client.get(), req.body.c_str(), wlen) < wlen)
    return out;
  const int64_t length = esp_http_client_fetch_headers(client.get());
  const int st = esp_http_client_get_status_code(client.get());
  if (!idf_headers_ok(length, st))
    return out;
  out.status = st;
  out.retry_after_s = hdr.retry_after_s;
  if (length > static_cast<int64_t>(MAX_DEVICE_BODY))
    return out;
  if (length == 0 && (st == 204 || st == 205 || st == 304)) {
    out.complete = true;
    out.ok = true;
    return out;
  }
  auto read_fn = [](void *ctx, char *buf, int max) -> int {
    return esp_http_client_read(static_cast<esp_http_client_handle_t>(ctx), buf, max);
  };
  if (!read_capped_body(read_fn, client.get(), MAX_DEVICE_BODY, &out.body))
    return out;
  out.complete = esp_http_client_is_complete_data_received(client.get()) || (length == 0 && out.body.empty());
  out.ok = out.complete;
  return out;
}

ShroomLabsCloud::ShroomLabsCloud(web_server_base::WebServerBase *base)
    : base_(base), engine_(&transport_, &clock_, &store_, &crypto_), chamber_impl_(this) {
  engine_.set_sync_jobs(false);
  engine_.set_start_job(&ShroomLabsCloud::start_job, this);
  engine_.set_chamber(&chamber_impl_);
}

bool ShroomLabsCloud::start_job(void *ctx, CloudJob job) {
  auto *self = static_cast<ShroomLabsCloud *>(ctx);
  if (!self->engine_.try_begin(job))
    return false;
  self->busy_ = true;
  self->pending_job_ = job;
  if (xTaskCreate(task_entry_, "shl_cloud", 16384, self, 1, nullptr) != pdPASS) {
    self->engine_.finish();
    self->busy_ = false;
    self->pending_job_ = CloudJob::NONE;
    ESP_LOGW(TAG, "Could not start the cloud task");
    return false;
  }
  return true;
}

void ShroomLabsCloud::task_entry_(void *arg) {
  auto *self = static_cast<ShroomLabsCloud *>(arg);
  self->engine_.run_job(self->pending_job_);
  self->pending_job_ = CloudJob::NONE;
  self->engine_.finish();
  self->busy_ = false;
  self->engine_.drain_queued();
  vTaskDelete(nullptr);
}

void ShroomLabsCloud::set_remote_apply(bool on) {
#if SHL_CLOUD_REMOTE_APPLY == 0
  on = false;
#endif
  this->engine_.set_remote_apply(on);
  this->persist_remote_apply_(on);
}

void ShroomLabsCloud::persist_remote_apply_(bool on) {
  nvs_handle_t h;
  if (nvs_open(NVS_NS, NVS_READWRITE, &h) != ESP_OK)
    return;
  nvs_set_u8(h, "raply", on ? 1 : 0);
  nvs_commit(h);
  nvs_close(h);
}

void ShroomLabsCloud::setup() {
  global_shroom_labs_cloud = this;
#ifdef SHL_HAS_FLASH_ENC
  this->flash_encrypted_ = esp_flash_encryption_enabled();
#endif
#ifdef CONFIG_NVS_ENCRYPTION
  this->nvs_encrypted_ = true;
#else
  this->nvs_encrypted_ = this->flash_encrypted_;
#endif
  this->engine_.load();
#if SHL_CLOUD_REMOTE_APPLY != 0
  nvs_handle_t h;
  if (nvs_open(NVS_NS, NVS_READONLY, &h) == ESP_OK) {
    uint8_t v = 1;
    if (nvs_get_u8(h, "raply", &v) == ESP_OK)
      this->engine_.set_remote_apply(v != 0);
    nvs_close(h);
  }
#else
  this->engine_.set_remote_apply(false);
#endif
  this->base_->add_handler(new CloudPage(this));  // NOLINT(cppcoreguidelines-owning-memory)
  ESP_LOGI(TAG, "Cloud link %s. Remote apply %s. Flash encryption %s. NVS encryption %s.",
           this->engine_.cloud_enabled() ? "on" : "off (opt-in)", this->engine_.remote_apply() ? "on" : "off",
           this->flash_encrypted_ ? "on" : "off", this->nvs_encrypted_ ? "on" : "off");
}

void ShroomLabsCloud::loop() {
  if (!this->watchers_on_)
    this->attach_local_watchers_();
  if (this->busy_)
    return;
  this->engine_.loop();
}

void ShroomLabsCloud::dump_config() {
  ESP_LOGCONFIG(TAG, "Shroom Labs cloud:");
  ESP_LOGCONFIG(TAG, "  Enabled: %s", YESNO(this->engine_.cloud_enabled()));
  ESP_LOGCONFIG(TAG, "  State: %s", state_name(this->engine_.state()));
  ESP_LOGCONFIG(TAG, "  Device id present: %s", YESNO(!this->engine_.device_id().empty()));
  ESP_LOGCONFIG(TAG, "  Linked: %s", YESNO(this->engine_.linked()));
  ESP_LOGCONFIG(TAG, "  Remote apply: %s", YESNO(this->engine_.remote_apply()));
  ESP_LOGCONFIG(TAG, "  Flash encryption: %s", YESNO(this->flash_encrypted_));
}

std::string ShroomLabsCloud::status_json() const {
  std::string body = this->engine_.status_json();
  if (!body.empty() && body.back() == '}')
    body.pop_back();
  body += ",\"nvs_encrypted\":";
  body += this->nvs_encrypted_ ? "true" : "false";
  body += ",\"flash_encrypted\":";
  body += this->flash_encrypted_ ? "true" : "false";
  QrCode qr{};
  std::string bits;
  int size = 0;
  if (this->fill_qr(&qr)) {
    size = qr.size;
    bits = qr_modules_string(qr);
  }
  body += ",\"qr_size\":";
  body += std::to_string(size);
  body += ",\"qr\":\"";
  body += bits;
  body += "\"}";
  return body;
}

bool ShroomLabsCloud::fill_qr(QrCode *out) const {
  const std::string url = this->engine_.claim_url();
  const std::string code = this->engine_.display_code();
  if (url.empty() || code.empty())
    return false;
  return qr_encode(url.c_str(), out);
}

#ifndef OBJECT_ID_MAX_LEN
#define OBJECT_ID_MAX_LEN 64
#endif

static const char *entity_object_id(EntityBase *entity, char *buf) {
  if (entity == nullptr) {
    buf[0] = '\0';
    return buf;
  }
  StringRef id = entity->get_object_id_to(buf);
  return id.c_str() != nullptr ? id.c_str() : buf;
}

void ShroomLabsCloud::attach_local_watchers_() {
  this->watchers_on_ = true;
  char id_buf[OBJECT_ID_MAX_LEN];
  for (auto *n : App.get_numbers()) {
    if (n == nullptr || !setpoint_object_id(entity_object_id(n, id_buf)))
      continue;
    n->add_on_state_callback([this](float) {
      if (!this->applying_remote_)
        this->note_local_change();
    });
  }
}

ChamberReading ShroomLabsCloud::read_chamber() {
  ChamberReading out;
  char id_buf[OBJECT_ID_MAX_LEN];
  for (auto *s : App.get_sensors()) {
    if (s == nullptr || !s->has_state() || std::isnan(s->state))
      continue;
    const char *id = entity_object_id(s, id_buf);
    if (sensor_is_temperature(id)) {
      out.has_temperature = true;
      out.temperature = s->state;
    } else if (sensor_is_humidity(id)) {
      out.has_humidity = true;
      out.humidity = s->state;
    }
  }
  for (auto *n : App.get_numbers()) {
    if (n == nullptr || std::isnan(n->state))
      continue;
    const char *id = entity_object_id(n, id_buf);
    if (std::strcmp(id, "temperature_target") == 0 || std::strcmp(id, "temperature__target") == 0) {
      out.has_temperature_target = true;
      out.temperature_target = n->state;
    } else if (std::strcmp(id, "target_humidity") == 0) {
      out.has_target_humidity = true;
      out.target_humidity = n->state;
    }
  }
  return out;
}

static bool write_number(const char *const *ids, float value, ShroomLabsCloud *self) {
  char id_buf[OBJECT_ID_MAX_LEN];
  for (auto *n : App.get_numbers()) {
    if (n == nullptr)
      continue;
    const char *id = entity_object_id(n, id_buf);
    for (const char *const *p = ids; *p != nullptr; p++) {
      if (std::strcmp(id, *p) == 0) {
        self->set_applying_remote(true);
        auto call = n->make_call();
        call.set_value(value);
        call.perform();
        self->set_applying_remote(false);
        return true;
      }
    }
  }
  return false;
}

bool ShroomLabsCloud::write_temperature_target(float c) {
  static const char *const ids[] = {"temperature_target", "temperature__target", nullptr};
  return write_number(ids, clamp_setpoint_temp(c), this);
}

bool ShroomLabsCloud::write_humidity_target(float rh) {
  static const char *const ids[] = {"target_humidity", nullptr};
  return write_number(ids, clamp_setpoint_rh(rh), this);
}

ChamberReading EspChamber::read() { return cloud_->read_chamber(); }
bool EspChamber::write_temperature(float c) { return cloud_->write_temperature_target(c); }
bool EspChamber::write_humidity(float rh) { return cloud_->write_humidity_target(rh); }
uint32_t EspChamber::last_local_change_ms() { return cloud_->last_local_change_ms(); }

}  // namespace shroom_labs
}  // namespace esphome
