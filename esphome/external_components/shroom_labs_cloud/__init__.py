"""Opt-in Shroom Labs cloud pairing. Off until the grower turns it on."""

import esphome.codegen as cg
import esphome.config_validation as cv
from esphome.components import esp32, number, select, web_server_base
from esphome.components.web_server_base import CONF_WEB_SERVER_BASE_ID
from esphome.const import CONF_ID

CODEOWNERS = ["@themsquared"]
DEPENDENCIES = ["wifi", "web_server", "esp32"]
AUTO_LOAD = ["web_server_base", "json"]

shroom_labs_ns = cg.esphome_ns.namespace("shroom_labs")
ShroomLabsCloud = shroom_labs_ns.class_("ShroomLabsCloud", cg.Component)

CONF_API_HOST = "api_host"
CONF_SITE_ORIGIN = "site_origin"
CONF_REMOTE_APPLY = "remote_apply"
CONF_KNOBS = "knobs"
CONF_GROW_PHASE = "grow_phase"

# Order matches the KNOB_* enum in cloud_format.h. The key is also the payload and telemetry key.
KNOB_KEYS = [
    "air_exchange_speed",
    "air_exchange_period_min",
    "air_exchange_run_sec",
    "sunrise_hour",
    "light_hours",
    "white_intensity",
    "color_r",
    "color_g",
    "color_b",
    "grow_day",
]


CONFIG_SCHEMA = cv.Schema(
    {
        cv.GenerateID(): cv.declare_id(ShroomLabsCloud),
        cv.GenerateID(CONF_WEB_SERVER_BASE_ID): cv.use_id(web_server_base.WebServerBase),
        cv.Optional(CONF_API_HOST, default="api.shroomlabs.io"): cv.domain,
        cv.Optional(CONF_SITE_ORIGIN, default="https://shroomlabs.io"): cv.url,
        cv.Optional(CONF_REMOTE_APPLY, default=True): cv.boolean,
        cv.Optional(CONF_KNOBS, default={}): cv.Schema(
            {cv.Optional(key): cv.use_id(number.Number) for key in KNOB_KEYS}
        ),
        cv.Optional(CONF_GROW_PHASE): cv.use_id(select.Select),
    }
).extend(cv.COMPONENT_SCHEMA)


async def to_code(config):
    base = await cg.get_variable(config[CONF_WEB_SERVER_BASE_ID])
    var = cg.new_Pvariable(config[CONF_ID], base)
    await cg.register_component(var, config)
    cg.add(var.set_api_host(config[CONF_API_HOST]))
    cg.add(var.set_site_origin(config[CONF_SITE_ORIGIN]))
    cg.add(var.set_remote_apply(config[CONF_REMOTE_APPLY]))
    for index, key in enumerate(KNOB_KEYS):
        if key in config[CONF_KNOBS]:
            knob = await cg.get_variable(config[CONF_KNOBS][key])
            cg.add(var.set_knob(index, knob))
    if CONF_GROW_PHASE in config:
        phase = await cg.get_variable(config[CONF_GROW_PHASE])
        cg.add(var.set_grow_phase_select(phase))
    cg.add_define("USE_SHROOM_LABS_CLOUD")
    cg.add_define("SHL_CLOUD_REMOTE_APPLY", 1 if config[CONF_REMOTE_APPLY] else 0)

    # HTTPS with the server certificate always checked. No insecure TLS.
    esp32.include_builtin_idf_component("esp_http_client")
    esp32.add_idf_sdkconfig_option("CONFIG_MBEDTLS_CERTIFICATE_BUNDLE", True)
    esp32.add_idf_sdkconfig_option("CONFIG_ESP_TLS_INSECURE", False)
    esp32.add_idf_sdkconfig_option("CONFIG_ESP_TLS_SKIP_SERVER_CERT_VERIFY", False)
