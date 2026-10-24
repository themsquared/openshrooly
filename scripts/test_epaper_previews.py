#!/usr/bin/env python3
"""Check native 296x128 and 4x preview sizes."""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PREVIEWS = ROOT / "docs" / "device-screen"
STEMS = ("growing-in-range", "growing-alert", "idle", "boot-splash")


def main() -> None:
    for stem in STEMS:
        native = Image.open(PREVIEWS / f"{stem}.png")
        big = Image.open(PREVIEWS / f"{stem}@4x.png")
        assert native.size == (296, 128), (stem, native.size)
        assert native.mode == "1", (stem, native.mode)
        assert big.size == (1184, 512), (stem, big.size)
        assert (PREVIEWS / f"{stem}.png").stat().st_size < 20_000
    print("ok", ", ".join(STEMS))


if __name__ == "__main__":
    main()
