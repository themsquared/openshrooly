#include "device_security.h"

#include <cstring>
#include <lwip/sockets.h>
#include <mbedtls/base64.h>
#include <esp_random.h>
#include <bootloader_random.h>

#include "esphome/core/application.h"
#include "esphome/core/hal.h"
#include "esphome/core/helpers.h"
#include "esphome/core/log.h"
#include "esphome/components/api/api_server.h"
#include "esphome/components/captive_portal/captive_portal.h"
#include "esphome/components/wifi/wifi_component.h"
#include "../web_server_idf/web_server_idf.h"

namespace esphome {
namespace device_security {

static const char *const TAG = "device_security";
DeviceSecurity *global_device_security = nullptr;  // NOLINT

// Wi-Fi keeps the two calls we need (start the setup network, stop only the setup
// network) protected and the class is final. This standard explicit-instantiation
// idiom names those members without patching the Wi-Fi component.
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wnon-template-friend"
template<typename Tag, typename Tag::type M> struct MemberAccess {
  friend typename Tag::type member_of(Tag) { return M; }
};
struct WifiStartAp {
  using type = void (wifi::WiFiComponent::*)();
  friend type member_of(WifiStartAp);
};
struct WifiMode {
  using type = bool (wifi::WiFiComponent::*)(optional<bool>, optional<bool>);
  friend type member_of(WifiMode);
};
template struct MemberAccess<WifiStartAp, &wifi::WiFiComponent::setup_ap_config_>;
template struct MemberAccess<WifiMode, &wifi::WiFiComponent::wifi_mode_>;
#pragma GCC diagnostic pop

static constexpr uint32_t SECRETS_MAGIC = 0x53484c31;  // "SHL1"
static constexpr size_t PW_LEN = 12;
struct SavedSecrets {
  uint32_t magic;
  char web[PW_LEN + 1];
  char ap[PW_LEN + 1];
} __attribute__((packed));

// No 0/o/1/l/i so it reads cleanly off the e-paper screen.
static const char PW_ALPHABET[] = "abcdefghjkmnpqrstuvwxyz23456789";

static void random_bytes(uint8_t *out, size_t len) {
  // The radio may not be running yet; this keeps the hardware generator truly random.
  bootloader_random_enable();
  esp_fill_random(out, len);
  bootloader_random_disable();
}

static void make_password(char *out) {
  const size_t n = sizeof(PW_ALPHABET) - 1;  // 31
  const uint8_t limit = 256 - (256 % n);     // 248, avoids bias
  size_t i = 0;
  while (i < PW_LEN) {
    uint8_t buf[32];
    random_bytes(buf, sizeof(buf));
    for (uint8_t b : buf) {
      if (b >= limit)
        continue;
      out[i++] = PW_ALPHABET[b % n];
      if (i == PW_LEN)
        break;
    }
  }
  out[PW_LEN] = '\0';
}

static bool valid_password(const char *pw) {
  if (strnlen(pw, PW_LEN + 1) != PW_LEN)
    return false;
  for (size_t i = 0; i < PW_LEN; i++)
    if (strchr(PW_ALPHABET, pw[i]) == nullptr)
      return false;
  return true;
}

void DeviceSecurity::load_or_create_secrets_() {
  this->pref_ = global_preferences->make_preference<SavedSecrets>(fnv1_hash("device_security_v1"), true);
  SavedSecrets s{};
  if (!this->pref_.load(&s) || s.magic != SECRETS_MAGIC || !valid_password(s.web) || !valid_password(s.ap)) {
    memset(&s, 0, sizeof(s));
    s.magic = SECRETS_MAGIC;
    make_password(s.web);
    make_password(s.ap);
    this->pref_.save(&s);
    global_preferences->sync();
    ESP_LOGI(TAG, "Created this device's own passwords");
  }
  this->web_password_ = s.web;
  this->ap_password_ = s.ap;
  std::string creds = "admin:" + this->web_password_;
  unsigned char b64[64];
  size_t olen = 0;
  mbedtls_base64_encode(b64, sizeof(b64), &olen, reinterpret_cast<const unsigned char *>(creds.data()), creds.size());
  this->expected_basic_ = "Basic " + std::string(reinterpret_cast<char *>(b64), olen);
}

bool DeviceSecurity::basic_auth_ok(const std::string &header) const {
  const std::string &want = this->expected_basic_;
  if (header.size() != want.size())
    return false;
  uint8_t diff = 0;
  for (size_t i = 0; i < want.size(); i++)
    diff |= static_cast<uint8_t>(header[i] ^ want[i]);
  return diff == 0;
}

std::string DeviceSecurity::api_key() const {
  if (api::global_api_server == nullptr || !api::global_api_server->get_noise_ctx().has_psk())
    return "";
  const auto &psk = api::global_api_server->get_noise_ctx().get_psk();
  unsigned char b64[48];
  size_t olen = 0;
  mbedtls_base64_encode(b64, sizeof(b64), &olen, psk.data(), psk.size());
  return std::string(reinterpret_cast<char *>(b64), olen);
}

uint32_t DeviceSecurity::setup_minutes_left() const {
  if (!this->in_setup_ || !this->timed_setup_)
    return 0;
  uint32_t elapsed = millis() - this->setup_started_ms_;
  if (elapsed >= this->setup_timeout_ms_)
    return 1;
  return (this->setup_timeout_ms_ - elapsed + 59999) / 60000;
}

// ---- Request guard -------------------------------------------------------

using web_server_idf::AsyncWebServerRequest;

static const char *const ACTION_DOMAINS[] = {
    "switch", "button", "fan",  "light", "cover",  "number", "select",       "text",
    "lock",   "valve",  "climate", "date", "time", "datetime", "alarm_control_panel",
    "media_player", "update", "water_heater", "siren"};

// True when a GET would change something: the dashboard's /domain/name/action URLs,
// the Wi-Fi save link, and this module's own page.
static bool get_changes_state(const char *url) {
  if (strcmp(url, "/wifisave") == 0)
    return true;
  if (url[0] != '/')
    return false;
  const char *seg = url + 1;
  const char *slash = strchr(seg, '/');
  if (slash == nullptr)
    return false;
  size_t dlen = slash - seg;
  bool action_domain = false;
  for (const char *d : ACTION_DOMAINS)
    if (strlen(d) == dlen && strncmp(seg, d, dlen) == 0)
      action_domain = true;
  if (!action_domain)
    return false;
  // /domain/name/action has a third segment; /domain/name is a read.
  return strchr(slash + 1, '/') != nullptr;
}

// The Wi-Fi setup page is reachable without a password only from the setup network itself.
static bool from_setup_network(httpd_req_t *r) {
  int fd = httpd_req_to_sockfd(r);
  struct sockaddr_storage addr {};
  socklen_t len = sizeof(addr);
  if (fd < 0 || getsockname(fd, reinterpret_cast<struct sockaddr *>(&addr), &len) != 0)
    return false;
  if (addr.ss_family == AF_INET) {
    auto *in = reinterpret_cast<struct sockaddr_in *>(&addr);
    return ntohl(in->sin_addr.s_addr) == 0xC0A80401;  // 192.168.4.1
  }
#if LWIP_IPV6
  if (addr.ss_family == AF_INET6) {
    auto *in6 = reinterpret_cast<struct sockaddr_in6 *>(&addr);
    // IPv4-mapped ::ffff:192.168.4.1
    const uint8_t *b = reinterpret_cast<const uint8_t *>(&in6->sin6_addr);
    static const uint8_t mapped[16] = {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, 192, 168, 4, 1};
    return memcmp(b, mapped, 16) == 0;
  }
#endif
  return false;
}

static void reply(AsyncWebServerRequest *req, int code, const char *text, bool ask_login) {
  auto *res = req->beginResponse(code, "text/plain", std::string(text));
  res->addHeader("Cache-Control", "no-store");
  if (ask_login)
    res->addHeader("WWW-Authenticate", "Basic realm=\"OpenShrooly\"");
  req->send(res);
}

// A change must come from this device's own page, never from another website.
// Browsers always send Origin on POST, so a POST without one is a script or tool,
// which still needs the password. A GET that changes something must carry a
// matching Origin or Referer, because a web page can strip both from an image link.
static bool same_origin(AsyncWebServerRequest *req, bool require_header) {
  auto host = req->get_header("Host");
  if (!host.has_value() || host->empty())
    return false;
  const std::string self = "http://" + *host;
  auto origin = req->get_header("Origin");
  if (origin.has_value())
    return *origin == self;
  auto referer = req->get_header("Referer");
  if (referer.has_value())
    return referer->size() > self.size() && referer->compare(0, self.size() + 1, self + "/") == 0;
  return !require_header;
}

static bool request_guard(AsyncWebServerRequest *req) {
  DeviceSecurity *sec = global_device_security;
  if (sec == nullptr)
    return true;
  const http_method m = req->method();
  if (m == HTTP_OPTIONS)
    return true;
  char buf[AsyncWebServerRequest::URL_BUF_SIZE];
  StringRef url_ref = req->url_to(buf);
  const char *url = url_ref.c_str();
  const bool is_secret_get =
      m == HTTP_GET && (strcmp(url, "/security") == 0 || strcmp(url, "/cloud") == 0);
  if (m == HTTP_GET && !is_secret_get) {
    if (!get_changes_state(url))
      return true;  // the read-only dashboard stays open on the home network
    if (strcmp(url, "/wifisave") == 0 && from_setup_network(*req))
      return true;  // joining the password-protected setup network is the proof
  }
  if (!is_secret_get && !same_origin(req, m == HTTP_GET)) {
    reply(req, 403, "This change must be made from the chamber's own page.", false);
    return false;
  }
  auto auth = req->get_header("Authorization");
  if (!auth.has_value() || !sec->basic_auth_ok(*auth)) {
    reply(req, 401, "Sign in with the user name admin and the web password shown on the chamber screen.", true);
    return false;
  }
  return true;
}

// ---- Security page -------------------------------------------------------

class SecurityPage : public AsyncWebHandler {
 public:
  explicit SecurityPage(DeviceSecurity *sec) : sec_(sec) {}
  bool canHandle(AsyncWebServerRequest *request) const override {
    char buf[AsyncWebServerRequest::URL_BUF_SIZE];
    return request->method() == HTTP_GET && request->url_to(buf) == "/security";
  }
  void handleRequest(AsyncWebServerRequest *request) override {
    // The guard has already checked the web login before this runs.
    std::string key = this->sec_->api_key();
    std::string html;
    html.reserve(2400);
    html += "<!DOCTYPE html><html><head><meta charset=utf-8>"
            "<meta name=viewport content=\"width=device-width,initial-scale=1\">"
            "<title>OpenShrooly security</title><style>"
            "body{font-family:system-ui,sans-serif;max-width:36em;margin:2em auto;padding:0 1em;color:#222}"
            "code{display:block;font-size:1.1em;background:#f2f2f2;padding:.6em;border-radius:6px;"
            "word-break:break-all;user-select:all}h2{margin-top:1.6em}li{margin:.3em 0}"
            "</style></head><body><h1>Chamber security</h1>"
            "<p>These belong to this chamber only. Keep them private.</p>"
            "<h2>Home Assistant encryption key</h2><code>";
    html += key.empty() ? std::string("Not ready yet. Refresh in a few seconds.") : key;
    html += "</code><ol><li>In Home Assistant, open Settings, then Devices and services.</li>"
            "<li>Choose the OpenShrooly chamber (or Add integration, then ESPHome).</li>"
            "<li>When it asks for the encryption key, paste the key above.</li></ol>"
            "<h2>Web page login</h2><p>User name</p><code>admin</code><p>Password</p><code>";
    html += this->sec_->web_password();
    html += "</code><p>Needed to change settings or install updates from this page.</p>"
            "<h2>Wi-Fi setup network</h2><p>Name</p><code>";
    html += this->sec_->ap_ssid();
    html += "</code><p>Password</p><code>";
    html += this->sec_->ap_password();
    html += "</code><p>This network only appears while Wi-Fi setup is on. Turn it on from the chamber: "
            "System menu, Wi-Fi setup.</p></body></html>";
    auto *res = request->beginResponse(200, "text/html", html);
    res->addHeader("Cache-Control", "no-store");
    res->addHeader("X-Frame-Options", "DENY");
    request->send(res);
  }

