"use strict";
const assert = require("assert");
const { spawn } = require("child_process");
const WebSocket = require("ws");

const PORT = 18798;
const URL = `ws://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function connect() {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(URL);
        ws._messages = [];
        ws.on("message", (raw) => {
            try { ws._messages.push(JSON.parse(String(raw))); } catch (e) {}
        });
        ws.once("open", () => resolve(ws));
        ws.once("error", reject);
    });
}

function send(ws, message) {
    ws.send(JSON.stringify(message));
}

function waitFor(ws, predicate, timeoutMs = 5000) {
    const started = Date.now();
    return new Promise((resolve, reject) => {
        function poll() {
            const index = ws._messages.findIndex(predicate);
            if (index >= 0) {
                resolve(ws._messages.splice(index, 1)[0]);
                return;
            }
            if (Date.now() - started > timeoutMs) {
                reject(new Error("timeout waiting for message; buffered=" +
                    JSON.stringify(ws._messages.map((m) => m.t))));
                return;
            }
            setTimeout(poll, 10);
        }
        poll();
    });
}

function sendPosition(ws, state, progress) {
    state.seq++;
    state.x += 1;
    send(ws, {
        t: "pos",
        x: state.x,
        z: state.x,
        yaw: 0,
        speed: 30,
        progress,
        seq: state.seq,
        ts: Date.now()
    });
}

(async () => {
    const server = spawn(process.execPath, ["server.js"], {
        cwd: __dirname,
        env: {
            ...process.env,
            PORT: String(PORT),
            HOST: "127.0.0.1",
            COUNTDOWN_MS: "100",
            RECONNECT_GRACE_MS: "2000"
        },
        stdio: ["ignore", "pipe", "pipe"]
    });
    const output = [];
    server.stdout.on("data", (data) => output.push(String(data)));

    try {
        for (let i = 0; i < 100 && !output.join("").includes("listening"); i++) {
            await sleep(50);
        }
        assert.ok(output.join("").includes("listening"), "server did not start");

        const alpha = await connect();
        send(alpha, { t: "create", name: "Alpha" });
        const created = await waitFor(alpha, (m) => m.t === "created");
        await waitFor(alpha, (m) => m.t === "state");

        const bravo = await connect();
        send(bravo, { t: "join", code: created.code, name: "Bravo" });
        const joined = await waitFor(bravo, (m) => m.t === "joined");
        await waitFor(bravo, (m) => m.t === "state");

        send(alpha, { t: "start" });
        await waitFor(bravo, (m) => m.t === "countdown");
        await waitFor(bravo, (m) => m.t === "state" && m.state === "racing");

        const a = { seq: 0, x: 10 };
        const b = { seq: 0, x: 20 };

        sendPosition(alpha, a, 100);
        // The server rate-limits standings broadcasts to 10 Hz; send
        // another current snapshot after that interval.
        await sleep(130);
        sendPosition(alpha, a, 100);
        const firstBoard = await waitFor(alpha, (m) =>
            m.t === "leaderboard" &&
            m.entries.some((e) => e.name === "Alpha" && e.progress >= 100)
        );
        assert.equal(firstBoard.entries[0].name, "Alpha");

        await sleep(130);
        sendPosition(bravo, b, 50);
        await waitFor(alpha, (m) =>
            m.t === "leaderboard" &&
            m.entries.some((e) => e.name === "Bravo" && e.progress >= 50)
        );

        await sleep(130);
        sendPosition(bravo, b, 120);
        const peer = await waitFor(alpha, (m) =>
            m.t === "peer" && m.id === joined.id && m.progress >= 120
        );
        assert.equal(peer.progress, 120, "peer relay omitted accepted progress");

        await sleep(130);
        sendPosition(bravo, b, 190);
        const overtakingBoard = await waitFor(alpha, (m) =>
            m.t === "leaderboard" &&
            m.entries[0] &&
            m.entries[0].name === "Bravo" &&
            m.entries[0].progress >= 190
        );
        assert.equal(overtakingBoard.entries[1].name, "Alpha");
        console.log("ok: server standings follow accepted live progress");

        // A dropped socket must be able to reclaim the same room/player.
        alpha.terminate();
        await sleep(100);
        const reconnected = await connect();
        send(reconnected, { t: "rejoin", token: created.token });
        const rejoined = await waitFor(reconnected, (m) => m.t === "rejoined");
        assert.equal(rejoined.id, created.id, "reconnect changed player identity");
        assert.equal(rejoined.code, created.code, "reconnect changed room");
        await waitFor(reconnected, (m) => m.t === "state");
        console.log("ok: reconnect restores the same player and room");

        reconnected.close();
        bravo.close();
        console.log("ALL LEADERBOARD / RECONNECT TESTS PASSED");
        process.exitCode = 0;
    } catch (error) {
        console.error("MULTIPLAYER TEST FAILED:", error);
        process.exitCode = 1;
    } finally {
        server.kill();
    }
})();
