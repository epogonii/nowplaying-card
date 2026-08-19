#!/bin/bash
# Installs the extension into the live session. Every file lands under a
# temporary name first and is then renamed into place: a rename swaps the inode
# instead of rewriting bytes, so a shell that is running the old copy - and has
# schemas/gschemas.compiled memory-mapped - keeps a consistent view until it is
# restarted. Overwriting those bytes in place corrupts that view, and a lookup
# that then fails aborts the whole session.
set -euo pipefail

uuid=nowplaying@epogonii.github.io
src=$(cd "$(dirname "$0")/.." && pwd)
dst=${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$uuid

mkdir -p "$dst/schemas"

install_file() {
    local from=$1 to=$2
    cp "$from" "$to.tmp"
    mv -f "$to.tmp" "$to"
}

python3 "$src/tools/gen-stylesheets.py"

for f in metadata.json extension.js prefs.js stylesheet.css \
         stylesheet-light.css stylesheet-dark.css; do
    install_file "$src/$f" "$dst/$f"
done
install_file "$src/schemas/org.gnome.shell.extensions.nowplaying.gschema.xml" \
    "$dst/schemas/org.gnome.shell.extensions.nowplaying.gschema.xml"

glib-compile-schemas --targetdir "$src/schemas" "$src/schemas"
install_file "$src/schemas/gschemas.compiled" "$dst/schemas/gschemas.compiled"

echo "installed to $dst"
echo "log out and back in - a running shell keeps the old code in memory"
