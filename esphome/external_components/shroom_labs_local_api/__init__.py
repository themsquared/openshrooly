"""Read-only local status API and mDNS helper for Shroom Labs chambers."""

import esphome.codegen as cg
from esphome.components import (
    binary_sensor,
    number,
    select,
    sensor,
    switch,
    text_sensor,
    web_server_base,
)
from esphome.components.web_server_base import CONF_WEB_SERVER_BASE_ID
import esphome.config_validation as cv
from esphome.const import CONF_ID

CODEOWNERS = ["@themsquared"]
DEPENDENCIES = ["web_server", "esp32"]
AUTO_LOAD = ["web_server_base"]

shroom_labs_local_api_ns = cg.esphome_ns.namespace("shroom_labs_local_api")
ShroomLabsLocalApi = shroom_labs_local_api_ns.class_("ShroomLabsLocalApi", cg.Component)

shroom_labs_ns = cg.esphome_ns.namespace("shroom_labs")
ShroomLabsCloud = shroom_labs_ns.class_("ShroomLabsCloud", cg.Component)

CONF_TYPE = "type"
CONF_MODEL = "model"
CONF_FIRMWARE = "firmware"
CONF_TEMPERATURE = "temperature"
CONF_HUMIDITY = "humidity"
CONF_FAN_RPM = "fan_rpm"
CONF_CO2 = "co2"
CONF_WIFI_RSSI = "wifi_rssi"
CONF_TEMPERATURE_TARGET = "temperature_target"
CONF_TEMPERATURE_TOLERANCE = "temperature_tolerance"
CONF_HUMIDITY_TARGET = "humidity_target"
CONF_HUMIDITY_TOLERANCE = "humidity_tolerance"
CONF_SUNRISE_HOUR = "sunrise_hour"
CONF_LIGHT_HOURS = "light_hours"
CONF_LIGHT_R = "light_r"
CONF_LIGHT_G = "light_g"
CONF_LIGHT_B = "light_b"
CONF_LIGHT_WHITE = "light_white"
CONF_LIGHT_BRIGHTNESS = "light_brightness"
CONF_HUMIDIFIER_LEVEL = "humidifier_level"
CONF_FAE_PERIOD_MIN = "fae_period_min"
CONF_FAE_RUN_S = "fae_run_s"
CONF_FAE_SPEED = "fae_speed"
CONF_STAGE = "stage"
CONF_CLIMATE_MODE = "climate_mode"
CONF_LIGHT_ENABLED = "light_enabled"
CONF_HUMIDIFIER_SWITCH = "humidifier_switch"
CONF_LIGHT_ON = "light_on"
CONF_HUMIDIFIER_ON = "humidifier_on"
CONF_FAE_ON = "fae_on"
CONF_LIGHT_STATUS = "light_status"
CONF_HUMIDIFIER_STATUS = "humidifier_status"
CONF_FAE_STATUS = "fae_status"
CONF_ALERTS = "alerts"
CONF_CLOUD_ID = "cloud_id"
CONF_LAST_GOOD_MS = "last_good_ms"
CONF_SENSOR_STALE_AFTER_MS = "sensor_stale_after_ms"
CONF_FAN_BOOST = "fan_boost"
CONF_FAN_IN_PCT = "fan_in_pct"
CONF_FAN_OUT_PCT = "fan_out_pct"
CONF_LIGHT_WHITE_IS_LUX = "light_white_is_lux"

SENSOR_KEYS = {
    CONF_TEMPERATURE: "set_temperature",
    CONF_HUMIDITY: "set_humidity",
    CONF_FAN_RPM: "set_fan_rpm",
    CONF_CO2: "set_co2",
    CONF_WIFI_RSSI: "set_wifi_rssi_sensor",
}

NUMBER_KEYS = {
    CONF_TEMPERATURE_TARGET: "set_temperature_target",
    CONF_TEMPERATURE_TOLERANCE: "set_temperature_tolerance",
    CONF_HUMIDITY_TARGET: "set_humidity_target",
    CONF_HUMIDITY_TOLERANCE: "set_humidity_tolerance",
    CONF_SUNRISE_HOUR: "set_sunrise_hour",
    CONF_LIGHT_HOURS: "set_light_hours",
    CONF_LIGHT_R: "set_light_r",
    CONF_LIGHT_G: "set_light_g",
    CONF_LIGHT_B: "set_light_b",
    CONF_LIGHT_WHITE: "set_light_white",
    CONF_LIGHT_BRIGHTNESS: "set_light_brightness",
    CONF_HUMIDIFIER_LEVEL: "set_humidifier_level",
    CONF_FAE_PERIOD_MIN: "set_fae_period_min",
    CONF_FAE_RUN_S: "set_fae_run_s",
    CONF_FAE_SPEED: "set_fae_speed",
}

