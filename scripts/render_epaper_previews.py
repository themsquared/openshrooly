#!/usr/bin/env python3
"""Render native 296x128 1-bit OpenShrooly screens and 4x previews.

Matches the Waveshare 2.90inv2-r2 landscape canvas (LVGL rotation 90).
Uses the same Spleen bitmap faces as the firmware. Regenerates subset BDF
fonts and 1-bit logo assets when those files are missing.

Type hierarchy on the growing screen:
  24x48  temperature / humidity (largest pair that fits side by side)
  12x24  clock in the header
   6x12  stage + day, next event, Wi-Fi / AP status
"""

from __future__ import annotations

import argparse
import re
import shutil
import tarfile
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ESPHOME = ROOT / "esphome"
FONTS = ESPHOME / "fonts"
IMAGES = ESPHOME / "images"
PREVIEWS = ROOT / "docs" / "device-screen"
SPLEEN_URL = "https://github.com/fcambus/spleen/archive/refs/tags/2.1.0.tar.gz"
WIDTH, HEIGHT = 296, 128
GLYPHS = (
    " 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
    ".:%/?!,+=-"
)
GLYPH_ORDINALS = {ord(ch) for ch in GLYPHS} | {0x00B0}  # degree

# Growing-screen layout — keep in sync with 00_main_screen.yaml.
TIME_X, TIME_Y = 5, 2
PHASE_Y = 8
HERO_Y = 28
TEMP_X = 6
RH_RIGHT = 290
NEXT_Y = 80
ALERT_Y, ALERT_H = 78, 24
STATUS_Y = 110
SELECT = (224, 107, 294, 126)


def parse_bdf(path: Path) -> dict[int, dict]:
    glyphs: dict[int, dict] = {}
    encoding = None
    bbw = bbh = bbx = bby = 0
    rows: list[str] = []
    in_bitmap = False
    font_bb = (6, 12, 0, 0)
    with path.open(encoding="ascii", errors="replace") as handle:
        for raw in handle:
            line = raw.rstrip("\n")
            if line.startswith("FONTBOUNDINGBOX"):
                parts = line.split()
                font_bb = tuple(int(parts[i]) for i in range(1, 5))
            elif line.startswith("STARTCHAR"):
                encoding = None
                rows = []
                in_bitmap = False
            elif line.startswith("ENCODING"):
                encoding = int(line.split()[1])
            elif line.startswith("BBX"):
                parts = line.split()
                bbw, bbh, bbx, bby = (int(parts[i]) for i in range(1, 5))
            elif line == "BITMAP":
                in_bitmap = True
            elif line == "ENDCHAR":
                if encoding is not None:
                    glyphs[encoding] = {
                        "bbw": bbw,
                        "bbh": bbh,
                        "bbx": bbx,
                        "bby": bby,
                        "rows": rows[:],
                    }
                encoding = None
                in_bitmap = False
            elif in_bitmap:
                rows.append(line.strip())
    return {"glyphs": glyphs, "bb": font_bb}


def subset_bdf(src: Path, dest: Path, keep: set[int]) -> None:
    keep = set(keep) | {32}
    lines = src.read_text(encoding="ascii", errors="replace").splitlines(True)
    out: list[str] = []
    block: list[str] = []
    encoding = None
    in_char = False
    kept = 0
    for line in lines:
        if line.startswith("STARTCHAR"):
            in_char = True
            block = [line]
            encoding = None
            continue
        if in_char:
            block.append(line)
            if line.startswith("ENCODING"):
                encoding = int(line.split()[1])
            if line.startswith("ENDCHAR"):
                if encoding in keep:
                    out.extend(block)
                    kept += 1
                in_char = False
            continue
        out.append(line)
    text = "".join(out)
    text = text.replace(f"CHARS {sum(1 for line in lines if line.startswith('STARTCHAR'))}", f"CHARS {kept}", 1)
    dest.write_text(text, encoding="ascii")


