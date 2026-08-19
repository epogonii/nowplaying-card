// Puts the nested session on a scaled monitor, so a run can tell a length that
// follows the scale factor from one that stays where it was written. Wayland
// mutter takes no notice of the legacy scaling-factor setting, the monitor
// configuration is the only way in. Usage: gjs set-scale.js 2
imports.gi.versions.Gio = '2.0';
const {GLib, Gio} = imports.gi;

const wanted = parseFloat(ARGV[0] ?? '2');
const bus = Gio.DBus.session;
const NAME = 'org.gnome.Mutter.DisplayConfig';
const PATH = '/org/gnome/Mutter/DisplayConfig';

function call(method, params) {
    return bus.call_sync(NAME, PATH, NAME, method, params, null,
        Gio.DBusCallFlags.NONE, 10000, null);
}

const state = call('GetCurrentState', null);
const [serial, monitors] = [state.get_child_value(0).get_uint32(),
    state.get_child_value(1)];

const logical = [];
for (let i = 0; i < monitors.n_children(); i++) {
    const monitor = monitors.get_child_value(i);
    const connector = monitor.get_child_value(0).get_child_value(0).get_string()[0];
    const modes = monitor.get_child_value(1);

    let modeId = null;
    let scales = [];
    for (let m = 0; m < modes.n_children(); m++) {
        const mode = modes.get_child_value(m);
        const props = mode.get_child_value(6);
        const current = props.lookup_value('is-current', null)?.get_boolean();
        const preferred = props.lookup_value('is-preferred', null)?.get_boolean();
        if (modeId === null && (current || preferred)) {
            modeId = mode.get_child_value(0).get_string()[0];
            scales = mode.get_child_value(5).deepUnpack();
        }
    }

    if (modeId === null) {
        printerr(`SCALE no mode for ${connector}`);
        continue;
    }
    if (!scales.some(s => Math.abs(s - wanted) < 0.01)) {
        printerr(`SCALE ${connector} cannot do ${wanted}, only ${scales.join(',')}`);
        continue;
    }

    print(`SCALE ${connector} mode=${modeId} to ${wanted}`);
    logical.push([0, 0, wanted, 0, i === 0, [[connector, modeId, {}]]]);
}

if (logical.length === 0)
    throw new Error('SCALE nothing to apply');

// Method 1 is a temporary configuration: it stays for the session and leaves
// no monitors.xml behind for the next run to inherit.
call('ApplyMonitorsConfig', new GLib.Variant('(uua(iiduba(ssa{sv}))a{sv})',
    [serial, 1, logical, {}]));
print('SCALE applied');