 protected:
  DeviceSecurity *sec_;
};

// ---- Component -----------------------------------------------------------

void DeviceSecurity::setup() {
  global_device_security = this;
  this->load_or_create_secrets_();

  uint8_t mac[6];
  get_mac_address_raw(mac);
  char suffix[6];
  snprintf(suffix, sizeof(suffix), "-%02X%02X", mac[4], mac[5]);
  this->ap_ssid_ = std::string(this->ap_ssid_prefix_) + suffix;

  // Runs before Wi-Fi starts, so the setup network never comes up open.
  wifi::WiFiAP ap = wifi::global_wifi_component->get_ap();
  ap.set_ssid(this->ap_ssid_);
  ap.set_password(this->ap_password_);
  wifi::global_wifi_component->set_ap(ap);

  web_server_idf::AsyncWebServer::set_request_guard(request_guard);
  this->base_->add_handler(new SecurityPage(this));  // NOLINT(cppcoreguidelines-owning-memory)
}

void DeviceSecurity::loop() {
  if (!this->psk_checked_) {
    this->psk_checked_ = true;
    if (api::global_api_server != nullptr && !api::global_api_server->get_noise_ctx().has_psk()) {
      api::psk_t psk{};
      random_bytes(psk.data(), psk.size());
      if (api::global_api_server->save_noise_psk(psk, true)) {
        ESP_LOGI(TAG, "Created this device's Home Assistant encryption key");
      } else {
        ESP_LOGE(TAG, "Could not save the Home Assistant encryption key");
      }
    }
  }

  auto *portal = captive_portal::global_captive_portal;
  const bool portal_on = portal != nullptr && portal->is_active();
  if (!this->in_setup_) {
    if (portal_on) {
      // Wi-Fi started setup itself (no saved network yet).
      this->in_setup_ = true;
      this->timed_setup_ = wifi::global_wifi_component->has_sta();
      this->setup_started_ms_ = millis();
      ESP_LOGI(TAG, "Wi-Fi setup is on");
    }
    return;
  }
  if (!portal_on) {
    // Wi-Fi closes setup once the new network works.
    this->in_setup_ = false;
    ESP_LOGI(TAG, "Wi-Fi setup is off");
    return;
  }
  if (this->timed_setup_ && wifi::global_wifi_component->is_connected() &&
      millis() - this->setup_started_ms_ > this->setup_timeout_ms_) {
    ESP_LOGI(TAG, "Wi-Fi setup timed out");
    this->exit_setup();
  }
}

void DeviceSecurity::enter_setup() {
  this->setup_started_ms_ = millis();
  if (this->in_setup_)
    return;  // already on: just restart the timer
  auto *wifi = wifi::global_wifi_component;
  (wifi->*member_of(WifiStartAp{}))();
  if (captive_portal::global_captive_portal != nullptr && !captive_portal::global_captive_portal->is_active())
    captive_portal::global_captive_portal->start();
  this->in_setup_ = true;
  this->timed_setup_ = wifi->has_sta();
  ESP_LOGI(TAG, "Wi-Fi setup is on");
}

void DeviceSecurity::exit_setup() {
  if (captive_portal::global_captive_portal != nullptr && captive_portal::global_captive_portal->is_active())
    captive_portal::global_captive_portal->end();
  (wifi::global_wifi_component->*member_of(WifiMode{}))({}, false);
  this->in_setup_ = false;
  ESP_LOGI(TAG, "Wi-Fi setup is off");
}

void DeviceSecurity::dump_config() {
  // Never log the secrets themselves.
  ESP_LOGCONFIG(TAG,
                "Device security:\n"
                "  Setup network: %s\n"
                "  Home Assistant key set: %s\n"
                "  Setup timeout: %u min",
                this->ap_ssid_.c_str(), YESNO(!this->api_key().empty()),
                static_cast<unsigned>(this->setup_timeout_ms_ / 60000));
}

}  // namespace device_security
}  // namespace esphome
