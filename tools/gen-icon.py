#!/usr/bin/env python3
"""Draws the icon: the README artwork and the animated version of it. The About
page of the preferences draws the same hills itself, from the same numbers.

Three layers of hills in fog, the sound drawn as a landscape. In motion each
layer drifts at its own speed, and swells run slowly along the crests like
peaks across the spectrum in the card, each layer to its own part of a made-up
slow beat: the kick at the back, the snare in the middle, the tune in front.
Speeds and beats come in whole turns of the loop so the animation repeats
without a jump.
"""

import math
from pathlib import Path

import cairo
from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"

# Drawn large and scaled down, so every rounded end and every corner is smooth.
RENDER = 512
ICON = 256
# Shown at 128 in the README, drawn at twice that for sharp screens.
FRAME = 256

CORNER = 0.22

GRAPHITE = (0.14, 0.14, 0.15)
# A hairline inside the edge, so the dark tile keeps its shape on a dark panel.
RIM = 0.0078
RIM_ALPHA = 0.20

# Back to front: colour, opacity, where the hill sits, how tall it swells, how
# many humps across the tile, and where along them it starts.
HILLS = (
    ((0.42, 0.42, 0.43), 0.55, 0.488, 0.117, 0.7, 0),
    ((0.68, 0.68, 0.67), 0.75, 0.625, 0.090, 0.95, 1),
    ((0.89, 0.88, 0.85), 0.95, 0.762, 0.066, 1.2, 2),
)
STEP = 0.008

# Fog settling into the dip in front of each far hill, so they sink back.
HAZE = (0.68, 0.68, 0.67)
HAZE_ALPHA = 0.16
HAZE_DEPTH = 0.12

# The animation lays the same grain over every frame, so it stays put and does
# not flicker.
GRAIN = 0.15

# One turn of the loop, and how many of those turns each hill makes in it. The
# near ones go faster, the way they would from a moving train.
LOOP_S = 9
TURNS = (1, 2, 3)
FPS = 20

# The beat: 40 a minute, a kick on every one, a snare on two and four, the
# tune in between.
BEATS = 6
# A beat swells up over this much of itself and then dies away, smooth at both
# ends: a hit that lands in one frame reads as a jolt.
RISE = 0.3
# How far a swell lifts its hill, back to front; how wide it is across the
# tile; how many go along each crest and how many times a loop they cross it.
REACT = (0.06, 0.06, 0.065)
SWELL_WIDTH = 0.2
SWELLS = 2
CROSSINGS = (1, 1, 2)

QUALITY = 88


def rounded_rect(cr, x, y, width, height, radius):
    cr.new_sub_path()
    cr.arc(x + width - radius, y + radius, radius, -math.pi / 2, 0)
    cr.arc(x + width - radius, y + height - radius, radius, 0, math.pi / 2)
    cr.arc(x + radius, y + height - radius, radius, math.pi / 2, math.pi)
    cr.arc(x + radius, y + radius, radius, math.pi, 3 * math.pi / 2)
    cr.close_path()


def lift(k, t, x):
    """How high the swells on hill k stand over x, as a smooth curve."""
    total = 0
    for j in range(SWELLS):
        centre = (j / SWELLS + k * 0.3 + CROSSINGS[k] * t) % 1
        gap = abs(x - centre)
        gap = min(gap, 1 - gap)
        total += math.exp(-(gap / SWELL_WIDTH) ** 2)
    return total


def paint(cr, size, shifts, beat=None):
    rounded_rect(cr, 0, 0, size, size, size * CORNER)
    cr.set_source_rgb(*GRAPHITE)
    cr.fill_preserve()
    cr.save()
    cr.clip()

    step = size * STEP
    for k, ((colour, alpha, base, swell, humps, start), shift) in enumerate(zip(HILLS, shifts)):
        crest = []
        x = 0
        while x <= size + step:
            angle = x / size * math.pi * humps * 2 + start + shift
            y = base - swell * math.sin(angle)
            if beat:
                t, louds = beat
                y -= REACT[k] * louds[k] * lift(k, t, min(x / size, 1))
            crest.append((x, size * y))
            x += step

        cr.move_to(0, size)
        for point in crest:
            cr.line_to(*point)
        cr.line_to(size, size)
        cr.close_path()
        cr.set_source_rgba(*colour, alpha)
        cr.fill_preserve()

        if k < len(HILLS) - 1:
            top = size * (base - swell)
            fog = cairo.LinearGradient(0, top, 0, top + size * (2 * swell + HAZE_DEPTH))
            fog.add_color_stop_rgba(0, *HAZE, 0)
            fog.add_color_stop_rgba(1, *HAZE, HAZE_ALPHA)
            cr.set_source(fog)
            cr.fill()
        else:
            cr.new_path()
    cr.restore()

    inset = size * RIM / 2
    rounded_rect(cr, inset, inset, size - 2 * inset, size - 2 * inset,
                 size * CORNER - inset)
    cr.set_line_width(size * RIM)
    cr.set_source_rgba(1, 1, 1, RIM_ALPHA)
    cr.stroke()


def swell(into):
    """Eases up from nothing to its top at RISE into the beat, then dies away."""
    x = into / RISE
    return x * x * math.exp(2 * (1 - x))


def music(count):
    """How loud each hill plays in every frame of the loop."""
    per_beat = count / BEATS
    out = []
    for n in range(count):
        beat, into = divmod(n / per_beat, 1)
        kick = swell(into)
        snare = swell(into) if beat % 2 == 1 else 0
        tune = math.exp(-((into - 0.5) * 4) ** 2)
        out.append((0.15 + 0.85 * kick, 0.15 + 0.85 * snare, 0.2 + 0.8 * tune))
    return out


def draw(size, shifts, beat=None):
    surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, size, size)
    paint(cairo.Context(surface), size, shifts, beat)
    return surface


def grain(image, noise=None):
    noise = noise or Image.effect_noise(image.size, 60).convert("RGB")
    rgb = image.convert("RGB")
    grained = Image.blend(rgb, ImageChops.overlay(rgb, noise), GRAIN)
    grained.putalpha(image.getchannel("A"))
    return grained


def to_image(surface, size):
    width = surface.get_width()
    data = bytes(surface.get_data())
    image = Image.frombuffer("RGBA", (width, width), data, "raw", "BGRa", 0, 1)
    return image.resize((size, size), Image.LANCZOS)


def main():
    DOCS.mkdir(exist_ok=True)

    still = (0,) * len(HILLS)
    grain(to_image(draw(RENDER, still), ICON)).save(DOCS / "icon.png")

    frames = []
    noise = Image.effect_noise((FRAME, FRAME), 60).convert("RGB")
    count = round(LOOP_S * FPS)
    song = music(count)
    for n in range(count):
        t = n / count
        shifts = [-2 * math.pi * turns * t for turns in TURNS]
        frames.append(grain(to_image(draw(RENDER, shifts, (t, song[n])), FRAME), noise))

    # WebP rather than GIF: full colour, so the grain and the fog keep their
    # tones instead of banding into a palette, and a far smaller file.
    frames[0].save(
        DOCS / "equalizer.webp",
        save_all=True,
        append_images=frames[1:],
        duration=round(1000 / FPS),
        loop=0,
        quality=QUALITY,
        method=6,
    )

    print(f"wrote {DOCS / 'icon.png'} and {DOCS / 'equalizer.webp'}")


if __name__ == "__main__":
    main()
