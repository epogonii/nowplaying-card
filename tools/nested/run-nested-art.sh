#!/bin/bash
# Cover art from a web server that fails on purpose (artserver.py).
S="$(dirname "$(readlink -f "$0")")"
export XDG_CONFIG_HOME="$S/nested-home/config"
export XDG_DATA_HOME="$S/nested-home/data"
export XDG_CACHE_HOME="$S/nested-home/cache"
export G_MESSAGES_DEBUG=all
export NP_PROBE=art
SRC="$(dirname "$(dirname "$S")")"
EXT="$S/nested-home/data/gnome-shell/extensions/nowplaying@epogonii.github.io"
python3 "$SRC"/tools/gen-stylesheets.py
mkdir -p "$EXT"/schemas
cp "$SRC"/extension.js "$SRC"/metadata.json "$SRC"/prefs.js "$SRC"/spectrum.js "$SRC"/stylesheet*.css "$EXT"/
cp "$SRC"/schemas/*.gschema.xml "$EXT"/schemas/
glib-compile-schemas --strict "$EXT"/schemas

export NP_ART_HITS=$(mktemp)
python3 "$S"/artserver.py 18765 "$S"/nested-home >"$NP_ART_HITS" 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; rm -f "$NP_ART_HITS"' EXIT
trap 'exit 1' INT TERM
for _ in $(seq 50); do
  grep -q '^SERVER listening' "$NP_ART_HITS" && break
  kill -0 $SERVER 2>/dev/null || break
  sleep 0.1
done
if ! grep -q '^SERVER listening' "$NP_ART_HITS"; then
  echo "HARNESS art server did not start"
  cat "$NP_ART_HITS"
  exit 1
fi

dbus-run-session -- bash -c '
  S='"$S"'
  SD=$S/nested-home/data/gnome-shell/extensions/nowplaying@epogonii.github.io/schemas
  gsettings set org.gnome.shell enabled-extensions "[\"nowplaying@epogonii.github.io\",\"npprobe@test\"]"
  gsettings set org.gnome.shell disable-user-extensions false
  gsettings set org.gnome.shell disabled-extensions "[]"
  gsettings --schemadir $SD reset-recursively org.gnome.shell.extensions.nowplaying
  gsettings --schemadir $SD set org.gnome.shell.extensions.nowplaying location quick-settings
  gsettings --schemadir $SD set org.gnome.shell.extensions.nowplaying max-cards 10
  gnome-shell --wayland --no-x11 --headless --wayland-display=nptest --virtual-monitor 1280x720 &
  SHELL_PID=$!
  sleep 6
  U=http://127.0.0.1:18765
  gjs $S/mprisstub5.js httpwide none HttpWide no no Wide $U/wide.png no no no &
  A=$!
  gjs $S/mprisstub5.js httpflaky none HttpFlaky no no Flaky $U/flaky.png no no no &
  B=$!
  gjs $S/mprisstub5.js httphang none HttpHang no no Hang $U/hang.png no no no &
  C=$!
  gjs $S/mprisstub5.js httpdead none HttpDead no no Dead http://127.0.0.1:1/x.png no no no &
  D=$!
  gjs $S/mprisstub5.js httpgone none HttpGone no no Gone $U/gone.png no no no &
  E=$!
  ( for _ in $(seq 120); do
      grep -q " /gone.png hit 1" "$NP_ART_HITS" && break
      sleep 0.5
    done
    sleep 3
    echo "HARNESS killing httpgone"
    kill $E ) &
  gjs $S/mprisstub5.js httpswitch none HttpSwitch no no Switch "$U/wide.png?s=1" no no no \
      "6:$U/slowsquare.png,10:$U/missing.png,14:$U/wide.png?s=2" &
  F=$!
  sleep 84
  echo "HARNESS killing stubs"
  kill $A $B $C $D $E $F 2>/dev/null
  sleep 10
  echo "HARNESS done"
  kill $SHELL_PID 2>/dev/null
  wait 2>/dev/null
'

grep '^SERVER [0-9]' "$NP_ART_HITS"
for expect in /wide.png=1 /flaky.png=2 /hang.png=2 /gone.png=1 /missing.png=3 \
    /slowsquare.png=1 "/wide.png?s=1=1" "/wide.png?s=2=1"; do
  path=${expect%=*}
  echo "HARNESS hits $path=$(grep -cF " $path hit" "$NP_ART_HITS") (expect ${expect##*=})"
done
