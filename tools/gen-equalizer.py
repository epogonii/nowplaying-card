#!/usr/bin/env python3
"""Draws the colour-cycling equalizer for the README, as the panel draws it.

Every number here is the one extension.js uses in EqualizerIcon.vfunc_repaint,
so the picture is the icon a 16px panel shows, only rendered larger. Two files
come out of it: the dark theme runs the colours at full strength, the light one
a notch below, the way the extension does when the panel draws in dark ink.

The bars are rounded to whole turns of the loop, otherwise the GIF jumps every
time it starts over. The colour wheel needs no rounding: one turn takes ten
seconds and so does the loop.
"""

import math
import re
from pathlib import Path

import cairo
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"

# extension.js: N_BARS, BAR_WIDTH, BAR_GAP, and the height from stylesheet.css.
N_BARS = 3
BAR_WIDTH = 3
BAR_GAP = 2
HEIGHT = 16

# extension.js: SPEEDS, PHASES, HUE_PERIOD, HUE_SPREAD, HUE_SATURATION.
SPEEDS = (7.1, 9.7, 5.3)
PHASES = (0, 2.1, 4.2)
HUE_PERIOD = 10
HUE_SPREAD = 1 / 8
HUE_SPREAD_JS = "1 / 8"
HUE_SATURATION = 0.7

# Shown at eight pixels to one, drawn at four times that and scaled back down
# so the round ends stay smooth.
SHOWN = 8
SUPER = 4
LOOP_S = HUE_PERIOD
FPS = 15
COLOURS = 128

# GitHub's own two canvases, so the ends of the bars have something to blend
# into instead of a hole. Value follows the extension: full strength where the
# panel draws in light ink, a notch below where it draws in dark ink.
THEMES = (
    ("dark", (0x0d, 0x11, 0x17), 1.0),
    ("light", (0xff, 0xff, 0xff), 0.8),
)


def check_the_source():
    """Fails when extension.js has moved on and this file has not."""
    source = (ROOT / "extension.js").read_text()
    numbers = {
        "N_BARS": N_BARS,
        "BAR_WIDTH": BAR_WIDTH,
        "BAR_GAP": BAR_GAP,
        "HUE_PERIOD": HUE_PERIOD,
        "HUE_SATURATION": HUE_SATURATION,
    }
    wanted = [f"const {name} = {value};" for name, value in numbers.items()]
    wanted.append(f"const HUE_SPREAD = {HUE_SPREAD_JS};")
    for name, values in (("SPEEDS", SPEEDS), ("PHASES", PHASES)):
        inside = ", ".join(repr(value) for value in values)
        wanted.append(f"const {name} = [{inside}];")

    missing = [line for line in wanted if line not in source]
    if missing:
        raise SystemExit(
            "extension.js no longer says:\n  " + "\n  ".join(missing))

    style = (ROOT / "stylesheet.css").read_text()
    found = re.search(r"\.np-equalizer\s*\{[^}]*?height:\s*(\d+)px", style)
    if not found or int(found.group(1)) != HEIGHT:
        raise SystemExit(f"stylesheet.css draws the icon at {found and found.group(1)}px")


def hsv_to_rgb(hue, saturation, value):
    h = (hue % 1.0) * 6
    sector = math.floor(h)
    f = h - sector
    p = value * (1 - saturation)
    q = value * (1 - saturation * f)
    t = value * (1 - saturation * (1 - f))

    return [
        (value, t, p),
        (q, value, p),
        (p, value, t),
        (p, q, value),
        (t, p, value),
        (value, p, q),
    ][sector % 6]


def draw(scale, phase, value, matte):
    bar = BAR_WIDTH * scale
    gap = BAR_GAP * scale
    height = HEIGHT * scale
    width = N_BARS * bar + (N_BARS - 1) * gap

    surface = cairo.ImageSurface(cairo.FORMAT_RGB24, width, height)
    cr = cairo.Context(surface)
    cr.set_source_rgb(*[channel / 255 for channel in matte])
    cr.paint()

    # extension.js keeps a bar from getting shorter than its own round end.
    min_height = max(round(height * 0.25), bar)
    max_height = round(height * 0.85)

    cr.set_line_width(bar)
    cr.set_line_cap(cairo.LINE_CAP_ROUND)

    for i in range(N_BARS):
        turns = round(SPEEDS[i] * LOOP_S / (2 * math.pi))
        wave = (math.sin(2 * math.pi * turns * phase + PHASES[i]) + 1) / 2
        bar_height = min_height + (max_height - min_height) * wave
        bottom = (height + bar_height) / 2
        middle = i * (bar + gap) + bar / 2

        hue = i * HUE_SPREAD + phase
        cr.set_source_rgb(*hsv_to_rgb(hue, HUE_SATURATION, value))
        cr.move_to(middle, bottom - bar_height + bar / 2)
        cr.line_to(middle, bottom - bar / 2)
        cr.stroke()

    return surface


def to_image(surface):
    width, height = surface.get_width(), surface.get_height()
    image = Image.frombuffer(
        "RGBA", (width, height), bytes(surface.get_data()), "raw", "BGRa", 0, 1)
    return image.convert("RGB").resize(
        (width // SUPER, height // SUPER), Image.LANCZOS)


def main():
    check_the_source()
    DOCS.mkdir(exist_ok=True)

    for name, matte, value in THEMES:
        count = round(LOOP_S * FPS)
        frames = [
            to_image(draw(SHOWN * SUPER, n / count, value, matte))
            for n in range(count)
        ]

        # One palette for the whole file, or the colours crawl between frames,
        # and it is built from frames spread over the loop: a palette taken from
        # the first frame alone knows nothing of the half of the wheel that is
        # not on it yet, and every blue in the file would land on a green.
        spread = frames[::5]
        width, height = frames[0].size
        sheet = Image.new("RGB", (width, height * len(spread)))
        for i, frame in enumerate(spread):
            sheet.paste(frame, (0, i * height))
        base = sheet.quantize(colors=COLOURS, dither=Image.NONE)
        mapped = [
            frame.quantize(palette=base, dither=Image.NONE) for frame in frames
        ]

        out = DOCS / f"equalizer-rainbow-{name}.gif"
        mapped[0].save(
            out,
            save_all=True,
            append_images=mapped[1:],
            duration=round(1000 / FPS),
            loop=0,
            optimize=True,
        )
        print(f"wrote {out} ({out.stat().st_size // 1024} KiB, {count} frames)")


if __name__ == "__main__":
    main()
