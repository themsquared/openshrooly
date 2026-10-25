#!/usr/bin/env python3
"""Draw the growing-screen mushroom as 1-bit 24x26 frames.

Writes esphome/images/mascot_*.png (the firmware embeds these) and, with
--preview DIR, 8x PNGs plus animated GIFs for review.

The chamber screen is e-paper. The mushroom only changes on the existing
10 second growing-screen refresh, so it adds no extra panel updates.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
IMAGES = ROOT / "esphome" / "images"
W, H = 24, 26
CAP_TOP = 4  # cap rows 4..13, puff / z room above

CAP = (
    ".........######.........",
    ".......##########.......",
    ".....###..#########.....",
    "....####..##########....",
    "...###########...####...",
    "..############...#####..",
    ".###..################..",
    ".###..################..",
    "########################",
    "..####################..",
)
STEM = (  # rows 14..25
    "......#..........#......",
    "......#..........#......",
    "......#.##....##.#......",  # eyes
    "......#.##....##.#......",
    "......#..........#......",
    "......#..#....#..#......",  # smile
    "......#...####...#......",
    "......#..........#......",
    "......#..........#......",
    ".....#............#.....",
    "....#..............#....",
    "....################....",
)

FRAMES = ("idle", "meh", "blink", "surprise", "sleep")


def _blank() -> list[list[str]]:
    return [["."] * W for _ in range(H)]


def _put(grid: list[list[str]], rows, top: int, dx: int = 0, row_dx=None) -> None:
    for i, row in enumerate(rows):
        y = top + i
        if not 0 <= y < H:
            continue
        shift = dx + (row_dx(i) if row_dx else 0)
        for x, ch in enumerate(row):
            xx = x + shift
            if ch == "#" and 0 <= xx < W:
                grid[y][xx] = "#"


def _stem(face: str) -> list[str]:
    rows = [list(r) for r in STEM]
    for r in (2, 3, 5, 6):  # clear eyes and mouth
        rows[r] = list("......#..........#......")
    if face in ("idle", "meh"):
        rows[2] = list("......#.##....##.#......")
        rows[3] = list("......#.##....##.#......")
    if face == "idle":
        rows[5] = list("......#..#....#..#......")
        rows[6] = list("......#...####...#......")
    if face == "meh":
        rows[6] = list("......#...####...#......")
    if face in ("blink", "sleep"):
        rows[3] = list("......#.##....##.#......")
    if face == "blink":
        rows[5] = list("......#..#....#..#......")
        rows[6] = list("......#...####...#......")
    if face == "sleep":
        rows[6] = list("......#....##....#......")
    if face == "surprise":
        rows[1] = list("......#.##....##.#......")
        rows[2] = list("......#.##....##.#......")
        rows[3] = list("......#.##....##.#......")
        rows[5] = list("......#....##....#......")
        rows[6] = list("......#....##....#......")
    return ["".join(r) for r in rows]


def frame(name: str) -> Image.Image:
    grid = _blank()
    if name == "surprise":
        # Cap lifted 3 rows and tipped to the right, a little spore puff
        # drifting off the left side, and the top of the stem peeking out.
        _put(grid, CAP, CAP_TOP - 3, row_dx=lambda i: (9 - i) // 3)
        for x in range(6, 18):
            grid[12][x] = "#"
        grid[13][6] = grid[13][17] = "#"
        for x, y in ((1, 1), (0, 3), (2, 3), (1, 5), (3, 6)):
            grid[y][x] = "#"
    else:
        _put(grid, CAP, CAP_TOP)
    _put(grid, _stem(name), CAP_TOP + len(CAP))
    if name == "meh":  # a small sweat drop: humidity is off target
        grid[16][20] = "#"
        grid[17][20] = grid[17][21] = "#"
        grid[18][20] = grid[18][21] = "#"
    if name == "sleep":  # a tiny z
        for x in (19, 20, 21, 22):
            grid[0][x] = grid[3][x] = "#"
        grid[1][21] = grid[2][20] = "#"
    img = Image.new("1", (W, H), 1)
    for y, row in enumerate(grid):
        for x, ch in enumerate(row):
            if ch == "#":
                img.putpixel((x, y), 0)
    return img


def save_firmware_frames() -> None:
    IMAGES.mkdir(parents=True, exist_ok=True)
    for name in FRAMES:
        frame(name).save(IMAGES / f"mascot_{name}.png")


# What the chamber shows, one step per 10 s refresh (bob = 2 px down).
SEQUENCE = (
    ("idle", 0), ("idle", 2), ("idle", 0), ("idle", 2), ("idle", 0), ("blink", 2),
    ("idle", 0), ("idle", 2), ("surprise", 0), ("idle", 2), ("idle", 0), ("blink", 2),
)


def _shifted(img: Image.Image, dy: int, pad: int = 2) -> Image.Image:
    out = Image.new("1", (W, H + pad), 1)
    out.paste(img, (0, dy))
    return out


def save_previews(out: Path, scale: int = 8) -> None:
    out.mkdir(parents=True, exist_ok=True)
    for name in FRAMES:
        frame(name).resize((W * scale, H * scale), Image.Resampling.NEAREST).save(out / f"mascot_{name}@{scale}x.png")
    sheet = Image.new("1", ((W + 4) * len(FRAMES) * scale, (H + 4) * scale), 1)
    for i, name in enumerate(FRAMES):
        big = frame(name).resize((W * scale, H * scale), Image.Resampling.NEAREST)
        sheet.paste(big, (((W + 4) * i + 2) * scale, 2 * scale))
    sheet.save(out / f"mascot_sheet@{scale}x.png")

    def gif(seq, path: Path) -> None:
        imgs = [
            _shifted(frame(n), dy).resize((W * scale, (H + 2) * scale), Image.Resampling.NEAREST).convert("L")
            for n, dy in seq
        ]
        imgs[0].save(path, save_all=True, append_images=imgs[1:], duration=600, loop=0)

    gif(SEQUENCE, out / "mascot.gif")
    gif((("meh", 0), ("meh", 2)), out / "mascot_meh.gif")
    gif((("sleep", 0), ("sleep", 1)), out / "mascot_sleep.gif")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--preview", type=Path, help="write 8x PNGs and GIFs here")
    args = parser.parse_args()
    save_firmware_frames()
    if args.preview:
        save_previews(args.preview)
    print("wrote", ", ".join(f"mascot_{n}.png" for n in FRAMES))


if __name__ == "__main__":
    main()
