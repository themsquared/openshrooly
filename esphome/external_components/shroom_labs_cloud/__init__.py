"""Opt-in Shroom Labs cloud pairing. Off until the grower turns it on."""

import esphome.codegen as cg
import esphome.config_validation as cv
from esphome.components import esp32, web_server_base
from esphome.components.web_server_base import CONF_WEB_SERVER_BASE_ID
from esphome.const import CONF_ID

CODEOWNERS = ["@themsquared"]
DEPENDENCIES = ["wifi", "web_server", "esp32"]
AUTO_LOAD = ["web_server_base", "json"]

shroom_labs_ns = cg.esphome_ns.namespace("shroom_labs")
ShroomLabsCloud = shroom_labs_ns.class_("ShroomLabsCloud", cg.Component)

CONF_API_HOST = "api_host"
CONF_SITE_ORIGIN = "site_origin"


CONFIG_SCHEMA = cv.Schema(
    {
        cv.GenerateID(): cv.declare_id(ShroomLabsCloud),
        cv.GenerateID(CONF_WEB_SERVER_BASE_ID): cv.use_id(web_server_base.WebServerBase),
        cv.Optional(CONF_API_HOST, default="api.shroomlabs.io"): cv.domain,
        cv.Optional(CONF_SITE_ORIGIN, default="https://shroomlabs.io"): cv.url,
    }
).extend(cv.COMPONENT_SCHEMA)


async def to_code(config):
    base = await cg.get_variable(config[CONF_WEB_SERVER_BASE_ID])
    var = cg.new_Pvariable(config[CONF_ID], base)
    await cg.register_component(var, config)
    cg.add(var.set_api_host(config[CONF_API_HOST]))
    cg.add(var.set_site_origin(config[CONF_SITE_ORIGIN]))
    cg.add_define("USE_SHROOM_LABS_CLOUD")

    # HTTPS with the server certificate always checked. No insecure TLS.
    esp32.include_builtin_idf_component("esp_http_client")
    esp32.add_idf_sdkconfig_option("CONFIG_MBEDTLS_CERTIFICATE_BUNDLE", True)
    esp32.add_idf_sdkconfig_option("CONFIG_ESP_TLS_INSECURE", False)
    esp32.add_idf_sdkconfig_option("CONFIG_ESP_TLS_SKIP_SERVER_CERT_VERIFY", False)
