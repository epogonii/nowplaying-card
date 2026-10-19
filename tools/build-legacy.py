#!/usr/bin/env python3
"""Build the extension for GNOME Shell 43 and 44 into build/gnome-43.

Those shells load extensions with the old imports.* system instead of ES
modules, so the sources are not kept twice: this rewrites the import lines of
extension.js and prefs.js into imports.* lookups, puts a small stand-in for
the Extension and ExtensionPreferences classes of GNOME 45 on top, and ends
each file with the init() and fillPreferencesWindow() the old loader calls.
Whatever differs between the shells at run time is handled in the sources
themselves, by asking for the feature rather than the version.

spectrum.js runs in a gjs process of its own with -m, which GJS 1.74 of
GNOME 43 already understands, so it is copied as it stands.

With --zip the result is also packed for extensions.gnome.org, next to the
zip of the current shells.
"""

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

SHELL_VERSIONS = ['43', '44']
OUT = Path('build') / 'gnome-43'
ZIP = 'nowplaying@epogonii.github.io.gnome-43.shell-extension.zip'

COPIED = [
    'spectrum.js', 'stylesheet.css', 'stylesheet-light.css',
    'stylesheet-dark.css', 'LICENSE',
    'icons/qr/bitcoin.svg', 'icons/qr/ethereum.svg', 'icons/qr/solana.svg',
    'schemas/org.gnome.shell.extensions.nowplaying.gschema.xml',
]

GI = re.compile(r"^import (\w+) from 'gi://(\w+)';$")
CAIRO = re.compile(r"^import (\w+) from 'cairo';$")
SHELL = re.compile(
    r"^import \* as (\w+) from 'resource:///org/gnome/shell/((?:ui|misc)/[\w/]+)\.js';$")
BASE = re.compile(r"^import \{(\w+), gettext as _\} from 'resource:///.*';$")
DEFAULT = re.compile(r'^export default class (\w+) extends (\w+) \{$')

# Both files start from the extension the old loader is running, found the way
# ExtensionUtils finds it: by who is asking.
PRELUDE = '''\
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const _domain = Me.metadata['gettext-domain'] ?? Me.metadata.uuid;
ExtensionUtils.initTranslations(_domain);
const _ = imports.gettext.domain(_domain).gettext;

// What the base class of GNOME 45 gives the code.
class {base} {{
    constructor() {{
        this.metadata = Me.metadata;
        this.uuid = Me.uuid;
        this.path = Me.path;
        this.dir = Me.dir;
    }}

    getSettings() {{
        return ExtensionUtils.getSettings();
    }}

    openPreferences() {{
        ExtensionUtils.openPrefs();
    }}
}}
'''

EXTENSION_TAIL = '''
function init() {{
    return new {cls}();
}}
'''

PREFS_TAIL = '''
function init() {{
}}

function fillPreferencesWindow(window) {{
    new {cls}().fillPreferencesWindow(window);
}}
'''


def convert(source, tail):
    lines = []
    base = cls = None
    for line in source.splitlines():
        if m := GI.match(line):
            line = f'const {m[1]} = imports.gi.{m[2]};'
        elif m := CAIRO.match(line):
            line = f'const {m[1]} = imports.cairo;'
        elif m := SHELL.match(line):
            line = f"const {m[1]} = imports.{m[2].replace('/', '.')};"
        elif m := BASE.match(line):
            base = m[1]
            line = PRELUDE.format(base=base)
        elif m := DEFAULT.match(line):
            cls = m[1]
            line = f'class {cls} extends {m[2]} {{'
        elif line.startswith(('import ', 'export ')):
            sys.exit(f'build-legacy: no rule for: {line}')
        lines.append(line)

    if base is None or cls is None:
        sys.exit('build-legacy: no base class or no default export')

    text = '\n'.join(lines) + '\n' + tail.format(cls=cls)
    # The file the code sits in, which the old loader has no import.meta for.
    return text.replace('import.meta.url',
                        "Me.dir.get_child('extension.js').get_uri()")


def main():
    root = Path(__file__).resolve().parent.parent
    out = root / OUT
    shutil.rmtree(out, ignore_errors=True)
    (out / 'schemas').mkdir(parents=True)
    (out / 'icons' / 'qr').mkdir(parents=True)

    subprocess.run([sys.executable, root / 'tools' / 'gen-stylesheets.py'],
                   check=True)

    for name, tail in (('extension.js', EXTENSION_TAIL),
                       ('prefs.js', PREFS_TAIL)):
        source = (root / name).read_text(encoding='utf-8')
        (out / name).write_text(convert(source, tail), encoding='utf-8')

    for name in COPIED:
        shutil.copy2(root / name, out / name)

    metadata = json.loads((root / 'metadata.json').read_text(encoding='utf-8'))
    metadata['shell-version'] = SHELL_VERSIONS
    (out / 'metadata.json').write_text(
        json.dumps(metadata, indent=2, ensure_ascii=False) + '\n',
        encoding='utf-8')

    subprocess.run(['glib-compile-schemas', '--strict', out / 'schemas'],
                   check=True)

    if '--zip' in sys.argv[1:]:
        zip_path = root / ZIP
        zip_path.unlink(missing_ok=True)
        # Compiled schema included: before GNOME 44 nothing compiles it on
        # install.
        subprocess.run(['zip', '-qr', zip_path, '.'], cwd=out, check=True)
        print(f'packed {zip_path.name}')

    print(f'built {OUT}')


if __name__ == '__main__':
    main()
