/* Stopped-driver detection for APEX GP multiplayer.
 *
 * Robust, time-windowed detection that avoids false positives
 * caused by packet loss, jitter, variable update intervals or
 * temporary network interruptions. A driver is only reported
 * as stopped when *actual* movement has been absent for a
 * sustained period while updates are still arriving.
 *
 * Usage (CommonJS / browser UMD):
 *   const d = new StoppedDriverDetector({ windowMs: 4000 });
 *   d.observe({ t, x, z, speed, finished, crashed, onGrid });
 *   const state = d.getState(now); // { state, stopped, disconnected, delayed, ... }
 */
"use strict";

function num(v) { return typeof v === "number" && Number.isFinite(v); }

const DEFAULTS = {
    windowMs: 4000,          // observation window
    stoppedAfterMs: 3000,    // no movement for this long => stopped
    waitingAfterMs: 1200,    // low movement for this long => waiting
    delayAfterMs: 1500,      // no update for this long => delayed
    disconnectAfterMs: 10000,// no update for this long => disconnected
    moveDistance: 0.75,      // meters between samples to count as movement
    speedThreshold: 1.0,     // m/s considered moving
    minSamples: 3,           // need at least this many samples in window
};

class StoppedDriverDetector {
    constructor(opts) {
        this.opts = Object.assign({}, DEFAULTS, opts || {});
        this.samples = [];
        this.lastMovementAt = null;
        this.lastUpdateAt = null;
        this.wasMoving = false;
    }

    reset() {
        this.samples = [];
        this.lastMovementAt = null;
        this.lastUpdateAt = null;
        this.wasMoving = false;
    }

    observe(sample) {
        if (!sample || !num(sample.t)) return;
        const s = {
            t: sample.t,
            x: num(sample.x) ? sample.x : 0,
            z: num(sample.z) ? sample.z : 0,
            speed: num(sample.speed) ? sample.speed : 0,
            finished: sample.finished === true,
            crashed: sample.crashed === true,
            onGrid: sample.onGrid === true,
        };
        // Ignore out-of-order samples.
        if (this.samples.length && s.t < this.samples[this.samples.length - 1].t) {
            return;
        }
        // Detect actual movement vs previous sample.
        if (this.samples.length) {
            const prev = this.samples[this.samples.length - 1];
            const dx = s.x - prev.x;
            const dz = s.z - prev.z;
            const dist = Math.hypot(dx, dz);
            const moving =
                dist >= this.opts.moveDistance ||
                Math.abs(s.speed) >= this.opts.speedThreshold;
            if (moving) {
                this.lastMovementAt = s.t;
                this.wasMoving = true;
            }
        } else {
            this.lastMovementAt = s.t;
        }
        this.samples.push(s);
        this.lastUpdateAt = s.t;
        this._prune(s.t);
    }

    _prune(now) {
        const cutoff = now - this.opts.windowMs * 2;
        while (this.samples.length && this.samples[0].t < cutoff) {
            this.samples.shift();
        }
    }

    getState(now) {
        const t = num(now) ? now : Date.now();
        const opts = this.opts;
        // Finished / crashed / on-grid cars are never "stopped driver" alerts.
        const last = this.samples.length ? this.samples[this.samples.length - 1] : null;
        if (last && (last.finished || last.crashed || last.onGrid)) {
            return {
                state: last.finished ? "finished" : last.crashed ? "crashed" : "on-grid",
                stopped: false,
                disconnected: false,
                delayed: false,
                moving: false,
                reason: "exempt",
            };
        }

        if (!this.lastUpdateAt) {
            return { state: "unknown", stopped: false, disconnected: false, delayed: false, moving: false, reason: "no-data" };
        }

        const sinceUpdate = t - this.lastUpdateAt;
        if (sinceUpdate >= opts.disconnectAfterMs) {
            return { state: "disconnected", stopped: false, disconnected: true, delayed: false, moving: false, reason: "no-updates" };
        }
        if (sinceUpdate >= opts.delayAfterMs) {
            return { state: "delayed", stopped: false, disconnected: false, delayed: true, moving: false, reason: "update-delay" };
        }

        // Movement over the observation window.
        const windowStart = t - opts.windowMs;
        const inWindow = this.samples.filter((s) => s.t >= windowStart);
        let totalDist = 0;
        let maxSpeed = 0;
        for (let i = 1; i < inWindow.length; i++) {
            totalDist += Math.hypot(inWindow[i].x - inWindow[i - 1].x, inWindow[i].z - inWindow[i - 1].z);
        }
        for (const s of inWindow) maxSpeed = Math.max(maxSpeed, Math.abs(s.speed));

        const sinceMove = this.lastMovementAt != null ? t - this.lastMovementAt : Infinity;
        const enoughSamples = inWindow.length >= opts.minSamples;
        const movingNow = last ? (Math.abs(last.speed) >= opts.speedThreshold) : false;

        if (movingNow) {
            return { state: "moving", stopped: false, disconnected: false, delayed: false, moving: true, reason: "moving" };
        }

        if (!enoughSamples) {
            // Not enough evidence yet — never classify on sparse data.
            return { state: "moving", stopped: false, disconnected: false, delayed: false, moving: true, reason: "insufficient-data" };
        }

        if (sinceMove >= opts.stoppedAfterMs && totalDist < opts.moveDistance * 2 && maxSpeed < opts.speedThreshold) {
            return { state: "stationary", stopped: true, disconnected: false, delayed: false, moving: false, reason: "no-movement-window" };
        }

        if (sinceMove >= opts.waitingAfterMs && totalDist < opts.moveDistance * 4) {
            return { state: "waiting", stopped: false, disconnected: false, delayed: false, moving: false, reason: "temporary-wait" };
        }

        return { state: "moving", stopped: false, disconnected: false, delayed: false, moving: true, reason: "recent-movement" };
    }
}

// Pure helper: given an array of samples, evaluate at `now`.
function detectStoppedDriver(samples, now, opts) {
    const d = new StoppedDriverDetector(opts);
    const arr = Array.isArray(samples) ? samples.slice().sort((a, b) => a.t - b.t) : [];
    for (const s of arr) d.observe(s);
    return d.getState(num(now) ? now : (arr.length ? arr[arr.length - 1].t : Date.now()));
}

// Aliases for compatibility with unknown callers.
const isDriverStopped = detectStoppedDriver;
const isStopped = detectStoppedDriver;
const checkDriverStopped = detectStoppedDriver;

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        StoppedDriverDetector,
        detectStoppedDriver,
        isDriverStopped,
        isStopped,
        checkDriverStopped,
        DEFAULTS,
    };
}

// Browser global
if (typeof window !== "undefined") {
    window.StoppedDriverDetector = StoppedDriverDetector;
    window.detectStoppedDriver = detectStoppedDriver;
    window.isDriverStopped = isDriverStopped;
}
