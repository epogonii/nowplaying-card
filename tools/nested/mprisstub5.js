// MPRIS stub. argv: suffix entry(|none) identity skip(yes|no) trackid(yes|no)
//                   title artUrl(|none) window(yes|no) extras(yes|no) pause(yes|no)
imports.gi.versions.Gtk = '4.0';
const {Gio, GLib} = imports.gi;
const [suffix, entry, identity, canSkip, withTrackId, title, artUrl, window_,
       extras, pauseCycle] = ARGV;
const hasExtras = extras === 'yes';

const ROOT_PROPS = entry === 'none'
    ? `<property name="Identity" type="s" access="read"/>`
    : `<property name="Identity" type="s" access="read"/>
       <property name="DesktopEntry" type="s" access="read"/>`;

const ROOT_IFACE = `
<node>
  <interface name="org.mpris.MediaPlayer2">
    <method name="Raise"/><method name="Quit"/>
    ${ROOT_PROPS}
    <property name="CanQuit" type="b" access="read"/>
    <property name="CanRaise" type="b" access="read"/>
  </interface>
</node>`;

const PLAYER_IFACE = `
<node>
  <interface name="org.mpris.MediaPlayer2.Player">
    <method name="Play"/><method name="Pause"/><method name="PlayPause"/>
    <method name="Next"/><method name="Previous"/><method name="Stop"/>
    <method name="Seek"><arg type="x" direction="in"/></method>
    <method name="SetPosition"><arg type="o" direction="in"/><arg type="x" direction="in"/></method>
    <signal name="Seeked"><arg type="x"/></signal>
    <property name="PlaybackStatus" type="s" access="read"/>
    <property name="Volume" type="d" access="readwrite"/>
    <property name="Position" type="x" access="read"/>
    <property name="Metadata" type="a{sv}" access="read"/>
    <property name="CanGoNext" type="b" access="read"/>
    <property name="CanGoPrevious" type="b" access="read"/>
    <property name="CanPlay" type="b" access="read"/>
    <property name="CanPause" type="b" access="read"/>
    <property name="CanSeek" type="b" access="read"/>
    <property name="CanControl" type="b" access="read"/>
    ${extras === 'yes' ? `<property name="LoopStatus" type="s" access="readwrite"/>
    <property name="Shuffle" type="b" access="readwrite"/>` : ''}
  </interface>
</node>`;

const skip = canSkip === 'yes';
const meta = {
  'mpris:length': new GLib.Variant('x', 210000000),
  'xesam:title': new GLib.Variant('s', title),
  'xesam:artist': new GLib.Variant('as', ['Phoebe Bridgers']),
  'xesam:album': new GLib.Variant('s', 'Stranger in the Alps'),
};
if (artUrl && artUrl !== 'none')
  meta['mpris:artUrl'] = new GLib.Variant('s', artUrl);
if (withTrackId === 'yes')
  meta['mpris:trackid'] = new GLib.Variant('o', '/org/test/track/1');

const root = {
  Identity: identity, CanQuit: true, CanRaise: true,
  Raise() { print(`stub-${suffix}: Raise`); }, Quit() {},
};
if (entry !== 'none')
  root.DesktopEntry = entry;

let volume = 1.0;
let loopStatus = 'None';
let shuffle = false;

const player = {
  PlaybackStatus: 'Playing', Position: 42000000,
  get Volume() { return volume; },
  set Volume(value) {
    volume = value;
    print(`stub-${suffix}: Volume=${value.toFixed(3)}`);
    playerExp.emit_property_changed('Volume', new GLib.Variant('d', volume));
  },
  Metadata: new GLib.Variant('a{sv}', meta),
  CanGoNext: skip, CanGoPrevious: skip, CanPlay: true, CanPause: true,
  CanSeek: true, CanControl: true,
  Play(){}, Pause(){}, PlayPause(){ print(`stub-${suffix}: PlayPause`); },
  Next(){ print(`stub-${suffix}: Next`); }, Previous(){ print(`stub-${suffix}: Previous`); }, Stop(){},
  Seek(delta) {
    player.Position += delta;
    print(`stub-${suffix}: Seek ${delta} -> ${player.Position}`);
    playerExp.emit_signal('Seeked', new GLib.Variant('(x)', [player.Position]));
  },
  SetPosition(trackid, pos) {
    player.Position = pos;
    print(`stub-${suffix}: SetPosition ${trackid} ${pos}`);
    playerExp.emit_signal('Seeked', new GLib.Variant('(x)', [player.Position]));
  },
};

if (hasExtras) {
  Object.defineProperties(player, {
    LoopStatus: {
      enumerable: true,
      get: () => loopStatus,
      set: value => {
        loopStatus = value;
        print(`stub-${suffix}: LoopStatus=${value}`);
        playerExp.emit_property_changed('LoopStatus', new GLib.Variant('s', loopStatus));
      },
    },
    Shuffle: {
      enumerable: true,
      get: () => shuffle,
      set: value => {
        shuffle = value;
        print(`stub-${suffix}: Shuffle=${value}`);
        playerExp.emit_property_changed('Shuffle', new GLib.Variant('b', shuffle));
      },
    },
  });
}

const rootExp = Gio.DBusExportedObject.wrapJSObject(ROOT_IFACE, root);
const playerExp = Gio.DBusExportedObject.wrapJSObject(PLAYER_IFACE, player);

GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
  if (player.PlaybackStatus === 'Playing')
    player.Position += 1000000;
  return GLib.SOURCE_CONTINUE;
});
if (!hasExtras) {
  GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
    player.Volume = volume === 1.0 ? 0.9 : 1.0;
    return GLib.SOURCE_CONTINUE;
  });
}

// A player that stops and starts again, so the order of the cards can be seen
// to follow it.
if (pauseCycle === 'yes') {
  const setStatus = status => {
    player.PlaybackStatus = status;
    print(`stub-${suffix}: PlaybackStatus=${status}`);
    playerExp.emit_property_changed('PlaybackStatus', new GLib.Variant('s', status));
    return GLib.SOURCE_REMOVE;
  };
  GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => setStatus('Paused'));
  GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 80, () => setStatus('Playing'));
}

Gio.DBus.session.own_name(`org.mpris.MediaPlayer2.${suffix}`,
  Gio.BusNameOwnerFlags.NONE,
  conn => {
    rootExp.export(conn, '/org/mpris/MediaPlayer2');
    playerExp.export(conn, '/org/mpris/MediaPlayer2');
    print(`stub-${suffix}: exported entry=${entry} identity=${identity} ` +
          `pid=${new Gio.Credentials().get_unix_pid()}`);
  },
  () => print(`stub-${suffix}: name lost`));

if (window_ === 'yes') {
  // A window makes the process discoverable through the window tracker, the
  // way a real player is.
  const Gtk = imports.gi.Gtk;
  Gtk.init();
  const app = new Gtk.Application({application_id: 'org.gnome.Calculator'});
  app.connect('activate', () => {
    const win = new Gtk.ApplicationWindow({application: app, title: 'Stub window'});
    win.set_default_size(200, 120);
    win.present();
    print(`stub-${suffix}: window shown`);
  });
  app.run([]);
} else {
  new GLib.MainLoop(null, false).run();
}
