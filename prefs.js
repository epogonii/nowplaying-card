// SPDX-License-Identifier: GPL-2.0-or-later

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const LOCATIONS = ['panel', 'quick-settings'];
const PANEL_BOXES = ['left', 'center', 'right'];
const PANEL_TEXTS = ['none', 'title', 'artist-title'];
const PANEL_SCROLLS = ['none', 'track', 'volume'];
const MIDDLE_CLICKS = ['none', 'play-pause', 'next'];
const CARD_LAYOUTS = ['auto', 'full', 'compact'];
const COVER_SIZES = ['small', 'medium', 'large'];
const EQUALIZER_STYLES = ['bars', 'rounded', 'rainbow'];

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

const VISIBILITIES = ['always', 'active', 'never'];
const IGNORED_KEY = 'ignored-players';

export default class NowPlayingPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        // Kept for the toast the copy button raises.
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

        const scrollRow = new Adw.ComboRow({
            title: _('Scrolling over the button'),
            model: new Gtk.StringList({
                strings: [_('Nothing'), _('Switch tracks'), _('Change volume')],
            }),
        });
        panel.add(scrollRow);

        const controlsRow = new Adw.SwitchRow({
            title: _('Controls in the panel'),
            subtitle: _('Previous, play and next next to the icon'),
        });
        panel.add(controlsRow);

        const middleRow = new Adw.ComboRow({
            title: _('Middle click'),
            model: new Gtk.StringList({
                strings: [_('Nothing'), _('Play or pause'), _('Next track')],
            }),
        });
        panel.add(middleRow);

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
            subtitle: _('A minimum: the cover grows to the height of the card'),
            model: new Gtk.StringList({
                strings: [_('Small'), _('Medium'), _('Large')],
            }),
        });
        card.add(coverRow);

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

        const animateRow = new Adw.SwitchRow({
            title: _('Animate the icon'),
            subtitle: _('Move the equalizer bars during playback'),
        });
        icon.add(animateRow);

        const visibilityRow = new Adw.ComboRow({
            title: _('Show in the top bar'),
            subtitle: _('In Quick Settings mode, never still leaves the card there'),
            model: new Gtk.StringList({
                strings: [
                    _('Always'),
                    _('While a player is running'),
                    _('Never'),
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

        this._fillAboutPage(aboutPage);

        this._bindEnum(settings, 'location', LOCATIONS, locationRow);
        this._bindEnum(settings, 'panel-box', PANEL_BOXES, boxRow);
        this._bindEnum(settings, 'panel-text', PANEL_TEXTS, textRow);
        this._bindEnum(settings, 'panel-scroll', PANEL_SCROLLS, scrollRow);
        this._bindEnum(settings, 'panel-middle-click', MIDDLE_CLICKS, middleRow);
        this._bindEnum(settings, 'card-layout', CARD_LAYOUTS, layoutRow);
        this._bindEnum(settings, 'cover-size', COVER_SIZES, coverRow);
        this._bindEnum(settings, 'indicator-visibility', VISIBILITIES, visibilityRow);
        this._bindEnum(settings, 'equalizer-style', EQUALIZER_STYLES, iconStyleRow);
        settings.bind('panel-index', indexRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('max-cards', maxCardsRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('panel-text-width', textWidthRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('show-progress', progressRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('show-volume', volumeRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('show-loop-shuffle', loopRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('scroll-text', scrollTextRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('sort-playing-first', sortRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('animate-icon', animateRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('panel-controls', controlsRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('panel-text-fixed', fixedWidthRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('hide-builtin-media', builtinRow, 'active', Gio.SettingsBindFlags.DEFAULT);

        this._bindIgnored(settings, players);

        // Everything about the panel button only means something in that mode,
        // and the width of the text only once there is text.
        const syncSensitivity = () => {
            const isPanel = settings.get_string('location') === 'panel';
            boxRow.sensitive = isPanel;
            indexRow.sensitive = isPanel;
            panel.sensitive = isPanel;
            const hasText = settings.get_string('panel-text') !== 'none';
            textWidthRow.sensitive = hasText;
            fixedWidthRow.sensitive = hasText;
        };
        settings.connect('changed::location', syncSensitivity);
        settings.connect('changed::panel-text', syncSensitivity);
        syncSensitivity();
    }

    // Where the extension came from, and a place to say thanks from. Nothing
    // on this page has anything to do with the extension working.
    _fillAboutPage(page) {
        const about = new Adw.PreferencesGroup({
            title: this.metadata.name,
            description: _('Whatever is playing, from the top bar'),
        });
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

        const footer = new Adw.PreferencesGroup();
        page.add(footer);
        footer.add(new Gtk.Label({
            label: `· ${this.metadata.name} ${this.metadata['version-name'] ?? ''} ·`,
            justify: Gtk.Justification.CENTER,
            margin_top: 6,
            css_classes: ['dim-label', 'caption'],
        }));
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

        const code = new Gtk.Picture({
            halign: Gtk.Align.CENTER,
            margin_top: 12,
            width_request: QR_SIZE,
            height_request: QR_SIZE,
        });
        group.add(code);

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
