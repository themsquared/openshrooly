"""White light percent. The same scale on every chamber: 0 to 100, where 100 is the most
that channel puts out, linear in output. The Shrooly white channel tops out at 4000 lux, so
lux = 40 x percent. The Lykyn ring is linear output at brightness 100, so its percent is the
channel value as is. Mirrors whitePercentToLux and friends in community/api/src/profile-schema.js.
"""

from __future__ import annotations

import math

WHITE_MAX_LUX = 4000
WHITE_LUX_PER_PERCENT = WHITE_MAX_LUX / 100
# Marker on a light recipe whose white percent uses the scale below.
LIGHT_SCALE = "output"


def round_percent(value: float) -> float:
    """Percent are kept to three decimals, which is exact for any whole lux (1 lux is 0.025%).
    A whole result comes back as an int so stored JSON stays 0 and 5, not 0.0 and 5.0."""
    rounded = math.floor(float(value) * 1000 + 0.5) / 1000
    return int(rounded) if rounded.is_integer() else rounded


def white_percent_to_lux(percent: float) -> int:
    """Shrooly white: 0 to 100 percent of the 4000 lux maximum, linear. 100% is 4000 lux.

    The same scale means the same thing on every chamber: 100 is the most that channel puts
    out. Rounds half up so it matches whitePercentToLux in profile-schema.js.
    """
    pct = min(100.0, float(percent))
    if not pct > 0:
        return 0
    return min(WHITE_MAX_LUX, int(math.floor(pct * WHITE_LUX_PER_PERCENT + 0.5)))


def lux_to_white_percent(lux: float) -> float:
    """Inverse of white_percent_to_lux. Exact for whole lux: 92 lux is 2.3%."""
    value = min(float(WHITE_MAX_LUX), float(lux))
    if not value > 0:
        return 0
    return round_percent(value / WHITE_LUX_PER_PERCENT)


def legacy_white_percent_to_lux(percent: float) -> int:
    """The scale recipes used before the light_scale marker: input to the firmware curve.

    At or below 20% the firmware uses a linear fit: 20% is 92 lux. Above 20% it uses
    lux = 0.02307 * brightness^2.768, and the white entity tops out at 4000 lux (about 78%).
    Kept only to upgrade stored recipes without changing the light they make.
    """
    pct = min(100.0, float(percent))
    if not pct > 0:
        return 0
    if pct <= 20:
        lux = (pct / 20.0) * 92.0
    else:
        lux = 0.02307 * (pct**2.768)
    return min(WHITE_MAX_LUX, int(math.floor(lux + 0.5)))


def legacy_white_percent_to_percent(percent: float) -> float:
    """A legacy recipe percent on the current scale: the same lux, as a share of 4000."""
    return lux_to_white_percent(legacy_white_percent_to_lux(percent))


def upgrade_recipe_scale(recipe: dict | None) -> dict | None:
    """Upgrade a recipe dict to the output scale. A recipe with no marker is on the legacy
    scale. A marked recipe is returned unchanged, so running it twice is safe."""
    if not isinstance(recipe, dict) or recipe.get("white_scale") == LIGHT_SCALE:
        return recipe
    out = dict(recipe)
    out["white_scale"] = LIGHT_SCALE
    phases = recipe.get("phases")
    if isinstance(phases, dict):
        out["phases"] = {
            name: (
                {**phase, "white_brightness_percent": legacy_white_percent_to_percent(phase["white_brightness_percent"])}
                if isinstance(phase, dict) and phase.get("white_brightness_percent") is not None
                else phase
            )
            for name, phase in phases.items()
        }
    return out
