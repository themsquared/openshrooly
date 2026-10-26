"""User-initiated, signed software updates from shroomlabs.io.

The device checks only when someone presses the check button. Release info is
fetched over HTTPS (certificate checked) from a compiled-in shroomlabs.io URL,
its Ed25519 signature is checked against the public key compiled in below, and
the boot slot changes only when the downloaded image matches the signed size
and SHA-256. Older releases are refused unless "allow older" is switched on.
"""

import re

import esphome.codegen as cg
import esphome.config_validation as cv
from esphome.components import esp32, text_sensor
from esphome.const import CONF_ID

CODEOWNERS = ["@themsquared"]
DEPENDENCIES = ["wifi", "esp32"]
AUTO_LOAD = ["json", "text_sensor"]

signed_update_ns = cg.esphome_ns.namespace("signed_update")
SignedUpdate = signed_update_ns.class_("SignedUpdate", cg.Component)

CONF_MANIFEST_URL = "manifest_url"
CONF_DOWNLOAD_PREFIX = "download_prefix"
CONF_PUBLIC_KEY = "public_key"
CONF_CURRENT_VERSION = "current_version"
CONF_PRODUCT = "product"
CONF_CHANNEL = "channel"
CONF_STATUS = "status"
CONF_STATE = "state"
CONF_AVAILABLE_VERSION = "available_version"
CONF_INSTALLED_VERSION = "installed_version"

# Releases may only come from Shroom Labs. Changing this needs a code change and review.
ALLOWED_ORIGIN = "https://shroomlabs.io/"
VERSION_RE = re.compile(r"^(0|[1-9]\d{0,6})\.(0|[1-9]\d{0,6})\.(0|[1-9]\d{0,6})(-sl\.(0|[1-9]\d{0,6}))?$")


def shroomlabs_https(value):
    value = cv.string_strict(value)
    if not value.startswith(ALLOWED_ORIGIN):
        raise cv.Invalid(f"Must start with {ALLOWED_ORIGIN}")
    if any(c in value for c in "?#@\\ ") or ".." in value:
        raise cv.Invalid("Must be a plain path on shroomlabs.io")
    return value


def download_prefix(value):
    value = shroomlabs_https(value)
    if not value.endswith("/"):
        raise cv.Invalid("Must end with /")
    return value


def public_key(value):
    value = cv.string_strict(value).strip().lower()
    if not re.fullmatch(r"[0-9a-f]{64}", value):
        raise cv.Invalid("Must be the 32 byte Ed25519 public key as 64 hex characters")
    return value


def release_version(value):
    value = cv.string_strict(value)
    if not VERSION_RE.match(value):
        raise cv.Invalid("Must look like 1.0.3 or 1.0.3-sl.1")
    return value


CONFIG_SCHEMA = cv.Schema(
    {
        cv.GenerateID(): cv.declare_id(SignedUpdate),
        cv.Required(CONF_MANIFEST_URL): shroomlabs_https,
        cv.Required(CONF_DOWNLOAD_PREFIX): download_prefix,
        cv.Required(CONF_PUBLIC_KEY): public_key,
        cv.Required(CONF_CURRENT_VERSION): release_version,
        cv.Optional(CONF_PRODUCT, default="openshrooly"): cv.string_strict,
        cv.Optional(CONF_CHANNEL, default="stable"): cv.string_strict,
        cv.Optional(CONF_STATUS): text_sensor.text_sensor_schema(),
        cv.Optional(CONF_STATE): text_sensor.text_sensor_schema(),
        cv.Optional(CONF_AVAILABLE_VERSION): text_sensor.text_sensor_schema(),
        cv.Optional(CONF_INSTALLED_VERSION): text_sensor.text_sensor_schema(),
    }
).extend(cv.COMPONENT_SCHEMA)


