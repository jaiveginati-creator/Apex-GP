/* Apex GP net client (Phase 2 milestone 1).
 *
 * Standalone: no dependency on index.html globals. Talks
 * to server/server.js over WebSocket. Plain script (no
 * modules) so it loads from any static page.
 *
 *   const net = new NetClient({
 *     url: "ws://host:8765",
 *     onLobby: (players) => {...},
 *     onPeer: (peer) => {...},       // {id,x,z,yaw,speed}
 *     onLeft: (id, reason) => {...},
 *     onError: (code) => {...}, // bad-code|no-room|room-full|race-over|...
 *     onDisconnect: () => {...},
 *   });
 *   net.create("Name");              // -> onCreated({code,id,players})
 *   net.join("ABCDE", "Name");       // -> onJoined({...})
 *   net.sendPos(x, z, yaw, speed);   // throttled to 20 Hz
 *   net.sendReady(true);             // lobby ready flag
 *   net.sendConfig("spa", 5);        // host only
 *   net.sendStart();                 // host only -> countdown
 *   net.sendCancel();                // host only
 *   net.sendLap(3, 91234);           // completed lap 3 at race-clock ms
 *   net.leave();
 */

"use strict";

function NetClient(opts) {
    opts = opts || {};
    this.url = opts.url;
    this.onLobby = opts.onLobby || function () {};
    this.onPeer = opts.onPeer || function () {};
    this.onLeft = opts.onLeft || function () {};
    this.onError = opts.onError || function () {};
    this.onDisconnect = opts.onDisconnect || function () {};
    this.onCreated = opts.onCreated || function () {};
    this.onJoined = opts.onJoined || function () {};
    this.onState = opts.onState || function () {};
    this.onCountdown = opts.onCountdown || function () {};
    this.onLapUpdate = opts.onLapUpdate || function () {};
    this.onFinish = opts.onFinish || function () {};
    this.onResults = opts.onResults || function () {};
    this.onCancelled = opts.onCancelled || function () {};
    this.onLeaderboard = opts.onLeaderboard || function () {};
    this.ws = null;
    this.id = null;
    this.code = null;
    this.token = null;
    this.seq = 0;
    this.rtt = null;
    this.autoReconnect = opts.autoReconnect === true;
    this._reconnectAttempts = 0;
    this._reconnectTimer = null;
    this._reconnecting = false;
    this.onReconnecting = opts.onReconnecting || function () {};
    this._lastPosAt = 0;
    this._manualClose = false;
}

NetClient.prototype._send = function (msg) {
    if (this.ws && this.ws.readyState === 1) {
        this.ws.send(JSON.stringify(msg));
    }
};

NetClient.prototype._attach = function () {
    const self = this;
    this.ws.onmessage = function (ev) {
        let msg;
        try {
            msg = JSON.parse(ev.data);
        } catch (e) {
            return;
        }
        if (!msg || typeof msg.t !== "string") return;
        if (msg.t === "created") {
            self.code = msg.code;
            self.id = msg.id;
            self.token = msg.token || self.token;
            self.onCreated(msg);
            self.onLobby(msg.players || []);
        } else if (msg.t === "joined") {
            self.code = msg.code;
            self.id = msg.id;
            self.token = msg.token || self.token;
            self.onJoined(msg);
            self.onLobby(msg.players || []);
        } else if (msg.t === "rejoined") {
            self.code = msg.code;
            self.id = msg.id;
            self.token = msg.token || self.token;
            self.onJoined(msg);
            self.onLobby(msg.players || []);
        } else if (msg.t === "lobby") {
            self.onLobby(msg.players || []);
        } else if (msg.t === "peer") {
            self.onPeer(msg);
        } else if (msg.t === "left") {
            self.onLeft(msg.id, msg.reason);
        } else if (msg.t === "state") {
            self.onState(msg);
        } else if (msg.t === "countdown") {
            self.onCountdown(msg);
        } else if (msg.t === "lapUpdate") {
            self.onLapUpdate(msg);
        } else if (msg.t === "finish") {
            self.onFinish(msg);
        } else if (msg.t === "results") {
            self.onResults(msg);
        } else if (msg.t === "cancelled") {
            self.onCancelled(msg);
        } else if (msg.t === "leaderboard") {
            self.onLeaderboard(msg);
        } else if (msg.t === "pong") {
            if (msg.ts != null) {
                self.rtt = Date.now() - msg.ts;
            }
            self.onPong && self.onPong(msg);
        } else if (msg.t === "error") {
            if (msg.error === "bad-token" || msg.error === "no-room") {
                self.autoReconnect = false;
                if (self._reconnectTimer) {
                    clearTimeout(self._reconnectTimer);
                    self._reconnectTimer = null;
                }
                self.onDisconnect();
            }
            self.onError(msg.error);
        }
    };
    this.ws.onclose = function () {
        const wasManual = self._manualClose;
        self.ws = null;
        self.id = null;
        if (wasManual) {
            self._manualClose = false;
            return;
        }
        if (self.autoReconnect && self.token) {
            self._scheduleReconnect();
        } else {
            self.onDisconnect();
        }
    };
};

