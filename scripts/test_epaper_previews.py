#!/usr/bin/env python3
"""Check growing-screen previews, fonts, and ESPHome font merge."""

from pathlib import Path
import os
import shutil
import subprocess

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PREVIEWS = ROOT / "docs" / "device-screen"
FONTS = ROOT / "esphome" / "fonts"
DISPLAY = ROOT / "esphome" / "components" / "display.yaml"
LVGL = ROOT / "esphome" / "components" / "lvgl_config.yaml"
MAIN = ROOT / "esphome" / "lvgl_screens" / "00_main_screen.yaml"
RENDER = ROOT / "scripts" / "render_epaper_previews.py"
STEMS = ("growing-in-range", "growing-alert", "idle", "boot-splash")


def assert_hyphen(path: Path) -> None:
    text = path.read_text(encoding="ascii", errors="replace")
    assert "ENCODING 45\n" in text, f"{path.name} is missing glyph '-' (ENCODING 45)"


def main() -> None:
    for stem in STEMS:
        native = Image.open(PREVIEWS / f"{stem}.png")
        big = Image.open(PREVIEWS / f"{stem}@4x.png")
        assert native.size == (296, 128), (stem, native.size)
        assert native.mode == "1", (stem, native.mode)
        assert big.size == (1184, 512), (stem, big.size)
        assert (PREVIEWS / f"{stem}.png").stat().st_size < 20_000

    display = DISPLAY.read_text(encoding="utf-8")
    assert "id: font_ui" in display, "font_ui must live in display.yaml so << merge keeps it"
    assert "id: font_hero" in display, "font_hero must live in display.yaml so << merge keeps it"
    lvgl = LVGL.read_text(encoding="utf-8")
    assert "\nfont:" not in f"\n{lvgl}", "lvgl_config.yaml must not define font: (merge drops it or the display.yaml list)"

    main_yaml = MAIN.read_text(encoding="utf-8")
    assert "id: main_humidity_value" in main_yaml
    assert "x: 212" not in main_yaml, "humidity must not use a fixed x=212"
    assert "id: grow_rh_unit" not in main_yaml
    assert "id: main_status_message" in main_yaml
    assert "hidden: true" not in main_yaml.split("id: main_status_message", 1)[1][:240]

    render = RENDER.read_text(encoding="utf-8")
    assert '"-:%%/?!,+=-"' in render or "+=-" in render
    assert "RH_RIGHT - hero.text_width" in render
    assert "Join OpenShrooly, then 192.168.4.1" in render

    for name in ("spleen-12x24.bdf", "spleen-24x48.bdf"):
        assert_hyphen(FONTS / name)
    hero_bb = next(
        line for line in (FONTS / "spleen-24x48.bdf").read_text(encoding="ascii").splitlines()
        if line.startswith("FONTBOUNDINGBOX")
    )
    assert int(hero_bb.split()[2]) >= 40, hero_bb
    assert "spleen-24x48.bdf" in display
    assert "text_font: font_hero" in main_yaml
    assert "text_font: font1" in main_yaml.split("id: grow_phase_label", 1)[1][:160]

    esphome = shutil.which("esphome")
    if esphome:
        subprocess.run([esphome, "config", str(ROOT / "esphome" / "openshrooly.yaml")], check=True)
    elif os.environ.get("REQUIRE_ESPHOME_CONFIG") == "1":
        raise SystemExit("esphome is required for REQUIRE_ESPHOME_CONFIG=1")
    print("ok", ", ".join(STEMS), "+ fonts + display.yaml merge")


if __name__ == "__main__":
    main()
