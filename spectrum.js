// SPDX-License-Identifier: GPL-2.0-or-later

// Prints how loud each band of the default output is, 0 to 1000, lowest band
// first, until the shell closes stdin. Nothing is recorded. A process of its
// own, so that the shell never waits on the sound server.

import GLib from 'gi://GLib';
import System from 'system';

const NO_CAPTURE = 2;

const RATE = 24000;
const SIZE = 2048;
const HALF = SIZE / 2;
const TICK_MS = 33;
// Repeated lines are skipped, but not for long: the shell takes half a second
// of nothing as silence.
const REPEAT = 8;

const BANDS = 32;
const LOWEST = 50;
const HIGHEST = RATE / 2;
// Decibels per octave added above 1 kHz and taken away below it, or the bass
// would fill the display and the treble hardly move.
const TILT = 2;
// The top follows the loudest band, never below QUIETEST, and the bottom is
// RANGE dB under it. Below SILENCE nothing shows.
const RANGE = 32;
const QUIETEST = -60;
const SILENCE = -80;
const ATTACK = 0.3;
const RELEASE = 0.1;

const PIPELINE = [
    'pulsesrc device=@DEFAULT_MONITOR@ client-name="Now Playing" latency-time=20000',
    'audioconvert',
    'audioresample',
    `audio/x-raw,format=F32LE,rate=${RATE},channels=1`,
    'appsink name=sink max-buffers=8 drop=true sync=false emit-signals=false',
].join(' ! ');

let Gst;
try {
    ({default: Gst} = await import('gi://Gst?version=1.0'));
    Gst.init(null);
} catch {
    System.exit(NO_CAPTURE);
}

if (!Gst.ElementFactory.find('pulsesrc'))
    System.exit(NO_CAPTURE);

// The newest SIZE samples, the oldest of them at pos.
const ring = new Float32Array(SIZE);
let pos = 0;

const hann = new Float64Array(SIZE);
for (let i = 0; i < SIZE; i++)
    hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / SIZE);

// SIZE real samples go through the transform as HALF complex ones, even
// samples real and odd ones imaginary, and are pulled apart at the end.
const re = new Float64Array(HALF);
const im = new Float64Array(HALF);
const power = new Float64Array(HALF + 1);

const reversed = new Uint16Array(HALF);
const bits = Math.log2(HALF);
for (let i = 0; i < HALF; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++)
        r |= ((i >> b) & 1) << (bits - 1 - b);
    reversed[i] = r;
}

const cosTurn = new Float64Array(HALF / 2);
const sinTurn = new Float64Array(HALF / 2);
for (let i = 0; i < HALF / 2; i++) {
    cosTurn[i] = Math.cos(2 * Math.PI * i / HALF);
    sinTurn[i] = -Math.sin(2 * Math.PI * i / HALF);
}

const cosSplit = new Float64Array(HALF);
const sinSplit = new Float64Array(HALF);
for (let k = 0; k < HALF; k++) {
    cosSplit[k] = Math.cos(Math.PI * k / HALF);
    sinSplit[k] = -Math.sin(Math.PI * k / HALF);
}

// A full-scale sine in the middle of a bin comes out at 0dB.
const FULL_SCALE = (SIZE / 4) ** 2;

// A bin on the edge of a band counts for as much of it as lies inside.
const BIN = RATE / SIZE;
const offsets = new Uint16Array(BANDS + 1);
const binList = [];
const weightList = [];
const tilts = new Float64Array(BANDS);
for (let band = 0; band < BANDS; band++) {
    const low = LOWEST * (HIGHEST / LOWEST) ** (band / BANDS);
    const high = LOWEST * (HIGHEST / LOWEST) ** ((band + 1) / BANDS);
    const from = low / BIN;
    const to = high / BIN;

    offsets[band] = binList.length;
    for (let k = Math.round(from); k <= Math.min(Math.round(to), HALF); k++) {
        const overlap = Math.min(to, k + 0.5) - Math.max(from, k - 0.5);
        if (overlap > 0) {
            binList.push(k);
            weightList.push(overlap);
        }
    }
    tilts[band] = TILT * Math.log2(Math.sqrt(low * high) / 1000);
}
offsets[BANDS] = binList.length;
const bins = Uint16Array.from(binList);
const weights = Float64Array.from(weightList);

const levels = new Float64Array(BANDS);
const values = new Uint16Array(BANDS);
let top = null;
let last = '';
let skipped = 0;

function push(data) {
    let n = data.length;
    let start = 0;
    if (n > SIZE) {
        start = n - SIZE;
        n = SIZE;
    }

    const first = Math.min(n, SIZE - pos);
    ring.set(data.subarray(start, start + first), pos);
    if (first < n)
        ring.set(data.subarray(start + first, start + n), 0);
    pos = (pos + n) % SIZE;
}

