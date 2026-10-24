"""Per-device secrets and local access control for OpenShrooly.

On first boot the device makes its own web page password, Wi-Fi setup network
password and Home Assistant encryption key, and keeps them in its settings
storage. Nothing secret is in this repository. Changes made through the web
page need the password and must come from the device's own page. The Wi-Fi
setup network only runs in setup mode. See docs/SECURITY.md.
"""

import esphome.codegen as cg
import esphome.config_validation as cv
from esphome.components import web_server_base
from esphome.components.web_server_base import CONF_WEB_SERVER_BASE_ID
from esphome.const import CONF_ID
import esphome.final_validate as fv

CODEOWNERS = ["@themsquared"]
DEPENDENCIES = ["wifi", "api", "captive_portal", "esp32"]
AUTO_LOAD = ["web_server_base"]

device_security_ns = cg.esphome_ns.namespace("device_security")
DeviceSecurity = device_security_ns.class_("DeviceSecurity", cg.Component)

CONF_AP_SSID_PREFIX = "ap_ssid_prefix"
CONF_SETUP_TIMEOUT = "setup_timeout"

CONFIG_SCHEMA = cv.Schema(
    {
        cv.GenerateID(): cv.declare_id(DeviceSecurity),
        cv.GenerateID(CONF_WEB_SERVER_BASE_ID): cv.use_id(web_server_base.WebServerBase),
        cv.Optional(CONF_AP_SSID_PREFIX, default="OpenShrooly"): cv.All(cv.string_strict, cv.Length(max=26)),
        cv.Optional(CONF_SETUP_TIMEOUT, default="10min"): cv.positive_time_period_milliseconds,
    }
).extend(cv.COMPONENT_SCHEMA)


def _final_validate(config):
    full = fv.full_config.get()
    api = full.get("api", {})
    enc = api.get("encryption")
    if enc is None or "key" in enc:
        raise cv.Invalid("device_security needs 'api: encryption: {}' with no key, so each device makes its own")
    if any(o.get("platform") == "esphome" for o in full.get("ota", [])):
        raise cv.Invalid("device_security refuses 'ota: platform: esphome', which installs unsigned files")
    if "password" in full.get("wifi", {}).get("ap", {}):
        raise cv.Invalid("device_security sets the Wi-Fi setup password per device; remove wifi ap password")
    if "auth" in full.get("web_server", {}):
        raise cv.Invalid("device_security handles web login; remove web_server auth")
    return config


FINAL_VALIDATE_SCHEMA = _final_validate


async def to_code(config):
    base = await cg.get_variable(config[CONF_WEB_SERVER_BASE_ID])
    var = cg.new_Pvariable(config[CONF_ID], base)
    await cg.register_component(var, config)
    cg.add(var.set_ap_ssid_prefix(config[CONF_AP_SSID_PREFIX]))
    cg.add(var.set_setup_timeout(config[CONF_SETUP_TIMEOUT]))
    cg.add_define("USE_DEVICE_SECURITY")
