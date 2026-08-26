"""Apply Z icon to static/ and release/zcord-dist/. Usage: py apply-zcord-icon.py [source.ico]"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

root = Path(__file__).resolve().parent.parent
dist = root / "release" / "zcord-dist"

default_src = root / "static" / "icon.ico"
src = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else default_src
if not src.exists():
    raise SystemExit(f"Icon source not found: {src}")

img = Image.open(src).convert("RGBA")
pixels = img.load()
for y in range(img.height):
    for x in range(img.width):
        r, g, b, a = pixels[x, y]
        if r < 20 and g < 20 and b < 20:
            pixels[x, y] = (0, 0, 0, 0)

sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]

dist.mkdir(parents=True, exist_ok=True)
png_path = dist / "app.png"
img.resize((256, 256), Image.Resampling.LANCZOS).save(png_path, "PNG")
(root / "static" / "icon.png").parent.mkdir(parents=True, exist_ok=True)
(root / "static" / "icon.png").write_bytes(png_path.read_bytes())

ico_path = dist / "app.ico"
img.save(ico_path, format="ICO", sizes=sizes)

targets = [
    root / "static" / "icon.ico",
    root / "zcord.ico",
    root / "icon.ico",
    dist / "resources" / "app.ico",
]
data = ico_path.read_bytes()
for t in targets:
    t.parent.mkdir(parents=True, exist_ok=True)
    t.write_bytes(data)
    print("ICO", t, t.stat().st_size)

print("PNG", png_path, png_path.stat().st_size)
print("done")