SELECT_KEYS = {
    CONF_STAGE: "set_stage",
    CONF_CLIMATE_MODE: "set_climate_mode",
}

SWITCH_KEYS = {
    CONF_LIGHT_ENABLED: "set_light_enabled",
    CONF_HUMIDIFIER_SWITCH: "set_humidifier_switch",
}

BINARY_KEYS = {
    CONF_LIGHT_ON: "set_light_on",
    CONF_HUMIDIFIER_ON: "set_humidifier_on",
    CONF_FAE_ON: "set_fae_on",
}

TEXT_KEYS = {
    CONF_LIGHT_STATUS: "set_light_status",
    CONF_HUMIDIFIER_STATUS: "set_humidifier_status",
    CONF_FAE_STATUS: "set_fae_status",
    CONF_ALERTS: "set_alerts",
}


def _global_id(value):
    return cv.validate_id_name(value)


CONFIG_SCHEMA = cv.Schema(
    {
        cv.GenerateID(): cv.declare_id(ShroomLabsLocalApi),
        cv.GenerateID(CONF_WEB_SERVER_BASE_ID): cv.use_id(web_server_base.WebServerBase),
        cv.Required(CONF_TYPE): cv.string,
        cv.Required(CONF_MODEL): cv.string,
        cv.Required(CONF_FIRMWARE): cv.string,
        **{cv.Optional(key): cv.use_id(sensor.Sensor) for key in SENSOR_KEYS},
        **{cv.Optional(key): cv.use_id(number.Number) for key in NUMBER_KEYS},
        **{cv.Optional(key): cv.use_id(select.Select) for key in SELECT_KEYS},
        **{cv.Optional(key): cv.use_id(switch.Switch) for key in SWITCH_KEYS},
        **{cv.Optional(key): cv.use_id(binary_sensor.BinarySensor) for key in BINARY_KEYS},
        **{cv.Optional(key): cv.use_id(text_sensor.TextSensor) for key in TEXT_KEYS},
        cv.Optional(CONF_CLOUD_ID): cv.use_id(ShroomLabsCloud),
        cv.Optional(CONF_LAST_GOOD_MS): _global_id,
        cv.Optional(CONF_SENSOR_STALE_AFTER_MS, default=60000): cv.positive_int,
        cv.Optional(CONF_FAN_BOOST): _global_id,
        cv.Optional(CONF_FAN_IN_PCT): _global_id,
        cv.Optional(CONF_FAN_OUT_PCT): _global_id,
        cv.Optional(CONF_LIGHT_WHITE_IS_LUX, default=False): cv.boolean,
    }
).extend(cv.COMPONENT_SCHEMA)


async def _set_entity(var, config, key, setter):
    if key not in config:
        return
    ent = await cg.get_variable(config[key])
    cg.add(getattr(var, setter)(ent))


async def to_code(config):
    base = await cg.get_variable(config[CONF_WEB_SERVER_BASE_ID])
    var = cg.new_Pvariable(config[CONF_ID], base)
    await cg.register_component(var, config)
    cg.add(var.set_device_type(config[CONF_TYPE]))
    cg.add(var.set_model(config[CONF_MODEL]))
    cg.add(var.set_firmware(config[CONF_FIRMWARE]))
    for key, setter in SENSOR_KEYS.items():
        await _set_entity(var, config, key, setter)
    for key, setter in NUMBER_KEYS.items():
        await _set_entity(var, config, key, setter)
    for key, setter in SELECT_KEYS.items():
        await _set_entity(var, config, key, setter)
    for key, setter in SWITCH_KEYS.items():
        await _set_entity(var, config, key, setter)
    for key, setter in BINARY_KEYS.items():
        await _set_entity(var, config, key, setter)
    for key, setter in TEXT_KEYS.items():
        await _set_entity(var, config, key, setter)
    if CONF_CLOUD_ID in config:
        cloud = await cg.get_variable(config[CONF_CLOUD_ID])
        cg.add(var.set_cloud(cloud))
    if CONF_LAST_GOOD_MS in config:
        cg.add(var.set_last_good_ms(cg.RawExpression(f"&id({config[CONF_LAST_GOOD_MS]})")))
    cg.add(var.set_sensor_stale_after_ms(config[CONF_SENSOR_STALE_AFTER_MS]))
    if CONF_FAN_BOOST in config:
        cg.add(var.set_fan_boost(cg.RawExpression(f"&id({config[CONF_FAN_BOOST]})")))
    if CONF_FAN_IN_PCT in config:
        cg.add(var.set_fan_in_pct(cg.RawExpression(f"&id({config[CONF_FAN_IN_PCT]})")))
    if CONF_FAN_OUT_PCT in config:
        cg.add(var.set_fan_out_pct(cg.RawExpression(f"&id({config[CONF_FAN_OUT_PCT]})")))
    cg.add(var.set_light_white_is_lux(config[CONF_LIGHT_WHITE_IS_LUX]))
