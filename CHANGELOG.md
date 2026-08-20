# Changelog

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
