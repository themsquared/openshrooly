import esphome.codegen as cg
import esphome.config_validation as cv
from esphome.const import CONF_ID

CODEOWNERS = ["@themsquared"]
DEPENDENCIES = ["wifi", "web_server"]

shroom_labs_ns = cg.esphome_ns.namespace("shroom_labs")
ShroomLabsCloud = shroom_labs_ns.class_("ShroomLabsCloud", cg.Component)

CONF_API_HOST = "api_host"

CONFIG_SCHEMA = cv.Schema(
    {
        cv.GenerateID(): cv.declare_id(ShroomLabsCloud),
        cv.Optional(CONF_API_HOST, default="link.shroomlabs.io"): cv.hostname,
    }
).extend(cv.COMPONENT_SCHEMA)


async def to_code(config):
    var = cg.new_Pvariable(config[CONF_ID])
    await cg.register_component(var, config)
    cg.add(var.set_api_host(config[CONF_API_HOST]))
