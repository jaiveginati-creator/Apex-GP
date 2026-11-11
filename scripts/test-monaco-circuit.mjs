import fs from "node:fs";
import assert from "node:assert/strict";

const html = fs.readFileSync("index.html", "utf8");
const pointsMatch = html.match(/const monacoPoints=\[([\s\S]*?)\n\];/);
assert.ok(pointsMatch, "Mapped Monaco centreline must exist");
const points = [...pointsMatch[1].matchAll(/\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]/g)]
  .map(m => [Number(m[1]), Number(m[2]), Number(m[3])]);
assert.ok(points.length >= 410, `Expected full mapped road trace, found ${points.length} points`);
assert.deepEqual(points[0], [0, 0, 0], "Monaco lap must begin at mapped start/finish");
let length = 0;
for (let i = 1; i < points.length; i++) length += Math.hypot(points[i][0]-points[i-1][0], points[i][2]-points[i-1][2]);
length += Math.hypot(points[0][0]-points.at(-1)[0], points[0][2]-points.at(-1)[2]);
assert.ok(length > 3300 && length < 3340, `Mapped Monaco trace should be approximately 3.323 km, got ${length.toFixed(1)}m`);
const xs=points.map(p=>p[0]),zs=points.map(p=>p[2]);
assert.ok(Math.max(...xs)-Math.min(...xs)>730 && Math.max(...xs)-Math.min(...xs)<745,"Mapped Monaco east-west extent is plausible");
assert.ok(Math.max(...zs)-Math.min(...zs)>960 && Math.max(...zs)-Math.min(...zs)<990,"Mapped Monaco north-south extent is plausible");

assert.match(html,/const MONACO_PUBLISHED_LENGTH_M=3337;/);
assert.match(html,/const MONACO_TRACK_HALF_WIDTH=14\.5;/,"Monaco road half-width must be 14.5m (29m total)");
assert.match(html,/TRACK_HALF_WIDTH=isMonza[\s\S]{0,120}isMonaco\s*\?MONACO_TRACK_HALF_WIDTH/);
assert.match(html,/PIT_LANE_PATH_LATERAL=isMonza\?35:isMonaco\?25\.5/);
assert.match(html,/PIT_BOX_LATERAL=isMonza\?41\.5:isMonaco\?32/);
assert.match(html,/PIT_ENTRY_LATERAL=isMonza\?23:isMonaco\?17\.5/);
assert.match(html,/PIT_EXIT_LATERAL=isMonza\?23:isMonaco\?17\.5/);

const builderStart=html.indexOf("function loadMonacoWorld()");
const builderEnd=html.indexOf("function setActiveTrack(id)",builderStart);
assert.ok(builderStart>=0&&builderEnd>builderStart,"Track-only Monaco world builder must exist");
const builder=html.slice(builderStart,builderEnd);
assert.match(builder,/createRibbon\(MONACO_TRACK_HALF_WIDTH,\.015,asphaltMaterial/,"Wider racing surface must use mapped track ribbon");
assert.match(builder,/buildPitStrip\(/,"Pit lane must remain");
assert.match(builder,/isNearKerbCorner\(/,"Kerbs must follow mapped corner positions");
assert.match(builder,/startLine/,"Start/finish line must remain");
for (const removed of ["addBuilding(","buildingInstances","yachtSpots","grandstands","tunnelStart","Casino de Monte-Carlo","Hotel de Paris","Street lamps","TreeGeometry"]) {
  assert.ok(!builder.includes(removed), `Monaco track-only builder must not contain ${removed}`);
}
assert.match(builder,/new THREE\.PlaneGeometry\(groundW,groundD\)/,"Only a flat neutral base should remain behind the circuit");
console.log(`Monaco track-only checks passed: ${points.length} mapped points, ${length.toFixed(0)}m source trace, 3.337 km published lap, 29m road width, pit lane, kerbs and start/finish stripe; scenery removed.`);
