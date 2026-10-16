#!/usr/bin/env python3
"""Draws the waves spectrum for the README: the 16px panel icon at eight times
the size, with the numbers read from extension.js and a made-up sound that
loops over three turns of the drift.
"""

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


def play(src, length):
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
                levels[i] += (level - levels[i]) * min(1, dt / src["rise"])
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

        points = [(0, y(0, 0))]
        points += [((i + 0.5) * pitch, y((i + 0.5) * pitch, i)) for i in range(COLUMNS)]
        points.append((width, y(width, COLUMNS - 1)))

        cr.move_to(0, height)
        cr.line_to(*points[0])
        for j in range(len(points) - 1):
            x0, y0 = points[max(j - 1, 0)]
            x1, y1 = points[j]
            x2, y2 = points[j + 1]
            x3, y3 = points[min(j + 2, len(points) - 1)]
            cr.curve_to(x1 + (x2 - x0) / 6, y1 + (y2 - y0) / 6,
                        x2 - (x3 - x1) / 6, y2 - (y3 - y1) / 6, x2, y2)
        cr.line_to(width, height)
        cr.close_path()
        cr.set_source_rgb(*inks[k])
        cr.fill()


def main():
    src = read_source()
    length = src["loop"] * LOOPS

    width = round((COLUMNS * src["pitch"] - src["gap"]) * SHOWN)
    height = 16 * SHOWN
    frames = play(src, length)

    for name, matte, ink in THEMES:
        images = []
        for levels, peaks, drift in frames:
            surface = cairo.ImageSurface(cairo.FORMAT_RGB24, width, height)
            cr = cairo.Context(surface)
            cr.set_source_rgb(*[c / 255 for c in matte])
            cr.paint()
            paint(cr, src, width, height, levels, peaks, drift, src["inks"][ink])
            image = Image.frombuffer("RGBA", (width, height), bytes(surface.get_data()),
                                     "raw", "BGRA", 0, 1).convert("RGB")
            images.append(image)

        # One palette for every frame, taken from a spread of them, or the
        # edges of the hills would shimmer.
        sample = Image.new("RGB", (width, height * 8))
        for k in range(8):
            sample.paste(images[k * len(images) // 8], (0, k * height))
        palette = sample.quantize(colors=COLOURS, dither=Image.NONE)
        quantized = [im.quantize(palette=palette, dither=Image.NONE) for im in images]

        out = DOCS / f"waves-{name}.gif"
        # GIF counts in hundredths, so 30 a second goes as 3, 3 and 4 of them.
        durations = [40 if n % 3 == 2 else 30 for n in range(len(quantized))]
        quantized[0].save(out, save_all=True, append_images=quantized[1:],
                          duration=durations, loop=0, disposal=1, optimize=True)
        print(f"wrote {out}")


if __name__ == "__main__":
    main()