function transform() {
    for (let i = 0; i < HALF; i++) {
        let even = pos + 2 * i;
        if (even >= SIZE)
            even -= SIZE;
        let odd = even + 1;
        if (odd >= SIZE)
            odd -= SIZE;

        const j = reversed[i];
        re[j] = ring[even] * hann[2 * i];
        im[j] = ring[odd] * hann[2 * i + 1];
    }

    for (let len = 2, step = HALF / 2; len <= HALF; len *= 2, step /= 2) {
        const half = len / 2;
        for (let i = 0; i < HALF; i += len) {
            for (let k = 0; k < half; k++) {
                const wr = cosTurn[k * step];
                const wi = sinTurn[k * step];
                const x = i + k;
                const y = x + half;
                const tr = re[y] * wr - im[y] * wi;
                const ti = re[y] * wi + im[y] * wr;
                re[y] = re[x] - tr;
                im[y] = im[x] - ti;
                re[x] += tr;
                im[x] += ti;
            }
        }
    }

    power[0] = (re[0] + im[0]) ** 2;
    power[HALF] = (re[0] - im[0]) ** 2;
    for (let k = 1; k < HALF; k++) {
        const n = HALF - k;
        const evenRe = (re[k] + re[n]) / 2;
        const evenIm = (im[k] - im[n]) / 2;
        const oddRe = (im[k] + im[n]) / 2;
        const oddIm = (re[n] - re[k]) / 2;
        const xr = evenRe + oddRe * cosSplit[k] - oddIm * sinSplit[k];
        const xi = evenIm + oddRe * sinSplit[k] + oddIm * cosSplit[k];
        power[k] = xr * xr + xi * xi;
    }
}

function report() {
    transform();

    let loudest = -Infinity;
    for (let band = 0; band < BANDS; band++) {
        let sum = 0;
        for (let j = offsets[band]; j < offsets[band + 1]; j++)
            sum += power[bins[j]] * weights[j];

        levels[band] = 10 * Math.log10(sum / FULL_SCALE + 1e-12) + tilts[band];
        loudest = Math.max(loudest, levels[band]);
    }

    if (loudest < SILENCE) {
        values.fill(0);
    } else {
        if (top === null)
            top = loudest;
        else if (loudest > top)
            top += (loudest - top) * ATTACK;
        else
            top = Math.max(top - RELEASE, loudest);
        top = Math.max(top, QUIETEST);

        const floor = top - RANGE;
        for (let band = 0; band < BANDS; band++) {
            const value = (levels[band] - floor) / RANGE;
            values[band] = Math.round(Math.min(Math.max(value, 0), 1) * 1000);
        }
    }

    const line = values.join(' ');
    if (line !== last || ++skipped >= REPEAT) {
        print(line);
        last = line;
        skipped = 0;
    }
}

function listen(pipeline) {
    const sink = pipeline.get_by_name('sink');
    const loop = new GLib.MainLoop(null, false);
    let status = 0;

    const stop = code => {
        status = code;
        loop.quit();
    };

    const bus = pipeline.get_bus();
    bus.add_signal_watch();
    bus.connect('message::error', (_bus, message) => {
        const [error] = message.parse_error();
        printerr(error.message);
        stop(1);
    });
    bus.connect('message::eos', () => stop(1));

    // The shell never writes to stdin; it only closes it, or dies.
    GLib.io_add_watch(GLib.IOChannel.unix_new(0), GLib.PRIORITY_DEFAULT,
        GLib.IOCondition.IN | GLib.IOCondition.HUP | GLib.IOCondition.ERR,
        () => {
            stop(0);
            return GLib.SOURCE_REMOVE;
        });

    GLib.timeout_add(GLib.PRIORITY_DEFAULT, TICK_MS, () => {
        let fresh = false;
        for (;;) {
            const sample = sink.emit('try-pull-sample', 0);
            if (!sample)
                break;

            const buffer = sample.get_buffer();
            const bytes = buffer.extract_dup(0, buffer.get_size());
            push(new Float32Array(bytes.buffer, bytes.byteOffset,
                bytes.byteLength >> 2));
            fresh = true;
        }

        if (fresh)
            report();
        return GLib.SOURCE_CONTINUE;
    });

    pipeline.set_state(Gst.State.PLAYING);
    loop.run();
    pipeline.set_state(Gst.State.NULL);
    return status;
}

let pipeline;
try {
    pipeline = Gst.parse_launch(PIPELINE);
} catch (e) {
    printerr(e.message);
    System.exit(NO_CAPTURE);
}

System.exit(listen(pipeline));
