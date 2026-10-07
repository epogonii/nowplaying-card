// SPDX-License-Identifier: GPL-2.0-or-later

import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GdkPixbuf from 'gi://GdkPixbuf';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import Soup from 'gi://Soup';
import Cairo from 'cairo';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';
import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';
import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';
import * as Volume from 'resource:///org/gnome/shell/ui/status/volume.js';

const N_COLUMNS = 2;

const SHELL_MAJOR = Number.parseInt(Config.PACKAGE_VERSION.split('.')[0], 10);

// St.BoxLayout only learned "orientation" in GNOME 48; before that the
// vertical axis was a plain boolean.
const VERTICAL = SHELL_MAJOR >= 48
    ? {orientation: Clutter.Orientation.VERTICAL}
    : {vertical: true};

const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';

const MPRIS_PATH = '/org/mpris/MediaPlayer2';
const MPRIS_IFACE = 'org.mpris.MediaPlayer2';
const PLAYER_IFACE = 'org.mpris.MediaPlayer2.Player';
const PROPERTIES_IFACE = 'org.freedesktop.DBus.Properties';

// Position is left out on purpose: it is not change-notified, so a cached
// proxy property would go stale. It is read on demand instead.
const MprisProxy = Gio.DBusProxy.makeProxyWrapper(`
<node>
  <interface name="org.mpris.MediaPlayer2">
    <method name="Raise"/>
    <property name="CanRaise" type="b" access="read"/>
    <property name="Identity" type="s" access="read"/>
    <property name="DesktopEntry" type="s" access="read"/>
  </interface>
</node>`);

const PlayerProxy = Gio.DBusProxy.makeProxyWrapper(`
<node>
  <interface name="org.mpris.MediaPlayer2.Player">
    <method name="PlayPause"/>
    <method name="Next"/>
    <method name="Previous"/>
    <method name="Seek">
      <arg type="x" direction="in" name="offset"/>
    </method>
    <method name="SetPosition">
      <arg type="o" direction="in" name="trackId"/>
      <arg type="x" direction="in" name="position"/>
    </method>
    <signal name="Seeked">
      <arg type="x" name="position"/>
    </signal>
    <property name="Metadata" type="a{sv}" access="read"/>
    <property name="PlaybackStatus" type="s" access="read"/>
    <property name="CanPlay" type="b" access="read"/>
    <property name="CanGoNext" type="b" access="read"/>
    <property name="CanGoPrevious" type="b" access="read"/>
    <property name="CanSeek" type="b" access="read"/>
    <property name="CanControl" type="b" access="read"/>
    <property name="Volume" type="d" access="readwrite"/>
    <property name="LoopStatus" type="s" access="readwrite"/>
    <property name="Shuffle" type="b" access="readwrite"/>
  </interface>
</node>`);

// How much of an in-memory cover (data: URL or fetched) is fed to the loader
// at a time while it looks for the image header. Large enough that a JPEG
// carrying an EXIF thumbnail still reports its size from the first chunk.
const ART_CHUNK = 64 * 1024;
const COVER_SIZE = 48;
const COMPACT_COVER_SIZE = 40;
const CONTROL_ICON_SIZE = 20;
// The skip arrows are wide and flat, so they get more room than the pause.
const SKIP_ICON_SIZE = 24;
const PLAY_ICON_SIZE = 22;
const COMPACT_CONTROL_ICON_SIZE = 16;
const COMPACT_PLAY_ICON_SIZE = 20;
const PANEL_CONTROL_ICON_SIZE = 14;

// GNOME 50 opens a panel menu from a Clutter gesture instead of the event
// vfunc. A gesture on the button wins over the buttons inside it, and there is
// no event vfunc left above to chain to, so both the menu and the transport
// have to be answered by gestures of our own where the class exists.
const HAS_CLICK_GESTURE = typeof Clutter.ClickGesture !== 'undefined';

const POLL_MS = 1000;
const SEEK_SETTLE_MS = 1000;
const SEEK_GUARD_MS = 800;
const SEEK_COALESCE_MS = 200;
const PROPERTY_RETRY_MS = 1000;
const PROPERTY_RETRIES = 10;
const BADGE_SIZE = 14;
const FULL_BADGE_SIZE = 18;
// How far the badge stops short of the corner of the cover.
const BADGE_INSET = 2;
const VOLUME_ICON_SIZE = 16;
const VOLUME_STEP = 0.05;
const VOLUME_COALESCE_MS = 100;
const VOLUME_GUARD_MS = 800;

// The cover sizes the preferences offer, against the height of the text
// beside the cover. Medium is just as tall.
const COVER_SIZES = {
    'small': 0.75,
    'medium': 1,
    'large': 1.25,
};

// A picture that is not square is scaled until it covers the square the card
// leaves for it and the rest runs past the edges, where the tile cuts it off.
// Squeezing it into the square instead would bend everything in the frame.
// Browsers announce a track before the file they point at is written: Firefox
// fills its own directory a moment later, Chrome writes a temporary file. So a
// local picture that is missing, or too unfinished to be measured, is looked
// for again a few times before the card settles for the player's icon.
const ART_RETRY_INTERVAL = 250;
const ART_RETRIES = 12;
// Remote artwork is fetched here, not by GIO: gvfsd-http can hang on a dead
// connection and St never reports a picture that failed to load.
const REMOTE_ART_TIMEOUT = 10;
const REMOTE_ART_TRIES = 3;
// How much of the cover the player's own icon fills when a track brings no
// artwork with it. All of it turns a logo into a poster.
const FALLBACK_ICON_RATIO = 0.6;

// What LoopStatus cycles through when the repeat button is clicked.
const LOOP_ORDER = ['None', 'Playlist', 'Track'];

// Smooth scrolling arrives as a stream of small deltas; this much travel
// counts as one wheel notch.
const SCROLL_NOTCH = 1;

const TEXT_SCROLL_SPEED = 30;
const TEXT_SCROLL_PAUSE_MS = 1600;
const TEXT_SCROLL_RETURN_MS = 500;
const PRESS_DIP_MS = 90;
const PRESS_RETURN_MS = 240;
const PRESS_SCALE = 0.92;
const PRESS_NUDGE = 3;

// Every default the schema declares, so a read can still answer when GSettings
// cannot. Replacing an extension's files under a running shell leaves the
// process with a stale view of the compiled schema, and asking GSettings for a
// key that view no longer has takes the whole session down with it.
const DEFAULTS = {
    'location': 'panel',
    'panel-box': 'right',
    'panel-index': 0,
    'indicator-visibility': 'active',
    'hide-builtin-media': true,
    'card-layout': 'auto',
    'animate-icon': true,
    'equalizer-style': 'rounded',
    'show-spectrum': false,
    'spectrum-shape': 'segments',
    'spectrum-colors': 'classic',
    'spectrum-columns': 16,
    'spectrum-peaks': true,
    'spectrum-text': 'panel',
    'max-cards': 3,
    'cover-size': 'medium',
    'show-progress': true,
    'show-volume': false,
    'show-loop-shuffle': false,
    'sort-playing-first': true,
    'scroll-text': true,
    'panel-scroll': 'track',
    'panel-middle-click': 'play-pause',
    'panel-controls': false,
    'panel-text': 'none',
    'panel-text-width': 180,
    'panel-text-fixed': false,
    'panel-icon': true,
    'ignored-players': [],
};

function readSetting(settings, key) {
    if (!settings?.settings_schema?.has_key(key))
        return DEFAULTS[key];

    try {
        return settings.get_value(key).deepUnpack();
    } catch (e) {
        console.debug(`nowplaying: ${key}: ${e.message}`);
        return DEFAULTS[key];
    }
}

// A length from the stylesheet and an icon size both grow with the scale factor
// of the session. A size handed straight to an actor does not: it is in stage
// pixels and stays where it was written unless it is scaled here.
function scaleFactor() {
    return St.ThemeContext.get_for_stage(global.stage).scale_factor || 1;
}

// The shell loads stylesheet-dark.css or -light.css by the style it thinks it
// has, and a custom shell theme can disagree (#2). Go by the text colour.
function followInk(widget) {
    widget.connect('style-changed', () => {
        const color = widget.peek_theme_node()?.get_foreground_color();
        if (!color)
            return;
        const lightInk = (color.red + color.green + color.blue) / 3 > 127;
        const [tone, other] = lightInk
            ? ['np-dark', 'np-light'] : ['np-light', 'np-dark'];
        if (widget.has_style_class_name(tone))
            return;
        widget.add_style_class_name(tone);
        widget.remove_style_class_name(other);
    });
}

const N_BARS = 3;
const BAR_WIDTH = 3;
const BAR_GAP = 2;
const EQUALIZER_WIDTH = N_BARS * BAR_WIDTH + (N_BARS - 1) * BAR_GAP;
// The bars are redrawn on the frame clock of the actor, which offers one frame
// per frame of the screen; this is the shortest gap between two of the frames
// that are used. 33ms takes every second frame at 60Hz and every fifth at
// 144Hz, so the step is the same whatever the monitor runs at and half of the
// frames cost nothing.
const FRAME_MS = 33;
const SPEEDS = [7.1, 9.7, 5.3];
const PHASES = [0, 2.1, 4.2];
const STATIC_HEIGHTS = [0.35, 0.7, 0.5];
// Seconds for one turn around the colour wheel, and how far apart the bars sit
// on it, for the colour-cycling style. A third of the wheel apart puts pure red
// next to pure green, which is loud in a panel; a narrower slice keeps the
// three in the same part of the wheel and reads as one gradient walking past.
const HUE_PERIOD = 10;
const HUE_SPREAD = 1 / 8;
const HUE_SATURATION = 0.7;
// Where the three stand while nothing plays.
const HUE_STATIC = 0.58;

const ROWS = 8;
const COLUMN_WIDTH = 3;
const COLUMN_GAP = 1;
// spectrum.js prints this many bands.
const BANDS = 32;
// FALL and PEAK_FALL are in column heights a second.
const FALL = 2.2;
const PEAK_HOLD_MS = 500;
const PEAK_FALL = 1;
const UNLIT = 0.22;
const RED_FROM = 0.75;
const YELLOW_FROM = 0.5;

const SPECTRUM_STALE_MS = 500;
// Long enough for the gap between two tracks, so it costs no restart.
const SPECTRUM_GRACE_MS = 3000;
// A helper that dies sooner than this has failed.
const SPECTRUM_STEADY_MS = 10000;
const SPECTRUM_TRIES = 3;
// Must match NO_CAPTURE in spectrum.js.
const SPECTRUM_NO_CAPTURE = 2;

// Hue in turns, saturation and value in 0 to 1, out as red, green and blue in
// the same range.
function hsvToRgb(hue, saturation, value) {
    const h = (((hue % 1) + 1) % 1) * 6;
    const sector = Math.floor(h);
    const f = h - sector;
    const p = value * (1 - saturation);
    const q = value * (1 - saturation * f);
    const t = value * (1 - saturation * (1 - f));

    switch (sector) {
    case 0: return [value, t, p];
    case 1: return [q, value, p];
    case 2: return [p, value, t];
    case 3: return [p, q, value];
    case 4: return [t, p, value];
    default: return [value, p, q];
    }
}

function rgb(hex) {
    const value = Number.parseInt(hex.slice(1), 16);
    return [(value >> 16) / 255, (value >> 8 & 0xff) / 255, (value & 0xff) / 255];
}

// Bright for a dark panel, deep for a light one.
const LEVEL_COLORS = [
    ['#2ec27e', '#f6d32d', '#e01b24'].map(rgb),
    ['#26a269', '#e5a50a', '#c01c28'].map(rgb),
];

