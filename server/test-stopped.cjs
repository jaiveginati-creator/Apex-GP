"use strict";
const assert = require("assert");
const { StoppedDriverDetector, detectStoppedDriver } = require("./stopped-driver.js");

// 1. moving driver not stopped
{
    const d = new StoppedDriverDetector({ windowMs: 4000, stoppedAfterMs: 2000 });
    let t = 1000;
    for (let i = 0; i < 20; i++) {
        t += 100;
        d.observe({ t, x: i * 5, z: 0, speed: 30 });
    }
    const st = d.getState(t);
    assert.equal(st.stopped, false, "moving driver flagged stopped");
    assert.equal(st.state, "moving");
    console.log("ok moving driver");
}

// 2. stationary driver eventually stopped
{
    const d = new StoppedDriverDetector({ windowMs: 4000, stoppedAfterMs: 2000, minSamples: 3 });
    let t = 1000;
    for (let i = 0; i < 40; i++) { t += 100; d.observe({ t, x: 0, z: 0, speed: 0 }); }
    const lastT = t;
    // not enough time yet (early)
    let st = d.getState(lastT - 2500);
    assert.equal(st.disconnected, false);
    // after sustained no-movement window
    st = d.getState(lastT);
    assert.equal(st.stopped, true, "stationary not detected");
    assert.equal(st.state, "stationary");
    console.log("ok stationary driver");
}

// 3. unchanged positions for several updates do not falsely trigger if moving later
{
    const d = new StoppedDriverDetector({ windowMs: 4000, stoppedAfterMs: 2000, minSamples: 3 });
    let t = 1000;
    for (let i = 0; i < 5; i++) { t += 100; d.observe({ t, x: 100, z: 0, speed: 20 }); }
    // a few identical samples (packet quirk)
    for (let i = 0; i < 3; i++) { t += 100; d.observe({ t, x: 100, z: 0, speed: 20 }); }
    // resume movement
    for (let i = 0; i < 5; i++) { t += 100; d.observe({ t, x: 100 + i * 5, z: 0, speed: 20 }); }
    const st = d.getState(t);
    assert.equal(st.stopped, false, "false stopped after resumed movement");
    console.log("ok resumed movement clears");
}

// 4. delayed updates classify delayed, not stopped
{
    const d = new StoppedDriverDetector({ windowMs: 4000, stoppedAfterMs: 2000, delayAfterMs: 1000 });
    let t = 1000;
    for (let i = 0; i < 5; i++) { t += 100; d.observe({ t, x: i * 5, z: 0, speed: 20 }); }
    const st = d.getState(t + 2000); // no update for 2s
    assert.equal(st.delayed, true);
    assert.equal(st.stopped, false);
    console.log("ok delayed");
}

// 5. lost packets / no updates for long => disconnected, not stopped
{
    const d = new StoppedDriverDetector({ windowMs: 4000, stoppedAfterMs: 2000, disconnectAfterMs: 5000 });
    let t = 1000;
    for (let i = 0; i < 5; i++) { t += 100; d.observe({ t, x: i * 5, z: 0, speed: 20 }); }
    const st = d.getState(t + 8000);
    assert.equal(st.disconnected, true);
    assert.equal(st.stopped, false);
    console.log("ok disconnected");
}

// 6. finished/crashed/on-grid exempt
{
    const d = new StoppedDriverDetector({});
    let t = 1000;
    for (let i = 0; i < 5; i++) { t += 100; d.observe({ t, x: 0, z: 0, speed: 0, finished: true }); }
    const st = d.getState(t + 5000);
    assert.equal(st.stopped, false);
    assert.equal(st.state, "finished");
    console.log("ok exempt finished");
}

// 7. pure helper
{
    const samples = [];
    let t = 0;
    for (let i = 0; i < 10; i++) { t += 100; samples.push({ t, x: i * 2, z: 0, speed: 10 }); }
    const st = detectStoppedDriver(samples, t);
    assert.equal(st.stopped, false);
    console.log("ok pure helper");
}

// 8. packet jitter: variable intervals but moving
{
    const d = new StoppedDriverDetector({ windowMs: 4000, stoppedAfterMs: 2000, minSamples: 3 });
    let t = 1000;
    const positions = [0, 3, 7, 12, 18, 25];
    for (const x of positions) {
        t += 80 + Math.floor(Math.random() * 200);
        d.observe({ t, x, z: 0, speed: 15 });
    }
    const st = d.getState(t);
    assert.equal(st.stopped, false);
    console.log("ok jitter moving");
}

console.log("ALL STOPPED-DRIVER TESTS PASSED");
