import fs from "node:fs";
import assert from "node:assert/strict";

const html = fs.readFileSync("index.html", "utf8");
const pointsMatch = html.match(/const monacoPoints=\[([\s\S]*?)\n\];/);
assert.ok(pointsMatch, "Monaco centreline control points must exist");
const points = [...pointsMatch[1].matchAll(/\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]/g)]
  .map(m => [Number(m[1]), Number(m[2]), Number(m[3])]);
assert.ok(points.length >= 40, `Expected a detailed Monaco centreline, found ${points.length} points`);
let polylineLength = 0;
for (let i = 1; i < points.length; i++) {
  polylineLength += Math.hypot(
    points[i][0] - points[i - 1][0],
    points[i][2] - points[i - 1][2]
  );
}
assert.ok(polylineLength > 2800 && polylineLength < 3300,
  `Monaco source path should be a 3.0-3.3 km centreline before spline smoothing; got ${polylineLength.toFixed(1)}m`);
assert.match(html, /const MONACO_PUBLISHED_LENGTH_M=3337;/);
assert.match(html, /const MONACO_BASE_LENGTH_M=new THREE\.CatmullRomCurve3/);
assert.match(html, /if\(id==="monaco"\)/);
assert.match(html, /activeTrackId=id==="spa"\?"spa":id==="monza"\?"monza":id==="monaco"\?"monaco":"jeddah"/);
assert.match(html, /const MONACO_TRACK_HALF_WIDTH=10\.5;/);
assert.match(html, /id:"monaco",[\s\S]*?name:"MONACO",[\s\S]*?corners:19,[\s\S]*?lengthKm:"3\.34 KM",[\s\S]*?playable:true/);
assert.match(html, /function loadMonacoWorld\(\)/);
for (const feature of [
  "const sea=new THREE.Mesh",
  "const yachtSpots=",
  "const casinoD=getTrackSample",
  "const tunnelStart=790,tunnelEnd=1085",
  "const buildingInstances=",
  "const barriers=new THREE.InstancedMesh",
  "buildPitStrip"
]) {
  assert.ok(html.includes(feature), `Missing Monaco environment feature: ${feature}`);
}
assert.match(html, /monacoWorld\.visible=next==="monaco"/);
assert.match(html, /monacoWorld\.visible=prevTrack==="monaco"/);
assert.match(html, /track\.id==="monaco"&&activeTrackId!=="monaco"/);
console.log(`Monaco checks passed: ${points.length} centreline points, ${polylineLength.toFixed(0)}m source path, 3.337 km scaled lap, street barriers, city, casino, tunnel and marina.`);