// Equalizer bars, drawn with the panel's own foreground color so it follows
// the theme. Animates only while something is playing.
const EqualizerIcon = GObject.registerClass(
class EqualizerIcon extends St.DrawingArea {
    _init() {
        super._init({
            style_class: 'np-equalizer',
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._playing = false;
        this._animate = true;
        this._iconStyle = DEFAULTS['equalizer-style'];
        this._shape = DEFAULTS['spectrum-shape'];
        this._colors = DEFAULTS['spectrum-colors'];
        this._columns = DEFAULTS['spectrum-columns'];
        this._showPeaks = DEFAULTS['spectrum-peaks'];
        this._analyzer = null;
        this._holding = false;
        this._timeline = null;
        this._frameId = 0;
        this._start = GLib.get_monotonic_time();
        this._painted = 0;
        this._resetLevels();

        // A new system theme means a new foreground colour: redraw with it. A
        // new scale factor arrives the same way, and that one changes the width.
        this.connect('style-changed', () => {
            this.queue_relayout();
            this.queue_repaint();
        });
        // Animations turned off in the system settings are turned off here too.
        St.Settings.get().connectObject('notify::enable-animations', () => {
            this._updateTimer();
            this.queue_repaint();
        }, this);
        this.connect('destroy', () => {
            this._stopTimer();
            this._letGo();
            this._analyzer = null;
        });
    }

    set playing(playing) {
        if (this._playing === playing)
            return;

        this._playing = playing;
        this._updateTimer();
        this.queue_repaint();
    }

    get playing() {
        return this._playing;
    }

    set animate(animate) {
        if (this._animate === animate)
            return;

        this._animate = animate;
        this._updateTimer();
        this.queue_repaint();
    }

    get animate() {
        return this._animate;
    }

    // The spectrum is wider than the bars, so a new style can change the size.
    set iconStyle(style) {
        if (this._iconStyle === style)
            return;

        this._iconStyle = style;
        this._resetLevels();
        this.queue_relayout();
        this.queue_repaint();
    }

    get iconStyle() {
        return this._iconStyle;
    }

    // Held only while the icon moves on screen.
    set analyzer(analyzer) {
        if (this._analyzer === analyzer)
            return;

        this._letGo();
        this._analyzer = analyzer;
        this._updateTimer();
        this.queue_repaint();
    }

    get analyzer() {
        return this._analyzer;
    }

    setSpectrum({shape, colors, columns, peaks}) {
        if (shape === this._shape && colors === this._colors &&
            columns === this._columns && peaks === this._showPeaks)
            return;

        this._shape = shape;
        this._colors = colors;
        this._showPeaks = peaks;
        if (columns !== this._columns) {
            this._columns = columns;
            this._resetLevels();
            this.queue_relayout();
        }
        this.queue_repaint();
    }

    // The height comes from the stylesheet and doubles in a 200% session, so
    // the width has to as well: an actor size is in stage pixels and follows
    // nothing on its own.
    vfunc_get_preferred_width(_forHeight) {
        const width = (this._iconStyle === 'spectrum'
            ? this._columns * (COLUMN_WIDTH + COLUMN_GAP) - COLUMN_GAP
            : EQUALIZER_WIDTH) * scaleFactor();

        if (!this.get_stage())
            return [width, width];

        return this.get_theme_node().adjust_preferred_width(width, width);
    }

    get _moving() {
        return this._playing && this._animate &&
            St.Settings.get().enable_animations;
    }

    _updateTimer() {
        const wanted = this._moving && this.mapped;

        const holding = wanted && this._analyzer !== null;
        if (holding !== this._holding) {
            this._holding = holding;
            if (holding)
                this._analyzer.hold(this);
            else
                this._analyzer.release(this);
        }

        if (wanted && this._timeline === null) {
            // A timer of our own fires whenever it likes, and a frame that
            // lands between two frames of the screen is a frame that shows up
            // late. The frame clock of the actor never does.
            this._timeline = new Clutter.Timeline({
                actor: this,
                duration: 1000,
                repeat_count: -1,
            });
            this._frameId = this._timeline.connect('new-frame',
                () => this._onFrame());
            this._timeline.start();
            this._resetLevels();
        } else if (!wanted) {
            this._stopTimer();
        }
    }

    _letGo() {
        if (this._holding)
            this._analyzer.release(this);
        this._holding = false;
    }

    // The clock offers more frames than these bars have any use for: this takes
    // one every FRAME_MS and lets the rest go by untouched.
    _onFrame() {
        const now = GLib.get_monotonic_time();
        if (now - this._painted < FRAME_MS * 1000)
            return;

        this._painted = now;
        this._step(now);
        this.queue_repaint();
    }

    get _count() {
        return this._iconStyle === 'spectrum' ? this._columns : N_BARS;
    }

    // A paused spectrum makes a low hill, so it still reads as one.
    _restLevel(i) {
        if (this._iconStyle !== 'spectrum')
            return STATIC_HEIGHTS[i];

        return 0.25 + 0.45 * Math.sin(Math.PI * (i + 0.5) / this._columns);
    }

    _fakeLevel(i, t) {
        if (this._iconStyle !== 'spectrum')
            return (Math.sin(t * SPEEDS[i] + PHASES[i]) + 1) / 2;

        const slow = Math.sin(t * SPEEDS[i % N_BARS] * 0.6 + i * 0.9);
        const fast = Math.sin(t * SPEEDS[(i + 1) % N_BARS] + i * 1.7);
        return (slow + fast + 2) / 4;
    }

    _resetLevels() {
        const count = this._count;
        this._levels = Array.from({length: count}, (_, i) => this._restLevel(i));
        this._peaks = new Array(count).fill(0);
        this._peakTimes = new Array(count).fill(0);
        this._lastStep = GLib.get_monotonic_time();
    }

    // An analyzer that has heard nothing yet counts as silence, and one that
    // gave up as no analyzer at all.
    _step(now) {
        const dt = (now - this._lastStep) / 1000000;
        const t = (now - this._start) / 1000000;
        const bands = this._analyzer?.bands ?? null;
        const real = bands !== null || this._analyzer?.listening === true;
        const spectrum = this._iconStyle === 'spectrum';
        const count = this._levels.length;

        this._lastStep = now;

        for (let i = 0; i < count; i++) {
            let level = 0;
            if (bands) {
                // A bar spans a third of the sound and would nearly always be
                // full on its loudest band, so it takes the average.
                const from = Math.floor(i * BANDS / count);
                const to = Math.floor((i + 1) * BANDS / count);
                for (let band = from; band < to; band++) {
                    level = spectrum
                        ? Math.max(level, bands[band])
                        : level + bands[band] / (to - from);
                }
            } else if (!real) {
                level = this._fakeLevel(i, t);
            }

            if (!real || level >= this._levels[i])
                this._levels[i] = level;
            else
                this._levels[i] = Math.max(level, this._levels[i] - FALL * dt);

            if (this._levels[i] >= this._peaks[i]) {
                this._peaks[i] = this._levels[i];
                this._peakTimes[i] = now;
            } else if (now - this._peakTimes[i] > PEAK_HOLD_MS * 1000) {
                this._peaks[i] = Math.max(this._levels[i],
                    this._peaks[i] - PEAK_FALL * dt);
            }
        }
    }

    vfunc_repaint() {
        const themeNode = this.get_theme_node();
        const [, height] = this.get_surface_size();
        const cr = this.get_context();
        const color = themeNode.get_foreground_color();

        if (this._iconStyle === 'spectrum') {
            this._repaintSpectrum(cr, color, height);
            cr.$dispose();
            return;
        }

        const scale = scaleFactor();
        const barWidth = BAR_WIDTH * scale;
        const gap = BAR_GAP * scale;
        const rounded = this._iconStyle !== 'bars';
        const rainbow = this._iconStyle === 'rainbow';
        const moving = this._moving;
        const t = (GLib.get_monotonic_time() - this._start) / 1000000;
        // A round end is half a bar tall on its own, so a bar that short is as
        // short as the shape goes.
        const minHeight = Math.max(Math.round(height * 0.25),
            rounded ? barWidth : 0);
        const maxHeight = Math.round(height * 0.85);
        // Full-strength colour disappears against a light panel, so the cycle
        // is taken down a notch where the theme draws in dark ink.
        const light = (color.red + color.green + color.blue) / 3 > 127;
        const value = light ? 1 : 0.8;

        if (rounded) {
            cr.setLineWidth(barWidth);
            cr.setLineCap(Cairo.LineCap.ROUND);
        }

        if (!rainbow) {
            cr.setSourceRGBA(
                color.red / 255, color.green / 255, color.blue / 255,
                color.alpha / 255);
        }

        for (let i = 0; i < N_BARS; i++) {
            const wave = moving ? this._levels[i] : STATIC_HEIGHTS[i];
            const barHeight = minHeight + (maxHeight - minHeight) * wave;
            const x = i * (barWidth + gap);
            const bottom = (height + barHeight) / 2;

            if (rainbow) {
                // Standing still means standing on one colour each, so a
                // paused icon is still three colours and not three greys.
                const hue = i * HUE_SPREAD + (moving ? t / HUE_PERIOD : HUE_STATIC);
                const [red, green, blue] = hsvToRgb(hue, HUE_SATURATION, value);
                cr.setSourceRGBA(red, green, blue, color.alpha / 255);
            }

            if (rounded) {
                // A round end adds half the line width past each end of the
                // line, so the line is that much shorter than the bar it draws.
                const middle = x + barWidth / 2;
                cr.moveTo(middle, bottom - barHeight + barWidth / 2);
                cr.lineTo(middle, bottom - barWidth / 2);
                cr.stroke();
            } else {
                cr.rectangle(x, bottom - barHeight, barWidth, barHeight);
                cr.fill();
            }
        }

        cr.$dispose();
    }

    // Unlit segments are drawn faintly, so the grid shows while it is quiet.
    _repaintSpectrum(cr, color, height) {
        // Two pixels a row at least, so a thin panel gets fewer rows.
        const rows = Math.min(ROWS, Math.floor(height / 2));
        if (rows < 1)
            return;

        const scale = scaleFactor();
        const pitch = (COLUMN_WIDTH + COLUMN_GAP) * scale;
        const columnWidth = COLUMN_WIDTH * scale;
        const rowPitch = Math.floor(height / rows);
        const gap = Math.min(COLUMN_GAP * scale, rowPitch - 1);
        const segment = rowPitch - gap;
        const gridHeight = rows * rowPitch - gap;
        const top = Math.floor((height - gridHeight) / 2);
        const bottom = top + gridHeight;
        const middle = top + gridHeight / 2;

        const moving = this._moving;
        const showPeaks = moving && this._showPeaks;
        const count = this._levels.length;
        const alpha = color.alpha / 255;
        const t = (GLib.get_monotonic_time() - this._start) / 1000000;
        const ink = [color.red / 255, color.green / 255, color.blue / 255];
        const lightInk = (color.red + color.green + color.blue) / 3 > 127;
        const [green, yellow, red] = LEVEL_COLORS[lightInk ? 0 : 1];
        const hue = moving ? t / HUE_PERIOD : HUE_STATIC;

        const colorAt = (i, fraction) => {
            switch (this._colors) {
            case 'classic':
                return fraction >= RED_FROM ? red : ink;
            case 'level':
                if (fraction >= RED_FROM)
                    return red;
                return fraction >= YELLOW_FROM ? yellow : green;
            case 'rainbow':
                return hsvToRgb(hue + i / count, HUE_SATURATION,
                    lightInk ? 1 : 0.8);
            default:
                return ink;
            }
        };

        // Zone by zone, so a solid column changes colour where segments do.
        const edges = [0, YELLOW_FROM, RED_FROM, 1];
        const mirrored = this._shape === 'mirrored';
        const reach = mirrored ? gridHeight / 2 : gridHeight;
        const span = (x, i, from, to, strength) => {
            for (let zone = 0; zone < 3; zone++) {
                const low = Math.max(from, edges[zone]);
                const high = Math.min(to, edges[zone + 1]);
                if (high <= low)
                    continue;

                const [r, g, b] = colorAt(i, (edges[zone] + edges[zone + 1]) / 2);
                cr.setSourceRGBA(r, g, b, strength);
                const inner = Math.round(low * reach);
                const outer = Math.round(high * reach);
                if (mirrored) {
                    cr.rectangle(x, Math.round(middle) - outer,
                        columnWidth, outer - inner);
                    cr.rectangle(x, Math.round(middle) + inner,
                        columnWidth, outer - inner);
                } else {
                    cr.rectangle(x, bottom - outer, columnWidth, outer - inner);
                }
                cr.fill();
            }
        };

        for (let i = 0; i < count; i++) {
            const x = i * pitch;
            const level = Math.min(moving ? this._levels[i] : this._restLevel(i), 1);
            const peak = showPeaks ? Math.min(this._peaks[i], 1) : 0;

            if (this._shape === 'segments') {
                const lit = Math.max(1, Math.round(level * rows));
                const peakRow = Math.round(peak * rows) - 1;

                for (let row = 0; row < rows; row++) {
                    const [r, g, b] = colorAt(i, (row + 0.5) / rows);
                    const on = row < lit || row === peakRow;
                    cr.setSourceRGBA(r, g, b, on ? alpha : alpha * UNLIT);
                    cr.rectangle(x, bottom - row * rowPitch - segment,
                        columnWidth, segment);
                    cr.fill();
                }
                continue;
            }

            const lit = Math.max(level, scale / reach);
            span(x, i, 0, lit, alpha);
            span(x, i, lit, 1, alpha * UNLIT);

            if (peak > lit) {
                const [r, g, b] = colorAt(i, peak);
                const outer = Math.round(peak * reach);
                cr.setSourceRGBA(r, g, b, alpha);
                if (mirrored) {
                    cr.rectangle(x, Math.round(middle) - outer, columnWidth, scale);
                    cr.rectangle(x, Math.round(middle) + outer - scale,
                        columnWidth, scale);
                } else {
                    cr.rectangle(x, bottom - outer, columnWidth, scale);
                }
                cr.fill();
            }
        }
    }

    // Stop burning frames while the panel is hidden (fullscreen video), and
    // pick the animation back up when it comes back.
    vfunc_map() {
        super.vfunc_map();
        this._updateTimer();
    }

    vfunc_unmap() {
        super.vfunc_unmap();
        this._updateTimer();
    }

    _stopTimer() {
        if (this._timeline) {
            this._timeline.stop();
            this._timeline.disconnect(this._frameId);
            this._frameId = 0;
        }
        this._timeline = null;
    }
});

// Runs spectrum.js while some icon holds it. The helper hears the whole
// default output, not one player.
class SpectrumAnalyzer {
    constructor() {
        this._path = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);
        this._holders = new Set();
        this._proc = null;
        this._stdin = null;
        this._cancellable = null;
        this._bands = null;
        this._received = 0;
        this._missing = false;
        this._failures = 0;
        this._started = 0;
        this._graceId = 0;
        this._backoffId = 0;
        this._mixer = null;
        this._sinkId = 0;
        this._sink = null;
    }

    // 0 to 1, lowest band first; null once the helper has gone quiet.
    get bands() {
        if (this._bands === null ||
            GLib.get_monotonic_time() - this._received > SPECTRUM_STALE_MS * 1000)
            return null;

        return this._bands;
    }

    get listening() {
        return this._proc !== null || this._backoffId !== 0;
    }

    hold(holder) {
        const first = this._holders.size === 0;
        this._holders.add(holder);

        if (this._graceId) {
            GLib.source_remove(this._graceId);
            this._graceId = 0;
        }

        if (first && !this.listening) {
            this._failures = 0;
            this._start();
        }
    }

    release(holder) {
        if (!this._holders.delete(holder) || this._holders.size > 0)
            return;

        if (this._backoffId) {
            GLib.source_remove(this._backoffId);
            this._backoffId = 0;
        }

        if (this._proc !== null && this._graceId === 0) {
            this._graceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT,
                SPECTRUM_GRACE_MS, () => {
                    this._graceId = 0;
                    this._stop();
                    return GLib.SOURCE_REMOVE;
                });
        }
    }

    _start() {
        if (this._missing || this._path === null)
            return;

        let proc;
        try {
            proc = Gio.Subprocess.new(['gjs', '-m', `${this._path}/spectrum.js`],
                Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE);
        } catch (e) {
            console.debug(`nowplaying: no spectrum: ${e.message}`);
            this._missing = true;
            return;
        }

        this._proc = proc;
        this._started = GLib.get_monotonic_time();
        this._cancellable = new Gio.Cancellable();
        // Never written to: the helper stops when its stdin closes.
        this._stdin = proc.get_stdin_pipe();

        const stream = new Gio.DataInputStream({
            base_stream: proc.get_stdout_pipe(),
            close_base_stream: true,
        });
        this._read(stream, this._cancellable);
        proc.wait_async(null, (_proc, result) => this._onExit(proc, result));
        this._watchSink();
    }

    _read(stream, cancellable) {
        stream.read_line_async(GLib.PRIORITY_DEFAULT, cancellable, (_stream, result) => {
            let line = null;
            try {
                [line] = stream.read_line_finish_utf8(result);
            } catch (e) {
                if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    console.debug(`nowplaying: spectrum: ${e.message}`);
            }

            if (line === null || cancellable.is_cancelled()) {
                stream.close_async(GLib.PRIORITY_DEFAULT, null, null);
                return;
            }

            this._parse(line);
            this._read(stream, cancellable);
        });
    }

    _parse(line) {
        const values = line.split(' ');
        if (values.length !== BANDS)
            return;

        this._bands = Float32Array.from(values, value => Number(value) / 1000);
        this._received = GLib.get_monotonic_time();
    }

    _onExit(proc, result) {
        try {
            proc.wait_finish(result);
        } catch (e) {
            console.debug(`nowplaying: spectrum: ${e.message}`);
        }

        if (proc !== this._proc)
            return;

        const status = proc.get_if_exited() ? proc.get_exit_status() : -1;
        const ran = GLib.get_monotonic_time() - this._started;
        this._stop();

        if (status === SPECTRUM_NO_CAPTURE) {
            this._missing = true;
            return;
        }

        this._failures = ran >= SPECTRUM_STEADY_MS * 1000 ? 1 : this._failures + 1;
        if (this._holders.size === 0 || this._failures >= SPECTRUM_TRIES)
            return;

        this._backoffId = GLib.timeout_add(GLib.PRIORITY_DEFAULT,
            1000 * 2 ** (this._failures - 1), () => {
                this._backoffId = 0;
                this._start();
                return GLib.SOURCE_REMOVE;
            });
    }

    _stop() {
        // Forgotten first, so that its exit is not taken for a failure.
        const proc = this._proc;
        this._proc = null;
        this._cancellable?.cancel();
        this._cancellable = null;
        this._stdin?.close_async(GLib.PRIORITY_DEFAULT, null, null);
        this._stdin = null;
        proc?.force_exit();
        this._unwatchSink();
        this._bands = null;

        if (this._graceId) {
            GLib.source_remove(this._graceId);
            this._graceId = 0;
        }
        if (this._backoffId) {
            GLib.source_remove(this._backoffId);
            this._backoffId = 0;
        }
    }

    // pulsesrc stays on the output that was the default when it started.
    _watchSink() {
        this._mixer = Volume.getMixerControl();
        this._sink = this._mixer.get_default_sink()?.id ?? null;
        this._sinkId = this._mixer.connect('default-sink-changed', (_mixer, id) => {
            if (id !== this._sink)
                this._restart();
        });
    }

    _unwatchSink() {
        if (this._sinkId)
            this._mixer.disconnect(this._sinkId);
        this._sinkId = 0;
        this._mixer = null;
    }

    _restart() {
        this._stop();
        if (this._holders.size > 0)
            this._start();
    }

    destroy() {
        this._holders.clear();
        this._path = null;
        this._stop();
    }
}

