#!/usr/bin/env python3
"""Check growing-screen previews, fonts, and ESPHome font merge."""

from pathlib import Path
import os
import shutil
import subprocess

from PIL import Image

import lvgl_images
from shroom_mascot import FRAMES as MASCOT_FRAMES

ROOT = Path(__file__).resolve().parents[1]
PREVIEWS = ROOT / "docs" / "device-screen"
FONTS = ROOT / "esphome" / "fonts"
DISPLAY = ROOT / "esphome" / "components" / "display.yaml"
LVGL = ROOT / "esphome" / "components" / "lvgl_config.yaml"
MAIN = ROOT / "esphome" / "lvgl_screens" / "00_main_screen.yaml"
RENDER = ROOT / "scripts" / "render_epaper_previews.py"
STEMS = ("growing-in-range", "growing-alert", "growing-night", "idle", "boot-splash", "wifi-setup")


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

    for wid in ("header_mark", "grow_progress", "grow_temp_target", "grow_temp_band_bad",
                "grow_rh_target", "grow_rh_band_bad"):
        assert f"id: {wid}" in main_yaml, f"main screen is missing {wid}"
    assert "id: mark_16" in display, "mark_16 must live in display.yaml so << merge keeps it"
    splash_yaml = (ROOT / "esphome" / "lvgl_screens" / "00_splash.yaml").read_text(encoding="utf-8")
    assert "by Shroom Labs" in splash_yaml
    claim_yaml = (ROOT / "esphome" / "lvgl_screens" / "07_cloud_claim.yaml").read_text(encoding="utf-8")
    assert "id: icloudclaim" in claim_yaml
    assert "id: claim_code_label" in claim_yaml
    assert "text_font: font_hero" in claim_yaml
    assert "id: claim_qr" in claim_yaml
    script = (ROOT / "esphome" / "scripts" / "update_growing_screen.yaml").read_text(encoding="utf-8")
    cloud_script = (ROOT / "esphome" / "scripts" / "update_cloud_screen.yaml").read_text(encoding="utf-8")
    for path_text in (main_yaml, splash_yaml, claim_yaml, script, cloud_script):
        assert "\u2014" not in path_text and "\u2013" not in path_text, "no em or en dashes in screen text"
    assert "grow_started_ts" in script, "grow day must auto-advance from grow_started_ts"
    logo = Image.open(ROOT / "esphome" / "images" / "splash_logo.png")
    assert logo.mode == "1" and 60 <= logo.size[1] <= 68, logo.size
    assert logo.transpose(Image.Transpose.FLIP_LEFT_RIGHT).tobytes() == logo.tobytes(), "logo must be symmetric"

    # Screen mushroom: small 1-bit frames, drawn under the alert bar and setup
    # overlay, before the Select button so flipping keeps working.
    assert {"idle", "meh", "blink", "surprise", "lean_left", "lean_right"} <= set(MASCOT_FRAMES)
    # Shroomy always parties: no sleep frame, and lights off never stops the dance.
    assert "sleep" not in MASCOT_FRAMES
    assert not (ROOT / "esphome" / "images" / "mascot_sleep.png").exists()
    assert "mascot_sleep" not in display
    for name in MASCOT_FRAMES:
        frame = Image.open(ROOT / "esphome" / "images" / f"mascot_{name}.png")
        assert frame.mode == "1" and frame.size == (24, 26), (name, frame.mode, frame.size)
        assert f"id: mascot_{name}" in display, f"mascot_{name} must live in display.yaml"
    assert "id: grow_mascot" in main_yaml
    assert main_yaml.index("id: grow_mascot") < main_yaml.index("id: grow_alert_bar"), \
        "grow_mascot must come before the alert bar so alerts draw over it"
    assert "script.execute: update_mascot" in script
    mascot_script = (ROOT / "esphome" / "scripts" / "update_mascot.yaml").read_text(encoding="utf-8")
    for name in MASCOT_FRAMES:
        assert f"id(mascot_{name})" in mascot_script, f"update_mascot never shows mascot_{name}"
    mascot_code = mascot_script.split("lambda:", 1)[1]
    for gone in ("mascot_sleep", "lights_on_flag", "lights_status"):
        assert gone not in mascot_code, f"update_mascot must not use {gone}: the dance never stops"
    assert "component.update" not in mascot_script and "interval" not in mascot_code, \
        "update_mascot must not add e-paper refreshes; it rides the 10 s growing-screen refresh"

    # 1-bit images: LVGL paints them as an alpha mask in image_recolor, which
    # defaults to white paper on this panel. Every LVGL image widget showing a
    # BINARY image must set image_recolor: paper_black, and the image needs
    # invert_alpha: true, or the chamber draws nothing (PR #68 shipped that way).
    problems = lvgl_images.recolor_problems()
    assert not problems, "1-bit images that would draw blank on the chamber:\n" + "\n".join(problems)
    widgets = lvgl_images.image_widgets()
    for wid in ("grow_mascot", "header_mark", "claim_header_mark", "splash_logo_widget"):
        assert wid in widgets, f"{wid} must be an image widget"
    for image_id, wid in [("mark_16", "header_mark"), ("splash_logo", "splash_logo_widget")] + [
        (f"mascot_{n}", "grow_mascot") for n in MASCOT_FRAMES
    ]:
        src = Image.open(lvgl_images.image_specs()[image_id].file).convert("1")
        paper = Image.new("1", src.size, 1)
        lvgl_images.draw_image(paper, image_id, wid, (0, 0))
        assert paper.tobytes() == src.tobytes(), f"{image_id} in {wid} does not draw like its PNG"
    # The check itself must catch the PR #68 setup: no recolor, no invert.
    real_specs, real_widgets = lvgl_images.image_specs, lvgl_images.image_widgets
    try:
        lvgl_images.image_specs = lambda: {k: v.__class__(v.id, v.file, v.type, False) for k, v in real_specs().items()}
        lvgl_images.image_widgets = lambda: {k: v.__class__(v.id, v.src, v.source, None, None) for k, v in real_widgets().items()}
        broken = lvgl_images.recolor_problems()
        assert any("grow_mascot" in b and "image_recolor" in b for b in broken), broken
        assert any("mascot_idle" in b and "invert_alpha" in b for b in broken), broken
        paper = Image.new("1", (24, 26), 1)
        lvgl_images.draw_image(paper, "mascot_idle", "grow_mascot", (0, 0))
        assert min(paper.getdata()) == 1, "old setup must render blank in the simulator"
    finally:
        lvgl_images.image_specs, lvgl_images.image_widgets = real_specs, real_widgets
    controls = (ROOT / "esphome" / "components" / "controls.yaml").read_text(encoding="utf-8")
    assert "id: screen_mushroom" in controls and "RESTORE_DEFAULT_ON" in controls.split("id: screen_mushroom", 1)[1][:300]

    render = RENDER.read_text(encoding="utf-8")
    assert '"-:%%/?!,+=-"' in render or "+=-" in render
    assert "RH_RIGHT - hero.text_width" in render
    assert "No Wi-Fi. Menu, System, Wi-Fi setup" in render and "No Wi-Fi. Menu, System, Wi-Fi setup" in script
    assert "id: setup_overlay" in main_yaml and "setup_overlay" in script
    assert main_yaml.index("id: setup_overlay") < main_yaml.index("id: main_status_message"), \
        "setup_overlay must come before the buttons so flipping the panel keeps working"

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
