import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Shell from 'gi://Shell';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const UUID = 'nowplaying@epogonii.github.io';

function stateObj() {
    return Main.extensionManager.lookup(UUID)?.stateObj ?? null;
}

function model() {
    return Main.panel.statusArea.quickSettings._indicators.get_children()
        .map(i => i._model).find(m => m) ?? null;
}

// A pointer of our own. Synthetic 'clicked' signals skip the gesture layer
// entirely, which is exactly where a panel button and the buttons inside it
// fight over a press, so the clicks here go in through the seat.
let virtualPointer = null;

function pointer() {
    if (virtualPointer === null) {
        virtualPointer = Clutter.get_default_backend().get_default_seat()
            .create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    }
    return virtualPointer;
}

function clickAt(actor, button = Clutter.BUTTON_PRIMARY) {
    const [x, y] = actor.get_transformed_position();
    const [w, h] = actor.get_transformed_size();
    const device = pointer();
    const at = () => GLib.get_monotonic_time();

    device.notify_absolute_motion(at(), x + w / 2, y + h / 2);
    device.notify_button(at(), button, Clutter.ButtonState.PRESSED);
    device.notify_button(at(), button, Clutter.ButtonState.RELEASED);
}

function scrollAt(actor, dy) {
    const [x, y] = actor.get_transformed_position();
    const [w, h] = actor.get_transformed_size();
    const device = pointer();

    device.notify_absolute_motion(GLib.get_monotonic_time(), x + w / 2, y + h / 2);
    device.notify_discrete_scroll(GLib.get_monotonic_time(),
        dy < 0 ? Clutter.ScrollDirection.UP : Clutter.ScrollDirection.DOWN,
        Clutter.ScrollSource.WHEEL);
}

function qsIndicator() {
    return Main.panel.statusArea.quickSettings._indicators.get_children()
        .find(i => i._model) ?? null;
}

function host() {
    return stateObj()?._host ?? null;
}

function hostCards() {
    const stack = host()?._model?.stack;
    return stack ? [...stack._cards.values()] : [];
}

function cards() {
    const stack = model()?.stack;
    return stack ? [...stack._cards.values()] : [];
}

function order() {
    const stack = model()?.stack;
    if (!stack)
        return 'no stack';
    return stack.get_children()
        .map(child => child._player?.busName.replace('org.mpris.MediaPlayer2.', '') ??
            'placeholder')
        .join(',');
}

function geom(actor) {
    if (!actor)
        return 'none';
    return `${Math.round(actor.x)},${Math.round(actor.y)},` +
        `${Math.round(actor.width)},${Math.round(actor.height)}`;
}

function cardInfo(card) {
    return `bus=${card._player.busName.replace('org.mpris.MediaPlayer2.', '')} ` +
        `compact=${card._compact} cover=${card._cover.icon_size} ` +
        `badgeBox=${geom(card._badge)} ` +
        `badgeT=${Math.round(card._badge.translation_x)},${Math.round(card._badge.translation_y)} ` +
        `coverBox=${geom(card._cover)} ` +
        `binBox=${geom(card._badge.get_parent())} ` +
        `badge=${card._badge.visible} seek=${card._seekBox.visible} ` +
        `volumeBox=${card._volumeBox.visible} volume=${card._volumeSlider.value.toFixed(2)} ` +
        `shuffleBtn=${card._shuffleButton.visible} loopBtn=${card._loopButton.visible} ` +
        `loop=${card._player.loopStatus} shuffle=${card._player.shuffle} ` +
        `overflow=${card._title._overflow} ` +
        `scrolling=${card._title._label.get_transition('translation-x') !== null}`;
}

function accordion() {
    const stack = model()?.stack;
    if (!stack)
        return 'no stack';
    return `expanded=${stack._expandedCard?._player.busName.replace('org.mpris.MediaPlayer2.', '') ?? 'none'} ` +
        cards().map(c => `${c._player.busName.replace('org.mpris.MediaPlayer2.', '')}` +
            `[compact=${c._compact} expandable=${c._expandable} h=${c.get_height()}]`).join(' ');
}

function panelButton() {
    return Main.panel.statusArea[UUID] ?? null;
}