// A label that walks its own text sideways when it does not fit, instead of
// cutting it off. The width request stays at the minimum the theme allows, so
// a long track title can never widen the card.
const ScrollingLabel = GObject.registerClass(
class ScrollingLabel extends St.Widget {
    _init(styleClass) {
        super._init({
            style_class: 'np-scroll',
            layout_manager: new Clutter.BinLayout(),
            clip_to_allocation: true,
            x_expand: true,
        });

        this._label = new St.Label({style_class: styleClass});
        this._label.clutter_text.single_line_mode = true;
        this._label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.add_child(this._label);

        this._scroll = true;
        this._maxWidth = 0;
        this._pin = false;
        this._overflow = 0;
        this._idleId = null;
        this._timeline = null;
        this._frameId = 0;
        this._away = 0;
        this._walkText = null;

        this.connect('notify::mapped', () => this._restart());
        this.connect('destroy', () => this._stop());
        // Without animations the text keeps its ellipsis instead of walking.
        St.Settings.get().connectObject('notify::enable-animations',
            () => this.queue_relayout(), this);
    }

    set text(text) {
        this._label.text = text;
    }

    get text() {
        return this._label.text;
    }

    set scroll(scroll) {
        if (this._scroll === scroll)
            return;

        this._scroll = scroll;
        this.queue_relayout();
    }

    get scroll() {
        return this._scroll;
    }

    // Zero lets the parent decide the width, anything else is a ceiling for a
    // label that has no parent to hold it back. The number comes from the
    // preferences, so it is a length like the stylesheet's and the scale factor
    // applies to it where it is used.
    set maxWidth(maxWidth) {
        if (this._maxWidth === maxWidth)
            return;

        this._maxWidth = maxWidth;
        this.queue_relayout();
    }

    get maxWidth() {
        return this._maxWidth;
    }

    // Asking for the ceiling even when the text is shorter: whatever sits next
    // to the label then keeps its place from one track to the next.
    set pin(pin) {
        if (this._pin === pin)
            return;

        this._pin = pin;
        this.queue_relayout();
    }

    get pin() {
        return this._pin;
    }

    // Natural width is pinned to the minimum: the card hands out the room and
    // the text moves within it, rather than the text widening the card.
    vfunc_get_preferred_width(forHeight) {
        const [min, natural] = super.vfunc_get_preferred_width(forHeight);

        if (this._maxWidth > 0) {
            const cap = this._maxWidth * scaleFactor();
            const width = this._pin ? cap : Math.min(natural, cap);
            return [width, width];
        }

        return [min, min];
    }

    vfunc_allocate(box) {
        const width = box.get_width();
        const height = box.get_height();

        // An ellipsizing label still asks for the whole text as its natural
        // width, so the request itself says how much does not fit.
        const [, natural] = this._label.get_preferred_width(height);
        const overflow = this._scroll && St.Settings.get().enable_animations
            ? Math.max(0, Math.ceil(natural - width)) : 0;

        this.set_allocation(box);
        this._label.allocate(new Clutter.ActorBox({
            x1: 0,
            y1: 0,
            x2: width + overflow,
            y2: height,
        }));

        if (overflow !== this._overflow) {
            this._overflow = overflow;
            this._queueRestart();
        }
    }

    // Transitions cannot be started while the actor is being allocated.
    _queueRestart() {
        if (this._idleId)
            return;

        this._idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._idleId = null;
            this._restart();
            return GLib.SOURCE_REMOVE;
        });
    }

    _restart() {
        // How far along the walk was. A card changes width whenever a cover
        // arrives or a neighbour of it folds, and every one of those is a new
        // amount of text that does not fit; starting the walk over each time
        // would leave a title in a busy popup standing at its first word for
        // good.
        // A new title starts from the beginning: the pause at the start is
        // there to be read, and the time carried over belongs to text that is
        // no longer on screen.
        const same = this._label.text === this._walkText;
        const carried = same ? this._timeline?.get_elapsed_time() ?? 0 : 0;
        this._walkText = this._label.text;

        this._stopWalk();
        this._label.translation_x = 0;

        // With animations turned off the text stays where it is and keeps its
        // ellipsis.
        if (!this._canScroll())
            return;

        this._away = Math.max(1, Math.round(
            (this._overflow / (TEXT_SCROLL_SPEED * scaleFactor())) * 1000));
        const duration = 2 * TEXT_SCROLL_PAUSE_MS + this._away +
            TEXT_SCROLL_RETURN_MS;
        this._timeline = new Clutter.Timeline({
            actor: this,
            duration,
            repeat_count: -1,
        });
        this._frameId = this._timeline.connect('new-frame',
            () => this._onFrame());
        this._timeline.start();
        if (carried > 0)
            this._timeline.advance(Math.min(carried, duration - 1));
        this._onFrame();
    }

    _canScroll() {
        return this._overflow >= 2 && this.mapped &&
            St.Settings.get().enable_animations;
    }

    // One walk: a pause at the start, out to the far end at a steady speed,
    // a pause there, and back with the last of it easing off. The frame clock
    // of the actor drives it, so the walk cannot be left parked halfway - a
    // chain of eases could, because a shell that decides not to animate
    // finishes an ease inside the call that starts it, and the leg after that
    // one never came.
    _onFrame() {
        const elapsed = this._timeline.get_elapsed_time();
        const there = TEXT_SCROLL_PAUSE_MS + this._away;
        const backFrom = there + TEXT_SCROLL_PAUSE_MS;
        let out;

        if (elapsed <= TEXT_SCROLL_PAUSE_MS) {
            out = 0;
        } else if (elapsed <= there) {
            out = (elapsed - TEXT_SCROLL_PAUSE_MS) / this._away;
        } else if (elapsed <= backFrom) {
            out = 1;
        } else {
            const left = Math.min(1,
                (elapsed - backFrom) / TEXT_SCROLL_RETURN_MS);
            out = (1 - left) * (1 - left);
        }

        this._label.translation_x = -Math.round(this._overflow * out);
    }

    _stopWalk() {
        if (this._timeline) {
            this._timeline.stop();
            this._timeline.disconnect(this._frameId);
            this._frameId = 0;
        }
        this._timeline = null;
        this._label.remove_all_transitions();
    }

    _stop() {
        if (this._idleId) {
            GLib.source_remove(this._idleId);
            this._idleId = null;
        }
        this._stopWalk();
    }
});

// A press is confirmed by the icon: it eases down, leaning towards the side it
// sends the track, and takes almost three times as long to come back up. Both
// halves are animated, since dropping the icon into place and only easing the
// way back is what makes a press feel like a snap.
function animatePress(button, nudge) {
    if (!St.Settings.get().enable_animations)
        return;

    const icon = button.child;
    icon.remove_all_transitions();
    icon.set_pivot_point(0.5, 0.5);
    icon.ease({
        scale_x: PRESS_SCALE,
        scale_y: PRESS_SCALE,
        translation_x: nudge * scaleFactor(),
        duration: PRESS_DIP_MS,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        onComplete: () => icon.ease({
            scale_x: 1,
            scale_y: 1,
            translation_x: 0,
            duration: PRESS_RETURN_MS,
            mode: Clutter.AnimationMode.EASE_OUT_BACK,
        }),
    });
}

// border-radius doesn't clip children in St, so the cover art gets its corners
// cut by a shader. GNOME 51 replaced Shell.GLSLEffect with Clutter.ShaderEffect.
const COVER_CLIP_DECLS = 'uniform vec2 size; uniform vec4 box; uniform float radius;';
const COVER_CLIP_CODE = `
vec2 half_box = (box.zw - box.xy) * 0.5;
vec2 q = abs(cogl_tex_coord_in[0].xy * size - box.xy - half_box) - half_box + radius;
float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
cogl_color_out *= clamp(0.5 - d, 0.0, 1.0);
`;

// Offscreen effects pad the actor, see _clutter_actor_box_enlarge_for_effects().
const effectPadding = length => Math.round(length) + 3 - Math.ceil(length + 0.75);

class CoverClip extends (Shell.GLSLEffect ?? Clutter.ShaderEffect) {
    vfunc_paint_target(...args) {
        const tile = this.get_actor();
        const scale = tile.get_resource_scale();
        const [x, y] = [tile.width, tile.height].map(l => effectPadding(l) * scale);
        const [, width, height] = this.get_target_size();
        const radius = tile.get_theme_node().get_border_radius(St.Corner.TOPLEFT);

        this._setUniform('size', [width, height]);
        this._setUniform('box', [x, y, x + tile.width * scale, y + tile.height * scale]);
        this._setUniform('radius', [radius * scale]);
        super.vfunc_paint_target(...args);
    }

    _setUniform(name, values) {
        const uniform = Shell.GLSLEffect ? this.get_uniform_location(name) : name;
        this.set_uniform_float(uniform, values.length, values);
    }
}

// registerClass() rejects a vfunc the parent lacks, so only one is added.
// Not by assignment: that makes GJS resolve it on the parent, which throws.
if (Shell.GLSLEffect) {
    Object.defineProperty(CoverClip.prototype, 'vfunc_build_pipeline', {
        value() {
            this.add_glsl_snippet(Shell.SnippetHook?.FRAGMENT ?? Cogl.SnippetHook.FRAGMENT,
                COVER_CLIP_DECLS, COVER_CLIP_CODE, false);
        },
    });
} else {
    Object.defineProperty(CoverClip.prototype, 'vfunc_get_static_snippet', {
        value: () => Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT,
            COVER_CLIP_DECLS, COVER_CLIP_CODE),
    });
}
GObject.registerClass(CoverClip);

// What a card looks like until the model hands it the preferences; a card
// built during startup is never left without an answer.
const CARD_OPTIONS = {
    coverSize: COVER_SIZES[DEFAULTS['cover-size']],
    showProgress: DEFAULTS['show-progress'],
    showVolume: DEFAULTS['show-volume'],
    showLoopShuffle: DEFAULTS['show-loop-shuffle'],
    sortPlayingFirst: DEFAULTS['sort-playing-first'],
    scrollText: DEFAULTS['scroll-text'],
    animate: DEFAULTS['animate-icon'],
    equalizerStyle: DEFAULTS['equalizer-style'],
    analyzer: null,
    maxCards: DEFAULTS['max-cards'],
};