NetClient.prototype._connect = function (openFn) {
    const self = this;
    try {
        this._manualClose = false;
        this.ws = new WebSocket(this.url);
    } catch (e) {
        self.onError("connect-failed");
        return;
    }
    this._attach();
    this.ws.onopen = function () {
        self._reconnectAttempts = 0;
        self._reconnecting = false;
        openFn();
    };
    this.ws.onerror = function () {
        // onclose follows with onDisconnect; surface once
        if (!self.ws || self.ws.readyState !== 1) {
            self.onError("connect-failed");
        }
    };
};

NetClient.prototype.create = function (name) {
    const self = this;
    this._connect(function () {
        self._send({ t: "create", name: name || "Driver" });
    });
};

NetClient.prototype.join = function (code, name) {
    const self = this;
    this._connect(function () {
        self._send({ t: "join", code: code, name: name || "Driver" });
    });
};

NetClient.prototype.rejoin = function (token) {
    const self = this;
    this._connect(function () {
        self._send({ t: "rejoin", token: token });
    });
};

NetClient.prototype.sendPos = function (x, z, yaw, speed, progress) {
    const now = (
        typeof performance !== "undefined" ? performance.now() : Date.now()
    );
    if (now - this._lastPosAt < 50) return; // 20 Hz
    this._lastPosAt = now;
    this.seq = (this.seq || 0) + 1;
    this._send({
        t: "pos",
        x: x,
        z: z,
        yaw: yaw,
        speed: speed,
        progress: Number.isFinite(progress) ? progress : null,
        seq: this.seq,
        ts: Date.now(),
    });
};

NetClient.prototype._scheduleReconnect = function () {
    const self = this;
    if (self._reconnectTimer) return;
    self._reconnecting = true;
    self.onReconnecting(self._reconnectAttempts);
    const delay = Math.min(5000, 300 * Math.pow(2, self._reconnectAttempts));
    self._reconnectAttempts++;
    self._reconnectTimer = setTimeout(function () {
        self._reconnectTimer = null;
        if (!self.token) {
            self.autoReconnect = false;
            self.onDisconnect();
            return;
        }
        self._connect(function () {
            self._send({ t: "rejoin", token: self.token });
        });
    }, delay);
};

NetClient.prototype.leave = function () {
    this._manualClose = true;
    if (this._reconnectTimer) {
        clearTimeout(this._reconnectTimer);
        this._reconnectTimer = null;
    }
    this.autoReconnect = false;
    this._send({ t: "leave" });
    try {
        if (this.ws) this.ws.close();
    } catch (e) {}
    this.ws = null;
    this.id = null;
    this.code = null;
    this.token = null;
};

NetClient.prototype.sendReady = function (ready) {
    this._send({ t: "ready", ready: ready === true });
};

NetClient.prototype.sendConfig = function (track, laps) {
    this._send({ t: "config", track: track, laps: laps });
};

NetClient.prototype.sendStart = function () {
    this._send({ t: "start" });
};

NetClient.prototype.sendCancel = function () {
    this._send({ t: "cancel" });
};

NetClient.prototype.sendLap = function (lap, t) {
    this._send({ t: "lap", lap: lap, time: t });
};

NetClient.prototype.sendPing = function () {
    this._send({ t: "ping", ts: Date.now(), seq: this.seq || 0 });
};

if (typeof module !== "undefined" && module.exports) {
    module.exports = { NetClient };
}
