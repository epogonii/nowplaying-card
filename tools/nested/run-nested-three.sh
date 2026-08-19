#!/bin/bash
S="$(dirname "$(readlink -f "$0")")"
export XDG_CONFIG_HOME="$S/nested-home/config"
export XDG_DATA_HOME="$S/nested-home/data"
export XDG_CACHE_HOME="$S/nested-home/cache"
export G_MESSAGES_DEBUG=all
SRC="$(dirname "$(dirname "$S")")"
EXT="$S/nested-home/data/gnome-shell/extensions/nowplaying@epogonii.github.io"
python3 "$SRC"/tools/gen-stylesheets.py
mkdir -p "$EXT"/schemas
cp "$SRC"/extension.js "$SRC"/metadata.json "$SRC"/prefs.js "$SRC"/stylesheet*.css "$EXT"/
cp "$SRC"/schemas/*.gschema.xml "$EXT"/schemas/
# Compile here: a stale gschemas.compiled in the source tree would hide
# every key added since it was built.
glib-compile-schemas --strict "$EXT"/schemas
dbus-run-session -- bash -c '
  S='"$S"'
  SD=$S/nested-home/data/gnome-shell/extensions/nowplaying@epogonii.github.io/schemas
  gsettings set org.gnome.shell enabled-extensions "[\"nowplaying@epogonii.github.io\",\"npprobe@test\"]"
  gsettings set org.gnome.shell disable-user-extensions false
  gsettings --schemadir $SD reset-recursively org.gnome.shell.extensions.nowplaying
  gsettings --schemadir $SD set org.gnome.shell.extensions.nowplaying location quick-settings
  gnome-shell --wayland --no-x11 --headless --wayland-display=nptest --virtual-monitor 1280x720 &
  SHELL_PID=$!
  sleep 6
  # flatpak-style: names a .desktop file, so the app icon can badge the cover
  gjs $S/mprisstub5.js spotify spotify Spotify yes yes \
      "Scott Street From The Album Stranger In The Alps Deluxe Edition" \
      file://$S/nested-home/np-cover.png no yes yes &
  A=$!
  # chrome-style: no DesktopEntry at all, no artwork, cannot skip tracks
  gjs $S/mprisstub5.js chromium.instance7 none Chrome no no "White Noise" none no no no &
  B=$!
  # a player with a window of its own, found through the window tracker
  WAYLAND_DISPLAY=nptest gjs $S/mprisstub5.js windowed none "Nothing Like This" \
      yes no "Windowed Track" file://$S/nested-home/np-cover.png yes no no &
  C=$!
  sleep 84
  echo "HARNESS killing stubs"
  kill $A $B $C 2>/dev/null
  sleep 14
  echo "HARNESS done"
  kill $SHELL_PID 2>/dev/null
  wait 2>/dev/null
'
