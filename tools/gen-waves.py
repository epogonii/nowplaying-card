#!/usr/bin/env python3
"""Draws the waves and the ribbon for the README: the 16px panel icon at eight
times the size, with the numbers read from extension.js and a made-up sound
that loops over three turns of the drift.
"""

import colorsys
import json
import math
import re
from pathlib import Path

import cairo
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"

SHOWN = 8
COLUMNS = 16
BANDS = 32
FPS = 30
LOOPS = 3
BPM = 120
COLOURS = 32

# GitHub's two canvases, and which of the extension's inks each one gets.
THEMES = (("dark", (0x0d, 0x11, 0x17), 0), ("light", (0xff, 0xff, 0xff), 1))


def read_source():
    source = (ROOT / "extension.js").read_text()

    def number(name):
        return float(re.search(rf"^const {name} = ([\d.]+);", source, re.M).group(1))

    def array(name):
        body = re.search(rf"^const {name} = (\[.*?\n\]);", source, re.M | re.S).group(1)
        return json.loads(re.sub(r",(\s*\])", r"\1", body))

    return {
        "waves": array("WAVES"),
        "inks": array("WAVE_INKS"),
        "loop": number("WAVE_LOOP_S"),
        "rise": number("WAVE_RISE_S"),
        "fall": number("FALL"),
        "hold": number("PEAK_HOLD_MS") / 1000,
        "peak_fall": number("PEAK_FALL"),
        "pitch": number("COLUMN_WIDTH") + number("COLUMN_GAP"),
        "gap": number("COLUMN_GAP"),
        "ribbon": [number(f"RIBBON_{name}") for name in ("REST", "REACH", "PINCH", "SWAY")],
        "alphas": json.loads(re.search(r"^const RIBBON_ALPHAS = (\[.*\]);", source, re.M).group(1)),
        "hue": number("HUE_STATIC"),
        "saturation": number("HUE_SATURATION"),
    }


def bands_at(t, length):
    """A kick, a snare on two and four, hats in between and a slow tune."""
    beats = round(length * BPM / 60)
    beat, into = divmod(t * beats / length, 1)
    out = []
    for band in range(BANDS):
        pos = band / (BANDS - 1)
        kick = max(0, 1 - pos * 4) * math.exp(-into * 5)
        snare = (math.exp(-((pos - 0.4) / 0.15) ** 2) * math.exp(-into * 6)
                 if beat % 2 == 1 else 0)
        hat = max(0, pos - 0.55) * 1.6 * math.exp(-abs(into - 0.5) * 12)
        tune = 0.45 * math.exp(-((pos - 0.3 - 0.25 * math.sin(2 * math.pi * t / length)) / 0.12) ** 2)
        shimmer = 0.08 * (1 + math.sin(2 * math.pi * (7 * t / length + band * 0.37))) / 2
        out.append(min(1, kick + snare * 0.8 + hat + tune + shimmer))
    return out


def play(src, length, rise):
    """The levels, peaks and drift of every frame, after one loop to settle."""
    count = round(length * FPS)
    dt = 1 / FPS
    levels = [0.0] * COLUMNS
    peaks = [0.0] * COLUMNS
    held = [0.0] * COLUMNS
    drift = 0.0
    frames = []
    for n in range(2 * count):
        t = (n % count) / FPS
        bands = bands_at(t, length)
        drift = (drift + dt) % src["loop"]
        for i in range(COLUMNS):
            a, b = i * BANDS // COLUMNS, (i + 1) * BANDS // COLUMNS
            level = max(bands[a:b])
            if level > levels[i]:
                levels[i] += (level - levels[i]) * (min(1, dt / rise) if rise else 1)
            else:
                levels[i] = max(level, levels[i] - src["fall"] * dt)
            if levels[i] >= peaks[i]:
                peaks[i], held[i] = levels[i], 0
            else:
                held[i] += dt
                if held[i] > src["hold"]:
                    peaks[i] = max(levels[i], peaks[i] - src["peak_fall"] * dt)
        if n >= count:
            frames.append((list(levels), list(peaks), drift))
    return frames


def paint(cr, src, width, height, levels, peaks, drift, inks):
    """_repaintWaves in extension.js, moving and with peak markers on."""
    pitch = width / COLUMNS
    for k, (rest, swell, humps, start, reach, turns) in enumerate(src["waves"]):
        shift = -2 * math.pi * turns * drift / src["loop"]

        def y(x, i):
            level, peak = min(levels[i], 1), min(peaks[i], 1)
            lift = (peak, (level + peak) / 2, level)[k]
            return height * (1 - min(1, rest + reach * lift +
                                     swell * math.sin(math.pi * humps * x / height + start + shift)))

        cr.move_to(0, height)
        curve_through(cr, points_of(width, y))
        cr.line_to(width, height)
        cr.close_path()
        cr.set_source_rgb(*inks[k])
        cr.fill()


