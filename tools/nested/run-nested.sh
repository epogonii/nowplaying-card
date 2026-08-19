#!/bin/bash
# Opens GNOME Shell in a window of its own with the current source installed.
# A running shell imports an extension's JavaScript once and keeps it for as
# long as the process lives, so code changes never reach the session that is
# already up; a nested shell is a new process, and it shares the session bus,
# so the players already running show up inside it.
set -euo pipefail

src=$(cd "$(dirname "$0")/../.." && pwd)
"$src/tools/install-local.sh"

export MUTTER_DEBUG_DUMMY_MODE_SPECS=${NESTED_SIZE:-1600x900}
exec gnome-shell --nested --wayland
