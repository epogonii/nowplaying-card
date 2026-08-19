// Builds the preferences window outside the shell, so a row that asks for a
// property which does not exist, or a page that cannot be added, throws here
// instead of leaving an empty dialog behind in the extensions app.
//
// It reads the copy under ~/.local/share: the translation helpers in the
// shell's own prefs module find an extension by the name of the directory it
// sits in, and only the installed copy sits in one named after the UUID. Run
// tools/install-local.sh first.
//
//   GI_TYPELIB_PATH=/usr/lib64/gnome-shell/girepository-1.0 \
//       gjs -m tools/prefs-smoke.js [extension directory]
import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';

Gio.resources_register(Gio.Resource.load(
    '/usr/share/gnome-shell/org.gnome.Shell.Extensions.src.gresource'));

const RESOURCE = 'resource:///org/gnome/Shell/Extensions/js';

const here = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);
const source = Gio.File.new_for_path(GLib.path_get_dirname(here));
const [, sourceBytes] = source.get_child('metadata.json').load_contents(null);
const uuid = JSON.parse(new TextDecoder().decode(sourceBytes))['uuid'];
const dir = System.programArgs.length > 0
    ? Gio.File.new_for_path(System.programArgs[0])
    : Gio.File.new_for_path(
        `${GLib.get_user_data_dir()}/gnome-shell/extensions/${uuid}`);

function* walk(widget) {
    for (let child = widget.get_first_child(); child;
        child = child.get_next_sibling()) {
        yield child;
        yield* walk(child);
    }
}

const loop = GLib.MainLoop.new(null, false);
let failed = true;

Promise.all([
    import(`${RESOURCE}/misc/extensionUtils.js`),
    import(`${RESOURCE}/extensionsService.js`),
    import(`file://${dir.get_path()}/prefs.js`),
]).then(([utils, service, {default: Preferences}]) => {
    const [, bytes] = dir.get_child('metadata.json').load_contents(null);
    const metadata = JSON.parse(new TextDecoder().decode(bytes));

    Adw.init();

    const prefs = new Preferences({
        ...metadata,
        dir,
        path: dir.get_path(),
    });

    // gettext() asks the extension manager for whoever is calling, and outside
    // the real service nothing has been loaded into it. This is that: the one
    // extension under test, handed over the way the service hands its own.
    const extension = service.extensionManager.createExtensionObject(
        utils.serializeExtension({
            metadata,
            uuid: metadata.uuid,
            type: utils.ExtensionType.PER_USER,
            state: utils.ExtensionState.ACTIVE,
            enabled: true,
            path: dir.get_path(),
            error: '',
            hasPrefs: true,
            hasUpdate: false,
            canChange: true,
            sessionModes: ['user'],
        }));
    extension.stateObj = prefs;

    const window = new Adw.PreferencesWindow();
    prefs.fillPreferencesWindow(window);

    // Counted per page of ours, since libadwaita carries an untitled page with
    // a group in it for search results and that is not ours to report.
    const pages = [];
    let groups = 0;
    let rows = 0;

    for (const child of walk(window)) {
        if (!(child instanceof Adw.PreferencesPage) || child.title === '')
            continue;
        pages.push(child.title);
        for (const inner of walk(child)) {
            if (inner instanceof Adw.PreferencesGroup)
                groups++;
            else if (inner instanceof Adw.PreferencesRow)
                rows++;
        }
    }

    print(`SMOKE ${dir.get_path()}`);
    print(`SMOKE pages=${pages.length} [${pages.join(', ')}] ` +
        `groups=${groups} rows=${rows}`);
    if (pages.length === 0)
        throw new Error('the window came up with no page of ours in it');
    failed = false;
    loop.quit();
}).catch(error => {
    printerr(`SMOKE failed ${error}\n${error.stack}`);
    loop.quit();
});

loop.run();
System.exit(failed ? 1 : 0);
