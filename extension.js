import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';
import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';
import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';

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

const COVER_SIZE = 48;
const COMPACT_COVER_SIZE = 32;
const CONTROL_ICON_SIZE = 20;
const PLAY_ICON_SIZE = 26;
const COMPACT_CONTROL_ICON_SIZE = 16;
const COMPACT_PLAY_ICON_SIZE = 20;
const PANEL_CONTROL_ICON_SIZE = 16;
const POLL_MS = 1000;
const SEEK_SETTLE_MS = 1000;
const SEEK_GUARD_MS = 800;
const SEEK_COALESCE_MS = 200;
const PROPERTY_RETRY_MS = 1000;
const PROPERTY_RETRIES = 10;
const BADGE_SIZE = 14;
const VOLUME_ICON_SIZE = 16;
const VOLUME_STEP = 0.05;
const VOLUME_COALESCE_MS = 100;
const VOLUME_GUARD_MS = 800;

// The cover sizes the preferences offer, in pixels.
const COVER_SIZES = {
    'small': 36,
    'medium': 48,
    'large': 64,
};

// What LoopStatus cycles through when the repeat button is clicked.
const LOOP_ORDER = ['None', 'Playlist', 'Track'];

// Smooth scrolling arrives as a stream of small deltas; this much travel
// counts as one wheel notch.
const SCROLL_NOTCH = 1;

const TEXT_SCROLL_SPEED = 30;
const TEXT_SCROLL_PAUSE_MS = 1600;
const TEXT_SCROLL_RETURN_MS = 500;
const PRESS_DURATION_MS = 140;
const PRESS_SCALE = 0.82;
const PRESS_NUDGE = 5;

