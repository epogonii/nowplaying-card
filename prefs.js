import Adw from 'gi://Adw';
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
const CARD_LAYOUTS = ['auto', 'full', 'compact'];
const COVER_SIZES = ['small', 'medium', 'large'];

const PAYPAL_URL = 'https://www.paypal.com/paypalme/pogonii';
const WALLETS = [
    ['Bitcoin', '18KtJEw8gt2oyicszwMUkbAKMHHXS9nwKR'],
    ['Ethereum', '0x4f2fb6a154526a72d612afa2e3a8129e30ca0996'],
    ['Cardano', 'DdzFFzCqrhsmpnmUqivufj3TmDzksP4HKzcksRUNVr8xA4Gbj7PngV6TfkZuqUqeeKxp138t2Ftd1HypLFkUQ8F1hGtEmyhTP9VnZcUt'],
];
const VISIBILITIES = ['always', 'active', 'never'];

export default class NowPlayingPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage();
        window.add(page);

        const placement = new Adw.PreferencesGroup({title: _('Placement')});
        page.add(placement);

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
        page.add(panel);

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
        page.add(card);

        const layoutRow = new Adw.ComboRow({
            title: _('Card size'),
            subtitle: _('With several players one card is open and the rest are rows'),
            model: new Gtk.StringList({
                strings: [
                    _('Accordion with several players'),
                    _('Always full'),
                    _('Always compact'),
                ],
            }),
        });
        card.add(layoutRow);

        const coverRow = new Adw.ComboRow({
            title: _('Cover size'),
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

        const animateRow = new Adw.SwitchRow({
            title: _('Animate the icon'),
            subtitle: _('Move the equalizer bars during playback'),
        });
        card.add(animateRow);

        const behavior = new Adw.PreferencesGroup({title: _('Behavior')});
        page.add(behavior);

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
        behavior.add(visibilityRow);

        const sortRow = new Adw.SwitchRow({
            title: _('Playing player first'),
            subtitle: _('Keep the card that is playing at the top of the stack'),
        });
        behavior.add(sortRow);

        const builtinRow = new Adw.SwitchRow({
            title: _('Hide the built-in media controls'),
            subtitle: _('Keep GNOME\'s own player out of the notification list'),
        });
        behavior.add(builtinRow);

        const players = new Adw.PreferencesGroup({
            title: _('Players'),
            description: _('Names separated by commas, matched against the app id, the bus name and the name a player reports. Example: firefox, chromium'),
        });
        page.add(players);

        const ignoreRow = new Adw.EntryRow({title: _('Ignored players')});
        players.add(ignoreRow);

        this._addSupportGroup(page);

        this._bindEnum(settings, 'location', LOCATIONS, locationRow);
        this._bindEnum(settings, 'panel-box', PANEL_BOXES, boxRow);
        this._bindEnum(settings, 'panel-text', PANEL_TEXTS, textRow);
        this._bindEnum(settings, 'panel-scroll', PANEL_SCROLLS, scrollRow);
        this._bindEnum(settings, 'panel-middle-click', MIDDLE_CLICKS, middleRow);
        this._bindEnum(settings, 'card-layout', CARD_LAYOUTS, layoutRow);
        this._bindEnum(settings, 'cover-size', COVER_SIZES, coverRow);
        this._bindEnum(settings, 'indicator-visibility', VISIBILITIES, visibilityRow);
        settings.bind('panel-index', indexRow, 'value', Gio.SettingsBindFlags.DEFAULT);
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

        this._bindStrv(settings, 'ignored-players', ignoreRow);

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

    // Nothing to do with the extension working; a place to say thanks from,
    // and nothing here asks for anything.
    _addSupportGroup(page) {
        const group = new Adw.PreferencesGroup({
            title: _('Support'),
            description: _('The extension is free and stays free. If it earned a coffee:'),
        });
        page.add(group);

        const paypal = new Adw.ActionRow({
            title: _('PayPal'),
            subtitle: PAYPAL_URL,
            activatable: true,
        });
        paypal.add_suffix(new Gtk.Image({icon_name: 'adw-external-link-symbolic'}));
        paypal.connect('activated', () =>
            Gio.AppInfo.launch_default_for_uri(PAYPAL_URL, null));
        group.add(paypal);

        for (const [name, address] of WALLETS) {
            const row = new Adw.ActionRow({
                title: name,
                subtitle: address,
                subtitle_selectable: true,
            });

            const copy = new Gtk.Button({
                icon_name: 'edit-copy-symbolic',
                tooltip_text: _('Copy the address'),
                valign: Gtk.Align.CENTER,
                css_classes: ['flat'],
            });
            copy.connect('clicked', () => this._copy(address));
            row.add_suffix(copy);
            group.add(row);
        }
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

    // One entry, one list: a comma separated line is easier to paste than a
    // row of buttons is to click.
    _bindStrv(settings, key, row) {
        const read = () => settings.get_strv(key);
        const parse = text => text.split(',')
            .map(name => name.trim())
            .filter(name => name);

        row.text = read().join(', ');
        row.connect('changed', () => {
            const names = parse(row.text);
            if (names.join('\n') !== read().join('\n'))
                settings.set_strv(key, names);
        });
        settings.connect(`changed::${key}`, () => {
            const text = read().join(', ');
            if (parse(row.text).join('\n') !== read().join('\n'))
                row.text = text;
        });
    }
}
