// SPDX-License-Identifier: GPL-2.0-or-later

import Adw from 'gi://Adw';
import Cairo from 'cairo';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const LOCATIONS = ['panel', 'quick-settings'];
const PANEL_BOXES = ['left', 'center', 'right'];
const PANEL_TEXTS = ['none', 'title', 'artist-title'];
const PANEL_SCROLLS = ['none', 'track', 'volume'];
const MIDDLE_CLICKS = ['none', 'play-pause', 'next'];
const RIGHT_CLICKS = ['menu', 'play-pause', 'next', 'none'];
const CONTROLS_SHOWN = ['all', 'play'];
const CARD_LAYOUTS = ['auto', 'full', 'compact'];
const COVER_SIZES = ['small', 'medium', 'large'];
const POPUP_WIDTHS = ['narrow', 'standard', 'wide', 'wider'];
const EQUALIZER_STYLES = ['bars', 'rounded', 'rainbow'];
const SPECTRUM_SHAPES = ['segments', 'solid', 'mirrored', 'waves'];
const SPECTRUM_COLORS = ['plain', 'classic', 'level', 'rainbow'];
const SPECTRUM_TEXTS = ['panel', 'title', 'artist-title'];

const PROJECT_URL = 'https://github.com/epogonii/nowplaying-card';
const ISSUES_URL = 'https://github.com/epogonii/nowplaying-card/issues';
const FEATURE_URL = 'https://github.com/epogonii/nowplaying-card/issues/new?labels=enhancement';
const SPONSORS_URL = 'https://github.com/sponsors/epogonii';
const PAYPAL_URL = 'https://www.paypal.com/paypalme/pogonii';
const WALLETS = [
    ['Bitcoin', 'bc1qe6fjj3uv23e2yx2ry3wwhyrl7s2pqshau7mga3'],
    ['Ethereum', '0xDC9e1EfA0F8FAE71377F4018d4ff7D123369438e'],
    ['Solana', '3sYQyR27CVz1VcwCfoDLUioaAHk8jspQaSDHXEvBALxg'],
];

// Where tools/gen-qr.sh keeps the codes it draws for those addresses, and how
// wide one of them is shown. They are drawn larger than that, so the picture is
// scaled down rather than up and the modules stay square.
const QR_DIR = 'icons/qr';
const QR_SIZE = 168;

// The icon at the top of the About page: the hills of tools/gen-icon.py, drawn
// here so they drift the way they do in the README. Same numbers as there.
const LOGO_SIZE = 96;
const LOGO_CORNER = 0.22;
const LOGO_TILE = [0.14, 0.14, 0.15];
const LOGO_RIM = 0.0078;
const LOGO_RIM_ALPHA = 0.20;
const LOGO_HILLS = [
    [[0.42, 0.42, 0.43], 0.55, 0.488, 0.117, 0.7, 0],
    [[0.68, 0.68, 0.67], 0.75, 0.625, 0.090, 0.95, 1],
    [[0.89, 0.88, 0.85], 0.95, 0.762, 0.066, 1.2, 2],
];
const LOGO_STEP = 0.008;
const LOGO_HAZE = [0.68, 0.68, 0.67];
const LOGO_HAZE_ALPHA = 0.16;
const LOGO_HAZE_DEPTH = 0.12;
const LOGO_LOOP_S = 9;
const LOGO_TURNS = [1, 2, 3];
const LOGO_BEATS = 6;
const LOGO_RISE = 0.3;
const LOGO_REACT = [0.06, 0.06, 0.065];
const LOGO_SWELL_WIDTH = 0.2;
const LOGO_SWELLS = 2;
const LOGO_CROSSINGS = [1, 1, 2];

const VISIBILITIES = ['always', 'active', 'never'];
const IGNORED_KEY = 'ignored-players';