// Every default the schema declares, so a read can still answer when GSettings
// cannot. Replacing an extension's files under a running shell leaves the
// process with a stale view of the compiled schema, and asking GSettings for a
// key that view no longer has takes the whole session down with it.
const DEFAULTS = {
    'location': 'panel',
    'panel-box': 'right',
    'panel-index': 0,
    'hide-when-idle': true,
    'hide-builtin-media': true,
    'card-layout': 'auto',
    'animate-icon': true,
    'animate-buttons': true,
    'cover-size': 'medium',
    'show-progress': true,
    'show-volume': true,
    'show-loop-shuffle': true,
    'sort-playing-first': true,
    'raise-on-click': true,
    'scroll-text': true,
    'panel-scroll': 'track',
    'panel-middle-click': 'play-pause',
    'panel-controls': false,
    'panel-text': 'none',
    'panel-text-width': 180,
    'panel-text-fixed': false,
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

const N_BARS = 3;
const BAR_WIDTH = 3;
const BAR_GAP = 2;
const FRAME_MS = 80;
const SPEEDS = [7.1, 9.7, 5.3];
const PHASES = [0, 2.1, 4.2];
const STATIC_HEIGHTS = [0.35, 0.7, 0.5];

// Equalizer bars, drawn with the panel's own foreground color so it follows
// the theme. Animates only while something is playing.
const EqualizerIcon = GObject.registerClass(
class EqualizerIcon extends St.DrawingArea {
    _init() {
        super._init({
            style_class: 'np-equalizer',
            y_align: Clutter.ActorAlign.CENTER,
            width: N_BARS * BAR_WIDTH + (N_BARS - 1) * BAR_GAP,
        });

        this._playing = false;
        this._animate = true;
        this._timerId = null;
        this._frame = 0;

        // A new system theme means a new foreground colour: redraw with it.
        this.connect('style-changed', () => this.queue_repaint());
        this.connect('destroy', () => this._stopTimer());
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

    _updateTimer() {
        const wanted = this._playing && this._animate && this.mapped;

        if (wanted && this._timerId === null) {
            this._timerId = GLib.timeout_add(GLib.PRIORITY_LOW, FRAME_MS, () => {
                this._frame++;
                this.queue_repaint();
                return GLib.SOURCE_CONTINUE;
            });
        } else if (!wanted) {
            this._stopTimer();
        }
    }

    vfunc_repaint() {
        const themeNode = this.get_theme_node();
        const [, height] = this.get_surface_size();
        const cr = this.get_context();
        const color = themeNode.get_foreground_color();

        cr.setSourceRGBA(
            color.red / 255, color.green / 255, color.blue / 255,
            color.alpha / 255);

        const t = this._frame * (FRAME_MS / 1000);
        const minHeight = Math.round(height * 0.25);
        const maxHeight = Math.round(height * 0.85);
        const moving = this._playing && this._animate;

        for (let i = 0; i < N_BARS; i++) {
            const wave = moving
                ? (Math.sin(t * SPEEDS[i] + PHASES[i]) + 1) / 2
                : STATIC_HEIGHTS[i];
            const barHeight = minHeight + (maxHeight - minHeight) * wave;
            const x = i * (BAR_WIDTH + BAR_GAP);
            const y = (height + barHeight) / 2;

            cr.rectangle(x, y - barHeight, BAR_WIDTH, barHeight);
        }

        cr.fill();
        cr.$dispose();
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
        if (this._timerId !== null) {
            GLib.source_remove(this._timerId);
            this._timerId = null;
        }
    }
});

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
        this._chaining = false;
        this._overflow = 0;
        this._idleId = null;

        this.connect('notify::mapped', () => this._restart());
        this.connect('destroy', () => this._stop());
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

    // Zero lets the parent decide the width, anything else is a ceiling in
    // pixels for a label that has no parent to hold it back.
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
            const width = this._pin
                ? this._maxWidth : Math.min(natural, this._maxWidth);
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
        const overflow = this._scroll
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
        this._label.remove_all_transitions();
        this._label.translation_x = 0;

        // With animations turned off the text stays where it is and keeps its
        // ellipsis.
        if (!this._canScroll())
            return;

        this._scrollAway();
    }

    _canScroll() {
        return this._overflow >= 2 && this.mapped &&
            St.Settings.get().enable_animations;
    }

    // One leg of the walk, and the next one only if this one took any time. A
    // shell that decides not to animate — the popup was closed, the actor is
    // off screen — finishes an ease inside the call that started it, and a
    // chain that carried on from there would call itself until the stack ran
    // out. The walk then waits for the next map or relayout instead.
    _ease(props, next) {
        if (!this._canScroll())
            return;

        this._chaining = true;
        this._label.ease({
            ...props,
            onComplete: () => {
                if (!this._chaining)
                    next();
            },
        });
        this._chaining = false;
    }

    _scrollAway() {
        this._ease({
            translation_x: -this._overflow,
            duration: (this._overflow / TEXT_SCROLL_SPEED) * 1000,
            delay: TEXT_SCROLL_PAUSE_MS,
            mode: Clutter.AnimationMode.LINEAR,
        }, () => this._scrollBack());
    }

    _scrollBack() {
        this._ease({
            translation_x: 0,
            duration: TEXT_SCROLL_RETURN_MS,
            delay: TEXT_SCROLL_PAUSE_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        }, () => this._scrollAway());
    }

    _stop() {
        if (this._idleId) {
            GLib.source_remove(this._idleId);
            this._idleId = null;
        }
        this._label.remove_all_transitions();
    }
});

// A press is confirmed by the icon: it dips and springs back, and the skip
// buttons start their way back from the side they send the track.
function animatePress(button, nudge) {
    if (!St.Settings.get().enable_animations)
        return;

    const icon = button.child;
    icon.remove_all_transitions();
    icon.set_pivot_point(0.5, 0.5);
    icon.set_scale(PRESS_SCALE, PRESS_SCALE);
    icon.translation_x = nudge;
    icon.ease({
        scale_x: 1,
        scale_y: 1,
        translation_x: 0,
        duration: PRESS_DURATION_MS,
        mode: Clutter.AnimationMode.EASE_OUT_BACK,
    });
}

