"use strict";
const assert = require("assert");
const { spawn } = require("child_process");
const WebSocket = require("ws");

const PORT = 18798;
const URL = `ws://127.0.0.1:${PORT}`;

function connect() {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(URL);
        ws._buf = [];
        ws.on("message", (d) => { try { ws._buf.push(JSON.parse(String(d))); } catch {} });
        ws.once("open", () => resolve(ws));
        ws.once("error", reject);
    });
}
function send(ws, obj) { ws.send(JSON.stringify(obj)); }
function waitFor(ws, pred, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const buffered = (ws._buf || []).findIndex(pred);
        if (buffered >= 0) { resolve(ws._buf.splice(buffered, 1)[0]); return; }
        const seen = [];
        const t = setTimeout(() => { ws.removeListener("message", onMsg); reject(new Error("timeout; got " + JSON.stringify(seen).slice(0, 200))); }, timeoutMs);
        function onMsg(data) {
            let m; try { m = JSON.parse(String(data)); } catch { return; }
            seen.push(m.t);
            if (pred(m)) {
                clearTimeout(t);
                ws.removeListener("message", onMsg);
                const bi = (ws._buf || []).findIndex((x) => JSON.stringify(x) === JSON.stringify(m));
                if (bi >= 0) ws._buf.splice(bi, 1);
                resolve(m);
            }
        }
        ws.on("message", onMsg);
    });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
    const srv = spawn(process.execPath, ["server.js"], {
        cwd: __dirname,
        env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", COUNTDOWN_MS: "100", MIN_LAP_MS: "50" },
        stdio: ["ignore", "pipe", "pipe"],
    });
    const out = [];
    srv.stdout.on("data", (d) => out.push(String(d)));
    for (let i = 0; i < 100; i++) { if (out.join("").includes("listening")) break; await sleep(50); }

    try {
        const a = await connect();
        send(a, { t: "create", name: "Alpha" });
        const created = await waitFor(a, (m) => m.t === "created");
        const code = created.code;
        await waitFor(a, (m) => m.t === "state");

        const b = await connect();
        send(b, { t: "join", code, name: "Bravo" });
        await waitFor(b, (m) => m.t === "joined");
        await waitFor(b, (m) => m.t === "state");

        // start race
        send(a, { t: "start" });
        await waitFor(b, (m) => m.t === "countdown");
        await waitFor(b, (m) => m.t === "state" && m.state === "racing");

        // A ahead of B by progress
        send(a, { t: "pos", x: 1, z: 1, yaw: 0, speed: 10, progress: 100, seq: 1, ts: Date.now() });
        send(b, { t: "pos", x: 2, z: 2, yaw: 0, speed: 10, progress: 50, seq: 1, ts: Date.now() });
        const lb1 = await waitFor(a, (m) => m.t === "leaderboard");
        assert.equal(lb1.entries[0].name, "Alpha", "A should be first");
        assert.equal(lb1.entries[1].name, "Bravo", "B should be second");
        console.log("ok lb: A ahead of B");

        // B overtakes A
        send(b, { t: "pos", x: 3, z: 3, yaw: 0, speed: 10, progress: 200, seq: 2, ts: Date.now() });
        await sleep(150);
        send(b, { t: "pos", x: 3, z: 3, yaw: 0, speed: 10, progress: 200, seq: 9, ts: Date.now() });
        const lb2 = await waitFor(a, (m) => m.t === "leaderboard" && m.entries[0].name === "Bravo");
        assert.equal(lb2.entries[0].name, "Bravo");
        assert.equal(lb2.entries[1].name, "Alpha");
        console.log("ok lb: B overtakes A");

        // near-identical progress: unique positions, no simultaneous ahead
        send(a, { t: "pos", x: 4, z: 4, yaw: 0, speed: 10, progress: 150.1, seq: 3, ts: Date.now() });
        send(b, { t: "pos", x: 5, z: 5, yaw: 0, speed: 10, progress: 150.2, seq: 3, ts: Date.now() });
        await sleep(150);
        send(a, { t: "pos", x: 4, z: 4, yaw: 0, speed: 10, progress: 150.1, seq: 10, ts: Date.now() });
        const lb3 = await waitFor(a, (m) => m.t === "leaderboard");
        const positions = lb3.entries.map((e) => e.position);
        assert.equal(new Set(positions).size, positions.length, "positions not unique");
        assert.deepEqual(positions, [1, 2], "positions not consecutive");
        console.log("ok lb: tie handling unique/consecutive");

        // different laps via progress
        send(a, { t: "pos", x: 6, z: 6, yaw: 0, speed: 10, progress: 1000, seq: 4, ts: Date.now() });
        send(b, { t: "pos", x: 7, z: 7, yaw: 0, speed: 10, progress: 100, seq: 4, ts: Date.now() });
        await sleep(150);
        send(a, { t: "pos", x: 6, z: 6, yaw: 0, speed: 10, progress: 1000, seq: 11, ts: Date.now() });
        const lb4 = await waitFor(a, (m) => m.t === "leaderboard" && m.entries[0].name === "Alpha");
        assert.equal(lb4.entries[0].name, "Alpha");
        console.log("ok lb: different progress order");

        // all clients same order
        const lbA = lb4;
        // get latest on b
        send(b, { t: "pos", x: 8, z: 8, yaw: 0, speed: 10, progress: 101, seq: 5, ts: Date.now() });
        await sleep(150);
        send(b, { t: "pos", x: 8, z: 8, yaw: 0, speed: 10, progress: 101, seq: 12, ts: Date.now() });
        const lbB = await waitFor(b, (m) => m.t === "leaderboard");
        assert.deepEqual(lbA.entries.map((e) => e.name), lbB.entries.map((e) => e.name), "clients disagree");
        console.log("ok lb: clients consistent");

        // new race clears leaderboard
        send(a, { t: "cancel" });
        await waitFor(a, (m) => m.t === "cancelled");
        await waitFor(a, (m) => m.t === "state" && m.state === "lobby");
        // progress reset: send pos not in racing ignored by server? pos still broadcast, but leaderboard includes reset progress
        await sleep(150);
        send(a, { t: "pos", x: 1, z: 1, yaw: 0, speed: 10, progress: 0, seq: 13, ts: Date.now() });
        const lb5 = await waitFor(a, (m) => m.t === "leaderboard" && m.entries.every((e) => (e.progress || 0) === 0));
        assert.ok(lb5.entries.every((e) => (e.progress || 0) === 0), "leaderboard not cleared");
        console.log("ok lb: new race clears");

        a.close(); b.close();
        console.log("ALL LEADERBOARD TESTS PASSED");
        process.exitCode = 0;
    } catch (e) {
        console.error("LEADERBOARD TEST FAILED:", e);
        process.exitCode = 1;
    } finally {
        srv.kill();
    }
})();