export default class NowPlayingPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        // Kept for the toasts, and for the reset dialog to open over.
        this._window = window;

        // Four pages rather than one long scroll: what the card looks like,
        // where the button lives, which players get one at all, and where the
        // extension came from.
        const cardPage = new Adw.PreferencesPage({
            title: _('Card'),
            icon_name: 'audio-x-generic-symbolic',
        });
        window.add(cardPage);

        const panelPage = new Adw.PreferencesPage({
            title: _('Panel'),
            icon_name: 'view-continuous-symbolic',
        });
        window.add(panelPage);

        const playersPage = new Adw.PreferencesPage({
            title: _('Players'),
            icon_name: 'multimedia-player-symbolic',
        });
        window.add(playersPage);

        const aboutPage = new Adw.PreferencesPage({
            title: _('About'),
            icon_name: 'help-about-symbolic',
        });
        window.add(aboutPage);

        const placement = new Adw.PreferencesGroup({title: _('Placement')});
        panelPage.add(placement);

        const locationRow = new Adw.ComboRow({
            title: _('Location'),
            subtitle: _('Own panel button, or embedded in Quick Settings'),
            model: new Gtk.StringList({
                strings: [_('Panel button'), _('Quick Settings')],
            }),
        });
        placement.add(locationRow);

        const boxRow = new Adw.ComboRow({
            title: _('Panel area'),
            model: new Gtk.StringList({
                strings: [_('Left'), _('Center'), _('Right')],
            }),
        });
        placement.add(boxRow);

        const indexRow = new Adw.SpinRow({
            title: _('Position'),
            subtitle: _('Order within the panel area'),
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 20,
                step_increment: 1,
                page_increment: 1,
            }),
        });
        placement.add(indexRow);

        const panel = new Adw.PreferencesGroup({
            title: _('Panel button'),
            description: _('Only used by the own-button mode.'),
        });
        panelPage.add(panel);

        const textRow = new Adw.ComboRow({
            title: _('Track in the panel'),
            subtitle: _('Text shown next to the icon'),
            model: new Gtk.StringList({
                strings: [_('Nothing'), _('Title'), _('Artist and title')],
            }),
        });
        panel.add(textRow);

        const textWidthRow = new Adw.SpinRow({
            title: _('Text width'),
            subtitle: _('Longest the text may get, in pixels'),
            adjustment: new Gtk.Adjustment({
                lower: 60,
                upper: 600,
                step_increment: 10,
                page_increment: 50,
            }),
        });
        panel.add(textWidthRow);

        const fixedWidthRow = new Adw.SwitchRow({
            title: _('Fixed text width'),
            subtitle: _('Keep the full width, so nothing moves between tracks'),
        });
        panel.add(fixedWidthRow);

        const iconRow = new Adw.SwitchRow({
            title: _('Icon in the panel'),
            subtitle: _('The equalizer next to the text, or the text alone'),
        });
        panel.add(iconRow);

        const appIconRow = new Adw.SwitchRow({
            title: _('Player icon'),
            subtitle: _('The app that is playing, next to the equalizer or in its place'),
        });
        panel.add(appIconRow);

        const scrollRow = new Adw.ComboRow({
            title: _('Scrolling over the button'),
            model: new Gtk.StringList({
                strings: [_('Nothing'), _('Switch tracks'), _('Change volume')],
            }),
        });
        panel.add(scrollRow);

        const controlsRow = new Adw.SwitchRow({
            title: _('Controls in the panel'),
            subtitle: _('Transport buttons next to the icon'),
        });
        panel.add(controlsRow);

        const controlsShownRow = new Adw.ComboRow({
            title: _('Controls shown'),
            model: new Gtk.StringList({
                strings: [_('Previous, play and next'), _('Play and pause only')],
            }),
        });
        panel.add(controlsShownRow);

        const middleRow = new Adw.ComboRow({
            title: _('Middle click'),
            model: new Gtk.StringList({
                strings: [_('Nothing'), _('Play or pause'), _('Next track')],
            }),
        });
        panel.add(middleRow);

        const rightRow = new Adw.ComboRow({
            title: _('Right click'),
            model: new Gtk.StringList({
                strings: [_('Menu'), _('Play or pause'), _('Next track'), _('Nothing')],
            }),
        });
        panel.add(rightRow);

        const card = new Adw.PreferencesGroup({title: _('Card')});
        cardPage.add(card);

        const layoutRow = new Adw.ComboRow({
            title: _('Card size'),
            subtitle: _('With several players one card is open and the rest are rows'),
            model: new Gtk.StringList({
                strings: [
                    _('Accordion'),
                    _('Always full'),
                    _('Always compact'),
                ],
            }),
        });
        card.add(layoutRow);

        const maxCardsRow = new Adw.SpinRow({
            title: _('Cards at once'),
            subtitle: _('Extra players wait their turn; what is playing always gets a card'),
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 10,
                step_increment: 1,
                page_increment: 1,
            }),
        });
        card.add(maxCardsRow);

        const sortRow = new Adw.SwitchRow({
            title: _('Playing player first'),
            subtitle: _('Keep the card that is playing at the top of the stack'),
        });
        card.add(sortRow);

        const coverRow = new Adw.ComboRow({
            title: _('Cover size'),
            subtitle: _('Medium is as tall as the text beside it'),
            model: new Gtk.StringList({
                strings: [_('Small'), _('Medium'), _('Large')],
            }),
        });
        card.add(coverRow);

        const popupWidthRow = new Adw.ComboRow({
            title: _('Popup width'),
            subtitle: _('How wide the card opens from the panel button'),
            model: Gtk.StringList.new([_('Narrow'), _('Standard'), _('Wide'), _('Wider')]),
        });
        card.add(popupWidthRow);

        const artworkRow = new Adw.SwitchRow({
            title: _('Album art'),
            subtitle: _('Off, the player\'s icon stands in for the picture'),
        });
        card.add(artworkRow);

        const progressRow = new Adw.SwitchRow({
            title: _('Show the progress bar'),
            subtitle: _('Position and length of the track'),
        });
        card.add(progressRow);

        const volumeRow = new Adw.SwitchRow({
            title: _('Show the volume slider'),
            subtitle: _('Only for players that carry a volume of their own'),
        });
        card.add(volumeRow);

        const loopRow = new Adw.SwitchRow({
            title: _('Show shuffle and repeat'),
            subtitle: _('Only for players that support them'),
        });
        card.add(loopRow);

        const scrollTextRow = new Adw.SwitchRow({
            title: _('Scroll long text'),
            subtitle: _('Move a title sideways instead of cutting it off'),
        });
        card.add(scrollTextRow);

        const icon = new Adw.PreferencesGroup({
            title: _('Icon'),
            description: _('The equalizer, both in the top bar and on the card.'),
        });
        cardPage.add(icon);

        const iconStyleRow = new Adw.ComboRow({
            title: _('Icon style'),
            subtitle: _('Shape of the equalizer bars'),
            model: new Gtk.StringList({
                strings: [
                    _('Square ends'),
                    _('Rounded ends'),
                    _('Cycling colours'),
                ],
            }),
        });
        icon.add(iconStyleRow);

        const accentRow = new Adw.SwitchRow({
            title: _('Accent colour'),
            subtitle: _('Bars in the system accent colour, GNOME 47 or later'),
        });
        icon.add(accentRow);

        const animateRow = new Adw.SwitchRow({
            title: _('Animate the icon'),
            subtitle: _('Move the equalizer bars during playback'),
        });
        icon.add(animateRow);

        const frameRateRow = new Adw.SpinRow({
            title: _('Frames a second'),
            subtitle: _('Fewer cost the shell less'),
            adjustment: new Gtk.Adjustment({
                lower: 10,
                upper: 60,
                step_increment: 5,
                page_increment: 10,
            }),
        });
        icon.add(frameRateRow);

        const spectrum = new Adw.PreferencesGroup({
            title: _('Spectrum analyzer'),
            description: _('Columns in the top bar that follow what is playing; the bars on the card follow it too. The sound is measured on this computer and kept nowhere. Without GStreamer\'s PulseAudio plugin the equalizer only pretends, and before GNOME 50.2 the microphone indicator shows while it listens.'),
        });
        cardPage.add(spectrum);

        const spectrumRow = new Adw.SwitchRow({
            title: _('Show the spectrum'),
            subtitle: _('In place of the bars in the top bar'),
        });
        spectrum.add(spectrumRow);

        const allSoundRow = new Adw.SwitchRow({
            title: _('Follow all sound'),
            subtitle: _('Calls and games too, even with nothing playing'),
        });
        spectrum.add(allSoundRow);

        const shapeRow = new Adw.ComboRow({
            title: _('Shape'),
            model: new Gtk.StringList({
                strings: [_('Segments'), _('Solid'), _('Mirrored'), _('Waves')],
            }),
        });
        spectrum.add(shapeRow);

        const colorsRow = new Adw.ComboRow({
            title: _('Colours'),
            model: new Gtk.StringList({
                strings: [
                    _('Theme colour'),
                    _('Red at the top'),
                    _('Green to red'),
                    _('Rainbow'),
                ],
            }),
        });
        spectrum.add(colorsRow);

        const columnsRow = new Adw.SpinRow({
            title: _('Columns'),
            subtitle: _('More columns make the icon wider'),
            adjustment: new Gtk.Adjustment({
                lower: 8,
                upper: 32,
                step_increment: 1,
                page_increment: 4,
            }),
        });
        spectrum.add(columnsRow);

        const peaksRow = new Adw.SwitchRow({
            title: _('Peak markers'),
            subtitle: _('Hold the top of each column for a moment'),
        });
        spectrum.add(peaksRow);

        const spectrumTextRow = new Adw.ComboRow({
            title: _('Track next to the spectrum'),
            model: new Gtk.StringList({
                strings: [_('Same as the panel'), _('Title'), _('Artist and title')],
            }),
        });
        spectrum.add(spectrumTextRow);

        const visibilityRow = new Adw.ComboRow({
            title: _('Visibility'),
            model: new Gtk.StringList({
                strings: [
                    _('Always Show in Top Bar'),
                    _('Show When Active'),
                    _('Don\'t Show in Top Bar'),
                ],
            }),
        });
        placement.add(visibilityRow);

        const builtin = new Adw.PreferencesGroup({title: _('Built-in controls')});
        playersPage.add(builtin);

        const builtinRow = new Adw.SwitchRow({
            title: _('Hide the built-in media controls'),
            subtitle: _('Keep GNOME\'s own player out of the notification list'),
        });
        builtin.add(builtinRow);

        const players = new Adw.PreferencesGroup({
            title: _('Ignored players'),
            description: _('These get no card. A name is matched against the app id, the bus name and the name the player reports.'),
        });
        playersPage.add(players);

        const addPlayer = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            tooltip_text: _('Add a player'),
            css_classes: ['flat'],
        });
        addPlayer.connect('clicked', () => this._pickPlayer(window, settings));
        players.set_header_suffix(addPlayer);

        this._fillAboutPage(aboutPage, settings);

        this._bindEnum(settings, 'location', LOCATIONS, locationRow);
        this._bindEnum(settings, 'panel-box', PANEL_BOXES, boxRow);
        this._bindEnum(settings, 'panel-text', PANEL_TEXTS, textRow);
        this._bindEnum(settings, 'panel-scroll', PANEL_SCROLLS, scrollRow);
        this._bindEnum(settings, 'panel-middle-click', MIDDLE_CLICKS, middleRow);
        this._bindEnum(settings, 'panel-right-click', RIGHT_CLICKS, rightRow);
        this._bindEnum(settings, 'panel-controls-shown', CONTROLS_SHOWN, controlsShownRow);
        this._bindEnum(settings, 'card-layout', CARD_LAYOUTS, layoutRow);
        this._bindEnum(settings, 'cover-size', COVER_SIZES, coverRow);
        this._bindEnum(settings, 'popup-width', POPUP_WIDTHS, popupWidthRow);
        this._bindEnum(settings, 'indicator-visibility', VISIBILITIES, visibilityRow);
        this._bindEnum(settings, 'equalizer-style', EQUALIZER_STYLES, iconStyleRow);
        this._bindEnum(settings, 'spectrum-shape', SPECTRUM_SHAPES, shapeRow);
        this._bindEnum(settings, 'spectrum-colors', SPECTRUM_COLORS, colorsRow);
        this._bindEnum(settings, 'spectrum-text', SPECTRUM_TEXTS, spectrumTextRow);
        settings.bind('panel-index', indexRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('max-cards', maxCardsRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('panel-text-width', textWidthRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('show-artwork', artworkRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('show-progress', progressRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('show-volume', volumeRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('show-loop-shuffle', loopRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('scroll-text', scrollTextRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('sort-playing-first', sortRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('equalizer-accent', accentRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('animate-icon', animateRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('frame-rate', frameRateRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('show-spectrum', spectrumRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('spectrum-columns', columnsRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('spectrum-peaks', peaksRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('spectrum-all-sound', allSoundRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('panel-controls', controlsRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('panel-text-fixed', fixedWidthRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('panel-icon', iconRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('panel-app-icon', appIconRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('hide-builtin-media', builtinRow, 'active', Gio.SettingsBindFlags.DEFAULT);

        this._bindIgnored(settings, players);

        // Everything about the panel button only means something in that mode,
        // and the width of the text only once there is text.
        const syncSensitivity = () => {
            const isPanel = settings.get_string('location') === 'panel';
            boxRow.sensitive = isPanel;
            indexRow.sensitive = isPanel;
            panel.sensitive = isPanel;
            // Quick Settings gives the card the width of its grid.
            popupWidthRow.sensitive = isPanel;
            const showSpectrum = settings.get_boolean('show-spectrum');
            const spectrumText = settings.get_string('spectrum-text');
            const ownText = showSpectrum && spectrumText !== 'panel';
            const hasText = (ownText ? spectrumText : settings.get_string('panel-text')) !== 'none';
            textWidthRow.sensitive = hasText;
            fixedWidthRow.sensitive = hasText;
            const appIcon = settings.get_boolean('panel-app-icon');
            iconRow.sensitive = (hasText || appIcon) && !ownText;
            controlsShownRow.sensitive = settings.get_boolean('panel-controls');
            const colors = settings.get_string('spectrum-colors');
            // The waves keep the greys of the icon.
            const waves = settings.get_string('spectrum-shape') === 'waves';
            const spectrumInk = showSpectrum && !waves &&
                (colors === 'plain' || colors === 'classic');
            accentRow.sensitive = spectrumInk ||
                settings.get_string('equalizer-style') !== 'rainbow';
            shapeRow.sensitive = showSpectrum;
            colorsRow.sensitive = showSpectrum && !waves;
            columnsRow.sensitive = showSpectrum;
            peaksRow.sensitive = showSpectrum && settings.get_boolean('animate-icon');
            allSoundRow.sensitive = showSpectrum && settings.get_boolean('animate-icon');
            frameRateRow.sensitive = settings.get_boolean('animate-icon');
            spectrumTextRow.sensitive = showSpectrum && isPanel;
        };
        settings.connect('changed::location', syncSensitivity);
        settings.connect('changed::panel-text', syncSensitivity);
        settings.connect('changed::panel-app-icon', syncSensitivity);
        settings.connect('changed::panel-controls', syncSensitivity);
        settings.connect('changed::equalizer-style', syncSensitivity);
        settings.connect('changed::spectrum-shape', syncSensitivity);
        settings.connect('changed::spectrum-colors', syncSensitivity);
        settings.connect('changed::show-spectrum', syncSensitivity);
        settings.connect('changed::spectrum-text', syncSensitivity);
        settings.connect('changed::animate-icon', syncSensitivity);
        syncSensitivity();
    }

    // Where the extension came from, and a place to say thanks from. The reset
    // at the bottom is the only thing on this page that touches a setting.
    _fillAboutPage(page, settings) {
        // The icon, the name and the line under it, centred the way the About
        // window of a GNOME app has them.
        const header = new Adw.PreferencesGroup();
        page.add(header);
        header.add(this._logo());
        header.add(new Gtk.Label({
            label: this.metadata.name,
            wrap: true,
            justify: Gtk.Justification.CENTER,
            margin_top: 12,
            css_classes: ['title-1'],
        }));
        header.add(new Gtk.Label({
            label: _('Whatever is playing, from the top bar'),
            wrap: true,
            justify: Gtk.Justification.CENTER,
            margin_top: 6,
            css_classes: ['dim-label'],
        }));

        const about = new Adw.PreferencesGroup();
        page.add(about);
        about.add(this._linkRow(_('Project page'), PROJECT_URL, PROJECT_URL));

        // Both halves of an issue as two buttons rather than two more rows,
        // because they are the two things somebody on this page came to do. A
        // group takes any widget, so they go in as they are.
        const buttons = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            homogeneous: true,
            halign: Gtk.Align.CENTER,
            spacing: 12,
            margin_top: 18,
        });
        buttons.append(this._pill(_('Report a problem'), ISSUES_URL));
        buttons.append(this._pill(_('Request a feature'), FEATURE_URL));
        about.add(buttons);

        about.add(new Gtk.Label({
            label: _('Something it does wrong, or something it does not do yet - either one belongs in an issue.'),
            justify: Gtk.Justification.CENTER,
            wrap: true,
            max_width_chars: 44,
            margin_top: 12,
            css_classes: ['dim-label', 'caption'],
        }));

        this._addSupportGroup(page);
        this._addResetGroup(page, settings);

        const footer = new Adw.PreferencesGroup();
        page.add(footer);
        footer.add(new Gtk.Label({
            label: `· ${this.metadata.name} ${this.metadata['version-name'] ?? ''} ·`,
            justify: Gtk.Justification.CENTER,
            margin_top: 6,
            css_classes: ['dim-label', 'caption'],
        }));
    }

    // Still when the desktop has animations off, and only ticking while the
    // page is on screen.
    _logo() {
        const logo = new Gtk.DrawingArea({
            content_width: LOGO_SIZE,
            content_height: LOGO_SIZE,
            halign: Gtk.Align.CENTER,
        });
        let t = null;
        logo.set_draw_func((area, cr, width) => {
            paintLogo(cr, width, t);
            cr.$dispose();
        });
        if (Gtk.Settings.get_default().gtk_enable_animations) {
            let tick = 0;
            logo.connect('map', () => {
                tick = logo.add_tick_callback((widget, clock) => {
                    t = clock.get_frame_time() / 1e6 / LOGO_LOOP_S % 1;
                    widget.queue_draw();
                    return true;
                });
            });
            logo.connect('unmap', () => logo.remove_tick_callback(tick));
        }
        return logo;
    }

    // A row that opens something in a browser.
    _linkRow(title, subtitle, url) {
        const row = new Adw.ActionRow({title, subtitle, activatable: true});
        row.add_suffix(new Gtk.Image({icon_name: 'adw-external-link-symbolic'}));
        row.connect('activated', () =>
            Gio.AppInfo.launch_default_for_uri(url, null));
        return row;
    }

    // A rounded button that opens something in a browser.
    _pill(label, url) {
        const button = new Gtk.Button({label, css_classes: ['pill']});
        button.connect('clicked', () =>
            Gio.AppInfo.launch_default_for_uri(url, null));
        return button;
    }

    // Nothing here asks for anything.
    _addSupportGroup(page) {
        const group = new Adw.PreferencesGroup({
            title: _('Support'),
            description: _('The extension is free and stays free. If it earned a coffee ☕'),
        });
        page.add(group);

        group.add(this._linkRow(_('GitHub Sponsors'),
            _('Monthly or one time'), SPONSORS_URL));
        group.add(this._linkRow(_('PayPal'), PAYPAL_URL, PAYPAL_URL));

        this._addWallets(group);
    }

    // The wallets, one at a time: the network to send on, the address it
    // belongs to, and the code to point a phone at instead of typing it out.
    // The codes are drawn by tools/gen-qr.sh and ship as files - an encoder
    // written in here would be a few hundred lines of arithmetic in front of
    // anybody reviewing the extension, and a wrong module in a QR code is money
    // sent nowhere.
    _addWallets(group) {
        const networks = new Gtk.StringList();
        for (const [name] of WALLETS)
            networks.append(name);

        const network = new Adw.ComboRow({
            title: _('Cryptocurrency'),
            model: networks,
        });
        group.add(network);

        const address = new Adw.ActionRow({
            title: _('Address'),
            subtitle_selectable: true,
            subtitle_lines: 0,
        });
        const copy = new Gtk.Button({
            icon_name: 'edit-copy-symbolic',
            tooltip_text: _('Copy the address'),
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        address.add_suffix(copy);
        group.add(address);

        // A picture grows to the width it is given, so the clamp holds it to
        // its size; centring it alone does not.
        const code = new Gtk.Picture({
            margin_top: 12,
            width_request: QR_SIZE,
            height_request: QR_SIZE,
        });
        group.add(new Adw.Clamp({maximum_size: QR_SIZE, child: code}));

        const chosen = () => WALLETS[network.selected] ?? WALLETS[0];

        const show = () => {
            const [name, wallet] = chosen();
            const file = `${name.toLowerCase().replaceAll(' ', '-')}.svg`;
            address.subtitle = wallet;
            code.file = Gio.File.new_for_path(`${this.path}/${QR_DIR}/${file}`);
            code.alternative_text =
                _('The %s address as a QR code').replace('%s', () => name);
        };
        network.connect('notify::selected', show);
        show();

        copy.connect('clicked', () => {
            const [name, wallet] = chosen();
            this._copy(wallet);
            this._toast(_('%s address copied').replace('%s', () => name));
        });
    }

    _addResetGroup(page, settings) {
        const group = new Adw.PreferencesGroup();
        page.add(group);

        const row = new Adw.ActionRow({
            title: _('Reset all settings'),
            subtitle: _('Card, Panel and Players back to their defaults'),
        });
        const button = new Gtk.Button({
            label: _('Reset…'),
            valign: Gtk.Align.CENTER,
        });
        button.connect('clicked', () => this._confirmReset(settings));
        row.add_suffix(button);
        group.add(row);
    }

    _confirmReset(settings) {
        const options = {
            heading: _('Reset all settings?'),
            body: _('Every option goes back to its default, and ignored players get their cards again.'),
            close_response: 'cancel',
        };
        // AlertDialog came with libadwaita 1.5; GNOME 45 only has MessageDialog.
        const dialog = Adw.AlertDialog
            ? new Adw.AlertDialog(options)
            : new Adw.MessageDialog({...options, transient_for: this._window, modal: true});
        dialog.add_response('cancel', _('Cancel'));
        dialog.add_response('reset', _('Reset'));
        dialog.set_response_appearance('reset', Adw.ResponseAppearance.DESTRUCTIVE);
        dialog.connect('response', (_dialog, response) => {
            if (response !== 'reset')
                return;

            for (const key of settings.settings_schema.list_keys())
                settings.reset(key);
            this._toast(_('All settings are back to their defaults'));
        });

        if (Adw.AlertDialog)
            dialog.present(this._window);
        else
            dialog.present();
    }

    _toast(message) {
        this._window?.add_toast?.(new Adw.Toast({title: message, timeout: 6}));
    }

    _copy(text) {
        const value = new GObject.Value();
        value.init(GObject.TYPE_STRING);
        value.set_string(text);
        Gdk.Display.get_default()?.get_clipboard().set_value(value);
    }

    // ComboRow works on indices, the schema stores enum nicks.
    _bindEnum(settings, key, values, row) {
        row.selected = Math.max(0, values.indexOf(settings.get_string(key)));
        row.connect('notify::selected', () => {
            const value = values[row.selected];
            if (value && value !== settings.get_string(key))
                settings.set_string(key, value);
        });
        settings.connect(`changed::${key}`, () => {
            const index = values.indexOf(settings.get_string(key));
            if (index >= 0 && index !== row.selected)
                row.selected = index;
        });
    }

    // The setting is the list; the rows are built from it every time it
    // changes, so removing one here and a change made elsewhere look the same.
    _bindIgnored(settings, group) {
        let rows = [];

        const rebuild = () => {
            rows.forEach(row => group.remove(row));
            rows = [];

            const names = settings.get_strv(IGNORED_KEY);
            if (names.length === 0) {
                const empty = new Adw.ActionRow({
                    title: _('Every player gets a card'),
                    sensitive: false,
                });
                rows.push(empty);
                group.add(empty);
                return;
            }

            for (const name of names) {
                const row = new Adw.ActionRow({title: name, use_markup: false});
                const remove = new Gtk.Button({
                    icon_name: 'list-remove-symbolic',
                    tooltip_text: _('Show this player again'),
                    valign: Gtk.Align.CENTER,
                    css_classes: ['flat'],
                });
                remove.connect('clicked', () => settings.set_strv(IGNORED_KEY,
                    settings.get_strv(IGNORED_KEY).filter(other => other !== name)));
                row.add_suffix(remove);
                rows.push(row);
                group.add(row);
            }
        };

        settings.connect(`changed::${IGNORED_KEY}`, rebuild);
        rebuild();
    }

    // Anything that speaks MPRIS can be named by hand, a player in a flatpak
    // or one with no .desktop file included, so the search doubles as the
    // entry: whatever is typed is offered as it stands.
    _pickPlayer(parent, settings) {
        const window = new Adw.Window({
            transient_for: parent,
            modal: true,
            title: _('Add a player'),
            default_width: 460,
            default_height: 560,
        });

        const search = new Gtk.SearchEntry({
            placeholder_text: _('Search apps, or type a name'),
            hexpand: true,
        });

        const list = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.NONE,
            css_classes: ['boxed-list'],
            valign: Gtk.Align.START,
        });

        const add = name => {
            const wanted = name.trim();
            const names = settings.get_strv(IGNORED_KEY);
            if (wanted && !names.includes(wanted))
                settings.set_strv(IGNORED_KEY, [...names, wanted]);

            window.close();
        };

        const manual = new Adw.ActionRow({activatable: true, use_markup: false});
        manual.add_prefix(new Gtk.Image({icon_name: 'list-add-symbolic'}));
        list.append(manual);

        for (const app of this._installedApps()) {
            const row = new Adw.ActionRow({
                title: app.name,
                subtitle: app.id,
                activatable: true,
                use_markup: false,
            });
            if (app.icon)
                row.add_prefix(new Gtk.Image({gicon: app.icon, pixel_size: 24}));

            row._name = `${app.name} ${app.id}`.toLowerCase();
            row._value = app.id;
            list.append(row);
        }

        list.set_filter_func(row => {
            const text = search.text.trim().toLowerCase();
            if (row === manual)
                return text !== '';

            return text === '' || row._name.includes(text);
        });
        list.connect('row-activated', (_list, row) =>
            add(row === manual ? search.text : row._value));

        search.connect('search-changed', () => {
            const text = search.text.trim();
            // A function as the replacement, so a $ in the name stays a $.
            manual.title = _('Use \u201c%s\u201d').replace('%s', () => text);
            manual.visible = text !== '';
            list.invalidate_filter();
        });
        search.connect('activate', () => add(search.text));

        const header = new Adw.HeaderBar({
            title_widget: search,
            show_start_title_buttons: false,
            show_end_title_buttons: false,
        });
        const cancel = new Gtk.Button({label: _('Cancel')});
        cancel.connect('clicked', () => window.close());
        header.pack_start(cancel);

        const view = new Adw.ToolbarView({
            content: new Gtk.ScrolledWindow({
                hscrollbar_policy: Gtk.PolicyType.NEVER,
                child: new Adw.Clamp({
                    child: list,
                    maximum_size: 420,
                    margin_top: 12,
                    margin_bottom: 12,
                    margin_start: 12,
                    margin_end: 12,
                }),
            }),
        });
        view.add_top_bar(header);
        window.set_content(view);

        const keys = new Gtk.EventControllerKey();
        keys.connect('key-pressed', (_controller, keyval) => {
            if (keyval !== Gdk.KEY_Escape)
                return Gdk.EVENT_PROPAGATE;

            window.close();
            return Gdk.EVENT_STOP;
        });
        window.add_controller(keys);

        window.present();
        search.grab_focus();
    }

    _installedApps() {
        return Gio.AppInfo.get_all()
            .filter(app => app.should_show())
            .map(app => ({
                id: (app.get_id() ?? '').replace(/\.desktop$/, ''),
                name: app.get_display_name() || app.get_name() || '',
                icon: app.get_icon(),
            }))
            .filter(app => app.id && app.name)
            .sort((first, second) => first.name.localeCompare(second.name));
    }
}

function roundedRect(cr, x, y, size, radius) {
    cr.newSubPath();
    cr.arc(x + size - radius, y + radius, radius, -Math.PI / 2, 0);
    cr.arc(x + size - radius, y + size - radius, radius, 0, Math.PI / 2);
    cr.arc(x + radius, y + size - radius, radius, Math.PI / 2, Math.PI);
    cr.arc(x + radius, y + radius, radius, Math.PI, 3 * Math.PI / 2);
    cr.closePath();
}

// Eases up from nothing to its top at LOGO_RISE into the beat, then dies away.
function swell(into) {
    const x = into / LOGO_RISE;
    return x * x * Math.exp(2 * (1 - x));
}

function lift(k, t, x) {
    let total = 0;
    for (let j = 0; j < LOGO_SWELLS; j++) {
        const centre = (j / LOGO_SWELLS + k * 0.3 + LOGO_CROSSINGS[k] * t) % 1;
        let gap = Math.abs(x - centre);
        gap = Math.min(gap, 1 - gap);
        total += Math.exp(-((gap / LOGO_SWELL_WIDTH) ** 2));
    }
    return total;
}

// t runs from 0 to 1 over the loop; null draws the still icon.
function paintLogo(cr, size, t) {
    let louds = null;
    if (t !== null) {
        const beat = Math.floor(t * LOGO_BEATS);
        const into = t * LOGO_BEATS - beat;
        const kick = swell(into);
        louds = [
            0.15 + 0.85 * kick,
            0.15 + 0.85 * (beat % 2 === 1 ? kick : 0),
            0.2 + 0.8 * Math.exp(-(((into - 0.5) * 4) ** 2)),
        ];
    }

    roundedRect(cr, 0, 0, size, size * LOGO_CORNER);
    cr.setSourceRGB(...LOGO_TILE);
    cr.fillPreserve();
    cr.save();
    cr.clip();

    const step = size * LOGO_STEP;
    LOGO_HILLS.forEach(([colour, alpha, base, height, humps, start], k) => {
        const shift = t === null ? 0 : -2 * Math.PI * LOGO_TURNS[k] * t;
        cr.moveTo(0, size);
        for (let x = 0; x <= size + step; x += step) {
            const angle = x / size * Math.PI * humps * 2 + start + shift;
            let y = base - height * Math.sin(angle);
            if (louds)
                y -= LOGO_REACT[k] * louds[k] * lift(k, t, Math.min(x / size, 1));
            cr.lineTo(x, size * y);
        }
        cr.lineTo(size, size);
        cr.closePath();
        cr.setSourceRGBA(...colour, alpha);
        cr.fillPreserve();

        if (k < LOGO_HILLS.length - 1) {
            const top = size * (base - height);
            const fog = new Cairo.LinearGradient(0, top, 0,
                top + size * (2 * height + LOGO_HAZE_DEPTH));
            fog.addColorStopRGBA(0, ...LOGO_HAZE, 0);
            fog.addColorStopRGBA(1, ...LOGO_HAZE, LOGO_HAZE_ALPHA);
            cr.setSource(fog);
            cr.fill();
        } else {
            cr.newPath();
        }
    });
    cr.restore();

    const inset = size * LOGO_RIM / 2;
    roundedRect(cr, inset, inset, size - 2 * inset, size * LOGO_CORNER - inset);
    cr.setLineWidth(size * LOGO_RIM);
    cr.setSourceRGBA(1, 1, 1, LOGO_RIM_ALPHA);
    cr.stroke();
}