async def to_code(config):
    var = cg.new_Pvariable(config[CONF_ID])
    await cg.register_component(var, config)
    cg.add(var.set_manifest_url(config[CONF_MANIFEST_URL]))
    cg.add(var.set_download_prefix(config[CONF_DOWNLOAD_PREFIX]))
    cg.add(var.set_current_version(config[CONF_CURRENT_VERSION]))
    cg.add(var.set_product(config[CONF_PRODUCT]))
    cg.add(var.set_channel(config[CONF_CHANNEL]))
    cg.add_define("USE_SIGNED_UPDATE")
    key = bytes.fromhex(config[CONF_PUBLIC_KEY])
    cg.add(var.set_public_key(cg.RawExpression("std::array<uint8_t, 32>{" + ", ".join(f"0x{b:02x}" for b in key) + "}")))
    for conf_key, setter in (
        (CONF_STATUS, var.set_status_sensor),
        (CONF_STATE, var.set_state_sensor),
        (CONF_AVAILABLE_VERSION, var.set_available_sensor),
        (CONF_INSTALLED_VERSION, var.set_installed_sensor),
    ):
        if conf_key in config:
            sens = await text_sensor.new_text_sensor(config[conf_key])
            cg.add(setter(sens))

    # HTTPS with the server certificate always checked against the CA bundle.
    esp32.include_builtin_idf_component("esp_http_client")
    esp32.add_idf_sdkconfig_option("CONFIG_MBEDTLS_CERTIFICATE_BUNDLE", True)
    esp32.add_idf_sdkconfig_option("CONFIG_ESP_TLS_INSECURE", False)
    esp32.add_idf_sdkconfig_option("CONFIG_ESP_TLS_SKIP_SERVER_CERT_VERIFY", False)
    # The device only ever makes outgoing HTTPS requests to shroomlabs.io, so the
    # TLS library is trimmed to modern forward-secret client suites. This keeps the
    # firmware inside the flash budget and removes code nothing here uses.
    for opt in (
        "CONFIG_MBEDTLS_TLS_SERVER_AND_CLIENT",
        "CONFIG_MBEDTLS_TLS_SERVER",
        "CONFIG_MBEDTLS_KEY_EXCHANGE_ECDHE_PSK",
        "CONFIG_MBEDTLS_KEY_EXCHANGE_RSA_PSK",
        "CONFIG_MBEDTLS_KEY_EXCHANGE_RSA",
        "CONFIG_MBEDTLS_KEY_EXCHANGE_ECDH_ECDSA",
        "CONFIG_MBEDTLS_KEY_EXCHANGE_ECDH_RSA",
        "CONFIG_MBEDTLS_SSL_RENEGOTIATION",
        "CONFIG_MBEDTLS_CCM_C",
        "CONFIG_MBEDTLS_CMAC_C",
        "CONFIG_MBEDTLS_GCM_SUPPORT_NON_AES_CIPHER",
        "CONFIG_MBEDTLS_ECP_DP_SECP192R1_ENABLED",
        "CONFIG_MBEDTLS_ECP_DP_SECP224R1_ENABLED",
        "CONFIG_MBEDTLS_ECP_DP_SECP192K1_ENABLED",
        "CONFIG_MBEDTLS_ECP_DP_SECP224K1_ENABLED",
        "CONFIG_MBEDTLS_ECP_DP_SECP256K1_ENABLED",
        "CONFIG_MBEDTLS_ECP_DP_BP256R1_ENABLED",
        "CONFIG_MBEDTLS_ECP_DP_BP384R1_ENABLED",
        "CONFIG_MBEDTLS_ECP_DP_BP512R1_ENABLED",
        "CONFIG_MBEDTLS_ECP_DP_SECP521R1_ENABLED",
        "CONFIG_MBEDTLS_PSK_MODES",
        "CONFIG_MBEDTLS_SERVER_SSL_SESSION_TICKETS",
        "CONFIG_MBEDTLS_PEM_WRITE_C",
        "CONFIG_MBEDTLS_X509_CRL_PARSE_C",
        "CONFIG_MBEDTLS_X509_CSR_PARSE_C",
        "CONFIG_MBEDTLS_ERROR_STRINGS",
        "CONFIG_MBEDTLS_CLIENT_SSL_SESSION_TICKETS",
        "CONFIG_MBEDTLS_PEM_PARSE_C",
    ):
        esp32.add_idf_sdkconfig_option(opt, False)
    esp32.add_idf_sdkconfig_option("CONFIG_MBEDTLS_TLS_CLIENT_ONLY", True)