def _scale_bitmap_row(hex_row: str, src_w: int, factor: int) -> str:
    bits = int(hex_row.strip() or "0", 16)
    src_bits = ((len(hex_row.strip()) * 4 + 7) // 8) * 8
    dst_w = src_w * factor
    dst_bits = ((dst_w + 7) // 8) * 8
    out = 0
    for col in range(src_w):
        if bits & (1 << (src_bits - 1 - col)):
            for dx in range(factor):
                out |= 1 << (dst_bits - 1 - (col * factor + dx))
    return f"{out:0{dst_bits // 4}X}"


def _scale_ints(line: str, factor: int) -> str:
    def repl(match: re.Match[str]) -> str:
        return str(int(match.group(0)) * factor)

    return re.sub(r"-?\d+", repl, line)


def scale_bdf(src: Path, dest: Path, factor: int) -> None:
    """Nearest-neighbor integer scale of a bitmap BDF (2x 12x24 → 24x48)."""
    lines = src.read_text(encoding="ascii", errors="replace").splitlines(True)
    out: list[str] = []
    in_bitmap = False
    src_w = 12
    for line in lines:
        stripped = line.rstrip("\n")
        if stripped.startswith("FONT "):
            out.append(_scale_ints(line, factor))
            continue
        if stripped.startswith("SIZE "):
            parts = stripped.split()
            parts[1] = str(int(parts[1]) * factor)
            out.append(" ".join(parts) + "\n")
            continue
        if stripped.startswith("FONTBOUNDINGBOX"):
            out.append(_scale_ints(line, factor))
            continue
        if stripped.startswith(("PIXEL_SIZE", "POINT_SIZE", "AVERAGE_WIDTH", "MIN_SPACE", "FONT_ASCENT", "FONT_DESCENT", "CAP_HEIGHT", "X_HEIGHT")):
            out.append(_scale_ints(line, factor))
            continue
        if stripped.startswith("BBX "):
            parts = stripped.split()
            src_w = int(parts[1])
            out.append(_scale_ints(line, factor))
            continue
        if stripped.startswith(("DWIDTH ", "DWIDTH1 ")):
            out.append(_scale_ints(line, factor))
            continue
        if stripped == "BITMAP":
            in_bitmap = True
            out.append(line)
            continue
        if stripped == "ENDCHAR":
            in_bitmap = False
            out.append(line)
            continue
        if in_bitmap:
            scaled = _scale_bitmap_row(stripped, src_w, factor)
            for _ in range(factor):
                out.append(scaled + "\n")
            continue
        out.append(line)
    dest.write_text("".join(out), encoding="ascii")


def bdf_has_hyphen(path: Path) -> bool:
    if not path.exists():
        return False
    return "ENCODING 45\n" in path.read_text(encoding="ascii", errors="replace")


def ensure_fonts() -> None:
    FONTS.mkdir(parents=True, exist_ok=True)
    face_12 = FONTS / "spleen-12x24.bdf"
    face_48 = FONTS / "spleen-24x48.bdf"
    if bdf_has_hyphen(face_12) and bdf_has_hyphen(face_48):
        parsed = parse_bdf(face_48)
        if parsed["bb"][1] >= 40:
            return
    archive = Path("/tmp/spleen-2.1.0.tar.gz")
    if not archive.exists():
        urllib.request.urlretrieve(SPLEEN_URL, archive)
    extract = Path("/tmp/spleen-2.1.0")
    if extract.exists():
        shutil.rmtree(extract)
    with tarfile.open(archive, "r:gz") as tar:
        tar.extractall("/tmp")
    src_root = Path("/tmp/spleen-2.1.0")
    subset_bdf(src_root / "spleen-12x24.bdf", face_12, GLYPH_ORDINALS)
    scale_bdf(face_12, face_48, 2)


class BitmapFont:
    def __init__(self, path: Path):
        data = parse_bdf(path)
        self.glyphs = data["glyphs"]
        self.bbw, self.bbh, self.bbx, self.bby = data["bb"]

    def text_width(self, text: str) -> int:
        return self.bbw * len(text)

    def draw(self, img: Image.Image, x: int, y: int, text: str, color: int = 0) -> None:
        px = x
        ascent = self.bbh + self.bby
        for ch in text:
            glyph = self.glyphs.get(ord(ch)) or self.glyphs.get(32)
            if glyph is None:
                px += self.bbw
                continue
            for row_i, hex_row in enumerate(glyph["rows"]):
                if not hex_row:
                    continue
                bits = int(hex_row, 16)
                width_bits = ((len(hex_row) * 4 + 7) // 8) * 8
                for col in range(glyph["bbw"]):
                    mask = 1 << (width_bits - 1 - col)
                    if bits & mask:
                        xx = px + glyph["bbx"] + col
                        yy = y + ascent - glyph["bby"] - glyph["bbh"] + row_i
                        if 0 <= xx < img.size[0] and 0 <= yy < img.size[1]:
                            img.putpixel((xx, yy), color)
            px += self.bbw


def new_paper() -> Image.Image:
    return Image.new("1", (WIDTH, HEIGHT), 1)


def _poly(draw: ImageDraw.ImageDraw, pts: list[tuple[int, int]], fill: int = 0, width: int = 1) -> None:
    closed = pts + [pts[0]]
    draw.line(closed, fill=fill, width=width)
    for pt in pts:
        draw.point(pt, fill=fill)


def draw_mark(draw: ImageDraw.ImageDraw, cx: int, cy: int, scale: int, fill: int = 0) -> None:
    """1-bit geometric mushroom: pentagon cap, three ridges, hex stem."""
    s = max(2, scale)

    def p(dx: float, dy: float) -> tuple[int, int]:
        return (cx + int(round(dx * s)), cy + int(round(dy * s)))

    stroke = 2 if s >= 6 else 1
    cap = [p(0, -3.2), p(3.1, -1.0), p(2.2, 1.3), p(-2.2, 1.3), p(-3.1, -1.0)]
    _poly(draw, cap, fill, stroke)
    draw.line([p(0, -3.2), p(0, 1.3)], fill=fill, width=stroke)
    draw.line([p(0, -3.2), p(2.2, 1.3)], fill=fill, width=stroke)
    draw.line([p(0, -3.2), p(-2.2, 1.3)], fill=fill, width=stroke)
    stem = [p(-1.0, 1.3), p(1.0, 1.3), p(1.3, 3.0), p(0.8, 4.0), p(-0.8, 4.0), p(-1.3, 3.0)]
    _poly(draw, stem, fill=fill, width=stroke)


def save_logo_assets() -> None:
    IMAGES.mkdir(parents=True, exist_ok=True)
    logo = Image.new("1", (80, 72), 1)
    draw_mark(ImageDraw.Draw(logo), 40, 28, 8)
    logo.save(IMAGES / "splash_logo.png")


def draw_select(img: Image.Image, font: BitmapFont) -> None:
    draw = ImageDraw.Draw(img)
    draw.rectangle([SELECT[0], SELECT[1], SELECT[2], SELECT[3]], fill=0)
    font.draw(img, 240, 110, "Select", color=1)


def draw_heroes(img: Image.Image, fonts: dict[str, BitmapFont], temp: str, rh: str) -> None:
    hero = fonts["24x48"]
    hero.draw(img, TEMP_X, HERO_Y, temp)
    hero.draw(img, RH_RIGHT - hero.text_width(rh), HERO_Y, rh)


def draw_header(img: Image.Image, fonts: dict[str, BitmapFont], time: str, phase: str) -> None:
    ui, small = fonts["12x24"], fonts["6x12"]
    ui.draw(img, TIME_X, TIME_Y, time)
    small.draw(img, WIDTH - 5 - small.text_width(phase), PHASE_Y, phase)


def draw_growing(state: dict, fonts: dict[str, BitmapFont]) -> Image.Image:
    img = new_paper()
    draw = ImageDraw.Draw(img)
    small, ui = fonts["6x12"], fonts["12x24"]
    alert = state.get("alert")
    draw_header(img, fonts, state["time"], state["phase_line"])
    draw_heroes(img, fonts, state["temp"], state["rh"])
    if alert:
        draw.rectangle([0, ALERT_Y, WIDTH - 1, ALERT_Y + ALERT_H - 1], fill=0)
        ui.draw(img, (WIDTH - ui.text_width(alert)) // 2, ALERT_Y, alert, color=1)
    else:
        small.draw(img, 5, NEXT_Y, state["next_event"])
    small.draw(img, 5, STATUS_Y, state.get("status", "Join OpenShrooly, then 192.168.4.1"))
    draw_select(img, small)
    return img


def draw_idle(state: dict, fonts: dict[str, BitmapFont]) -> Image.Image:
    img = new_paper()
    small = fonts["6x12"]
    draw_header(img, fonts, state["time"], "Idle")
    draw_heroes(img, fonts, state["temp"], state["rh"])
    small.draw(img, 5, NEXT_Y, "No grow running")
    small.draw(img, 5, STATUS_Y, state.get("status", "Join OpenShrooly, then 192.168.4.1"))
    draw_select(img, small)
    return img


def draw_splash(fonts: dict[str, BitmapFont]) -> Image.Image:
    img = new_paper()
    logo = Image.open(IMAGES / "splash_logo.png").convert("1")
    img.paste(logo, ((WIDTH - logo.size[0]) // 2, 12))
    word = "OpenShrooly"
    fonts["12x24"].draw(img, (WIDTH - fonts["12x24"].text_width(word)) // 2, 92, word)
    return img


def save_pair(img: Image.Image, stem: str) -> None:
    PREVIEWS.mkdir(parents=True, exist_ok=True)
    native = PREVIEWS / f"{stem}.png"
    big = PREVIEWS / f"{stem}@4x.png"
    img.save(native)
    img.resize((WIDTH * 4, HEIGHT * 4), Image.Resampling.NEAREST).save(big)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    ensure_fonts()
    fonts = {
        "6x12": BitmapFont(FONTS / "spleen-6x12.bdf"),
        "12x24": BitmapFont(FONTS / "spleen-12x24.bdf"),
        "24x48": BitmapFont(FONTS / "spleen-24x48.bdf"),
    }
    save_logo_assets()
    save_pair(
        draw_growing(
            {
                "time": "14:32",
                "phase_line": "Fruiting, day 6 of 10",
                "temp": "24.5C",
                "rh": "91%",
                "next_event": "Lights off 19:00",
                "status": "Wi-Fi 192.168.1.20",
            },
            fonts,
        ),
        "growing-in-range",
    )
    save_pair(
        draw_growing(
            {
                "time": "14:32",
                "phase_line": "Fruiting, day 6 of 10",
                "temp": "22.1C",
                "rh": "78%",
                "next_event": "FAE in 12m",
                "alert": "WATER LOW",
                "status": "Wi-Fi 192.168.1.20",
            },
            fonts,
        ),
        "growing-alert",
    )
    save_pair(
        draw_idle(
            {
                "time": "08:05",
                "temp": "21.4C",
                "rh": "55%",
                "status": "Join OpenShrooly, then 192.168.4.1",
            },
            fonts,
        ),
        "idle",
    )
    save_pair(draw_splash(fonts), "boot-splash")
    print(f"wrote fonts, logos, and previews under {PREVIEWS}")


if __name__ == "__main__":
    main()
