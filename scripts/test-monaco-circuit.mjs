import fs from "node:fs";
import assert from "node:assert/strict";

const html = fs.readFileSync("index.html", "utf8");
const pointsMatch = html.match(/const monacoSourcePoints=\\[([\\s\\S]*?)\\n\\];/);
assert.ok(pointsMatch, "Mapped Monaco source centreline must exist");
const sourcePoints = [...pointsMatch[1].matchAll(/\\[\\s*(-?[\\d.]+)\\s*,\\s*(-?[\\d.]+)\\s*,\\s*(-?[\\d.]+)\\s*\\]/g)]
  .map(m => [Number(m[1]), Number(m[2]), Number(m[3])]);
assert.ok(sourcePoints.length >= 410, `Expected full mapped road trace, found ${sourcePoints.length} points`);
assert.deepEqual(sourcePoints[0], [0, 0, 0], "Monaco lap must begin at mapped start/finish");

let sourceLength = 0;
for (let i = 1; i < sourcePoints.length; i++) sourceLength += Math.hypot(sourcePoints[i][0]-sourcePoints[i-1][0], sourcePoints[i][2]-sourcePoints[i-1][2]);
sourceLength += Math.hypot(sourcePoints[0][0]-sourcePoints.at(-1)[0], sourcePoints[0][2]-sourcePoints.at(-1)[2]);
assert.ok(sourceLength > 3300 && sourceLength < 3340, `Mapped source trace should remain approximately 3.323 km, got ${sourceLength.toFixed(1)}m`);

// Reproduce the centreline-clearance pass used by the game and check
// the normalized full-width road against every non-adjacent section.
const points = sourcePoints.map(([x,y,z]) => [x*1.25,y,z*1.25]);
const count = points.length;
const clearance = 78;
for (let iteration=0; iteration<300; iteration++) {
  const pushX = new Float64Array(count);
  const pushZ = new Float64Array(count);
  for (let i=0; i<count; i++) {
    for (let j=i+11; j<count; j++) {
      if (count-(j-i)<11) continue;
      let dx=points[j][0]-points[i][0];
      let dz=points[j][2]-points[i][2];
      let distance=Math.hypot(dx,dz);
      if (distance>=clearance) continue;
      if (distance<1e-6) { dx=1; dz=0; distance=1; }
      const amount=(clearance-distance)*.09/distance;
      pushX[i]-=dx*amount; pushZ[i]-=dz*amount;
      pushX[j]+=dx*amount; pushZ[j]+=dz*amount;
    }
  }
  for (let i=0; i<count; i++) { points[i][0]+=pushX[i]; points[i][2]+=pushZ[i]; }
}
for (let pass=0; pass<3; pass++) {
  const smooth=points.map(point=>point.slice());
  for (let i=0; i<count; i++) {
    const previous=points[(i+count-1)%count];
    const next=points[(i+1)%count];
    smooth[i][0]=points[i][0]*.8+(previous[0]+next[0])*.1;
    smooth[i][2]=points[i][2]*.8+(previous[2]+next[2])*.1;
  }
  for (let i=0; i<count; i++) points[i]=smooth[i];
}
const samples=[];
for (let i=0; i<count; i++) {
  const a=points[i], b=points[(i+1)%count];
  for (let step=0; step<8; step++) {
    const t=step/8;
    samples.push([a[0]+(b[0]-a[0])*t,a[2]+(b[2]-a[2])*t]);
  }
}
let normalizedLength=0;
for (let i=0; i<samples.length; i++) {
  const a=samples[i], b=samples[(i+1)%samples.length];
  normalizedLength+=Math.hypot(a[0]-b[0],a[1]-b[1]);
}
let minimumGap=Infinity;
for (let i=0; i<samples.length; i++) {
  for (let j=i+81; j<samples.length; j++) {
    if (samples.length-(j-i)<81) continue;
    minimumGap=Math.min(minimumGap,Math.hypot(samples[i][0]-samples[j][0],samples[i][1]-samples[j][1]));
  }
}
const publishedLength=3500;
const normalizedGap=minimumGap*publishedLength/normalizedLength;
assert.ok(normalizedGap>=44, `Full-width Monaco road overlaps: minimum centreline clearance is ${normalizedGap.toFixed(2)}m for a 44m road`);

assert.match(html,/const MONACO_PUBLISHED_LENGTH_M=3500;/);
assert.match(html,/const MONACO_TRACK_HALF_WIDTH=22;/,"Monaco road half-width must match the other tracks at 22m (44m total)");
assert.match(html,/TRACK_HALF_WIDTH=isMonza[\\s\\S]{0,120}isMonaco\\s*\\?MONACO_TRACK_HALF_WIDTH/);
assert.match(html,/PIT_LANE_PATH_LATERAL=isMonza\\?35:isMonaco\\?35\\.5/);
assert.match(html,/PIT_BOX_LATERAL=isMonza\\?41\\.5:isMonaco\\?42/);
assert.match(html,/PIT_ENTRY_LATERAL=isMonza\\?23:isMonaco\\?24\\.5/);
assert.match(html,/PIT_EXIT_LATERAL=isMonza\\?23:isMonaco\\?24\\.5/);

const builderStart=html.indexOf("function loadMonacoWorld()");
const builderEnd=html.indexOf("function setActiveTrack(id)",builderStart);
assert.ok(builderStart>=0&&builderEnd>builderStart,"Track-only Monaco world builder must exist");
const builder=html.slice(builderStart,builderEnd);
assert.match(builder,/createRibbon\\(MONACO_TRACK_HALF_WIDTH,\\.015,asphaltMaterial/,"Wider racing surface must use mapped track ribbon");
assert.match(builder,/buildPitStrip\\(/,"Pit lane must remain");
assert.match(builder,/isNearKerbCorner\\(/,"Kerbs must follow mapped corner positions");
assert.match(builder,/startLine/,"Start/finish line must remain");
for (const removed of ["addBuilding(","buildingInstances","yachtSpots","crowdGeo","tunnelStart","Casino de Monte-Carlo","Hotel de Paris","Street lamps","TreeGeometry"]) {
  assert.ok(!builder.includes(removed), `Monaco track-only builder must not contain ${removed}`);
}
assert.match(builder,/new THREE\\.PlaneGeometry\\(groundW,groundD\\)/,"Only a flat neutral base should remain behind the circuit");
console.log(`Monaco checks passed: ${sourcePoints.length} mapped points, ${sourceLength.toFixed(0)}m source trace, 3.50 km lap, 44m road width, ${normalizedGap.toFixed(2)}m minimum non-adjacent clearance, pit lane and kerbs.`);
