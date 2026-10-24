#!/usr/bin/env python3
"""Render native 296x128 1-bit OpenShrooly screens and 4x previews.

Matches the Waveshare 2.90inv2-r2 landscape canvas (LVGL rotation 90).
Uses the same Spleen bitmap faces as the firmware. Regenerates subset BDF
fonts and 1-bit logo assets when those files are missing.
"""

from __future__ import annotations

import argparse
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
    ".:%/?!,+="
)
GLYPH_ORDINALS = {ord(ch) for ch in GLYPHS} | {0x00B0}  # degree


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
    header: list[str] = []
    for line in lines:
        if line.startswith("STARTCHAR"):
            if not in_char:
                header = out[:]
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


def ensure_fonts() -> None:
    FONTS.mkdir(parents=True, exist_ok=True)
    needed = ["spleen-8x16.bdf", "spleen-16x32.bdf"]
    if all((FONTS / name).exists() for name in needed):
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
    for name in needed:
        subset_bdf(src_root / name, FONTS / name, GLYPH_ORDINALS)


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
    _poly(draw, stem, fill, stroke)


def save_logo_assets() -> None:
    IMAGES.mkdir(parents=True, exist_ok=True)
    mark = Image.new("1", (16, 16), 1)
    draw_mark(ImageDraw.Draw(mark), 8, 6, 2)
    mark.save(IMAGES / "mark_16.png")
    logo = Image.new("1", (80, 72), 1)
    draw_mark(ImageDraw.Draw(logo), 40, 28, 8)
    logo.save(IMAGES / "splash_logo.png")


def draw_select(img: Image.Image, font: BitmapFont) -> None:
    draw = ImageDraw.Draw(img)
    draw.rectangle([224, 107, 294, 126], fill=0)
    font.draw(img, 240, 110, "Select", color=1)


def draw_progress(draw: ImageDraw.ImageDraw, day: int, total: int) -> None:
    x, y, w, h = 5, 20, 286, 6
    draw.rectangle([x, y, x + w - 1, y + h - 1], outline=0)
    if total <= 0:
        return
    inner = max(0, min(w - 2, int((w - 2) * day / total)))
    if inner:
        draw.rectangle([x + 1, y + 1, x + inner, y + h - 2], fill=0)


def paste_mark(img: Image.Image, xy: tuple[int, int]) -> None:
    mark = Image.open(IMAGES / "mark_16.png").convert("1")
    img.paste(mark, xy)


def draw_growing(state: dict, fonts: dict[str, BitmapFont]) -> Image.Image:
    img = new_paper()
    draw = ImageDraw.Draw(img)
    small, ui, hero = fonts["6x12"], fonts["8x16"], fonts["16x32"]
    alert = state.get("alert")
    if alert:
        draw.rectangle([0, 90, WIDTH - 1, 103], fill=0)
        ui.draw(img, (WIDTH - ui.text_width(alert)) // 2, 90, alert, color=1)
    paste_mark(img, (4, 2))
    ui.draw(img, 22, 2, state["time"])
    phase = state["phase_line"]
    ui.draw(img, WIDTH - 5 - ui.text_width(phase), 2, phase)
    if state.get("day") and state.get("total"):
        draw_progress(draw, state["day"], state["total"])
    hero.draw(img, 8, 30, state["temp"])
    ui.draw(img, 8 + hero.text_width(state["temp"]) + 4, 46, "C")
    hero.draw(img, 160, 30, state["rh"])
    ui.draw(img, 160 + hero.text_width(state["rh"]) + 4, 46, "%")
    small.draw(img, 8, 66, state["temp_meta"])
    small.draw(img, 160, 66, state["rh_meta"])
    small.draw(img, 5, 78, state["next_event"])
    draw_select(img, small)
    return img


def draw_idle(state: dict, fonts: dict[str, BitmapFont]) -> Image.Image:
    img = new_paper()
    small, ui, hero = fonts["6x12"], fonts["8x16"], fonts["16x32"]
    paste_mark(img, (4, 2))
    ui.draw(img, 22, 2, state["time"])
    idle = "Idle"
    ui.draw(img, WIDTH - 5 - ui.text_width(idle), 2, idle)
    hero.draw(img, 8, 30, state["temp"])
    ui.draw(img, 8 + hero.text_width(state["temp"]) + 4, 46, "C")
    hero.draw(img, 160, 30, state["rh"])
    ui.draw(img, 160 + hero.text_width(state["rh"]) + 4, 46, "%")
    small.draw(img, 8, 66, state["temp_meta"])
    small.draw(img, 160, 66, state["rh_meta"])
    small.draw(img, 5, 78, "No grow running")
    draw_select(img, small)
    return img


def draw_splash(fonts: dict[str, BitmapFont]) -> Image.Image:
    img = new_paper()
    logo = Image.open(IMAGES / "splash_logo.png").convert("1")
    img.paste(logo, ((WIDTH - logo.size[0]) // 2, 12))
    word = "OpenShrooly"
    fonts["8x16"].draw(img, (WIDTH - fonts["8x16"].text_width(word)) // 2, 92, word)
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
        "8x16": BitmapFont(FONTS / "spleen-8x16.bdf"),
        "16x32": BitmapFont(FONTS / "spleen-16x32.bdf"),
    }
    save_logo_assets()
    save_pair(
        draw_growing(
            {
                "time": "14:32",
                "phase_line": "Fruiting, day 6 of 10",
                "day": 6,
                "total": 10,
                "temp": "24.5",
                "rh": "91",
                "temp_meta": "tgt 24  OK",
                "rh_meta": "tgt 90  OK",
                "next_event": "Lights off 19:00",
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
                "day": 6,
                "total": 10,
                "temp": "22.1",
                "rh": "78",
                "temp_meta": "tgt 24  DRIFT",
                "rh_meta": "tgt 90  DRIFT",
                "next_event": "FAE in 12m",
                "alert": "WATER LOW",
            },
            fonts,
        ),
        "growing-alert",
    )
    save_pair(
        draw_idle(
            {
                "time": "08:05",
                "temp": "21.4",
                "rh": "55",
                "temp_meta": "tgt 22  OK",
                "rh_meta": "tgt 70  DRIFT",
            },
            fonts,
        ),
        "idle",
    )
    save_pair(draw_splash(fonts), "boot-splash")
    print(f"wrote fonts, logos, and previews under {PREVIEWS}")


if __name__ == "__main__":
    main()
