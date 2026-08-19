#!/usr/bin/env python3
"""Draws the README artwork: the icon and the animated version of it.

The bars are the ones the extension draws, with the same shape and the same
wave underneath. The speeds are rounded to whole turns of the loop so the
animation comes back to where it started and the GIF can repeat without a jump.
"""

import math
from pathlib import Path

import cairo
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"

# Drawn large and scaled down, so every rounded end and every corner is smooth.
RENDER = 512
ICON = 256
FRAME = 128

N_BARS = 3
BAR_WIDTH = 0.11
BAR_GAP = 0.075
MIN_HEIGHT = 0.16
MAX_HEIGHT = 0.62
CORNER = 0.22

# GNOME blue, top to bottom.
TOP = (0.30, 0.60, 0.92)
BOTTOM = (0.08, 0.38, 0.73)

# The pose of the still icon: the middle bar tallest, the outer two uneven.
POSE = (0.55, 1.0, 0.72)

# One turn of the loop, and how many of those turns each bar makes in it. Whole
# numbers are what keeps the last frame next to the first one.
LOOP_S = 2.4
TURNS = (3, 4, 2)
PHASES = (0, 2.1, 4.2)
FPS = 20
# Colours in the shared palette; one index above them stands for the corners.
COLOURS = 64


def rounded_rect(cr, x, y, width, height, radius):
    cr.new_sub_path()
    cr.arc(x + width - radius, y + radius, radius, -math.pi / 2, 0)
    cr.arc(x + width - radius, y + height - radius, radius, 0, math.pi / 2)
    cr.arc(x + radius, y + height - radius, radius, math.pi / 2, math.pi)
    cr.arc(x + radius, y + radius, radius, math.pi, 3 * math.pi / 2)
    cr.close_path()


def draw(size, waves):
    surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, size, size)
    cr = cairo.Context(surface)

    tile = cairo.LinearGradient(0, 0, 0, size)
    tile.add_color_stop_rgb(0, *TOP)
    tile.add_color_stop_rgb(1, *BOTTOM)
    rounded_rect(cr, 0, 0, size, size, size * CORNER)
    cr.set_source(tile)
    cr.fill()

    bar = size * BAR_WIDTH
    gap = size * BAR_GAP
    total = N_BARS * bar + (N_BARS - 1) * gap
    left = (size - total) / 2
    middle = size / 2

    cr.set_source_rgb(1, 1, 1)
    cr.set_line_width(bar)
    cr.set_line_cap(cairo.LINE_CAP_ROUND)

    for i, wave in enumerate(waves):
        height = size * (MIN_HEIGHT + (MAX_HEIGHT - MIN_HEIGHT) * wave)
        x = left + i * (bar + gap) + bar / 2
        cr.move_to(x, middle - height / 2 + bar / 2)
        cr.line_to(x, middle + height / 2 - bar / 2)
        cr.stroke()

    return surface


def to_image(surface, size):
    width = surface.get_width()
    data = bytes(surface.get_data())
    image = Image.frombuffer("RGBA", (width, width), data, "raw", "BGRa", 0, 1)
    return image.resize((size, size), Image.LANCZOS)


def main():
    DOCS.mkdir(exist_ok=True)

    to_image(draw(RENDER, POSE), ICON).save(DOCS / "icon.png")

    frames = []
    count = round(LOOP_S * FPS)
    for n in range(count):
        t = n / count
        waves = [
            (math.sin(2 * math.pi * turns * t + phase) + 1) / 2
            for turns, phase in zip(TURNS, PHASES)
        ]
        frames.append(to_image(draw(RENDER, waves), FRAME))

    # One palette for every frame, or the colours crawl from frame to frame:
    # the first frame builds it and the rest are mapped onto it. The last entry
    # is left over for what surrounds the tile.
    base = frames[0].convert("RGB").quantize(colors=COLOURS, dither=Image.NONE)
    masked = []
    for frame in frames:
        quantized = frame.convert("RGB").quantize(palette=base, dither=Image.NONE)
        quantized = quantized.convert("P")
        alpha = frame.getchannel("A").point(lambda a: 255 if a < 128 else 0)
        quantized.paste(COLOURS, alpha)
        masked.append(quantized)

    masked[0].save(
        DOCS / "equalizer.gif",
        save_all=True,
        append_images=masked[1:],
        duration=round(1000 / FPS),
        loop=0,
        transparency=COLOURS,
        disposal=2,
        optimize=True,
    )

    print(f"wrote {DOCS / 'icon.png'} and {DOCS / 'equalizer.gif'}")


if __name__ == "__main__":
    main()
