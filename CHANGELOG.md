# Changelog

## 0.1

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
