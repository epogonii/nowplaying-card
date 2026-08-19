# Now Playing Card

![GNOME Shell 45 to 50](https://img.shields.io/badge/GNOME%20Shell-45%20to%2050-4a86cf)
![License GPL-2.0-or-later](https://img.shields.io/badge/license-GPL--2.0--or--later-blue)

A GNOME Shell extension that shows what is playing: an animated equalizer icon
in the top panel and a media card with cover art, a seekable progress bar and
transport controls for any MPRIS player.

Nothing to configure to get going, nothing to install beside it: the players
already on the session bus are the ones it shows.

## Requirements

GNOME Shell 45 or newer, on Wayland or X11. No other dependency; the tools in
`tools/` need `python3` and, for the nested runs, `gjs`.

## Features

- Works with every MPRIS player - Spotify, browsers, VLC, Rhythmbox, mpv with
  an MPRIS script - no matter how it is packaged (native, Flatpak, Snap).
- Cover art from the player's metadata, with the application icon as a
  fallback when the artwork lives inside a sandbox the shell cannot read.
- Seekable progress bar: drag it to jump, exact `SetPosition` where the player
  reports a track id, a relative `Seek` otherwise.
- Volume slider for players that carry a volume of their own.
- Shuffle and repeat where the player supports them; repeat cycles off,
  playlist, track.
- Skip buttons appear only when the player says it can skip.
- Long titles scroll sideways instead of being cut off, and a dimmed equalizer
  next to them shows the card that is playing.
- Click the cover to switch to the player's window - the window itself, so a
  Flatpak player is raised instead of started a second time.
- Several players share one popup as an accordion: the one that is playing is
  open, the rest are one-line rows, and clicking a row opens that one. The open
  row shows the player's icon on its cover. A row opened by hand stays open
  while its player keeps playing, closing the popup included.
- The playing player is kept at the top of the stack.
- Lives either in a panel button of its own or inside the Quick Settings menu.
  In panel mode the button can also carry the transport buttons and the track
  itself, answer the scroll wheel (tracks or volume) and the middle button -
  a track can be changed without opening anything.
- One popup width whatever the track is called, so nothing jumps between
  songs.
- The top-bar icon can be there always, only while a player is running, or
  never at all, in which case the card still opens from Quick Settings.
- Follows the system light and dark theme, and switches with it.
- Hides GNOME's own media controls in the notification list to avoid showing
  the same player twice; they come straight back when the extension is turned
  off or removed.

## Installation

From extensions.gnome.org, or by hand:

```sh
gnome-extensions pack --force --schema=schemas/org.gnome.shell.extensions.nowplaying.gschema.xml \
    --extra-source=stylesheet.css --extra-source=stylesheet-light.css \
    --extra-source=stylesheet-dark.css --extra-source=LICENSE
gnome-extensions install --force nowplaying@epogonii.github.io.shell-extension.zip
```

Log out and back in (X11: `Alt+F2`, `r`), then:

```sh
gnome-extensions enable nowplaying@epogonii.github.io
```

Preferences apply immediately; new code does not. A running shell imports an
extension's JavaScript once and keeps it for the life of the process, so after
editing the source either restart the shell (X11) or open a nested one with
`tools/nested/run-nested.sh` (works on both session types).

While hacking on the extension, install with `tools/install-local.sh` instead:
it renames every file into place rather than rewriting it. A shell that is
still running the previous copy keeps `schemas/gschemas.compiled` memory-mapped,
and overwriting those bytes underneath it leaves the process with a broken view
of the schema - the next settings read then aborts the session.

## Preferences

`gnome-extensions prefs nowplaying@epogonii.github.io`

| Setting | Meaning |
| --- | --- |
| Location | Own panel button, or embedded in Quick Settings |
| Panel area / Position | Where the button sits, panel mode only |
| Track in the panel | Nothing, title, or artist and title next to the icon |
| Text width | Longest the panel text may get, in pixels |
| Fixed text width | Keep that width even for a short track |
| Scrolling over the button | Nothing, switch tracks, or change volume |
| Controls in the panel | Previous, play and next next to the icon |
| Middle click | Nothing, play or pause, or next track |
| Card size | Accordion with several players, always full, or always compact |
| Cover size | Small, medium or large artwork in a full card |
| Show the progress bar | Position and length of the track |
| Show the volume slider | For players that carry a volume of their own |
| Show shuffle and repeat | For players that support them |
| Scroll long text | Move a title sideways instead of cutting it off |
| Animate the icon | Move the equalizer bars during playback |
| Animate button presses | Dip the icon of a control when it is pressed |
| Show in the top bar | Always, only while a player is running, or never |
| Playing player first | Keep the card that is playing at the top |
| Click the cover to switch to the player | Raise the player's window |
| Hide the built-in media controls | Keep GNOME's own player out of the notification list |
| Ignored players | Names, separated by commas, that get no card |

## Theme

`stylesheet.css` is the neutral base. GNOME Shell 47 and later load
`stylesheet-light.css` or `stylesheet-dark.css` instead and reload them when the
system switches between light and dark; both are generated from the base by
`tools/gen-stylesheets.py`, which only replaces the colours on lines marked
`/* np-var: NAME */`. Edit the base file and run the script - `install-local.sh`
runs it too. Older shells find no variant and use the base.

## Supported versions

GNOME Shell 45 to 50, on Wayland and on X11. Nothing here touches the display
server: windows are found through Mutter and raised through the shell.

## Development

`tools/nested/run-nested-three.sh` starts a nested headless GNOME Shell with
three MPRIS stub players - one naming a `.desktop` file, one with no
`DesktopEntry` at all, one with a window of its own - and a probe extension that
logs the card state, both seek paths, the layout and accordion switches, the
volume, repeat and shuffle writes, the panel text, wheel and middle click, the
stylesheet variant, and the built-in-media restore. It touches nothing in the
live session.

`tools/nested/run-nested.sh` opens a nested shell with your own session bus, so
the players already running show up in it.

Settings are read through `readSetting()`, which answers from the schema
defaults when the compiled schema has no such key, so a half-replaced install
can never take the shell down.

## License

GPL-2.0-or-later, see [LICENSE](LICENSE).
