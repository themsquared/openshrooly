#!/usr/bin/env python3
"""How the firmware really draws a 1-bit image on the e-paper screen.

ESPHome hands LVGL a BINARY image as LV_COLOR_FORMAT_A1: an alpha mask with
no color of its own. LVGL paints every bit that is 1 in the widget's
image_recolor color and leaves bits that are 0 untouched. Two details make
that easy to get wrong on this panel:

  * The encoder sets bit 1 for white PNG pixels, unless the image has
    invert_alpha: true, which sets bit 1 for the dark pixels instead.
  * image_recolor defaults to black, and black in memory is white paper on
    this panel (paper_white = 000000, paper_black = FFFFFF).

So a BINARY image with neither setting paints its background white on white
and shows nothing. render_epaper_previews.py draws through draw_image() so
the previews show what the chamber shows, and test_epaper_previews.py calls
recolor_problems() so a widget that would draw blank fails CI.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ESPHOME = ROOT / "esphome"
DISPLAY = ESPHOME / "components" / "display.yaml"
SCREENS = ESPHOME / "lvgl_screens"

# Panel colors in memory, and what each one looks like on paper (PIL "1": 0 ink, 1 paper).
PAPER = {"paper_white": 1, "paper_black": 0}
DEFAULT_RECOLOR = "paper_white"  # LVGL's default black, which is white paper here


@dataclass(frozen=True)
class ImageSpec:
    id: str
    file: Path
    type: str
    invert_alpha: bool


@dataclass(frozen=True)
class ImageWidget:
    id: str
    src: str
    source: str  # screen file name, for error messages
    recolor: str | None
    recolor_opa: str | None


def _blocks(text: str, opener: str) -> list[tuple[int, dict[str, str]]]:
    """Return (line_no, flat key: value map) for each list item that starts with opener."""
    lines = text.splitlines()
    out = []
    for i, line in enumerate(lines):
        m = re.match(rf"^(\s*)- {re.escape(opener)}(.*)$", line)
        if not m:
            continue
        indent = len(m.group(1))
        fields: dict[str, str] = {}
        first = m.group(2).strip()
        kv = re.match(r"^(\w+):\s*(.*)$", first)
        if kv:
            fields[kv.group(1)] = kv.group(2)
        for nxt in lines[i + 1:]:
            if not nxt.strip() or nxt.lstrip().startswith("#"):
                continue
            if len(nxt) - len(nxt.lstrip()) <= indent:
                break
            kv = re.match(r"^\s*(\w+):\s*(.*?)\s*(#.*)?$", nxt)
            if kv and kv.group(1) not in fields:
                fields[kv.group(1)] = kv.group(2).strip().strip("\"'")
        out.append((i + 1, fields))
    return out


def image_specs(display: Path = DISPLAY) -> dict[str, ImageSpec]:
    specs = {}
    for _, f in _blocks(display.read_text(encoding="utf-8"), "platform: file"):
        if "id" in f and "type" in f:
            specs[f["id"]] = ImageSpec(
                id=f["id"],
                file=ESPHOME / f["file"],
                type=f["type"].upper(),
                invert_alpha=f.get("invert_alpha", "false").lower() == "true",
            )
    return specs


def image_widgets(screens: Path = SCREENS) -> dict[str, ImageWidget]:
    widgets = {}
    for path in sorted(screens.glob("*.yaml")):
        for line, f in _blocks(path.read_text(encoding="utf-8"), "image:"):
            wid = f.get("id", f"{path.name}:{line}")
            widgets[wid] = ImageWidget(
                id=wid,
                src=f.get("src", ""),
                source=path.name,
                recolor=f.get("image_recolor"),
                recolor_opa=f.get("image_recolor_opa"),
            )
    return widgets


def lambda_sources(widget_id: str, root: Path = ESPHOME) -> set[str]:
    """Image ids a lambda swaps into a widget with lv_image_set_src (for example the mushroom frames)."""
    found: set[str] = set()
    for path in root.rglob("*.yaml"):
        if ".esphome" in path.parts:
            continue
        text = path.read_text(encoding="utf-8")
        if f"id({widget_id})" in text and "lv_image_set_src" in text:
            found |= set(re.findall(r"id\((\w+)\)", text))
    return found


def recolor_problems() -> list[str]:
    """Every reason a 1-bit image would draw blank on the chamber. Empty means fine."""
    specs, widgets = image_specs(), image_widgets()
    problems = []
    for w in widgets.values():
        srcs = {w.src} | (lambda_sources(w.id) & set(specs))
        binary = sorted(s for s in srcs if s in specs and specs[s].type == "BINARY")
        if not binary:
            continue
        if w.recolor != "paper_black":
            problems.append(
                f"{w.source}: image widget {w.id} shows 1-bit {', '.join(binary)} but has "
                f"image_recolor: {w.recolor or 'unset (LVGL black = white paper)'}; set image_recolor: paper_black"
            )
        for s in binary:
            if not specs[s].invert_alpha:
                problems.append(
                    f"display.yaml: 1-bit image {s} (used by {w.id}) needs invert_alpha: true, "
                    "or LVGL paints its background instead of its ink"
                )
    return problems


def a1_mask(spec: ImageSpec) -> Image.Image:
    """The A1 bits ESPHome stores for a BINARY image, as an L mask (255 = bit set)."""
    img = Image.open(spec.file).convert("1")
    bits = img.point(lambda p: 0 if p else 255) if spec.invert_alpha else img.point(lambda p: 255 if p else 0)
    return bits.convert("L")


def draw_image(canvas: Image.Image, image_id: str, widget_id: str, xy: tuple[int, int]) -> None:
    """Paste image_id at xy the way LVGL draws it in widget_id on the chamber."""
    spec = image_specs()[image_id]
    widget = image_widgets()[widget_id]
    if spec.type != "BINARY":
        canvas.paste(Image.open(spec.file).convert("1"), xy)
        return
    # LVGL decodes A1 to an A8 mask and blends widget.recolor through it
    # (lv_draw_sw_img.c, the LV_COLOR_FORMAT_A8 branch); image_recolor_opa
    # does not change that, the firmware sets it to COVER anyway.
    mask = a1_mask(spec)
    color = PAPER[widget.recolor or DEFAULT_RECOLOR]
    canvas.paste(color, (*xy, xy[0] + mask.size[0], xy[1] + mask.size[1]), mask)


if __name__ == "__main__":
    issues = recolor_problems()
    print("\n".join(issues) or "every 1-bit LVGL image draws ink")
    raise SystemExit(1 if issues else 0)
