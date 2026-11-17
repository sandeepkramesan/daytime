#!/usr/bin/env python3
"""Generate the Android adaptive-icon foreground from the shared mark geometry.

    python android/tools/make-icon.py

Keeps one source of truth: tools/make-icons.py draws the mark for the web icons
and for the Android launcher.
"""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "android" / "app" / "src" / "main" / "res" / "drawable-nodpi"


def main():
    spec = importlib.util.spec_from_file_location("daytime_icons", ROOT / "tools" / "make-icons.py")
    icons = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(icons)

    OUT.mkdir(parents=True, exist_ok=True)
    # Adaptive icons crop to 66/108dp, so keep the mark comfortably inside it.
    image = icons.draw_mark(432, 0.62)
    path = OUT / "ic_launcher_foreground.png"
    image.save(path, "PNG", optimize=True)
    print(f"wrote {path.relative_to(ROOT)} ({image.width}x{image.height})")


if __name__ == "__main__":
    main()
