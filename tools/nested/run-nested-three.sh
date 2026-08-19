#!/bin/bash
S="$(dirname "$(readlink -f "$0")")"
export XDG_CONFIG_HOME="$S/nested-home/config"
export XDG_DATA_HOME="$S/nested-home/data"
export XDG_CACHE_HOME="$S/nested-home/cache"
export G_MESSAGES_DEBUG=all
SRC="$(dirname "$(dirname "$S")")"
# NP_SCALE=2 runs the session at 200% on a monitor twice as wide, so the shell
# has the same room in logical pixels as an unscaled run.
export NP_SCALE="${NP_SCALE:-1}"
export NP_MONITOR=$(python3 -c "s=float('$NP_SCALE');print(f'{round(1280*s)}x{round(720*s)}')")
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
  # A shell that was asked to turn the extension off writes the uuid into
  # disabled-extensions, and that list wins over the one above for every run
  # after it. The stand starts from a clean pair.
  gsettings set org.gnome.shell disabled-extensions "[]"
  gsettings --schemadir $SD reset-recursively org.gnome.shell.extensions.nowplaying
  gsettings --schemadir $SD set org.gnome.shell.extensions.nowplaying location quick-settings
  gnome-shell --wayland --no-x11 --headless --wayland-display=nptest --virtual-monitor $NP_MONITOR &
  SHELL_PID=$!
  sleep 6
  # A scaled run leaves the same 1280x720 of room in logical pixels, so every
  # expectation about the layout still holds and only the scale factor moves.
  if [ "$NP_SCALE" != 1 ]; then
    gjs $S/set-scale.js $NP_SCALE || echo "HARNESS scale failed"
    sleep 3
  fi
  # flatpak-style: names a .desktop file, so the app icon can badge the cover.
  # Its artwork is written after the track is announced, the way Firefox and
  # Chrome do it, so the card has to come back for the picture on its own.
  LATE_ART=$S/nested-home/cache/np-late-cover.png
  mkdir -p $(dirname $LATE_ART)
  rm -f $LATE_ART
  gjs $S/mprisstub5.js spotify spotify Spotify yes yes \
      "Scott Street From The Album Stranger In The Alps Deluxe Edition" \
      file://$LATE_ART no yes yes &
  A=$!
  ( sleep 2; cp $S/nested-home/np-cover-wide.png $LATE_ART ) &
  # chrome-style: no DesktopEntry at all, no artwork, cannot skip tracks
  gjs $S/mprisstub5.js chromium.instance7 none Chrome no no "White Noise" none no no no &
  B=$!
  # a player with a window of its own, found through the window tracker
  # telegram-style artwork: the picture itself inline, as a data: URI
  INLINE_ART="data:image/png;base64,$(base64 -w0 $S/nested-home/np-art-square.png)"
  WAYLAND_DISPLAY=nptest gjs $S/mprisstub5.js windowed none "Nothing Like This" \
      yes no "Windowed Track" "$INLINE_ART" yes no no &
  C=$!
  sleep 84
  echo "HARNESS killing stubs"
  kill $A $B $C 2>/dev/null
  sleep 14
  echo "HARNESS done"
  kill $SHELL_PID 2>/dev/null
  wait 2>/dev/null
'