// What a card looks like until the model hands it the preferences; a card
// built during startup is never left without an answer.
const CARD_OPTIONS = {
    coverSize: COVER_SIZES[DEFAULTS['cover-size']],
    showProgress: DEFAULTS['show-progress'],
    showVolume: DEFAULTS['show-volume'],
    showLoopShuffle: DEFAULTS['show-loop-shuffle'],
    sortPlayingFirst: DEFAULTS['sort-playing-first'],
    raiseOnClick: DEFAULTS['raise-on-click'],
    scrollText: DEFAULTS['scroll-text'],
    animate: DEFAULTS['animate-icon'],
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
        this._hasArtwork = false;
        this._lengthUs = 0;
        this._positionUs = 0;
        this._trackId = null;
        this._dragging = false;
        this._settingValue = false;
        this._volumeDragging = false;
        this._settingVolume = false;
        this._volumePendingId = null;
        this._volumeGuardUntil = 0;
        this._pollId = null;
        this._seekPendingId = null;
        this._ignorePositionUntil = 0;
        this._cancellable = new Gio.Cancellable();

        this._compact = false;
        this._compactApplied = false;
        this._options = CARD_OPTIONS;

        // The header and the controls share a row in the compact layout, so the
        // header cannot be a direct child of the card.
        this._topRow = new St.BoxLayout({style_class: 'np-top-row', x_expand: true});
        this.add_child(this._topRow);

        const headerBox = new St.BoxLayout({
            style_class: 'np-header-box',
            x_expand: true,
        });
        this._topRow.add_child(headerBox);

        this._cover = new St.Icon({
            style_class: 'np-cover',
            icon_size: COVER_SIZE,
        });

        // Which player a row belongs to is not obvious from album art alone,
        // so the app icon sits in its corner while the cards are stacked.
        this._badge = new St.Icon({
            style_class: 'np-cover-badge',
            icon_size: BADGE_SIZE,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.END,
            visible: false,
        });

        const coverBin = new St.Widget({layout_manager: new Clutter.BinLayout()});
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
        headerBox.add_child(this._coverButton);

        const labels = new St.BoxLayout({
            style_class: 'np-labels',
            ...VERTICAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        headerBox.add_child(labels);

        this._title = new ScrollingLabel('np-title');
        labels.add_child(this._title);

        this._subtitle = new ScrollingLabel('np-subtitle');
        labels.add_child(this._subtitle);

        // The same bars as the panel icon, dimmed: with several cards open it
        // shows which one is making the noise, without another label.
        this._equalizer = new EqualizerIcon();
        this._equalizer.add_style_class_name('np-card-equalizer');
        this._equalizer.x_align = Clutter.ActorAlign.END;
        headerBox.add_child(this._equalizer);

        this._seekBox = new St.BoxLayout({
            style_class: 'np-seek-box',
            ...VERTICAL,
            x_expand: true,
        });
        this.add_child(this._seekBox);

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
        this.add_child(this._volumeBox);

        this._volumeIcon = new St.Icon({
            style_class: 'np-volume-icon',
            icon_name: 'audio-volume-high-symbolic',
            icon_size: VOLUME_ICON_SIZE,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._volumeBox.add_child(this._volumeIcon);

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
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._controls);

        this._shuffleButton = this._addControl(this._controls, 'media-playlist-shuffle-symbolic',
            CONTROL_ICON_SIZE, () => this._player.setShuffle(!this._player.shuffle));
        this._prevButton = this._addControl(this._controls, 'media-skip-backward-symbolic',
            CONTROL_ICON_SIZE, () => this._player.previous(), -PRESS_NUDGE);
        this._playButton = this._addControl(this._controls, 'media-playback-start-symbolic',
            PLAY_ICON_SIZE, () => this._player.playPause());
        this._nextButton = this._addControl(this._controls, 'media-skip-forward-symbolic',
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
        const button = new St.Button({
            style_class: 'np-control',
            can_focus: true,
            child: new St.Icon({
                style_class: 'popup-menu-icon',
                icon_name: iconName,
                icon_size: iconSize,
            }),
        });
        button.connect('clicked', () => {
            this._animatePress(button, nudge);
            callback();
        });
        parent.add_child(button);
        return button;
    }

    _animatePress(button, nudge) {
        if (this._options.animateButtons)
            animatePress(button, nudge);
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
            const parent = compact ? this._topRow : this;
            this._controls.get_parent().remove_child(this._controls);
            parent.add_child(this._controls);
            this._controls.x_expand = !compact;

            if (compact)
                this.add_style_class_name('np-card-compact');
            else
                this.remove_style_class_name('np-card-compact');
        }

        this._cover.icon_size = compact ? COMPACT_COVER_SIZE : options.coverSize;
        this._times.visible = !compact;
        this._title.scroll = options.scrollText;
        this._subtitle.scroll = options.scrollText;

        this._equalizer.visible = !compact;
        this._equalizer.animate = options.animate;
        this._equalizer.playing = this.playing;

        const controlSize = compact
            ? COMPACT_CONTROL_ICON_SIZE : CONTROL_ICON_SIZE;
        this._prevButton.child.icon_size = controlSize;
        this._nextButton.child.icon_size = controlSize;
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
        this._seekBox.visible = !compact && options.showProgress &&
            this._lengthUs > 0;
        this._badge.visible = compact && this._hasArtwork && !!this._badge.gicon;

        this._coverButton.reactive = options.raiseOnClick;
        this._coverButton.can_focus = options.raiseOnClick;
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
        this._subtitle.text = this._subtitleText();

        // Players emit 'changed' for every position or volume tweak; only
        // touch the texture when the artwork or the fallback changed.
        const coverUrl = this._player.trackCoverUrl;
        const app = this._player.app;
        if (coverUrl !== this._coverUrl || app !== this._coverApp) {
            this._coverUrl = coverUrl;
            this._coverApp = app;
            const artwork = this._artworkIcon(coverUrl);
            this._hasArtwork = artwork !== null;
            this._cover.gicon = artwork ?? this._fallbackIcon(app);
            this._badge.gicon = app?.get_icon() ?? null;
        }

        this._playButton.child.icon_name = this.playing
            ? 'media-playback-pause-symbolic'
            : 'media-playback-start-symbolic';

        // A player that cannot skip gets no skip buttons at all.
        this._prevButton.visible = this._player.canGoPrevious;
        this._nextButton.visible = this._player.canGoNext;
        this._slider.reactive = this._player.canSeek;

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
        this._player.setVolume(this._volumeSlider.value);
    }

    // Null when the player named no usable artwork. Players inside a sandbox
    // point at files that only exist in their own filesystem, so a local file
    // is checked before it is used.
    _artworkIcon(coverUrl) {
        if (!coverUrl)
            return null;

        const file = Gio.File.new_for_uri(coverUrl);
        if (file.has_uri_scheme('file') && !file.query_exists(null))
            return null;

        return new Gio.FileIcon({file});
    }

    _fallbackIcon(app) {
        return app?.get_icon() ??
            new Gio.ThemedIcon({name: 'audio-x-generic-symbolic'});
    }

    _subtitleText() {
        const artists = this._player.trackArtists.join(', ');
        const album = this._metadataValue('xesam:album');
        const parts = [artists, typeof album === 'string' ? album : ''].filter(p => p);
        if (parts.length === 0)
            return this._player.app?.get_name() || '';
        return parts.join(' — ');
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

        this._lengthLabel.text = formatTime(this._lengthUs);

        if (trackChanged) {
            this._setPositionUs(0);
            this._fetchPosition();
        }
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
        this._elapsedLabel.text = formatTime(this._positionUs);

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
        this._elapsedLabel.text = formatTime(positionUs);

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
        this._elapsedLabel.text = formatTime(targetUs);
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
        : `${minutes}:${pad(seconds)}`;
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

    // Whatever is playing belongs on top, the rest keep the order they turned
    // up in. Children are only moved when the order really changed: a property
    // update must not shuffle the cards under the pointer.
    _syncOrder() {
        const cards = [...this._cards.values()];
        const wanted = this._options.sortPlayingFirst
            ? [...cards].sort((a, b) => Number(b.playing) - Number(a.playing))
            : cards;

        // The placeholder is the first child and stays there.
        wanted.forEach((card, index) => {
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
        const cards = [...this._cards.values()];
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

    _update() {
        const metadata = {};
        for (const key in this._playerProxy?.Metadata ?? {})
            metadata[key] = this._playerProxy.Metadata[key].deepUnpack();
        this._metadata = metadata;

        // Players are known to send metadata that does not match the spec, so
        // everything that reaches the screen gets checked.
        const artists = metadata['xesam:artist'];
        this._trackArtists = Array.isArray(artists)
            ? artists.filter(artist => typeof artist === 'string')
            : [];

        const title = metadata['xesam:title'];
        this._trackTitle = typeof title === 'string' ? title : '';

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

    // True when the host should show its panel button at all.
    get shouldShow() {
        return this._shown.size > 0 ||
            !readSetting(this._settings, 'hide-when-idle');
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
        this.equalizer.animate = readSetting(this._settings, 'animate-icon');
        this.equalizer.playing = this.stack.anyPlaying;
        this.notifyVisibility?.();
    }

    _readOptions() {
        const size = readSetting(this._settings, 'cover-size');
        return {
            coverSize: COVER_SIZES[size] ?? COVER_SIZE,
            showProgress: readSetting(this._settings, 'show-progress'),
            showVolume: readSetting(this._settings, 'show-volume'),
            showLoopShuffle: readSetting(this._settings, 'show-loop-shuffle'),
            sortPlayingFirst: readSetting(this._settings, 'sort-playing-first'),
            raiseOnClick: readSetting(this._settings, 'raise-on-click'),
            scrollText: readSetting(this._settings, 'scroll-text'),
            animate: readSetting(this._settings, 'animate-icon'),
            animateButtons: readSetting(this._settings, 'animate-buttons'),
        };
    }

    destroy() {
        this._source?.disconnectObject(this);
        this._source?.destroy();
        this._source = null;
        this._players.forEach(player => player.disconnectObject(this));
        this._players.clear();
        this._shown.clear();
        this.notifyVisibility = null;
    }
}

// Host 1: own panel button with its own popup, position set in preferences.
const NowPlayingButton = GObject.registerClass(
class NowPlayingButton extends PanelMenu.Button {
    _init(settings) {
        super._init(0.5, _('Now Playing'));

        this._settings = settings;
        this._scrollDelta = 0;

        this._model = new MediaModel(settings, {
            keepStackVisible: true,
            closeMenu: () => this.menu.close(),
        });
        this._model.notifyVisibility = () => this._syncVisibility();

        const box = new St.BoxLayout({style_class: 'np-panel-box'});
        box.add_child(this._model.equalizer);
        this.add_child(box);

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

        this._prevButton = this._addPanelControl('media-skip-backward-symbolic',
            () => this._model.previous(), -PRESS_NUDGE);
        this._playButton = this._addPanelControl('media-playback-start-symbolic',
            () => this._model.playPause());
        this._nextButton = this._addPanelControl('media-skip-forward-symbolic',
            () => this._model.next(), PRESS_NUDGE);

        this.menu.box.add_style_class_name('np-menu');
        this.menu.box.add_child(this._model.stack);

        this.menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this._model.stack.onMenuOpened();
        });

        this._syncVisibility();
    }

    // A button of its own inside the panel button: St.Button answers the press
    // itself, so it never reaches PanelMenu.Button and the popup stays shut.
    // The middle button is not one St.Button takes, so it still opens the menu
    // or does what the preferences say.
    _addPanelControl(iconName, callback, nudge = 0) {
        const button = new St.Button({
            style_class: 'np-panel-control',
            can_focus: true,
            child: new St.Icon({
                icon_name: iconName,
                icon_size: PANEL_CONTROL_ICON_SIZE,
            }),
        });
        button.connect('clicked', () => {
            if (readSetting(this._settings, 'animate-buttons'))
                animatePress(button, nudge);
            callback();
        });
        this._controls.add_child(button);
        return button;
    }

    // PanelMenu.Button opens its menu from the generic event signal, so the
    // wheel and the middle button have to be answered before that happens.
    vfunc_event(event) {
        const type = event.type();

        if (type === Clutter.EventType.SCROLL && this._onScroll(event))
            return Clutter.EVENT_STOP;

        const middle = (type === Clutter.EventType.BUTTON_PRESS ||
            type === Clutter.EventType.BUTTON_RELEASE) &&
            event.get_button() === Clutter.BUTTON_MIDDLE;

        if (middle && this._middleClickAction())
            return Clutter.EVENT_STOP;

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
        this._syncControls();
        this.visible = this._model.shouldShow;
    }

    _syncControls() {
        const player = this._model.activePlayer;
        const wanted = readSetting(this._settings, 'panel-controls') && !!player;

        this._controls.visible = wanted;

        // Text of its own width would walk the buttons sideways on every
        // track, so with buttons the label always keeps the width it is
        // allowed; on its own it is a preference.
        this._panelLabel.pin = wanted ||
            readSetting(this._settings, 'panel-text-fixed');
        if (!wanted)
            return;

        this._playButton.child.icon_name = player.status === 'Playing'
            ? 'media-playback-pause-symbolic'
            : 'media-playback-start-symbolic';
        this._prevButton.visible = player.canGoPrevious;
        this._nextButton.visible = player.canGoNext;
    }

    _syncLabel() {
        const mode = readSetting(this._settings, 'panel-text');
        const player = this._model.activePlayer;
        const title = player?.trackTitle ?? '';
        const artists = player?.trackArtists.join(', ') ?? '';

        let text = '';
        if (mode === 'title')
            text = title;
        else if (mode === 'artist-title')
            text = [artists, title].filter(part => part).join(' — ');

        this._panelLabel.text = text;
        this._panelLabel.maxWidth = readSetting(this._settings, 'panel-text-width');
        this._panelLabel.scroll = readSetting(this._settings, 'scroll-text');
        this._panelLabel.visible = text !== '';
    }

    destroy() {
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
        this._model.destroy();
        this.quickSettingsItems.forEach(item => item.destroy());
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
            'changed::hide-when-idle', () => this._host?._syncVisibility(),
            'changed::animate-icon', () => this._host?._model.sync(),
            'changed::animate-buttons', () => this._host?._model.sync(),
            'changed::card-layout', () => this._host?._model.sync(),
            'changed::cover-size', () => this._host?._model.sync(),
            'changed::show-progress', () => this._host?._model.sync(),
            'changed::show-volume', () => this._host?._model.sync(),
            'changed::show-loop-shuffle', () => this._host?._model.sync(),
            'changed::sort-playing-first', () => this._host?._model.sync(),
            'changed::raise-on-click', () => this._host?._model.sync(),
            'changed::scroll-text', () => this._host?._model.sync(),
            'changed::panel-text', () => this._host?._model.sync(),
            'changed::panel-text-width', () => this._host?._model.sync(),
            'changed::panel-controls', () => this._host?._model.sync(),
            'changed::panel-text-fixed', () => this._host?._model.sync(),
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
            this._host = new NowPlayingButton(this._settings);
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
