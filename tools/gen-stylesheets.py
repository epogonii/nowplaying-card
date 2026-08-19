#!/usr/bin/env python3
"""Write the light and dark variants of stylesheet.css.

GNOME Shell 47 and later load stylesheet-light.css or stylesheet-dark.css
instead of stylesheet.css, and reload them whenever the system switches
between light and dark. A variant replaces the base file rather than adding to
it, so both are generated in full from the base: the only differences are the
colours on lines marked with a /* np-var: NAME */ comment. Older shells find no
variant and keep the neutral base.
"""

import re
import sys
from pathlib import Path

VARIANTS = {
    'dark': {
        'fill': 'rgba(255, 255, 255, 0.08)',
        'hover': 'rgba(255, 255, 255, 0.14)',
        'ring': 'rgba(255, 255, 255, 0.45)',
    },
    'light': {
        'fill': 'rgba(0, 0, 0, 0.06)',
        'hover': 'rgba(0, 0, 0, 0.10)',
        'ring': 'rgba(0, 0, 0, 0.35)',
    },
}

MARKER = re.compile(r'/\* np-var: (\w+) \*/')
COLOR = re.compile(r'rgba\([^)]*\)')


def main():
    root = Path(__file__).resolve().parent.parent
    base = (root / 'stylesheet.css').read_text(encoding='utf-8')

    names = set(MARKER.findall(base))
    if not names:
        sys.exit('stylesheet.css carries no np-var markers')

    for variant, colors in VARIANTS.items():
        missing = names - colors.keys()
        if missing:
            sys.exit(f'{variant}: no colour for {sorted(missing)}')

        lines = []
        for line in base.splitlines():
            marker = MARKER.search(line)
            if marker:
                line = COLOR.sub(colors[marker.group(1)], line, count=1)
            lines.append(line)

        out = root / f'stylesheet-{variant}.css'
        header = (f'/* Generated from stylesheet.css by tools/gen-stylesheets.py.\n'
                  f'   Edit the base file, then run the script. */\n\n')
        out.write_text(header + '\n'.join(lines) + '\n', encoding='utf-8')
        print(f'wrote {out.name}')


main()
