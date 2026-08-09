#!/usr/bin/env python3
"""Generate the extension's deterministic PNG icon set."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "icons"
SIZES = (16, 32, 48, 128)


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for candidate in (
        "/System/Library/Fonts/SFNSRounded.ttf",
        "/System/Library/Fonts/SFNS.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ):
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            pass
    return ImageFont.load_default()


def render(size: int) -> Image.Image:
    scale = 4
    canvas_size = size * scale
    image = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    pixels = image.load()
    start = (179, 156, 255)
    end = (106, 79, 176)
    for y in range(canvas_size):
        blend = y / max(1, canvas_size - 1)
        color = tuple(round(a + (b - a) * blend) for a, b in zip(start, end)) + (255,)
        for x in range(canvas_size):
            pixels[x, y] = color

    mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, canvas_size - 1, canvas_size - 1), radius=round(canvas_size * .23), fill=255)
    image.putalpha(mask)

    draw = ImageDraw.Draw(image)
    inset = round(canvas_size * .08)
    draw.rounded_rectangle(
        (inset, inset, canvas_size - inset - 1, canvas_size - inset - 1),
        radius=round(canvas_size * .17),
        outline=(255, 255, 255, 48),
        width=max(1, round(canvas_size * .018)),
    )
    face = font(round(canvas_size * .56))
    text = "T"
    bounds = draw.textbbox((0, 0), text, font=face, stroke_width=0)
    width = bounds[2] - bounds[0]
    height = bounds[3] - bounds[1]
    draw.text(
        ((canvas_size - width) / 2, (canvas_size - height) / 2 - bounds[1] - canvas_size * .025),
        text,
        font=face,
        fill=(255, 255, 255, 255),
    )
    return image.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        render(size).save(OUT / f"icon-{size}.png", optimize=True)


if __name__ == "__main__":
    main()