function panelCards() {
    const stack = panelButton()?._model?.stack;
    return stack ? [...stack._cards.values()] : [];
}

function sheetName() {
    return Main.extensionManager.lookup(UUID)?.stylesheet?.get_basename() ?? 'none';
}

function builtinSourceInfo() {
    const view = Main.panel.statusArea.dateMenu?._messageList?._messageView;
    const source = view?._mediaSource;
    const players = source?._players ?? source?._playerToMessage;
    const keys = players
        ? [...players.keys()].map(p => p.busName ?? p._busName ?? String(p))
        : [];
    const visible = source?.players
        ? source.players.map(p => `${p.busName ?? p._busName}[${p.trackTitle}]`)
        : [];
    const messages = view?._playerToMessage
        ? [...view._playerToMessage.keys()].map(p => p.busName ?? p._busName)
        : [];
    return `own=${keys.length}:${keys.join(',')} getter=${visible.length}:${visible.join(',')} ` +
        `messages=${messages.join(',')}`;
}

function builtinCount() {
    const view = Main.panel.statusArea.dateMenu?._messageList?._messageView;
    return view?._playerToMessage?.size ?? -1;
}

export default class ProbeQs extends Extension {
    enable() {
        this._ids = [];

        this._at(12, () => Main.panel.statusArea.quickSettings.menu.open(false));

        this._at(14, () => {
            const app = Shell.AppSystem.get_default().lookup_app('spotify.desktop');
            log(`PROBE LOOKUP shim app=${app ? app.get_name() : 'null'} icon=${app?.get_icon()?.to_string()}`);
            log(`PROBE BUILTIN hidden count=${builtinCount()} (expect 0)`);
        });

        this._at(16, () => {
            cards().forEach(c => {
                const p = c._player;
                log(`PROBE CARD bus=${p.busName} entry="${p._desktopEntry}" pid=${p._pid} ` +
                    `app=${p.app ? p.app.get_id() : 'null'} appIcon=${p.app?.get_icon()?.to_string()} ` +
                    `cover=${c._cover.gicon?.to_string()} title="${c._title.text}" sub="${c._subtitle.text}" ` +
                    `prev=${c._prevButton.visible} next=${c._nextButton.visible} ` +
                    `seek=${c._slider.reactive} len=${c._lengthUs} elapsed="${c._elapsedLabel.text}" ` +
                    `w=${c.get_width()} h=${c.get_height()}`);
            });
            log(`PROBE COUNT cards=${cards().length} (expect 3)`);
            const stack = model()?.stack;
            log(`PROBE LAYOUT mode=${stack?._layout} ` +
                `compact=${cards().map(c => c._compact).join(',')} (expect one expanded, rest compact) ` +
                `controlsInRow=${cards().map(c => c._controls.get_parent() === c._topRow).join(',')} ` +
                `times=${cards().map(c => c._times.visible).join(',')} ` +
                `stackH=${stack?.get_height()}`);
        });

        // Full cards on demand, and back to compact.
        this._at(17, () => stateObj()?._settings.set_string('card-layout', 'full'));
        this._at(18, () => log(`PROBE LAYOUT full compact=${cards().map(c => c._compact).join(',')} ` +
            `(expect false,false,false) times=${cards().map(c => c._times.visible).join(',')} ` +
            `stackH=${model()?.stack.get_height()}`));
        this._at(19, () => stateObj()?._settings.set_string('card-layout', 'auto'));
        this._at(20, () => log(`PROBE LAYOUT auto compact=${cards().map(c => c._compact).join(',')} ` +
            `(expect one expanded, rest compact) stackH=${model()?.stack.get_height()}`));

        // The windowed player needs longer to show up; look again once it has.
        this._at(21, () => {
            cards().forEach(c => {
                const p = c._player;
                log(`PROBE CARD2 bus=${p.busName} entry="${p._desktopEntry}" ` +
                    `app=${p.app ? p.app.get_id() : 'null'} cover=${c._cover.gicon?.to_string()} ` +
                    `title="${c._title.text}" prev=${c._prevButton.visible} next=${c._nextButton.visible} ` +
                    `compact=${c._compact} h=${c.get_height()}`);
            });
            log(`PROBE COUNT2 cards=${cards().length} (expect 3) stackH=${model()?.stack.get_height()}`);
            const src = model()?._source;
            src?._players.forEach((p, bus) => {
                const names = p._playerProxy?.get_cached_property_names();
                log(`PROBE SRC bus=${bus} visible=${src._visible.has(p)} canPlay=${p.canPlay} ` +
                    `raw=${p._playerProxy?.CanPlay} owner=${p._playerProxy?.g_name_owner} ` +
                    `props=${names ? names.join('|') : 'none'} title="${p.trackTitle}"`);
            });
        });

        this._at(22, () => {
            cards().forEach((c, i) => {
                log(`PROBE SEEK i=${i} bus=${c._player.busName} trackId=${c._trackId} ` +
                    `from=${c._positionUs} expect=${Math.round(0.6 * c._lengthUs)}`);
                c._slider.value = 0.6;
            });
        });

        this._at(25, () => cards().forEach((c, i) =>
            log(`PROBE AFTER i=${i} value=${c._slider.value.toFixed(3)} pos=${c._positionUs} ` +
                `elapsed="${c._elapsedLabel.text}"`)));

        // The new rows: hidden in a compact card, shown in a full one.
        this._at(23, () => {
            cards().forEach(c => log(`PROBE ROWS compact ${cardInfo(c)}`));
            log(`PROBE ORDER compact ${order()}`);
        });

        this._at(24, () => {
            stateObj()?._settings.set_string('card-layout', 'full');
            stateObj()?._settings.set_string('cover-size', 'large');
        });

        this._at(26, () => {
            cards().forEach(c => log(`PROBE ROWS full ${cardInfo(c)}`));

            // Only the stub that exports LoopStatus and Shuffle can be told to
            // change them, and it is the one with a volume of its own.
            const card = cards().find(c => c._player.hasLoop);
            log(`PROBE WRITE target=${card?._player.busName}`);
            if (card) {
                // Setting the value is what a drag does; the card listens on
                // notify::value.
                card._volumeSlider.value = 0.35;
                card._loopButton.emit('clicked', 0);
                card._shuffleButton.emit('clicked', 0);
            }
        });

        // Pressing a control animates its icon; two taps on play leave the
        // player exactly as it was.
        this._at(27, () => {
            const card = cards().find(c => c._player.hasLoop);
            card?._playButton.emit('clicked', 0);
            card?._playButton.emit('clicked', 0);
            card?._nextButton.emit('clicked', 0);
            log(`PROBE PRESS animations=${St.Settings.get().enable_animations} ` +
                `play=${card?._playButton.child.get_transition('scale-x') !== null} ` +
                `next=${card?._nextButton.child.get_transition('translation-x') !== null} ` +
                `status=${card?._player.status}`);
        });

        this._at(28, () => {
            const iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
            log(`PROBE STYLE start scheme=${iface.get_string('color-scheme')} ` +
                `variant=${Main.getStyleVariant?.()} sheet=${sheetName()} ` +
                `cardFill=${cards()[0]?.get_theme_node().get_background_color().to_string()}`);
            iface.set_string('color-scheme', 'prefer-light');
        });

        this._at(30, () => {
            const iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
            log(`PROBE STYLE light scheme=${iface.get_string('color-scheme')} ` +
                `variant=${Main.getStyleVariant?.()} sheet=${sheetName()} ` +
                `cardFill=${cards()[0]?.get_theme_node().get_background_color().to_string()} ` +
                `(expect light, stylesheet-light.css, #0000000f)`);
            iface.set_string('color-scheme', 'default');
        });

        this._at(34, () => {
            const iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
            log(`PROBE STYLE back scheme=${iface.get_string('color-scheme')} ` +
                `variant=${Main.getStyleVariant?.()} sheet=${sheetName()} ` +
                `cardFill=${cards()[0]?.get_theme_node().get_background_color().to_string()} ` +
                `(expect dark, stylesheet-dark.css, #ffffff14)`);
        });

        this._at(29, () => {
            const card = cards().find(c => c._player.hasLoop);
            log(`PROBE WRITE after volume=${card?._player.volume?.toFixed(3)} ` +
                `slider=${card?._volumeSlider.value.toFixed(3)} ` +
                `loop=${card?._player.loopStatus} (expect Playlist) ` +
                `shuffle=${card?._player.shuffle} (expect true) ` +
                `loopIcon=${card?._loopButton.child.icon_name} ` +
                `loopOff=${card?._loopButton.has_style_class_name('np-control-off')} ` +
                `shuffleOff=${card?._shuffleButton.has_style_class_name('np-control-off')}`);
            card?._loopButton.emit('clicked', 0);
        });

        this._at(31, () => {
            const card = cards().find(c => c._player.hasLoop);
            log(`PROBE WRITE cycled loop=${card?._player.loopStatus} ` +
                `icon=${card?._loopButton.child.icon_name} (expect Track, repeat-song)`);
            stateObj()?._settings.set_boolean('show-progress', false);
            stateObj()?._settings.set_boolean('show-volume', false);
            stateObj()?._settings.set_boolean('show-loop-shuffle', false);
        });

        this._at(33, () => {
            cards().forEach(c => log(`PROBE ROWS off ${cardInfo(c)}`));
            stateObj()?._settings.set_boolean('show-progress', true);
            stateObj()?._settings.set_boolean('show-volume', true);
            stateObj()?._settings.set_boolean('show-loop-shuffle', true);
            stateObj()?._settings.set_string('card-layout', 'auto');
            stateObj()?._settings.set_string('cover-size', 'medium');
        });

        // Accordion: one card open, the rest as rows, and a click moves the
        // expansion. Cards are reachable by pointer and by focus only while
        // there is something to expand.
        this._at(57, () => log(`PROBE ACCORDION ${accordion()}`));

        this._at(58, () => {
            const stack = model()?.stack;
            const target = cards().find(c => c !== stack?._expandedCard);
            log(`PROBE ACCORDION click ${target?._player.busName} ` +
                `reactive=${target?.reactive} focusable=${target?.can_focus}`);
            target?.emit('expand-request');
        });

        this._at(60, () => {
            log(`PROBE ACCORDION opened ${accordion()}`);
            model()?.stack._expandedCard?.emit('expand-request');
        });

        this._at(62, () => log(`PROBE ACCORDION closed ${accordion()} ` +
            `manual=${model()?.stack._manualCard} (expect all compact)`));

        this._at(63, () => stateObj()?._settings.set_string('card-layout', 'compact'));
        this._at(65, () => {
            log(`PROBE ACCORDION forced ${accordion()} (expect no expandable)`);
            stateObj()?._settings.set_string('card-layout', 'auto');
        });

        // What the stack looks like after the popup has been closed and opened
        // again: a pick that is still playing survives, a collapsed stack and a
        // pick that fell silent do not.
        const reopen = () => {
            const menu = Main.panel.statusArea.quickSettings.menu;
            menu.close();
            menu.open(false);
        };

        this._at(76, () => {
            // The last of the players that are playing, not the first: a pick
            // has to survive on its own account, not by being the one the
            // fallback would have chosen anyway.
            const playing = cards()
                .filter(c => c.playing && c !== model()?.stack._expandedCard).pop();
            log(`PROBE REOPEN pick=${playing?._player.busName} playing=${playing?.playing}`);
            playing?.emit('expand-request');
            reopen();
            log(`PROBE REOPEN kept ${accordion()} manual=${model()?.stack._manualCard?._player?.busName ?? model()?.stack._manualCard} (expect the pick still open)`);
        });

        this._at(78, () => {
            model()?.stack._expandedCard?.emit('expand-request');
            log(`PROBE REOPEN collapsed ${accordion()}`);
            reopen();
            log(`PROBE REOPEN after collapse ${accordion()} ` +
                `playing=${cards().map(c => c.playing).join(',')} (expect the playing one open)`);
        });

        this._at(80, () => {
            const quiet = cards().find(c => !c.playing);
            log(`PROBE REOPEN pick quiet=${quiet?._player.busName} playing=${quiet?.playing}`);
            quiet?.emit('expand-request');
            log(`PROBE REOPEN quiet open ${accordion()}`);
            reopen();
            log(`PROBE REOPEN after quiet ${accordion()} ` +
                `playing=${cards().map(c => c.playing).join(',')} (expect a playing one open)`);
        });

        // Raw coordinates while the popup is open: bin box, cover box inside
        // the bin, badge box inside the bin.
        const rawDump = () => cards().forEach(c => {
            const bin = c._badge.get_parent();
            log(`PROBE RAW bus=${c._player.busName.replace('org.mpris.MediaPlayer2.', '')} ` +
                `compact=${c._compact} vis=${c._badge.visible} iconSize=${c._cover.icon_size} ` +
                `bin=${geom(bin)} cover=${geom(c._cover)} badge=${geom(c._badge)} ` +
                `btn=${geom(bin.get_parent())} ` +
                `t=${Math.round(c._badge.translation_x)},${Math.round(c._badge.translation_y)} ` +
                `coverAbs=${c._cover.get_transformed_position().map(Math.round).join(',')} ` +
                `badgeAbs=${c._badge.get_transformed_position().map(Math.round).join(',')} ` +
                `prefW=${c._cover.get_preferred_width(-1).map(Math.round).join('/')} ` +
                `prefH=${c._cover.get_preferred_height(-1).map(Math.round).join('/')} ` +
                `topRow=${geom(c._topRow)} column=${geom(c._column)} card=${geom(c)}`);
        });

        this._at(28.5, rawDump);

        // Where the badge lands: the app icon has to ride the bottom right
        // corner of the artwork, the way the card is meant to look.
        this._at(82, () => {
            const menu = Main.panel.statusArea.quickSettings.menu;
            if (!menu.isOpen)
                menu.open(false);
        });

        this._at(84, () => {
            cards().forEach(c => {
                const [cx, cy] = c._cover.get_transformed_position();
                const [bx, by] = c._badge.get_transformed_position();
                log(`PROBE BADGE bus=${c._player.busName.replace('org.mpris.MediaPlayer2.', '')} ` +
                    `compact=${c._compact} visible=${c._badge.visible} ` +
                    `cover=${Math.round(cx)},${Math.round(cy)},` +
                    `${Math.round(c._cover.width)},${Math.round(c._cover.height)} ` +
                    `badge=${Math.round(bx)},${Math.round(by)},` +
                    `${Math.round(c._badge.width)},${Math.round(c._badge.height)} ` +
                    `(expect the badge in the bottom right corner of the cover)`);
            });
        });

        // Players the preferences leave out get no card.
        this._at(49, () => stateObj()?._settings.set_strv('ignored-players', ['chromium']));
        this._at(51, () => log(`PROBE IGNORE cards=${hostCards().length} (expect 2) ` +
            `buses=${hostCards().map(c => c._player.busName.replace('org.mpris.MediaPlayer2.', '')).join(',')} ` +
            `shouldShow=${host()?._model.shouldShow}`));
        this._at(53, () => stateObj()?._settings.set_strv('ignored-players', []));
        this._at(55, () => log(`PROBE IGNORE cleared cards=${hostCards().length} (expect 3) ` +
            `buses=${hostCards().map(c => c._player.busName.replace('org.mpris.MediaPlayer2.', '')).join(',')}`));

        // Order follows what is playing: the first stub pauses at t=66 and
        // starts again at t=86.
        // The same at 200%, this time for the artwork and the app icon on it.
        this._at(66, () => {
            // Allocations stand still while the popup is closed, so the boxes
            // have to be read with it open.
            const menu = Main.panel.statusArea.quickSettings.menu;
            if (!menu.isOpen)
                menu.open(false);
            St.ThemeContext.get_for_stage(global.stage).scale_factor = 2;
        });

        this._at(67, () => {
            const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
            log(`PROBE FORCEDCARD factor=${scale} (expect 2)`);
            cards().forEach(c => {
                const art = Math.min(c._cover.width, c._cover.height,
                    c._cover.icon_size * scale);
                log(`PROBE FORCEDCARD ${cardInfo(c)} art=${Math.round(art)} ` +
                    `inset=${Math.round((art - c._badge.width) / 2 - c._badge.translation_x)} ` +
                    `(expect an inset of 4 at 200%)`);
            });
        });

        this._at(68, () => {
            St.ThemeContext.get_for_stage(global.stage).scale_factor = 1;
        });

        this._at(69, () => log(`PROBE ORDER paused ${order()} ` +
            `(expect spotify last) status=${cards().map(c => c._player.status).join(',')}`));
        this._at(71, () => stateObj()?._settings.set_boolean('sort-playing-first', false));
        this._at(73, () => log(`PROBE ORDER unsorted ${order()} (expect spotify first)`));
        this._at(75, () => stateObj()?._settings.set_boolean('sort-playing-first', true));
        this._at(88, () => log(`PROBE ORDER resumed ${order()} ` +
            `status=${cards().map(c => c._player.status).join(',')}`));

        // Built-in media controls: give them back, take them away again.
        this._at(27, () => stateObj()?._settings.set_boolean('hide-builtin-media', false));
        this._at(29, () => log(`PROBE BUILTIN restored count=${builtinCount()} (expect: as many as the shell's own source lists) ` +
            `shellSource ${builtinSourceInfo()}`));
        this._at(31, () => stateObj()?._settings.set_boolean('hide-builtin-media', true));
        this._at(33, () => log(`PROBE BUILTIN hidden again count=${builtinCount()} (expect 0)`));

        // Stopping the extension has to put everything back.
        this._at(35, () => stateObj()?.disable());
        this._at(37, () => log(`PROBE BUILTIN after disable count=${builtinCount()} (restored) ` +
            `model=${model() ? 'present' : 'gone'}`));
        this._at(39, () => stateObj()?.enable());
        this._at(41, () => log(`PROBE BUILTIN after re-enable count=${builtinCount()} (expect 0) ` +
            `cards=${cards().length}`));

        // Panel mode, to be sure the other host survives the same players.
        this._at(43, () => {
            stateObj()?._settings.set_string('location', 'panel');
            stateObj()?._settings.set_string('panel-text', 'artist-title');
            stateObj()?._settings.set_int('panel-text-width', 200);
        });
        this._at(45, () => {
            const button = Main.panel.statusArea['nowplaying@epogonii.github.io'];
            log(`PROBE PANEL button=${button ? 'present' : 'absent'} visible=${button?.visible} ` +
                `cards=${button?._model.stack._cards.size}`);
        });
        this._at(44, () => {
            stateObj()?._settings.set_boolean('panel-controls', true);
            stateObj()?._settings.set_string('card-layout', 'full');
            // The player that answers the panel has to be one that can skip,
            // or the skip buttons are hidden and nothing moves.
            stateObj()?._settings.set_strv('ignored-players', ['chromium']);

            const button = panelButton();
            button?.menu.open(false);

            const card = panelCards()[0];
            const before = card?.get_preferred_width(-1);
            panelCards().forEach(c => {
                c._title.text = 'A track title long enough to drag a popup wider than it has any business being';
                c._subtitle.text = 'An artist of some name — from an album of some name as well';
            });
            const after = card?.get_preferred_width(-1);
            log(`PROBE WIDTH preferred before=${before} after=${after} ` +
                `(expect the same) w=${panelCards().map(c => c.get_width()).join(',')} ` +
                `menu=${button?.menu.box.get_width()}`);
        });

        this._at(46, () => {
            const button = panelButton();
            const label = button?._panelLabel;
            log(`PROBE PANELTEXT text="${label?.text}" visible=${label?.visible} ` +
                `width=${label?.get_width()} cap=${label?.maxWidth} ` +
                `overflow=${label?._overflow} active=${button?._model.activePlayer?.busName}`);

            // The wheel and the middle button, straight into the handlers: the
            // stubs log what they were asked to do.
            const wheel = direction => ({
                type: () => Clutter.EventType.SCROLL,
                get_scroll_direction: () => direction,
                get_scroll_delta: () => [0, 0],
                get_button: () => 0,
            });
            log(`PROBE WHEEL track up=${button?._onScroll(wheel(Clutter.ScrollDirection.UP))}`);
            log(`PROBE WHEEL track down=${button?._onScroll(wheel(Clutter.ScrollDirection.DOWN))}`);
            stateObj()?._settings.set_string('panel-scroll', 'volume');
            log(`PROBE WHEEL volume up=${button?._onScroll(wheel(Clutter.ScrollDirection.UP))}`);
            stateObj()?._settings.set_string('panel-scroll', 'none');
            log(`PROBE WHEEL off=${button?._onScroll(wheel(Clutter.ScrollDirection.UP))} (expect false)`);
            stateObj()?._settings.set_string('panel-scroll', 'track');
            log(`PROBE MIDDLE handled=${button?._middleClickAction()}`);
            stateObj()?._settings.set_string('panel-middle-click', 'none');
            log(`PROBE MIDDLE off=${button?._middleClickAction()} (expect false)`);
            stateObj()?._settings.set_string('panel-middle-click', 'play-pause');
        });

        // Everything sized in stage pixels has to follow the scale factor, the
        // way an icon size or a length from the stylesheet already does.
        this._at(47, () => {
            const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
            const button = panelButton();
            const eq = button?._model.equalizer;
            const label = button?._panelLabel;
            log(`PROBE SCALE factor=${scale} ` +
                `eq=${geom(eq)} eqPrefW=${eq?.get_preferred_width(-1).map(Math.round).join('/')} ` +
                `(expect ${11 * scale}) ` +
                `labelW=${Math.round(label?.get_width())} ` +
                `labelPrefW=${label?.get_preferred_width(-1).map(Math.round).join('/')} ` +
                `cap=${label?.maxWidth} (expect ${200 * scale}) ` +
                `panelH=${Math.round(Main.panel.height)} (expect twice a 1x panel)`);
        });

        // Wayland scales the framebuffer, so the ui scale factor stays 1 there
        // whatever the monitor does. An X11 session at 200% is the case where it
        // does not, and moving the scale by hand is the only way to stand in for
        // one here.
        this._at(47.2, () => {
            St.ThemeContext.get_for_stage(global.stage).scale_factor = 2;
        });

        this._at(47.5, () => {
            const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
            const button = panelButton();
            const eq = button?._model.equalizer;
            const label = button?._panelLabel;
            log(`PROBE FORCED factor=${scale} (expect 2) ` +
                `eq=${geom(eq)} eqPrefW=${eq?.get_preferred_width(-1).map(Math.round).join('/')} ` +
                `(expect 22) ` +
                `labelPrefW=${label?.get_preferred_width(-1).map(Math.round).join('/')} ` +
                `cap=${label?.maxWidth} (expect 400) ` +
                `panelH=${Math.round(Main.panel.height)} (expect twice the 1x panel)`);
        });

        this._at(47.8, () => {
            St.ThemeContext.get_for_stage(global.stage).scale_factor = 1;
        });

        this._at(46, () => {
            const button = panelButton();
            const label = button?._panelLabel;
            log(`PROBE PANELCTRL visible=${button?._controls.visible} ` +
                `prev=${button?._prevButton.visible} next=${button?._nextButton.visible} ` +
                `play=${button?._playButton.child.icon_name} ` +
                `labelWidth=${label?.get_width()} cap=${label?.maxWidth} pin=${label?.pin} ` +
                `menuOpen=${button?.menu.isOpen}`);

            button?.menu.close();
            button?._nextButton.emit('clicked', 0);
            button?._playButton.emit('clicked', 0);
            log(`PROBE PANELCTRL pressed active=${button?._model.activePlayer?.busName} ` +
                `nextAnim=${button?._nextButton.child.get_transition('translation-x') !== null} ` +
                `playAnim=${button?._playButton.child.get_transition('scale-x') !== null} ` +
                `menuOpen=${button?.menu.isOpen} status=${button?._model.activePlayer?.status}`);

            log(`PROBE WIDTH long w=${panelCards().map(c => c.get_width()).join(',')} ` +
                `titleLen=${panelCards().map(c => c._title.text.length).join(',')} ` +
                `overflow=${panelCards().map(c => c._title._overflow).join(',')} ` +
                `menu=${button?.menu.box.get_width()}`);

            // Without the buttons the fixed width is a preference of its own.
            stateObj()?._settings.set_boolean('panel-controls', false);
            stateObj()?._settings.set_boolean('panel-text-fixed', true);
            log(`PROBE PANELCTRL off controls=${button?._controls.visible} ` +
                `pin=${label?.pin} width=${label?.get_width()} (expect false, true)`);
        });

        // The same presses a hand makes. The events are queued, not answered
        // inside the call that sends them, so every check waits a beat.
        this._at(48.5, () => {
            panelButton()?.menu.close();
            clickAt(panelButton()._nextButton);
        });
        this._at(48.9, () => log(`PROBE REALCLICK next menuOpen=${panelButton()?.menu.isOpen} ` +
            `(expect false, and a Next in the stub log)`));

        this._at(49.3, () => clickAt(panelButton()._playButton));
        this._at(49.7, () => log(`PROBE REALCLICK play menuOpen=${panelButton()?.menu.isOpen} ` +
            `icon=${panelButton()?._playButton.child.icon_name} (expect false, pause)`));

        this._at(50.1, () => clickAt(panelButton()._model.equalizer));
        this._at(50.5, () => log(`PROBE REALCLICK icon menuOpen=${panelButton()?.menu.isOpen} ` +
            `(expect true)`));

        this._at(50.9, () => {
            panelButton()?.menu.close();
            clickAt(panelButton()._model.equalizer, Clutter.BUTTON_MIDDLE);
        });
        this._at(51.5, () => log(`PROBE REALCLICK middle menuOpen=${panelButton()?.menu.isOpen} ` +
            `status=${panelButton()?._model.activePlayer?.status} (expect false, and a PlayPause)`));

        this._at(52.1, () => scrollAt(panelButton()._model.equalizer, -1));
        this._at(52.5, () => log(`PROBE REALSCROLL up menuOpen=${panelButton()?.menu.isOpen} ` +
            `(expect false, and a Previous in the stub log)`));

        this._at(54, () => {
            stateObj()?._settings.set_string('location', 'quick-settings');
            stateObj()?._settings.set_string('panel-text', 'none');
            stateObj()?._settings.set_boolean('panel-controls', false);
            stateObj()?._settings.set_string('card-layout', 'auto');
            stateObj()?._settings.set_strv('ignored-players', []);
            stateObj()?._settings.set_boolean('panel-text-fixed', false);
        });

        // Always, only while a player runs, or never at all. With players
        // around only 'never' differs; the other two part company once the
        // stubs are gone.
        this._at(48, () => {
            stateObj()?._settings.set_string('indicator-visibility', 'never');
            log(`PROBE VIS never shouldShow=${host()?._model.shouldShow} ` +
                `visible=${host()?.visible} cards=${hostCards().length} ` +
                `(expect false, false, 2)`);
        });

        this._at(50, () => {
            stateObj()?._settings.set_string('indicator-visibility', 'active');
            log(`PROBE VIS active shouldShow=${host()?._model.shouldShow} ` +
                `visible=${host()?.visible} (expect true, true)`);
        });

        this._at(92, () => {
            stateObj()?._settings.set_string('indicator-visibility', 'always');
            log(`PROBE VIS always shouldShow=${host()?._model.shouldShow} ` +
                `visible=${host()?.visible} cards=${hostCards().length} ` +
                `(expect true, true, 0)`);
        });

        this._at(94, () => {
            stateObj()?._settings.set_string('indicator-visibility', 'active');
            log(`PROBE VIS active idle shouldShow=${host()?._model.shouldShow} ` +
                `visible=${host()?.visible} (expect false, false)`);
        });

        // Harness kills the stubs at t=90.
        this._at(96, () => {
            const m = model();
            log(`PROBE GONE cards=${cards().length} shouldShow=${m?.shouldShow} ` +
                `eqVisible=${m?.equalizer.visible} builtin=${builtinCount()}`);
        });
    }

    // Milliseconds underneath, so a step can sit between two whole seconds.
    _at(seconds, fn) {
        this._ids.push(GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.round(seconds * 1000), () => {
            try {
                fn();
            } catch (e) {
                log(`PROBE ERROR t=${seconds} ${e}`);
            }
            return GLib.SOURCE_REMOVE;
        }));
    }

    disable() {
        this._ids?.forEach(id => GLib.source_remove(id));
        this._ids = null;
    }
}