// The card: cover and labels on top, a seek bar with
// timestamps in the middle, transport controls centered at the bottom.
const MediaCard = GObject.registerClass({
    Signals: {'expand-request': {}},
}, class MediaCard extends St.BoxLayout {
    _init(player, closeMenu) {
        super._init({
            style_class: 'np-card',
            ...VERTICAL,
            x_expand: true,
        });

        this._player = player;
        this._closeMenu = closeMenu;
        this._coverUrl = null;
        this._coverApp = null;
        this._artwork = null;
        this._hasArtwork = false;
        this._artAspect = null;
        this._artRetryId = null;
        this._artRetryTries = 0;
        this._artSession = null;
        this._artCancellable = null;
        this._coverGeometry = null;
        this._lengthUs = 0;
        this._positionUs = 0;
        this._trackId = null;
        this._dragging = false;
        this._settingValue = false;
        this._volumeDragging = false;
        this._settingVolume = false;
        this._volumePendingId = null;
        this._volumeGuardUntil = 0;
        this._unmutedVolume = 1;
        this._pollId = null;
        this._seekPendingId = null;
        this._ignorePositionUntil = 0;
        this._cancellable = new Gio.Cancellable();

        this._compact = false;
        this._compactApplied = false;
        this._options = CARD_OPTIONS;

        // Cover on the left, everything else stacked beside it. Expanded, that
        // column carries the text, the controls and the seek bar; folded, it
        // holds a single row.
        this._topRow = new St.BoxLayout({style_class: 'np-top-row', x_expand: true});
        this.add_child(this._topRow);

        this._cover = new St.Icon({
            style_class: 'np-cover-art',
            icon_size: COVER_SIZE,
        });

        // Which player a row belongs to is not obvious from album art alone,
        // so the app icon sits in the bottom right corner of the cover.
        this._badge = new St.Icon({
            style_class: 'np-cover-badge',
            icon_size: BADGE_SIZE,
            visible: false,
        });

        // The tile is the square the cover occupies and the icon inside it is
        // the picture, which is not always square: keeping them apart is what
        // lets a video thumbnail cover the square instead of being squeezed
        // into it. The picture hangs over the edges, so the tile places its
        // children by hand and cuts off whatever reaches past it.
        const coverBin = new St.Widget({
            style_class: 'np-cover',
            layout_manager: new Clutter.FixedLayout(),
            clip_to_allocation: true,
        });
        coverBin.add_effect(new CoverClip());
        this._coverTile = coverBin;
        coverBin.add_child(this._cover);
        coverBin.add_child(this._badge);

        // The cover is the only part that switches to the player: a title that
        // answers clicks is harder to read, and it moves while it scrolls.
        this._coverButton = new St.Button({
            style_class: 'np-cover-button',
            can_focus: true,
            child: coverBin,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._coverButton.connect('clicked', () => this._raise());
        this._topRow.add_child(this._coverButton);

        this._column = new St.BoxLayout({
            style_class: 'np-column',
            ...VERTICAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._topRow.add_child(this._column);
        // Not on the column's notify::height: that comes in the middle of an
        // allocation, and resizing the cover there makes Clutter complain.
        this.connect('style-changed', () => this._syncCover());
        this.connect('notify::mapped', () => this._syncCover());

        // Both squares move the corner the badge rides on.
        this._coverTile.connectObject(
            'notify::width', () => this._placeBadge(),
            'notify::height', () => this._placeBadge(),
            this);
        this._badge.connectObject('notify::width',
            () => this._placeBadge(), this);

        this._headerRow = new St.BoxLayout({
            style_class: 'np-header-box',
            x_expand: true,
        });
        this._column.add_child(this._headerRow);

        const labels = new St.BoxLayout({
            style_class: 'np-labels',
            ...VERTICAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._headerRow.add_child(labels);

        this._title = new ScrollingLabel('np-title');
        labels.add_child(this._title);

        this._subtitle = new ScrollingLabel('np-subtitle');
        labels.add_child(this._subtitle);

        // The same bars as the panel icon, dimmed: with several cards open it
        // shows which one is making the noise, without another label.
        this._equalizer = new EqualizerIcon();
        this._equalizer.add_style_class_name('np-card-equalizer');
        this._equalizer.x_align = Clutter.ActorAlign.END;
        this._equalizer.y_align = Clutter.ActorAlign.START;
        this._headerRow.add_child(this._equalizer);

        this._seekBox = new St.BoxLayout({
            style_class: 'np-seek-box',
            ...VERTICAL,
            x_expand: true,
        });
        this._column.add_child(this._seekBox);

        this._slider = new Slider.Slider(0);
        this._slider.add_style_class_name('np-seek');
        this._slider.connectObject(
            'drag-begin', () => (this._dragging = true),
            'drag-end', () => {
                this._dragging = false;
                this._seekToSlider();
            },
            'notify::value', () => this._onSliderValue(),
            this);
        this._seekBox.add_child(this._slider);

        this._times = new St.BoxLayout({style_class: 'np-times', x_expand: true});
        this._seekBox.add_child(this._times);
        const times = this._times;

        this._elapsedLabel = new St.Label({style_class: 'np-time'});
        times.add_child(this._elapsedLabel);
        times.add_child(new St.Widget({x_expand: true}));
        this._lengthLabel = new St.Label({style_class: 'np-time'});
        times.add_child(this._lengthLabel);

        this._volumeBox = new St.BoxLayout({
            style_class: 'np-volume-box',
            x_expand: true,
        });
        this._column.add_child(this._volumeBox);

        this._volumeIcon = new St.Icon({
            style_class: 'np-volume-icon',
            icon_name: 'audio-volume-high-symbolic',
            icon_size: VOLUME_ICON_SIZE,
        });
        // The speaker mutes, and a second click brings the level back.
        const muteButton = new St.Button({
            style_class: 'np-control np-volume-button',
            can_focus: true,
            child: this._volumeIcon,
            y_align: Clutter.ActorAlign.CENTER,
        });
        muteButton.connect('clicked', () => {
            const value = this._volumeSlider.value;
            if (value > 0.001)
                this._unmutedVolume = value;
            this._volumeSlider.value = value > 0.001 ? 0 : this._unmutedVolume;
        });
        this._volumeBox.add_child(muteButton);

        this._volumeSlider = new Slider.Slider(0);
        this._volumeSlider.add_style_class_name('np-volume');
        this._volumeSlider.connectObject(
            'drag-begin', () => (this._volumeDragging = true),
            'drag-end', () => {
                this._volumeDragging = false;
                this._pushVolume();
            },
            'notify::value', () => this._onVolumeValue(),
            this);
        this._volumeBox.add_child(this._volumeSlider);

        this._controls = new St.BoxLayout({
            style_class: 'np-controls',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._column.insert_child_below(this._controls, this._seekBox);

        this._shuffleButton = this._addControl(this._controls, 'media-playlist-shuffle-symbolic',
            CONTROL_ICON_SIZE, () => this._player.setShuffle(!this._player.shuffle));
        this._prevButton = this._addControl(this._controls, 'media-seek-backward-symbolic',
            CONTROL_ICON_SIZE, () => this._player.previous(), -PRESS_NUDGE);
        this._playButton = this._addControl(this._controls, 'media-playback-start-symbolic',
            PLAY_ICON_SIZE, () => this._player.playPause());
        this._nextButton = this._addControl(this._controls, 'media-seek-forward-symbolic',
            CONTROL_ICON_SIZE, () => this._player.next(), PRESS_NUDGE);
        this._loopButton = this._addControl(this._controls, 'media-playlist-repeat-symbolic',
            CONTROL_ICON_SIZE, () => this._cycleLoop());

        // Clicking the body of a compact card asks the stack to open this one.
        // Buttons and sliders are reactive themselves, so a press on them
        // never gets here.
        this._expandable = false;
        this.connect('button-release-event', (_actor, event) => {
            if (event.get_button() !== Clutter.BUTTON_PRIMARY || !this._expandable)
                return Clutter.EVENT_PROPAGATE;

            this.emit('expand-request');
            return Clutter.EVENT_STOP;
        });
        this.connect('key-press-event', (_actor, event) => {
            const symbol = event.get_key_symbol();
            const wanted = symbol === Clutter.KEY_Return ||
                symbol === Clutter.KEY_KP_Enter || symbol === Clutter.KEY_space;
            if (!wanted || !this._expandable)
                return Clutter.EVENT_PROPAGATE;

            this.emit('expand-request');
            return Clutter.EVENT_STOP;
        });

        this._player.connectObject(
            'changed', () => this._sync(),
            'seeked', (_p, positionUs) => this._onSeeked(positionUs),
            this);
        this.connect('notify::mapped', () => {
            if (this.mapped)
                this._fetchPosition();
            this._updatePoll();
        });
        this.connect('destroy', () => this._onDestroy());
        this._sync();
    }

    _addControl(parent, iconName, iconSize, callback, nudge = 0) {
        // A full card spreads the buttons over its row.
        const button = new St.Button({
            style_class: 'np-control',
            can_focus: true,
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({
                style_class: 'popup-menu-icon',
                icon_name: iconName,
                icon_size: iconSize,
            }),
        });
        button.connect('clicked', () => {
            animatePress(button, nudge);
            callback();
        });
        parent.add_child(button);
        return button;
    }

    // Several cards at once would fill the screen at full size, so the compact
    // layout folds the controls into the header row and drops everything that
    // is not the track and the transport.
    setCompact(compact) {
        if (compact === this._compact)
            return;

        this._compact = compact;
        this._applyLayout();
    }

    setOptions(options) {
        this._options = options;
        this._applyLayout();
    }

    // Only a stack that holds several players has anything to expand.
    setExpandable(expandable) {
        if (expandable === this._expandable)
            return;

        this._expandable = expandable;
        this.reactive = expandable;
        this.can_focus = expandable;
        this.track_hover = expandable;
        if (expandable)
            this.add_style_class_name('np-card-expandable');
        else
            this.remove_style_class_name('np-card-expandable');
    }

    // Every size and every visibility is decided here, and nowhere else: the
    // compact layout and the preferences both have a say in most of them.
    _applyLayout() {
        const compact = this._compact;
        const options = this._options;
        const player = this._player;

        if (compact !== this._compactApplied) {
            this._compactApplied = compact;
            this._controls.get_parent().remove_child(this._controls);
            if (compact)
                this._headerRow.add_child(this._controls);
            else
                this._column.insert_child_below(this._controls, this._seekBox);
            this._controls.x_expand = !compact;

            if (compact)
                this.add_style_class_name('np-card-compact');
            else
                this.remove_style_class_name('np-card-compact');
        }

        this._times.visible = !compact;
        this._title.scroll = options.scrollText;
        this._subtitle.scroll = options.scrollText;

        // No room for columns here, so these bars follow the sound instead.
        this._equalizer.visible = !compact;
        this._equalizer.animate = options.animate;
        this._equalizer.iconStyle = options.equalizerStyle;
        this._equalizer.analyzer = options.analyzer;
        this._equalizer.playing = this.playing;

        const controlSize = compact
            ? COMPACT_CONTROL_ICON_SIZE : CONTROL_ICON_SIZE;
        const skipSize = compact ? COMPACT_CONTROL_ICON_SIZE : SKIP_ICON_SIZE;
        this._prevButton.child.icon_size = skipSize;
        this._nextButton.child.icon_size = skipSize;
        this._shuffleButton.child.icon_size = controlSize;
        this._loopButton.child.icon_size = controlSize;
        this._playButton.child.icon_size = compact
            ? COMPACT_PLAY_ICON_SIZE : PLAY_ICON_SIZE;

        // Shuffle and repeat only make sense for a player that has them, and
        // the compact row has no space for them anyway.
        const toggles = !compact && options.showLoopShuffle && player.canControl;
        this._shuffleButton.visible = toggles && player.hasShuffle;
        this._loopButton.visible = toggles && player.hasLoop;

        this._volumeBox.visible = !compact && options.showVolume &&
            player.hasVolume;
        // Empty rows keep their place, so the card stays one size from track
        // to track. Folded, the cover is taller than both lines anyway.
        this._subtitle.visible = !compact || this._subtitle.text !== '';
        this._seekBox.visible = !compact && options.showProgress;
        this._seekBox.opacity = this._lengthUs > 0 ? 255 : 0;
        this._slider.can_focus = this._lengthUs > 0;
        this._slider.reactive = player.canSeek && this._lengthUs > 0;
        // The badge says which player a card belongs to, folded or not.
        this._badge.icon_size = compact ? BADGE_SIZE : FULL_BADGE_SIZE;
        this._placeBadge();
        this._badge.visible = this._hasArtwork && !!this._badge.gicon;
        // Last, once every row above knows whether it is shown.
        this._syncCover();
    }

    get playing() {
        return this._player.status === 'Playing';
    }

    _raise() {
        if (Main.sessionMode.isLocked)
            return;

        this._player.raise();
        this._closeMenu();
    }

    _sync() {
        this._title.text = this._player.trackTitle || '';
        const subtitle = this._subtitleText();
        this._subtitle.text = subtitle;

        // Players emit 'changed' for every position or volume tweak; only
        // touch the texture when the artwork or the fallback changed.
        const coverUrl = this._player.trackCoverUrl;
        const app = this._player.app;
        if (coverUrl !== this._coverUrl || app !== this._coverApp) {
            // A player recognised late changes only the icon, no new fetch.
            const sameRemoteArt = coverUrl === this._coverUrl &&
                this._isRemoteArt(coverUrl);
            this._coverUrl = coverUrl;
            this._coverApp = app;
            this._badge.gicon = app?.get_icon() ?? null;
            if (this._isRemoteArt(coverUrl)) {
                // Keep what is on screen until the new picture is here.
                this._applyArtwork(this._artwork);
                if (!sameRemoteArt) {
                    this._stopArtRetry();
                    this._fetchArtwork(coverUrl, 1);
                }
            } else {
                const artwork = this._artworkIcon(coverUrl);
                this._applyArtwork(artwork);
                this._stopArtRetry();
                if (this._artworkPending(coverUrl, artwork))
                    this._startArtRetry(coverUrl);
            }
        }

        this._playButton.child.icon_name = this.playing
            ? 'media-playback-pause-symbolic'
            : 'media-playback-start-symbolic';

        // A player that cannot skip gets no skip buttons at all.
        this._prevButton.visible = this._player.canGoPrevious;
        this._nextButton.visible = this._player.canGoNext;

        this._syncShuffle();
        this._syncLoop();
        this._syncVolume();
        this._syncTrack();
        this._applyLayout();
        this._updatePoll();
    }

    _syncShuffle() {
        this._setToggled(this._shuffleButton, this._player.shuffle === true);
    }

    _syncLoop() {
        const status = this._player.loopStatus;
        this._loopButton.child.icon_name = status === 'Track'
            ? 'media-playlist-repeat-song-symbolic'
            : 'media-playlist-repeat-symbolic';
        this._setToggled(this._loopButton,
            status === 'Playlist' || status === 'Track');
    }

    _setToggled(button, toggled) {
        if (toggled)
            button.remove_style_class_name('np-control-off');
        else
            button.add_style_class_name('np-control-off');
    }

    _cycleLoop() {
        const current = Math.max(0, LOOP_ORDER.indexOf(this._player.loopStatus));
        this._player.setLoopStatus(LOOP_ORDER[(current + 1) % LOOP_ORDER.length]);
    }

    // Same deal as the seek bar: a value we just wrote comes back as a
    // property change, and it must not fight the handle under the pointer.
    _syncVolume() {
        const volume = this._player.volume;
        if (volume === null || this._volumeDragging || this._volumePendingId ||
            GLib.get_monotonic_time() < this._volumeGuardUntil)
            return;

        this._settingVolume = true;
        this._volumeSlider.value = Math.max(0, Math.min(1, volume));
        this._settingVolume = false;
        this._syncVolumeIcon();
        this._keepUnmutedVolume();
    }

    _syncVolumeIcon() {
        const value = this._volumeSlider.value;
        let iconName = 'audio-volume-high-symbolic';
        if (value <= 0.001)
            iconName = 'audio-volume-muted-symbolic';
        else if (value < 0.34)
            iconName = 'audio-volume-low-symbolic';
        else if (value < 0.67)
            iconName = 'audio-volume-medium-symbolic';

        this._volumeIcon.icon_name = iconName;
    }

    _onVolumeValue() {
        if (this._settingVolume)
            return;

        this._syncVolumeIcon();

        // Dragging writes once on release; scroll and arrow keys have no
        // release, so their steps are coalesced into one write.
        if (this._volumeDragging)
            return;

        if (this._volumePendingId)
            GLib.source_remove(this._volumePendingId);

        this._volumePendingId = GLib.timeout_add(GLib.PRIORITY_DEFAULT,
            VOLUME_COALESCE_MS, () => {
                this._volumePendingId = null;
                this._pushVolume();
                return GLib.SOURCE_REMOVE;
            });
    }

    _pushVolume() {
        this._volumeGuardUntil = GLib.get_monotonic_time() + VOLUME_GUARD_MS * 1000;
        this._keepUnmutedVolume();
        this._player.setVolume(this._volumeSlider.value);
    }

    // Only levels the player actually got, not the ones a drag down to zero
    // passes on its way.
    _keepUnmutedVolume() {
        if (this._volumeSlider.value > 0.001)
            this._unmutedVolume = this._volumeSlider.value;
    }

    // A file on disk or an inline picture (Telegram). Sandboxed players can
    // name files we cannot see, so the file is checked first.
    _artworkIcon(coverUrl) {
        if (!coverUrl)
            return null;

        if (coverUrl.startsWith('data:'))
            return this._inlineArtwork(coverUrl);

        const file = Gio.File.new_for_uri(coverUrl);
        if (file.has_uri_scheme('file')) {
            if (!file.query_exists(null))
                return null;
            const path = file.get_path();
            return {
                gicon: new Gio.FileIcon({file}),
                aspect: this._fileAspect(path),
                path,
            };
        }

        return {gicon: new Gio.FileIcon({file}), aspect: null, path: null};
    }

    _isRemoteArt(coverUrl) {
        return /^https?:\/\//i.test(coverUrl ?? '');
    }

    _fetchArtwork(coverUrl, tries) {
        const message = Soup.Message.new('GET', coverUrl);
        if (!message) {
            this._applyArtwork(null);
            return;
        }

        // Trailing space: libsoup appends its own name and version.
        this._artSession ??= new Soup.Session({
            timeout: REMOTE_ART_TIMEOUT,
            user_agent: 'nowplaying-card ',
        });
        const cancellable = new Gio.Cancellable();
        this._artCancellable = cancellable;
        this._artSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT,
            cancellable, (session, result) => {
                let artwork = null;
                try {
                    const bytes = session.send_and_read_finish(result);
                    if (message.get_status() === Soup.Status.OK)
                        artwork = this._bytesArtwork(bytes);
                } catch {
                    artwork = null;
                }
                if (cancellable.is_cancelled())
                    return;
                this._artCancellable = null;

                if (artwork || tries >= REMOTE_ART_TRIES) {
                    this._applyArtwork(artwork);
                    return;
                }

                // Next try on a fresh connection.
                session.abort();
                this._fetchArtwork(coverUrl, tries + 1);
            });
    }

    // Header only: the picture is not decoded to be measured.
    _fileAspect(path) {
        if (!path)
            return null;

        const [, width, height] = GdkPixbuf.Pixbuf.get_file_info(path);
        return width > 0 && height > 0 ? width / height : null;
    }

    // Everything the artwork decides in one place, so a picture that turns up
    // late lands the same way as one that was there from the start.
    _applyArtwork(artwork) {
        this._artwork = artwork;
        this._hasArtwork = artwork !== null;
        this._artAspect = artwork?.aspect ?? null;
        this._cover.gicon = artwork?.gicon ?? this._fallbackIcon(this._coverApp);
        this._badge.visible = this._hasArtwork && !!this._badge.gicon;
        this._syncCover();
    }

    // A file the player named but has not finished writing: either it is not
    // there at all yet, or its header cannot be read, which would leave the
    // card with the player's icon or a picture cropped as a square.
    _artworkPending(coverUrl, artwork) {
        if (!coverUrl?.startsWith('file://'))
            return false;

        return artwork === null || artwork.aspect === null;
    }

    // Another look, and another, until the picture is there and measured or
    // the player has had long enough to write it.
    _startArtRetry(coverUrl) {
        this._artRetryTries = 0;
        this._artRetryId = GLib.timeout_add(GLib.PRIORITY_DEFAULT,
            ART_RETRY_INTERVAL, () => {
                this._artRetryTries++;
                const artwork = this._artworkIcon(coverUrl);

                // A picture that arrived is worth showing even before it can
                // be measured; one that was measured replaces the square guess.
                if (artwork && (artwork.aspect !== null || !this._hasArtwork))
                    this._applyArtwork(artwork);

                if (this._artworkPending(coverUrl, artwork) &&
                    this._artRetryTries < ART_RETRIES)
                    return GLib.SOURCE_CONTINUE;

                this._artRetryId = null;
                return GLib.SOURCE_REMOVE;
            });
    }

    _stopArtRetry() {
        if (this._artRetryId) {
            GLib.source_remove(this._artRetryId);
            this._artRetryId = null;
        }
        this._artCancellable?.cancel();
        this._artCancellable = null;
    }

    // data:[<mediatype>][;base64],<payload>. GIO opens no such file, so the
    // bytes are decoded here and handed over as an icon of their own.
    _inlineArtwork(coverUrl) {
        const comma = coverUrl.indexOf(',');
        if (comma < 0)
            return null;

        const header = coverUrl.slice(0, comma);
        const payload = coverUrl.slice(comma + 1);

        let bytes;
        try {
            bytes = new GLib.Bytes(header.endsWith(';base64')
                ? GLib.base64_decode(payload)
                : new TextEncoder().encode(decodeURIComponent(payload)));
        } catch {
            return null;
        }

        return this._bytesArtwork(bytes);
    }

    _bytesArtwork(bytes) {
        // Bytes that no loader recognises are not artwork: drawing them would
        // leave an empty square where the player's own icon belongs. The
        // loader is fed only until it has seen the header, which is all the
        // aspect needs: decoding a whole image here would stall the shell,
        // and St decodes it anyway when the icon is drawn.
        let width = 0;
        let height = 0;
        const loader = new GdkPixbuf.PixbufLoader();
        loader.connect('size-prepared', (_loader, w, h) => {
            width = w;
            height = h;
        });
        try {
            const size = bytes.get_size();
            for (let offset = 0; offset < size && width === 0; offset += ART_CHUNK) {
                const length = Math.min(ART_CHUNK, size - offset);
                loader.write_bytes(GLib.Bytes.new_from_bytes(bytes, offset, length));
            }
        } catch {
            width = 0;
        }
        try {
            loader.close();
        } catch {
            // Closing a loader that has only seen a header is an error by
            // design; the size has already been reported by then. SVG is the
            // exception: it reports its size only here, on close.
        }
        if (width <= 0 || height <= 0)
            return null;

        return {gicon: new Gio.BytesIcon({bytes}), aspect: width / height, path: null};
    }

    _fallbackIcon(app) {
        return app?.get_icon() ??
            new Gio.ThemedIcon({name: 'audio-x-generic-symbolic'});
    }

    // The artist, the album, or nothing at all. A film or a file with no tags
    // used to get the player's own name here, which the icon beside the cover
    // has already said, and the line is dropped instead of standing empty.
    _subtitleText() {
        const artists = this._player.trackArtists.join(', ');
        const album = this._metadataValue('xesam:album');
        return [artists, typeof album === 'string' ? album : '']
            .filter(part => part)
            .join(' - ');
    }

    // Art sized against everything standing next to it, in the shape it came in.
    _syncCover() {
        if (!this._options || this._syncingCover)
            return;

        // Asking a card that is not on the stage yet how tall it is walks a
        // style tree that does not exist. The map below brings us back.
        if (!this.get_stage())
            return;

        const scale = scaleFactor();
        const [, columnHeight] = this._column.get_preferred_height(-1);
        const beside = Math.round(columnHeight / scale);
        const box = this._compact
            ? COMPACT_COVER_SIZE
            : Math.round(beside * this._options.coverSize);

        // The tile is a square as tall as the card, and the picture covers it:
        // its shorter side matches the square, the longer one runs past the
        // edges and the tile cuts it off there. A picture that could not be
        // measured is taken for a square, which is what most artwork is.
        let width = box;
        let height = box;
        if (this._hasArtwork && this._artAspect) {
            if (this._artAspect >= 1)
                width = Math.round(box * this._artAspect);
            else
                height = Math.round(box / this._artAspect);
        }

        // Without artwork there is only the player's own icon to show, and an
        // icon stretched to the height of a card is a poster, so it sits at a
        // readable size in the middle of the tile instead.
        const iconSize = this._hasArtwork
            ? Math.max(width, height)
            : Math.round(box * FALLBACK_ICON_RATIO);

        // The sizes below are set in the pixels the actor is drawn in, so the
        // scale factor belongs in what counts as unchanged: the same card on a
        // display that switched to 200% needs the same box twice as large.
        const geometry = `${box}:${width}x${height}:${iconSize}:${scale}`;
        if (this._coverGeometry === geometry)
            return;
        this._coverGeometry = geometry;

        this._syncingCover = true;
        this._cover.icon_size = iconSize;
        // Whatever the picture is, it sits in the middle of the square: art
        // that covers it reaches past two of the edges, and a fallback icon
        // stops well short of all four.
        const pictureWidth = this._hasArtwork ? width : iconSize;
        const pictureHeight = this._hasArtwork ? height : iconSize;
        this._cover.set_size(pictureWidth * scale, pictureHeight * scale);
        this._cover.set_position(Math.round((box - pictureWidth) * scale / 2),
            Math.round((box - pictureHeight) * scale / 2));
        this._coverTile.set_size(box * scale, box * scale);
        this._coverTile.remove_style_class_name('np-cover-empty');
        if (!this._hasArtwork)
            this._coverTile.add_style_class_name('np-cover-empty');
        this._syncingCover = false;
        this._placeBadge();
    }

    // The app icon belongs in the bottom right corner of the cover, a step
    // short of it to stay clear of the rounded corner.
    _placeBadge() {
        // Reading a size walks the style tree, and a card that has not reached
        // the stage yet has none. The map and the sizes that come with it bring
        // us back here.
        if (!this.get_stage())
            return;

        const scale = scaleFactor();

        // What the cover draws, not what it asked for: a card too narrow for
        // the size in the preferences moves the corner the badge belongs in.
        const tile = this._coverTile;
        const inset = BADGE_INSET * scale;
        this._badge.set_position(
            Math.round(tile.width - this._badge.width - inset),
            Math.round(tile.height - this._badge.height - inset));
    }

    _metadataValue(key) {
        return this._player.metadata[key];
    }

    _syncTrack() {
        // Compare normalized values: players that omit mpris:trackid would
        // otherwise look like they changed track on every property update.
        const rawTrackId = this._metadataValue('mpris:trackid');
        const rawLength = this._metadataValue('mpris:length');
        const trackId = typeof rawTrackId === 'string' ? rawTrackId : null;
        const lengthUs = typeof rawLength === 'number' && rawLength > 0 ? rawLength : 0;

        const trackChanged = trackId !== this._trackId || lengthUs !== this._lengthUs;
        this._trackId = trackId;
        this._lengthUs = lengthUs;

        this._showTime(this._positionUs);

        if (trackChanged) {
            this._setPositionUs(0);
            this._fetchPosition();
        }
    }

    // Elapsed on the left, what is left of the track on the right.
    _showTime(positionUs) {
        this._elapsedLabel.text = formatTime(positionUs);
        this._lengthLabel.text = this._lengthUs > 0
            ? `−${formatTime(Math.max(0, this._lengthUs - positionUs))}` : '';
    }

    // Players report every seek, including the ones triggered elsewhere.
    _onSeeked(positionUs) {
        if (this._dragging || this._seekPendingId)
            return;

        this._ignorePositionUntil = 0;
        this._setPositionUs(positionUs);
    }

    _setPositionUs(positionUs) {
        this._positionUs = Math.max(0, Math.min(positionUs, this._lengthUs));
        this._showTime(this._positionUs);

        // Never move the handle out from under the user.
        if (this._dragging || this._seekPendingId)
            return;

        const value = this._lengthUs > 0 ? this._positionUs / this._lengthUs : 0;
        this._settingValue = true;
        this._slider.value = value;
        this._settingValue = false;
    }

    _onSliderValue() {
        if (this._settingValue)
            return;

        const positionUs = Math.round(this._slider.value * this._lengthUs);
        this._showTime(positionUs);

        // Dragging seeks once on release; scroll and arrow keys have no drag,
        // so coalesce their steps into a single seek.
        if (this._dragging)
            return;

        if (this._seekPendingId)
            GLib.source_remove(this._seekPendingId);

        this._seekPendingId = GLib.timeout_add(GLib.PRIORITY_DEFAULT,
            SEEK_COALESCE_MS, () => {
                this._seekPendingId = null;
                this._seekToSlider();
                return GLib.SOURCE_REMOVE;
            });
    }

    _seekToSlider() {
        if (this._lengthUs <= 0)
            return;

        const targetUs = Math.round(this._slider.value * this._lengthUs);
        this._showTime(targetUs);
        this._seek(targetUs);
        this._positionUs = targetUs;
    }

    _fetchPosition() {
        if (this._lengthUs <= 0)
            return;

        this._player.getPosition(this._cancellable, position => {
            if (this._dragging || this._seekPendingId ||
                typeof position !== 'number')
                return;

            // Drop replies to requests that were already in flight when we
            // seeked; they still carry the old position.
            if (GLib.get_monotonic_time() < this._ignorePositionUntil)
                return;

            this._setPositionUs(position);
        });
    }

    _seek(targetUs) {
        if (!this._player.canSeek)
            return;

        // SetPosition needs a valid object path; players that hand out a
        // bogus mpris:trackid only get relative seeks.
        let trackPath = null;
        if (this._trackId && GLib.Variant.is_object_path(this._trackId))
            trackPath = this._trackId;

        if (trackPath)
            this._player.setPosition(trackPath, targetUs);
        else
            this._player.seek(targetUs - this._positionUs);

        // Position is not change-notified, and players update it lazily.
        this._ignorePositionUntil = GLib.get_monotonic_time() + SEEK_GUARD_MS * 1000;
        this._schedulePoll(SEEK_SETTLE_MS);
    }

    _updatePoll() {
        const wanted = this.mapped && this.playing && this._lengthUs > 0;
        if (wanted && this._pollId === null)
            this._schedulePoll(POLL_MS);
        else if (!wanted && this._pollId !== null)
            this._stopPoll();
    }

    _schedulePoll(delayMs) {
        this._stopPoll();
        this._pollId = GLib.timeout_add(GLib.PRIORITY_LOW, delayMs, () => {
            this._pollId = null;
            this._fetchPosition();
            this._updatePoll();
            return GLib.SOURCE_REMOVE;
        });
    }

    _stopPoll() {
        if (this._pollId !== null) {
            GLib.source_remove(this._pollId);
            this._pollId = null;
        }
    }

    _onDestroy() {
        this._stopPoll();
        this._stopArtRetry();
        this._artSession?.abort();
        if (this._seekPendingId) {
            GLib.source_remove(this._seekPendingId);
            this._seekPendingId = null;
        }
        if (this._volumePendingId) {
            GLib.source_remove(this._volumePendingId);
            this._volumePendingId = null;
        }
        this._cancellable.cancel();
        this._slider.disconnectObject(this);
        this._volumeSlider.disconnectObject(this);
        this._player.disconnectObject(this);
    }
});

function formatTime(microseconds) {
    const total = Math.max(0, Math.floor(microseconds / 1000000));
    const seconds = total % 60;
    const minutes = Math.floor(total / 60) % 60;
    const hours = Math.floor(total / 3600);
    const pad = value => value.toString().padStart(2, '0');

    return hours > 0
        ? `${hours}:${pad(minutes)}:${pad(seconds)}`
        : `${pad(minutes)}:${pad(seconds)}`;
}

const CardStack = GObject.registerClass(
class CardStack extends St.BoxLayout {
    _init(closeMenu, keepVisible) {
        super._init({
            style_class: 'np-stack',
            ...VERTICAL,
            x_expand: true,
        });

        this._closeMenu = closeMenu;
        this._keepVisible = keepVisible;
        this._cards = new Map();
        this._layout = 'auto';
        this._options = CARD_OPTIONS;
        this._manualCard = null;
        this._expandedCard = null;

        this._placeholder = new St.Label({
            style_class: 'np-placeholder',
            text: _('Nothing playing'),
        });
        this.add_child(this._placeholder);

        followInk(this);
        this._syncVisibility();
    }

    addPlayer(player) {
        if (this._cards.has(player))
            return;

        const card = new MediaCard(player, this._closeMenu);
        card.setOptions(this._options);
        card.connect('expand-request', () => this._onExpandRequest(card));
        this._cards.set(player, card);
        this.add_child(card);
        this._syncVisibility();
        this._syncLayout();
        this._syncOrder();
    }

    removePlayer(player) {
        if (this._manualCard === this._cards.get(player))
            this._manualCard = null;
        this._cards.get(player)?.destroy();
        this._cards.delete(player);
        this._syncVisibility();
        this._syncLayout();
        this._syncOrder();
    }

    setOptions(options) {
        this._options = options;
        this._cards.forEach(card => card.setOptions(options));
        this._syncLayout();
        this._syncOrder();
    }

    // Clicking the card that is already open closes it, so a stack can also be
    // all compact; clicking any other one moves the expansion over.
    _onExpandRequest(card) {
        this._manualCard = card === this._expandedCard ? 'none' : card;
        this._syncLayout();
    }

    // Every visit starts from what is playing. A pick that is still the one
    // playing survives the popup being closed, so a stack someone arranged
    // stays arranged; a stack left collapsed, or opened on a player that has
    // since gone quiet, opens on the one making the noise instead.
    onMenuOpened() {
        if (this._manualCard === null)
            return;

        const anyPlaying = [...this._cards.values()].some(card => card.playing);
        if (this._manualCard !== 'none' &&
            (this._manualCard.playing || !anyPlaying))
            return;

        this._manualCard = null;
        this._syncLayout();
    }

    // The player someone picked stays picked for as long as it is around.
    // Until then, whatever is playing is the one worth seeing in full.
    _expandedCandidate(cards) {
        if (this._manualCard === 'none')
            return null;
        if (cards.includes(this._manualCard))
            return this._manualCard;

        this._manualCard = null;
        return cards.find(card => card.playing) ?? cards[0] ?? null;
    }

    // Whatever is playing first, the rest in the order they turned up in.
    _ranked() {
        return [...this._cards.values()]
            .sort((a, b) => Number(b.playing) - Number(a.playing));
    }

    // The cards the popup has room for. A player that is playing is always one
    // of them, whichever order the preferences ask for: the quiet ones give up
    // their place first, and the ones past the limit are hidden rather than
    // dropped, so a card comes straight back when a place frees up.
    _shownCards() {
        return this._ranked().slice(0, this._options.maxCards);
    }

    // Whatever is playing belongs on top, the rest keep the order they turned
    // up in. Children are only moved when the order really changed: a property
    // update must not shuffle the cards under the pointer.
    _syncOrder() {
        const cards = [...this._cards.values()];
        const shown = new Set(this._shownCards());
        const wanted = this._options.sortPlayingFirst ? this._ranked() : cards;

        // The placeholder is the first child and stays there.
        wanted.forEach((card, index) => {
            card.visible = shown.has(card);
            if (this.get_child_at_index(index + 1) !== card)
                this.set_child_at_index(card, index + 1);
        });
    }

    setLayout(layout) {
        if (layout === this._layout)
            return;

        this._layout = layout;
        this._syncLayout();
    }

    _syncLayout() {
        const cards = this._shownCards();
        // Several players share the popup as an accordion: one card open, the
        // rest as one-line rows. A fixed size from the preferences is a fixed
        // size, and nothing expands.
        const accordion = this._layout === 'auto' && cards.length > 1;
        this._expandedCard = accordion ? this._expandedCandidate(cards) : null;

        cards.forEach(card => {
            card.setCompact(accordion
                ? card !== this._expandedCard : this._layout === 'compact');
            card.setExpandable(accordion);
        });
    }

    _syncVisibility() {
        const hasPlayers = this._cards.size > 0;
        this._placeholder.visible = !hasPlayers;
        this.visible = hasPlayers || this._keepVisible;
    }

    get anyPlaying() {
        return [...this._cards.values()].some(card => card.playing);
    }

    get nPlayers() {
        return this._cards.size;
    }
});

// A small MPRIS client of our own. The shell has one, but it keeps the
// proxies private and exposes neither the position nor the seek calls.
class MprisPlayer extends Signals.EventEmitter {
    constructor(busName) {
        super();

        this._busName = busName;
        this._closed = false;
        this._canPlay = false;
        this._metadata = {};
        this._trackArtists = [];
        this._trackTitle = '';
        this._trackCoverUrl = '';
        this._desktopEntry = '';
        this._app = null;
        this._seekedId = 0;
        this._pid = 0;
        this._retryId = null;
        this._retries = 0;
        this._cancellable = new Gio.Cancellable();

        // Players that name no .desktop file can still be identified through
        // the process that owns the bus name.
        Gio.DBus.session.call('org.freedesktop.DBus', '/org/freedesktop/DBus',
            'org.freedesktop.DBus', 'GetConnectionUnixProcessID',
            new GLib.Variant('(s)', [busName]), new GLib.VariantType('(u)'),
            Gio.DBusCallFlags.NONE, -1, this._cancellable, (bus, result) => {
                try {
                    [this._pid] = bus.call_finish(result).deepUnpack();
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        console.debug(`nowplaying: no pid for ${busName}: ${e.message}`);
                }
            });

        this._mprisProxy = new MprisProxy(Gio.DBus.session, busName, MPRIS_PATH,
            (proxy, error) => this._onMprisReady(error));
        this._playerProxy = new PlayerProxy(Gio.DBus.session, busName, MPRIS_PATH,
            (proxy, error) => this._onPlayerReady(error));
    }

    get busName() {
        return this._busName;
    }

    get canPlay() {
        return this._canPlay;
    }

    get status() {
        return this._playerProxy?.PlaybackStatus ?? 'Stopped';
    }

    get metadata() {
        return this._metadata;
    }

    get trackTitle() {
        return this._trackTitle;
    }

    get trackArtists() {
        return this._trackArtists;
    }

    get trackCoverUrl() {
        return this._trackCoverUrl;
    }

    get app() {
        return this._app;
    }

    get canGoNext() {
        return !!this._playerProxy?.CanGoNext;
    }

    get canGoPrevious() {
        return !!this._playerProxy?.CanGoPrevious;
    }

    get canSeek() {
        return !!this._playerProxy?.CanSeek;
    }

    get canControl() {
        // Plenty of players leave it out; the spec's own default is true.
        return this._playerProxy?.CanControl ?? true;
    }

    get hasVolume() {
        return this._hasProperty(this._playerProxy, 'Volume');
    }

    get volume() {
        const volume = this._playerProxy?.Volume;
        return typeof volume === 'number' ? volume : null;
    }

    get hasLoop() {
        return this._hasProperty(this._playerProxy, 'LoopStatus');
    }

    get loopStatus() {
        const status = this._playerProxy?.LoopStatus;
        return typeof status === 'string' ? status : null;
    }

    get hasShuffle() {
        return this._hasProperty(this._playerProxy, 'Shuffle');
    }

    get shuffle() {
        const shuffle = this._playerProxy?.Shuffle;
        return typeof shuffle === 'boolean' ? shuffle : null;
    }

    playPause() {
        this._playerProxy?.PlayPauseAsync().catch(this._logCall('PlayPause'));
    }

    next() {
        this._playerProxy?.NextAsync().catch(this._logCall('Next'));
    }

    previous() {
        this._playerProxy?.PreviousAsync().catch(this._logCall('Previous'));
    }

    seek(offsetUs) {
        this._playerProxy?.SeekAsync(offsetUs).catch(this._logCall('Seek'));
    }

    setPosition(trackId, positionUs) {
        this._playerProxy?.SetPositionAsync(trackId, positionUs)
            .catch(this._logCall('SetPosition'));
    }

    setVolume(volume) {
        this._setProperty('Volume',
            new GLib.Variant('d', Math.max(0, Math.min(1, volume))));
    }

    setLoopStatus(status) {
        this._setProperty('LoopStatus', new GLib.Variant('s', status));
    }

    setShuffle(shuffle) {
        this._setProperty('Shuffle', new GLib.Variant('b', shuffle));
    }

    // Written through the properties interface: the setters the proxy wrapper
    // generates drop the reply, so a player refusing the write would go
    // unnoticed. Players that do not announce the change themselves get their
    // cached value corrected by hand.
    _setProperty(name, value) {
        if (this._closed)
            return;

        Gio.DBus.session.call(this._busName, MPRIS_PATH, PROPERTIES_IFACE, 'Set',
            new GLib.Variant('(ssv)', [PLAYER_IFACE, name, value]),
            null, Gio.DBusCallFlags.NONE, -1, this._cancellable,
            (bus, result) => {
                try {
                    bus.call_finish(result);
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        console.debug(`nowplaying: writing ${name} failed: ${e.message}`);
                    return;
                }

                if (this._closed)
                    return;

                this._playerProxy?.set_cached_property(name, value);
                this._update();
            });
    }

    // Focus the window the player already has. Activating a .desktop file the
    // shell does not consider running starts a second copy instead, and a
    // player in a flatpak or a snap regularly fails to match its own window.
    raise() {
        const window = this._findWindow();
        if (window) {
            Main.activateWindow(window);
            return;
        }

        // No window to focus: ask the player, and only launch as a last resort.
        if (this._mprisProxy?.CanRaise) {
            this._mprisProxy.RaiseAsync().catch(this._logCall('Raise'));
            return;
        }

        this._app?.activate();
    }

    _findWindow() {
        const appWindows = this._app?.get_windows() ?? [];
        if (appWindows.length > 0)
            return appWindows[0];

        const windows = global.display.list_all_windows();

        // The process that owns the bus name, when the host can see it.
        if (this._pid > 0) {
            const byPid = windows.find(window => window.get_pid() === this._pid);
            if (byPid)
                return byPid;
        }

        // Otherwise go by what the window calls itself: "Spotify" against
        // com.spotify.Client, "brave-browser" against brave, and so on.
        const wanted = this._wantedNames().filter(name => name.length >= 3);
        return windows.find(window => {
            const wmClass = window.get_wm_class()?.toLowerCase();
            return wmClass?.length >= 3 && wanted.some(name =>
                name.includes(wmClass) || wmClass.includes(name));
        }) ?? null;
    }

    // True when one of the names the player is known by contains the given
    // name. Preferences spell players the way a person sees them: an app id, a
    // bus name, or whatever the player calls itself.
    matches(name) {
        return this._wantedNames().some(known => known.includes(name));
    }

    // Every name this player is known by, lowercased.
    _wantedNames() {
        // org.mpris.MediaPlayer2.firefox.instance_1_42 -> firefox
        const busBase = this._busName.slice(MPRIS_PREFIX.length).split('.')[0];
        return [this._mprisProxy?.DesktopEntry, busBase, this._mprisProxy?.Identity]
            .filter(name => name)
            .map(name => name.toLowerCase());
    }

    // Position has to be polled: the spec leaves it out of PropertiesChanged.
    getPosition(cancellable, callback) {
        if (this._closed)
            return;

        Gio.DBus.session.call(
            this._busName, MPRIS_PATH, PROPERTIES_IFACE, 'Get',
            new GLib.Variant('(ss)', [PLAYER_IFACE, 'Position']),
            new GLib.VariantType('(v)'), Gio.DBusCallFlags.NONE, -1, cancellable,
            (bus, result) => {
                try {
                    const [variant] = bus.call_finish(result).deepUnpack();
                    callback(variant.deepUnpack());
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        console.debug(`nowplaying: reading Position failed: ${e.message}`);
                }
            });
    }

    // A player is free to take its bus name before it exports the objects, and
    // then both proxies start out with an empty property cache. Nothing tells
    // us when the objects appear, so the properties are asked for again.
    _ensureProperties() {
        // A proxy that failed after close() still lands here.
        if (this._closed)
            return;
        const missing = [];
        if (!this._hasProperty(this._mprisProxy, 'Identity'))
            missing.push([this._mprisProxy, MPRIS_IFACE]);
        if (!this._hasProperty(this._playerProxy, 'CanPlay'))
            missing.push([this._playerProxy, PLAYER_IFACE]);

        if (missing.length === 0) {
            this._retries = 0;
            return;
        }
        if (this._retryId || this._retries >= PROPERTY_RETRIES)
            return;

        this._retries++;
        this._retryId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PROPERTY_RETRY_MS,
            () => {
                this._retryId = null;
                missing.forEach(([proxy, iface]) => this._fetchProperties(proxy, iface));
                return GLib.SOURCE_REMOVE;
            });
    }

    _hasProperty(proxy, name) {
        return !!proxy?.get_cached_property_names()?.includes(name);
    }

    _fetchProperties(proxy, iface) {
        Gio.DBus.session.call(this._busName, MPRIS_PATH, PROPERTIES_IFACE,
            'GetAll', new GLib.Variant('(s)', [iface]),
            new GLib.VariantType('(a{sv})'), Gio.DBusCallFlags.NONE, -1,
            this._cancellable, (bus, result) => {
                let properties;
                try {
                    [properties] = bus.call_finish(result).deepUnpack();
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        console.debug(`nowplaying: ${this._busName}: ${e.message}`);
                    if (!this._closed)
                        this._ensureProperties();
                    return;
                }

                if (this._closed)
                    return;

                // GetAll answers with everything the player has, including
                // properties our interface does not declare.
                const info = proxy.get_interface_info();
                for (const [name, value] of Object.entries(properties)) {
                    if (info?.lookup_property(name))
                        proxy.set_cached_property(name, value);
                }
                this._update();
            });
    }

    close() {
        if (this._closed)
            return;
        this._closed = true;
        this._canPlay = false;
        this._cancellable.cancel();

        if (this._retryId) {
            GLib.source_remove(this._retryId);
            this._retryId = null;
        }

        if (this._seekedId) {
            this._playerProxy?.disconnectSignal(this._seekedId);
            this._seekedId = 0;
        }
        this._mprisProxy?.disconnectObject(this);
        this._mprisProxy = null;
        this._playerProxy?.disconnectObject(this);
        this._playerProxy = null;

        this.emit('closed');
    }

    // Kept out of the getters: the answer can change while the player runs,
    // and a failed lookup is worth retrying. Packaging is the reason for the
    // three steps: what a player reports about itself often does not match
    // what is installed on the host.
    _resolveApp() {
        const entry = this._mprisProxy?.DesktopEntry ?? '';
        if (entry !== this._desktopEntry) {
            this._desktopEntry = entry;
            this._app = null;
        }

        if (this._app)
            return;

        const appSystem = Shell.AppSystem.get_default();

        // 1. The .desktop file the player names, when the host has it.
        if (entry)
            this._app = appSystem.lookup_app(`${entry}.desktop`);

        // 2. The window of the process that owns the bus name. Catches
        //    browsers and players in a flatpak or snap, which report a name
        //    that only exists inside their own sandbox, or none at all.
        if (!this._app && this._pid > 0) {
            this._app = Shell.WindowTracker.get_default()
                .get_app_from_pid(this._pid);
        }

        // 3. What the player calls itself, for players without a window.
        if (!this._app)
            this._app = this._matchInstalledApp(entry, appSystem);
    }

    _matchInstalledApp(entry, appSystem) {
        const wanted = this._wantedNames();

        if (wanted.length === 0)
            return null;

        let partial = null;

        for (const info of appSystem.get_installed()) {
            const id = info.get_id().replace(/\.desktop$/, '').toLowerCase();
            const name = info.get_name()?.toLowerCase() ?? '';

            if (wanted.includes(id) || wanted.includes(name))
                return appSystem.lookup_app(info.get_id());

            // Weaker, and only used when nothing matches outright: a player
            // saying "Chrome" against an installed "Google Chrome".
            const words = name.split(/[^\p{L}\p{N}]+/u);
            if (!partial && wanted.some(word => words.includes(word)))
                partial = appSystem.lookup_app(info.get_id());
        }

        return partial;
    }

    _logCall(method) {
        return e => console.debug(`nowplaying: ${method} failed: ${e.message}`);
    }

    _onMprisReady(error) {
        if (error || this._closed) {
            if (error)
                console.debug(`nowplaying: ${this._busName}: ${error.message}`);
            return;
        }

        this._mprisProxy.connectObject('notify::g-name-owner', () => {
            if (!this._mprisProxy?.g_name_owner)
                this.close();
        }, this);

        // The player may have quit while the proxy was still being set up.
        if (!this._mprisProxy.g_name_owner)
            this.close();
        else
            this._update();
    }

    _onPlayerReady(error) {
        if (error || this._closed) {
            if (error) {
                console.debug(`nowplaying: ${this._busName}: ${error.message}`);
                this._ensureProperties();
            }
            return;
        }

        this._playerProxy.connectObject(
            'g-properties-changed', () => this._update(), this);
        this._seekedId = this._playerProxy.connectSignal('Seeked',
            (proxy, sender, [positionUs]) => this.emit('seeked', positionUs));

        this._update();
    }

    // A player with nothing to say about the track still says what it opened:
    // VLC playing a file with no tags sends only xesam:url, and the name of
    // the file beats naming the player twice. Local files only, since a page
    // address is not a title and browsers send one anyway.
    _titleFromUrl(url) {
        if (typeof url !== 'string' || !url.startsWith('file://'))
            return '';

        const name = Gio.File.new_for_uri(url).get_basename();
        if (!name || name === '/' || name === '.')
            return '';

        const dot = name.lastIndexOf('.');
        return dot > 0 ? name.slice(0, dot) : name;
    }

    _update() {
        const metadata = {};
        const raw = this._playerProxy?.Metadata ?? {};
        for (const key in raw)
            metadata[key] = raw[key].deepUnpack();
        this._metadata = metadata;

        // Players are known to send metadata that does not match the spec, so
        // everything that reaches the screen gets checked.
        const artists = metadata['xesam:artist'];
        this._trackArtists = Array.isArray(artists)
            ? artists.filter(artist => typeof artist === 'string')
            : [];

        const title = metadata['xesam:title'];
        this._trackTitle = typeof title === 'string' && title
            ? title
            : this._titleFromUrl(metadata['xesam:url']);

        const coverUrl = metadata['mpris:artUrl'];
        this._trackCoverUrl = typeof coverUrl === 'string' ? coverUrl : '';

        this._resolveApp();

        this._canPlay = !!this._playerProxy?.CanPlay;
        this.emit('changed');
        this._ensureProperties();
    }
}

// Tracks the MPRIS players on the session bus and reports the ones that have
// something to play.
class MprisSource extends Signals.EventEmitter {
    constructor() {
        super();

        this._players = new Map();
        this._visible = new Set();
        this._cancellable = new Gio.Cancellable();

        this._nameWatchId = Gio.DBus.session.signal_subscribe(
            'org.freedesktop.DBus', 'org.freedesktop.DBus', 'NameOwnerChanged',
            '/org/freedesktop/DBus', null, Gio.DBusSignalFlags.NONE,
            (bus, sender, path, iface, signal, params) => {
                const [name, oldOwner, newOwner] = params.deepUnpack();
                if (!name.startsWith(MPRIS_PREFIX))
                    return;
                if (oldOwner)
                    this._removePlayer(name);
                if (newOwner)
                    this._addPlayer(name);
            });

        Gio.DBus.session.call('org.freedesktop.DBus', '/org/freedesktop/DBus',
            'org.freedesktop.DBus', 'ListNames', null,
            new GLib.VariantType('(as)'), Gio.DBusCallFlags.NONE, -1,
            this._cancellable, (bus, result) => {
                let names;
                try {
                    [names] = bus.call_finish(result).deepUnpack();
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        logError(e);
                    return;
                }
                names.filter(name => name.startsWith(MPRIS_PREFIX))
                    .forEach(name => this._addPlayer(name));
            });
    }

    get players() {
        return [...this._visible];
    }

    _addPlayer(busName) {
        if (this._players.has(busName))
            return;

        const player = new MprisPlayer(busName);
        this._players.set(busName, player);

        player.connectObject(
            'changed', () => this._syncPlayer(player),
            'closed', () => this._removePlayer(busName),
            this);
    }

    _syncPlayer(player) {
        if (player.canPlay === this._visible.has(player))
            return;

        if (player.canPlay) {
            this._visible.add(player);
            this.emit('player-added', player);
        } else {
            this._visible.delete(player);
            this.emit('player-removed', player);
        }
    }

    _removePlayer(busName) {
        const player = this._players.get(busName);
        if (!player)
            return;

        this._players.delete(busName);
        if (this._visible.delete(player))
            this.emit('player-removed', player);
        player.disconnectObject(this);
        player.close();
    }

    destroy() {
        this._cancellable.cancel();
        if (this._nameWatchId) {
            Gio.DBus.session.signal_unsubscribe(this._nameWatchId);
            this._nameWatchId = 0;
        }
        this._players.forEach(player => {
            player.disconnectObject(this);
            player.close();
        });
        this._players.clear();
        this._visible.clear();
    }
}

// Owns the MPRIS source and the two actors a host displays: the panel
// equalizer and the card stack. The host decides where they go.
class MediaModel {
    constructor(settings, {keepStackVisible, closeMenu}) {
        this._settings = settings;
        this._players = new Set();
        this._shown = new Set();

        this._analyzer = new SpectrumAnalyzer();
        this.equalizer = new EqualizerIcon();
        this.stack = new CardStack(closeMenu, keepStackVisible);

        this._source = new MprisSource();
        this._source.connectObject(
            'player-added', (_s, player) => this._addPlayer(player),
            'player-removed', (_s, player) => this._removePlayer(player),
            this);

        this._source.players.forEach(player => this._addPlayer(player));
        this.sync();
    }

    _addPlayer(player) {
        this._players.add(player);
        player.connectObject('changed', () => this.sync(), this);
        this.sync();
    }

    _removePlayer(player) {
        player.disconnectObject(this);
        this._players.delete(player);
        if (this._shown.delete(player))
            this.stack.removePlayer(player);
        this.sync();
    }

    // Which players get a card. Decided on every sync, because a player only
    // says what it is once its properties arrive, which can be after it
    // appeared on the bus.
    _syncPlayers() {
        const ignored = readSetting(this._settings, 'ignored-players')
            .map(name => name.toLowerCase().trim())
            .filter(name => name);

        for (const player of this._players) {
            const wanted = !ignored.some(name => player.matches(name));

            if (wanted && !this._shown.has(player)) {
                this._shown.add(player);
                this.stack.addPlayer(player);
            } else if (!wanted && this._shown.has(player)) {
                this._shown.delete(player);
                this.stack.removePlayer(player);
            }
        }
    }

    // True when the host should show its panel button at all. Hidden for good
    // is a choice of its own: in Quick Settings the card stays where it is,
    // only the icon beside the other indicators goes.
    get shouldShow() {
        const visibility = readSetting(this._settings, 'indicator-visibility');
        if (visibility === 'never')
            return false;

        return this._shown.size > 0 || visibility === 'always';
    }

    // The player the panel icon acts on: the one that is playing, or the
    // first one that turned up.
    get activePlayer() {
        let first = null;
        for (const player of this._shown) {
            if (player.status === 'Playing')
                return player;
            first ??= player;
        }
        return first;
    }

    playPause() {
        this.activePlayer?.playPause();
    }

    next() {
        this.activePlayer?.next();
    }

    previous() {
        this.activePlayer?.previous();
    }

    // Answers whether the step landed, so the panel can leave the event alone
    // when there is nothing to turn.
    adjustVolume(delta) {
        const player = this.activePlayer;
        const volume = player?.hasVolume ? player.volume : null;
        if (volume === null)
            return false;

        player.setVolume(volume + delta);
        return true;
    }

    sync() {
        this._syncPlayers();
        this.stack.setLayout(readSetting(this._settings, 'card-layout'));
        this.stack.setOptions(this._readOptions());
        const spectrum = readSetting(this._settings, 'show-spectrum');
        this.equalizer.animate = readSetting(this._settings, 'animate-icon');
        this.equalizer.iconStyle = spectrum
            ? 'spectrum' : readSetting(this._settings, 'equalizer-style');
        this.equalizer.setSpectrum({
            shape: readSetting(this._settings, 'spectrum-shape'),
            colors: readSetting(this._settings, 'spectrum-colors'),
            columns: readSetting(this._settings, 'spectrum-columns'),
            peaks: readSetting(this._settings, 'spectrum-peaks'),
        });
        this.equalizer.analyzer = spectrum ? this._analyzer : null;
        this.equalizer.playing = this.stack.anyPlaying;
        this.notifyVisibility?.();
    }

    _readOptions() {
        const size = readSetting(this._settings, 'cover-size');
        return {
            coverSize: COVER_SIZES[size] ?? COVER_SIZES.medium,
            showProgress: readSetting(this._settings, 'show-progress'),
            showVolume: readSetting(this._settings, 'show-volume'),
            showLoopShuffle: readSetting(this._settings, 'show-loop-shuffle'),
            sortPlayingFirst: readSetting(this._settings, 'sort-playing-first'),
            scrollText: readSetting(this._settings, 'scroll-text'),
            animate: readSetting(this._settings, 'animate-icon'),
            equalizerStyle: readSetting(this._settings, 'equalizer-style'),
            analyzer: readSetting(this._settings, 'show-spectrum')
                ? this._analyzer : null,
            maxCards: readSetting(this._settings, 'max-cards'),
        };
    }

    destroy() {
        this._source?.disconnectObject(this);
        this._source?.destroy();
        this._source = null;
        this._players.forEach(player => player.disconnectObject(this));
        this._players.clear();
        this._shown.clear();
        this.stack?.destroy();
        this.stack = null;
        this.equalizer?.destroy();
        this.equalizer = null;
        this._analyzer?.destroy();
        this._analyzer = null;
        this.notifyVisibility = null;
    }
}

// Host 1: own panel button with its own popup, position set in preferences.
const NowPlayingButton = GObject.registerClass(
class NowPlayingButton extends PanelMenu.Button {
    _init(settings, openPreferences) {
        super._init(0.5, _('Now Playing'));
        followInk(this);

        this._settings = settings;
        this._scrollDelta = 0;

        this._model = new MediaModel(settings, {
            keepStackVisible: true,
            closeMenu: () => this.menu.close(),
        });
        this._model.notifyVisibility = () => this._syncVisibility();

        // A crowded panel hands the button less room than it asked for, and
        // PanelMenu.ButtonBox answers that by dropping to the minimum padding
        // and giving the whole rest of the box to its child. A box layout packs
        // what it holds against its start, so the spare room piles up after the
        // last child and the icon sits left of the plate drawn around it. The
        // group is centred inside that room instead.
        const box = new St.BoxLayout({
            style_class: 'np-panel-box',
            x_align: Clutter.ActorAlign.CENTER,
        });
        const center = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
        });
        center.add_child(box);
        box.add_child(this._model.equalizer);
        this.add_child(center);

        // The track can be read straight from the panel, cut to the width the
        // preferences allow and scrolled when it does not fit.
        this._panelLabel = new ScrollingLabel('np-panel-label');
        this._panelLabel.y_align = Clutter.ActorAlign.CENTER;
        box.add_child(this._panelLabel);

        // The transport in the panel too, for switching a track without
        // opening anything.
        this._controls = new St.BoxLayout({
            style_class: 'np-panel-controls',
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(this._controls);

        this._prevButton = this._addPanelControl('media-seek-backward-symbolic',
            () => this._model.previous(), -PRESS_NUDGE);
        this._playButton = this._addPanelControl('media-playback-start-symbolic',
            () => this._model.playPause());
        this._nextButton = this._addPanelControl('media-seek-forward-symbolic',
            () => this._model.next(), PRESS_NUDGE);

        if (HAS_CLICK_GESTURE) {
            this._clickGesture?.set_enabled(false);
            this._addGesture(this, Clutter.BUTTON_PRIMARY, () => {
                if (!this._pointerOverControls())
                    this.menu.toggle();
            });
            this._addGesture(this, Clutter.BUTTON_MIDDLE,
                () => this._middleClickAction());
            this._addGesture(this, Clutter.BUTTON_SECONDARY,
                () => this._contextMenu.toggle());
        }

        this.menu.box.add_style_class_name('np-menu');
        this.menu.box.add_child(this._model.stack);

        this.menu.connectObject('open-state-changed', (_menu, open) => {
            if (open)
                this._model.stack.onMenuOpened();
        }, this);

        this._buildContextMenu(openPreferences);

        this.connect('popup-menu', () => {
            if (!this._contextMenu.isOpen)
                this._contextMenu.toggle();
            this._contextMenu.actor.navigate_focus(null,
                St.DirectionType.TAB_FORWARD, false);
        });

        this._syncVisibility();
    }

    // Its own manager: the panel's one finds menus by source actor and would
    // swap this one for the card on hover.
    _buildContextMenu(openPreferences) {
        this._contextMenu = new PopupMenu.PopupMenu(this, 0.5, St.Side.TOP);
        this._contextMenu.actor.add_style_class_name('panel-menu');
        Main.uiGroup.add_child(this._contextMenu.actor);
        this._contextMenu.actor.hide();

        this._contextMenuManager = new PopupMenu.PopupMenuManager(this);
        this._contextMenuManager.addMenu(this._contextMenu);

        this._visibilityItems = new Map();
        const choices = [
            ['always', _('Always Show in Top Bar')],
            ['active', _('Show When Active')],
            ['never', _('Don\'t Show in Top Bar')],
        ];
        for (const [value, label] of choices) {
            const item = this._contextMenu.addAction(label,
                () => this._settings.set_string('indicator-visibility', value));
            this._visibilityItems.set(value, item);
        }

        this._contextMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._contextMenu.addAction(_('Settings'), () => openPreferences());

        this._contextMenu.connectObject('open-state-changed', (_menu, open) => {
            if (open)
                this.add_style_pseudo_class('active');
            else
                this.remove_style_pseudo_class('active');
        }, this);
    }

    _syncContextMenu() {
        const current = readSetting(this._settings, 'indicator-visibility');
        for (const [value, item] of this._visibilityItems)
            item.setOrnament(value === current
                ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
    }

    // A button of its own inside the panel button. It answers the press and the
    // menu stays shut, so a track can be changed without the popup appearing.
    _addPanelControl(iconName, callback, nudge = 0) {
        const button = new St.Button({
            style_class: 'np-panel-control',
            can_focus: true,
            child: new St.Icon({
                icon_name: iconName,
                icon_size: PANEL_CONTROL_ICON_SIZE,
            }),
        });

        const act = () => {
            animatePress(button, nudge);
            callback();
        };

        if (HAS_CLICK_GESTURE)
            this._addGesture(button, Clutter.BUTTON_PRIMARY, act);
        else
            button.connect('clicked', act);

        this._controls.add_child(button);
        return button;
    }

    _addGesture(actor, mouseButton, callback) {
        const gesture = new Clutter.ClickGesture();
        gesture.set_n_clicks_required(1);
        gesture.set_required_button?.(mouseButton);
        gesture.set_recognize_on_press?.(true);
        gesture.connect('recognize', () => {
            callback();
            return Clutter.EVENT_STOP;
        });
        actor.add_action(gesture);
        return gesture;
    }

    // A press that landed on the transport belongs to it, not to the menu: the
    // gesture on the whole button cannot tell where it started on its own.
    _pointerOverControls() {
        if (!this._controls.visible)
            return false;

        const [x, y] = global.get_pointer();
        const actor = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y);
        return !!actor && this._controls.contains(actor);
    }

    // Older shells open the menu from the generic event signal, so there the
    // wheel and the middle and right buttons have to be answered first.
    vfunc_event(event) {
        const type = event.type();

        if (type === Clutter.EventType.SCROLL && this._onScroll(event))
            return Clutter.EVENT_STOP;

        // Newer shells answer the buttons with gestures, and St.Widget has no
        // event vfunc to chain into.
        if (HAS_CLICK_GESTURE)
            return Clutter.EVENT_PROPAGATE;

        const middle = (type === Clutter.EventType.BUTTON_PRESS ||
            type === Clutter.EventType.BUTTON_RELEASE) &&
            event.get_button() === Clutter.BUTTON_MIDDLE;

        if (middle && this._middleClickAction())
            return Clutter.EVENT_STOP;

        if (type === Clutter.EventType.BUTTON_PRESS &&
            event.get_button() === Clutter.BUTTON_SECONDARY) {
            this._contextMenu.toggle();
            return Clutter.EVENT_STOP;
        }

        return super.vfunc_event(event);
    }

    _onScroll(event) {
        const mode = readSetting(this._settings, 'panel-scroll');
        if (mode === 'none')
            return false;

        const step = this._scrollStep(event);

        // Zero means the gesture has not travelled far enough yet; the event is
        // still ours, or the leftover would open the menu.
        if (step === 0)
            return true;

        if (mode === 'volume')
            return this._model.adjustVolume(-step * VOLUME_STEP);

        if (step < 0)
            this._model.next();
        else
            this._model.previous();

        return true;
    }

    // Wheels click, touchpads slide: a touchpad sends a stream of small deltas
    // and one notch of travel has to stay one action.
    _scrollStep(event) {
        const direction = event.get_scroll_direction();

        if (direction === Clutter.ScrollDirection.UP)
            return -1;
        if (direction === Clutter.ScrollDirection.DOWN)
            return 1;
        if (direction !== Clutter.ScrollDirection.SMOOTH)
            return 0;

        const [, dy] = event.get_scroll_delta();
        if (Math.sign(dy) !== Math.sign(this._scrollDelta))
            this._scrollDelta = 0;

        this._scrollDelta += dy;
        if (Math.abs(this._scrollDelta) < SCROLL_NOTCH)
            return 0;

        this._scrollDelta = 0;
        return Math.sign(dy);
    }

    _middleClickAction() {
        const action = readSetting(this._settings, 'panel-middle-click');
        if (action === 'none' || !this._model.activePlayer)
            return false;

        if (action === 'next')
            this._model.next();
        else
            this._model.playPause();

        return true;
    }

    _syncVisibility() {
        this._syncLabel();
        this._syncIcon();
        this._syncControls();
        this._syncContextMenu();
        this.visible = this._model.shouldShow;
    }

    _syncControls() {
        const player = this._model.activePlayer;
        const wanted = readSetting(this._settings, 'panel-controls') && !!player;

        this._controls.visible = wanted;

        // Whether the text keeps its full width is the preference's business
        // only. Pinning it whenever the transport is shown filled the gap
        // between a short title and the buttons with nothing.
        this._panelLabel.pin = readSetting(this._settings, 'panel-text-fixed');
        if (!wanted)
            return;

        this._playButton.child.icon_name = player.status === 'Playing'
            ? 'media-playback-pause-symbolic'
            : 'media-playback-start-symbolic';
        this._prevButton.visible = player.canGoPrevious;
        this._nextButton.visible = player.canGoNext;
    }

    // The spectrum's own choice of text, or null when the Panel page decides.
    _spectrumText() {
        const mode = readSetting(this._settings, 'spectrum-text');
        return readSetting(this._settings, 'show-spectrum') && mode !== 'panel' ? mode : null;
    }

    _syncLabel() {
        const mode = this._spectrumText() ?? readSetting(this._settings, 'panel-text');

        const player = this._model.activePlayer;
        const title = player?.trackTitle ?? '';
        const artists = player?.trackArtists.join(', ') ?? '';

        let text = '';
        if (mode === 'title')
            text = title;
        else if (mode === 'artist-title')
            text = [artists, title].filter(part => part).join(' - ');

        this._panelLabel.text = text;
        this._panelLabel.maxWidth = readSetting(this._settings, 'panel-text-width');
        this._panelLabel.scroll = readSetting(this._settings, 'scroll-text');
        this._panelLabel.visible = text !== '';
    }

    // With no text the icon stays, or the button would be empty. Text chosen
    // for the spectrum goes next to it, so the spectrum stays too.
    _syncIcon() {
        const showIcon = readSetting(this._settings, 'panel-icon') ||
            !this._panelLabel.visible || this._spectrumText() !== null;
        this._model.equalizer.visible = showIcon;
        if (showIcon)
            this._panelLabel.remove_style_class_name('np-panel-text-alone');
        else
            this._panelLabel.add_style_class_name('np-panel-text-alone');
    }

    destroy() {
        this._contextMenu.destroy();
        this._model.destroy();
        super.destroy();
    }
});

// Host 2: card inside the Quick Settings grid, equalizer in the system pill.
const NowPlayingIndicator = GObject.registerClass(
class NowPlayingIndicator extends QuickSettings.SystemIndicator {
    _init(settings) {
        super._init();

        const quickSettings = Main.panel.statusArea.quickSettings;

        this._model = new MediaModel(settings, {
            keepStackVisible: false,
            closeMenu: () => quickSettings.menu.close(),
        });
        this._model.notifyVisibility = () => this._syncVisibility();

        this.add_child(this._model.equalizer);
        this.quickSettingsItems.push(this._model.stack);

        this._quickSettings = quickSettings;
        quickSettings.menu.connectObject('open-state-changed', (_menu, open) => {
            if (open)
                this._model.stack.onMenuOpened();
        }, this);

        this._syncVisibility();
    }

    _syncVisibility() {
        this._model.equalizer.visible = this._model.shouldShow;
        this.visible = this._model.shouldShow;
    }

    destroy() {
        this._quickSettings?.menu.disconnectObject(this);
        this._quickSettings = null;
        // The card is the one quick settings item and the model owns it,
        // so the list is dropped here and the model takes the actor down.
        this.quickSettingsItems.length = 0;
        this._model.destroy();
        super.destroy();
    }
});

// The shell shows its own media controls in the notification list, which would
// duplicate the card. Hiding them is fully undone when the extension stops.
class BuiltinMediaHider {
    constructor() {
        this._hidden = false;
    }

    get _messageList() {
        return Main.panel.statusArea.dateMenu?._messageList ?? null;
    }

    hide() {
        if (this._hidden)
            return;

        const list = this._messageList;
        const view = list?._messageView;

        if (view?._mediaSource && view._playerToMessage) {
            // GNOME 48 and later feed media messages from an MprisSource.
            view._mediaSource.disconnectObject(view);
            this._dropMessages(view);
            this._hidden = true;
        } else if (list?._mediaSection?.get_parent()) {
            // Up to GNOME 47 the players live in a section of their own.
            const section = list._mediaSection;
            section.get_parent().remove_child(section);
            this._hidden = true;
        }
    }

    restore() {
        if (!this._hidden)
            return;
        this._hidden = false;

        const list = this._messageList;
        const view = list?._messageView;
        const section = list?._mediaSection;

        if (view?._setupMpris) {
            // Let the shell rebuild its own messages for the current players.
            this._dropMessages(view);
            view._setupMpris();
        } else if (section && !section.get_parent() && list?._sectionList) {
            list._sectionList.insert_child_at_index(section, 0);
        }
    }

    _dropMessages(view) {
        [...view._playerToMessage.keys()].forEach(
            player => view._removePlayer(player));
    }

    destroy() {
        this.restore();
    }
}

export default class NowPlayingExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._settings.connectObject(
            'changed::location', () => this._rebuild(),
            'changed::panel-box', () => this._rebuild(),
            'changed::panel-index', () => this._rebuild(),
            'changed::indicator-visibility', () => this._host?._syncVisibility(),
            'changed::animate-icon', () => this._host?._model.sync(),
            'changed::equalizer-style', () => this._host?._model.sync(),
            'changed::show-spectrum', () => this._host?._model.sync(),
            'changed::spectrum-shape', () => this._host?._model.sync(),
            'changed::spectrum-colors', () => this._host?._model.sync(),
            'changed::spectrum-columns', () => this._host?._model.sync(),
            'changed::spectrum-peaks', () => this._host?._model.sync(),
            'changed::spectrum-text', () => this._host?._model.sync(),
            'changed::max-cards', () => this._host?._model.sync(),
            'changed::card-layout', () => this._host?._model.sync(),
            'changed::cover-size', () => this._host?._model.sync(),
            'changed::show-progress', () => this._host?._model.sync(),
            'changed::show-volume', () => this._host?._model.sync(),
            'changed::show-loop-shuffle', () => this._host?._model.sync(),
            'changed::sort-playing-first', () => this._host?._model.sync(),
            'changed::scroll-text', () => this._host?._model.sync(),
            'changed::panel-text', () => this._host?._model.sync(),
            'changed::panel-text-width', () => this._host?._model.sync(),
            'changed::panel-controls', () => this._host?._model.sync(),
            'changed::panel-text-fixed', () => this._host?._model.sync(),
            'changed::panel-icon', () => this._host?._model.sync(),
            'changed::ignored-players', () => this._host?._model.sync(),
            'changed::hide-builtin-media', () => this._syncBuiltinMedia(),
            this);

        this._hider = new BuiltinMediaHider();
        this._build();
        this._syncBuiltinMedia();
    }

    disable() {
        this._settings?.disconnectObject(this);
        this._settings = null;
        this._destroyHost();
        this._hider?.destroy();
        this._hider = null;
    }

    _syncBuiltinMedia() {
        if (readSetting(this._settings, 'hide-builtin-media'))
            this._hider?.hide();
        else
            this._hider?.restore();
    }

    _build() {
        if (readSetting(this._settings, 'location') === 'quick-settings') {
            this._host = new NowPlayingIndicator(this._settings);
            Main.panel.statusArea.quickSettings.addExternalIndicator(
                this._host, N_COLUMNS);
        } else {
            this._host = new NowPlayingButton(this._settings,
                () => this.openPreferences());
            Main.panel.addToStatusArea(this.uuid, this._host,
                readSetting(this._settings, 'panel-index'),
                readSetting(this._settings, 'panel-box'));
        }
    }

    _destroyHost() {
        this._host?.destroy();
        this._host = null;
    }

    _rebuild() {
        this._destroyHost();
        this._build();
    }
}