def points_of(width, y):
    pitch = width / COLUMNS
    points = [(0, y(0, 0))]
    points += [((i + 0.5) * pitch, y((i + 0.5) * pitch, i)) for i in range(COLUMNS)]
    points.append((width, y(width, COLUMNS - 1)))
    return points


def curve_through(cr, points):
    cr.line_to(*points[0])
    for j in range(len(points) - 1):
        x0, y0 = points[max(j - 1, 0)]
        x1, y1 = points[j]
        x2, y2 = points[j + 1]
        x3, y3 = points[min(j + 2, len(points) - 1)]
        cr.curve_to(x1 + (x2 - x0) / 6, y1 + (y2 - y0) / 6,
                    x2 - (x3 - x1) / 6, y2 - (y3 - y1) / 6, x2, y2)


def paint_ribbon(cr, src, width, height, levels, peaks, drift, value):
    """_repaintRibbon in extension.js, in the rainbow and with peak markers on."""
    rest_scale, reach_scale, pinch, sway = src["ribbon"]
    middle = height / 2
    ink = cairo.LinearGradient(0, 0, width, 0)
    for n in range(9):
        ink.add_color_stop_rgb(n / 8, *colorsys.hsv_to_rgb((src["hue"] + n / 8) % 1,
                                                          src["saturation"], value))

    def narrow(x):
        return max(0, math.sin(math.pi * x / width)) ** 0.9

    for k, (rest, _, humps, start, reach, turns) in enumerate(src["waves"]):
        shift = -2 * math.pi * turns * drift / src["loop"]

        def lift(i):
            def one(c):
                level, peak = min(levels[c], 1), min(peaks[c], 1)
                return (peak, (level + peak) / 2, level)[k]
            far = abs(2 * i + 1 - COLUMNS)
            return max(one(max(far - 1, 0)), one(min(far, COLUMNS - 1)))

        def half(x, i):
            lobe = abs(math.sin(math.pi * humps * x / height + start + shift))
            return middle * narrow(x) * min(1, rest_scale * rest * (pinch + (1 - pinch) * lobe ** 1.3) +
                                            reach_scale * reach * lift(i) * (sway + (1 - sway) * lobe))

        top = points_of(width, lambda x, i: middle - half(x, i))
        cr.save()
        cr.move_to(*top[0])
        curve_through(cr, top)
        curve_through(cr, [(x, height - y) for x, y in reversed(top)])
        cr.close_path()
        cr.clip()
        cr.set_source(ink)
        cr.paint_with_alpha(src["alphas"][k])
        cr.restore()

    fade = cairo.LinearGradient(0, 0, width, 0)
    for n in range(9):
        fade.add_color_stop_rgba(n / 8, 0, 0, 0, narrow(n * width / 8))
    cr.save()
    cr.rectangle(0, middle - height / 32, width, height / 16)
    cr.clip()
    cr.set_source(ink)
    cr.mask(fade)
    cr.restore()


def save_gif(images, out, colours):
    # One palette for every frame, taken from a spread of them, or the
    # edges of the hills would shimmer.
    width, height = images[0].size
    sample = Image.new("RGB", (width, height * 8))
    for k in range(8):
        sample.paste(images[k * len(images) // 8], (0, k * height))
    palette = sample.quantize(colors=colours, dither=Image.NONE)
    quantized = [im.quantize(palette=palette, dither=Image.NONE) for im in images]

    # GIF counts in hundredths, so 30 a second goes as 3, 3 and 4 of them.
    durations = [40 if n % 3 == 2 else 30 for n in range(len(quantized))]
    quantized[0].save(out, save_all=True, append_images=quantized[1:],
                      duration=durations, loop=0, disposal=1, optimize=True)
    print(f"wrote {out}")


def main():
    src = read_source()
    length = src["loop"] * LOOPS

    width = round((COLUMNS * src["pitch"] - src["gap"]) * SHOWN)
    height = 16 * SHOWN
    shapes = (
        ("waves", play(src, length, src["rise"]), COLOURS,
         lambda cr, frame, ink: paint(cr, src, width, height, *frame, src["inks"][ink])),
        # The ribbon jumps with the sound the way the columns do, and its
        # rainbow is drawn brighter on a dark canvas.
        ("ribbon", play(src, length, 0), 256,
         lambda cr, frame, ink: paint_ribbon(cr, src, width, height, *frame, 1 if ink == 0 else 0.8)),
    )

    for shape, frames, colours, draw in shapes:
        for name, matte, ink in THEMES:
            images = []
            for frame in frames:
                surface = cairo.ImageSurface(cairo.FORMAT_RGB24, width, height)
                cr = cairo.Context(surface)
                cr.set_source_rgb(*[c / 255 for c in matte])
                cr.paint()
                draw(cr, frame, ink)
                images.append(Image.frombuffer("RGBA", (width, height), bytes(surface.get_data()),
                                               "raw", "BGRA", 0, 1).convert("RGB"))
            save_gif(images, DOCS / f"{shape}-{name}.gif", colours)


if __name__ == "__main__":
    main()
