# Changelog

## 1.0.5

- The spectrum helper removes its timeout, stdin watch and bus handlers
  before it exits, as the extensions.gnome.org review asked.

## 1.0.4

- New switch on the Panel page, Icon in the panel. Turn it off and the button
  shows only the track, handy next to another visualiser extension. The icon
  stays when there is no text.
- The panel button has a right-click menu: Always Show in Top Bar, Show When
  Active and Don't Show in Top Bar, and Settings to open the preferences. The
  Menu key and Shift+F10 open it too. Don't Show in Top Bar hides the button
  and the menu with it; the preferences bring it back. The same choice on the
  Panel page is called Visibility now and uses the same three names.
- A spectrum analyzer: columns that move with the sound itself, lowest notes
  on the left, instead of bars that only pretend. A switch in its own group on
  the Card page puts it in the top bar in place of the bars, and turning it off
  brings the bars back in the style they had. The same group picks the shape
  (segments, solid, or mirrored around the middle), the colours (the theme
  colour, red at the top, green to red, or a rainbow), eight to thirty-two
  columns, peak markers that hold for a moment, and the track next to the
  spectrum while it is on, whatever the Panel page says, with the spectrum
  kept beside it. The bars on the card follow the sound as well. A small
  helper listens to the default output through GStreamer's PulseAudio plugin,
  only while the icon is on screen and moving; without the plugin the icon
  goes back to pretending. Before GNOME 50.2 the microphone indicator shows
  while it listens.

## 1.0.3

- GNOME Shell 51 is back on the supported list, now that it is out. The card
  needed nothing for it: the quick settings menu's `open()` and `close()` take
  an options object there, and the card closes the menu with no arguments, and
  which of the two spellings of a box's axis to use has been read off the shell
  version since 48.
- The nested test stand runs on 51 as well. `Clutter.get_default_backend()` is
  gone there, so the probe's virtual pointer takes the backend off the stage's
  context when the old call is not around.

## 1.0.2

- The volume slider and the shuffle and repeat buttons start out hidden. Both
  only ever appear for players that carry them, and a card without them reads
  better on a fresh install; the preferences turn them back on.
- The card in its own popup is one em wider. A card showing the volume row and
  the loop buttons needed more width than 23em left it, and the few pixels it
  overran by put the equalizer in the top right corner on the card's rounded
  edge.

## 1.0.1

- The preferences come in three pages — Card, Panel and Players — rather than
  one long scroll, and two combo entries got shorter names so they fit.
- A track with no artist and no album leaves the second line out instead of
  repeating the player's name, which the icon beside the cover already says.
- The panel icon stays centred inside the plate drawn around it when a crowded
  top bar hands the button less room than it asked for.
- Disable leaves nothing behind: the equalizer and the card stack go down with
  the model, both animations drop their frame handler when they stop, and the
  card's geometry handlers go with the card.
- The extensions.gnome.org page carries a Donate button, from the donation
  links in `metadata.json`.
- GNOME 51 is off the supported list until it is out.

## 1.0

First release.

- Animated equalizer in the top bar, or an entry in Quick Settings.
- Media card with cover art, a seekable progress bar and transport controls
  for any MPRIS player.
- Several players stack up as an accordion; the row you open by hand stays
  open while that player is playing.
- Transport buttons in the panel, plus wheel and middle-click actions.
- Hides GNOME's own media section while running, and puts it back on disable.
- Equalizer bars with rounded ends, square ends, or rounded ends that cycle
  through colours while a player is playing.
- The bars follow the frame clock, so the step is even whatever the refresh
  rate is, and the timer only exists while something is playing.
- Three cards at once, up to ten by a setting; a player that starts playing
  takes one of the places.
- The cover grows to the height of the card and carries the application icon
  in its corner. Artwork covers that square whatever shape it arrived in, and
  is cropped rather than squeezed, whether the player points at a file, at a
  URL, or sends the picture inline; a track without any falls back to the
  player's own icon on a plain tile.
- Sizes that are not styles follow the display scale factor.
- Support links in the preferences: GitHub Sponsors and PayPal.
