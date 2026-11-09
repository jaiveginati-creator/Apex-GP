/* Apex GP multiplayer transport.
 * Reliable reconnect + bounded position traffic for Render/WebSocket.
 * The server remains the authority for rooms, laps and race results.
 */
"use strict";

function NetClient(opts) {
    opts = opts || {};
    this.url = opts.url || "";
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
    this.onReconnecting = opts.onReconnecting || function () {};
    this.onPong = opts.onPong || function () {};

    this.ws = null;
    this.id = null;
    this.code = null;
    this.token = null;
    this.seq = 0;
    this.rtt = null;
    this.autoReconnect = opts.autoReconnect === true;
    this.intent = null;
    this._reconnectAttempts = 0;
    this._reconnectTimer = null;
    this._connectTimer = null;
    this._handshakeTimer = null;
    this._reconnecting = false;
    this._manualClose = false;
    this._lastPosAt = 0;
}

NetClient.prototype._clearTimers = function () {
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    if (this._connectTimer) clearTimeout(this._connectTimer);
    if (this._handshakeTimer) clearTimeout(this._handshakeTimer);
    this._reconnectTimer = null;
    this._connectTimer = null;
    this._handshakeTimer = null;
};

NetClient.prototype._send = function (msg) {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return false;
    // Never let a backlog of old position packets build up.
    if (msg.t === "pos" && ws.bufferedAmount > 96 * 1024) return false;
    try {
        ws.send(JSON.stringify(msg));
        return true;
    } catch (e) {
        return false;
    }
};

NetClient.prototype._handleMessage = function (socket, ev) {
    if (socket !== this.ws) return;
    let msg;
    try {
        msg = JSON.parse(ev.data);
    } catch (e) {
        return;
    }
    if (!msg || typeof msg.t !== "string") return;

    if (msg.t === "created" || msg.t === "joined" || msg.t === "rejoined") {
        if (this._handshakeTimer) clearTimeout(this._handshakeTimer);
        this._handshakeTimer = null;
        this.code = msg.code || this.code;
        this.id = msg.id || this.id;
        this.token = msg.token || this.token;
        this.intent = null;
        this._reconnectAttempts = 0;
        this._reconnecting = false;
        if (msg.t === "created") this.onCreated(msg);
        else this.onJoined(msg);
        this.onLobby(msg.players || []);
        return;
    }

    if (msg.t === "lobby") this.onLobby(msg.players || []);
    else if (msg.t === "peer") this.onPeer(msg);
    else if (msg.t === "left") this.onLeft(msg.id, msg.reason);
    else if (msg.t === "state") this.onState(msg);
    else if (msg.t === "countdown") this.onCountdown(msg);
    else if (msg.t === "lapUpdate") this.onLapUpdate(msg);
    else if (msg.t === "finish") this.onFinish(msg);
    else if (msg.t === "results") this.onResults(msg);
    else if (msg.t === "cancelled") this.onCancelled(msg);
    else if (msg.t === "leaderboard") this.onLeaderboard(msg);
    else if (msg.t === "pong") {
        if (Number.isFinite(msg.ts)) this.rtt = Math.max(0, Date.now() - msg.ts);
        this.onPong(msg);
    } else if (msg.t === "error") {
        const fatalJoinErrors = ["bad-token", "no-room", "bad-code", "room-full", "race-over"];
        if (fatalJoinErrors.indexOf(msg.error) >= 0) {
            this.autoReconnect = false;
            this.intent = null;
            this.token = null;
            if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
            this.onDisconnect();
        }
        this.onError(msg.error || "server-error");
    }
};

NetClient.prototype._connect = function (openFn) {
    const self = this;
    let socket;
    try {
        this._manualClose = false;
        socket = new WebSocket(this.url);
        this.ws = socket;
    } catch (e) {
        this.onError("connect-failed");
        if (this.autoReconnect && (this.token || this.intent)) this._scheduleReconnect();
        else this.onDisconnect();
        return;
    }

    socket.onopen = function () {
        if (socket !== self.ws) return;
        if (self._connectTimer) clearTimeout(self._connectTimer);
        self._connectTimer = null;
        self._handshakeTimer = setTimeout(function () {
            if (socket === self.ws && !self.id) {
                self.onError("server-timeout");
                try { socket.close(); } catch (e) {}
            }
        }, 15000);
        self._lastPosAt = 0;
        openFn();
    };
    socket.onmessage = function (ev) {
        self._handleMessage(socket, ev);
    };
    socket.onerror = function () {
        if (socket === self.ws && socket.readyState !== 1) {
            self.onError("connect-failed");
        }
    };
    socket.onclose = function () {
        if (socket !== self.ws) return;
        self._clearTimers();
        self.ws = null;
        self.id = null;
        self.rtt = null;
        if (self._manualClose) {
            self._manualClose = false;
            return;
        }
        if (self.autoReconnect && (self.token || self.intent)) {
            self._scheduleReconnect();
        } else {
            self.onDisconnect();
        }
    };

    this._connectTimer = setTimeout(function () {
        if (socket === self.ws && socket.readyState === 0) {
            self.onError("connection-timeout");
            try { socket.close(); } catch (e) {}
        }
    }, 12000);
};

NetClient.prototype.create = function (name) {
    const self = this;
    this.intent = { t: "create", name: name || "Driver" };
    this._connect(function () { self._send(self.intent); });
};

NetClient.prototype.join = function (code, name) {
    const self = this;
    this.intent = { t: "join", code: String(code || "").trim().toUpperCase(), name: name || "Driver" };
    this._connect(function () { self._send(self.intent); });
};

NetClient.prototype.rejoin = function (token) {
    const self = this;
    this.token = token;
    this.intent = null;
    this._connect(function () { self._send({ t: "rejoin", token: self.token }); });
};

NetClient.prototype._scheduleReconnect = function () {
    const self = this;
    if (self._reconnectTimer || !self.autoReconnect || (!self.token && !self.intent)) return;
    self._reconnecting = true;
    self.onReconnecting(self._reconnectAttempts);
    const delay = Math.min(10000, 500 * Math.pow(2, Math.min(self._reconnectAttempts, 5)));
    self._reconnectAttempts++;
    self._reconnectTimer = setTimeout(function () {
        self._reconnectTimer = null;
        if (!self.autoReconnect || (!self.token && !self.intent)) return;
        self._connect(function () {
            if (self.token) self._send({ t: "rejoin", token: self.token });
            else if (self.intent) self._send(self.intent);
        });
    }, delay);
};

NetClient.prototype.sendPos = function (x, z, yaw, speed, progress) {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (now - this._lastPosAt < 50) return false;
    if (!this.ws || this.ws.readyState !== 1 || this.ws.bufferedAmount > 96 * 1024) return false;
    this._lastPosAt = now;
    this.seq++;
    return this._send({
        t: "pos",
        x: x,
        z: z,
        yaw: yaw,
        speed: speed,
        progress: Number.isFinite(progress) ? progress : null,
        seq: this.seq,
        ts: Date.now()
    });
};

NetClient.prototype.leave = function () {
    const socket = this.ws;
    this._manualClose = true;
    this.autoReconnect = false;
    this.intent = null;
    this.token = null;
    this.id = null;
    this.code = null;
    this._clearTimers();
    this._send({ t: "leave" });
    this.ws = null;
    if (socket) {
        try { socket.close(1000, "left room"); } catch (e) {}
    }
};

NetClient.prototype.sendReady = function (ready) {
    return this._send({ t: "ready", ready: ready === true });
};
NetClient.prototype.sendConfig = function (track, laps) {
    return this._send({ t: "config", track: track, laps: laps });
};
NetClient.prototype.sendStart = function () { return this._send({ t: "start" }); };
NetClient.prototype.sendCancel = function () { return this._send({ t: "cancel" }); };
NetClient.prototype.sendLap = function (lap, time) {
    return this._send({ t: "lap", lap: lap, time: time });
};
NetClient.prototype.sendPing = function () {
    return this._send({ t: "ping", ts: Date.now(), seq: this.seq || 0 });
};

if (typeof module !== "undefined" && module.exports) {
    module.exports = { NetClient };
}
