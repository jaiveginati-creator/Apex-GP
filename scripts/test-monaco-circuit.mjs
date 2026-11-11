import fs from "node:fs";
import assert from "node:assert/strict";

const html = fs.readFileSync("index.html", "utf8");
const pointsMatch = html.match(/const monacoSourcePoints=\[([\s\S]*?)\n\];/);
assert.ok(pointsMatch, "Mapped Monaco source centreline must exist");
const sourcePoints = [...pointsMatch[1].matchAll(/\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]/g)]
  .map(m => [Number(m[1]), Number(m[2]), Number(m[3])]);
assert.ok(sourcePoints.length >= 410, `Expected full mapped road trace, found ${sourcePoints.length} points`);
assert.deepEqual(sourcePoints[0], [0, 0, 0], "Monaco lap must begin at mapped start/finish");

let sourceLength = 0;
for (let i = 1; i < sourcePoints.length; i++) sourceLength += Math.hypot(sourcePoints[i][0]-sourcePoints[i-1][0], sourcePoints[i][2]-sourcePoints[i-1][2]);
sourceLength += Math.hypot(sourcePoints[0][0]-sourcePoints.at(-1)[0], sourcePoints[0][2]-sourcePoints.at(-1)[2]);
assert.ok(sourceLength > 3300 && sourceLength < 3340, `Mapped source trace should remain approximately 3.323 km, got ${sourceLength.toFixed(1)}m`);

// Reproduce the game's clearance relaxation exactly.
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
  for (let i=0; i<count; i++) {
    points[i][0]+=pushX[i];
    points[i][2]+=pushZ[i];
  }
}
for (let pass=0; pass<35; pass++) {
  const smooth=points.map(point => point.slice());
  for (let i=0; i<count; i++) {
    const previous=points[(i+count-1)%count];
    const next=points[(i+1)%count];
    smooth[i][0]=points[i][0]*.8+(previous[0]+next[0])*.1;
    smooth[i][2]=points[i][2]*.8+(previous[2]+next[2])*.1;
  }
  for (let i=0; i<count; i++) points[i]=smooth[i];
}

// Sample the actual centripetal Catmull-Rom curve, rather than the
// straight chords between control points. This catches curve overshoot.
function curvePoint(segment, u) {
  const p0=points[(segment-1+count)%count];
  const p1=points[segment%count];
  const p2=points[(segment+1)%count];
  const p3=points[(segment+2)%count];
  const knot=(a,b)=>Math.pow(Math.hypot(a[0]-b[0],a[2]-b[2]),.5);
  let dt0=knot(p0,p1), dt1=knot(p1,p2), dt2=knot(p2,p3);
  if (dt1<1e-4) dt1=1;
  if (dt0<1e-4) dt0=dt1;
  if (dt2<1e-4) dt2=dt1;
  const component=axis=>{
    const t1=(p1[axis]-p0[axis])/dt0-(p2[axis]-p0[axis])/(dt0+dt1)+(p2[axis]-p1[axis])/dt1;
    const t2=(p2[axis]-p1[axis])/dt1-(p3[axis]-p1[axis])/(dt1+dt2)+(p3[axis]-p2[axis])/dt2;
    const c0=p1[axis], c1=t1;
    const c2=-3*p1[axis]+3*p2[axis]-2*t1-t2;
    const c3=2*p1[axis]-2*p2[axis]+t1+t2;
    return c0+c1*u+c2*u*u+c3*u*u*u;
  };
  return [component(0),component(2)];
}

const samples=[];
const samplesPerSegment=32;
for (let segment=0; segment<count; segment++) {
  for (let step=0; step<samplesPerSegment; step++) {
    samples.push(curvePoint(segment,step/samplesPerSegment));
  }
}
let curveLength=0;
const arc=[0];
for (let i=1; i<samples.length; i++) {
  curveLength+=Math.hypot(samples[i][0]-samples[i-1][0],samples[i][1]-samples[i-1][1]);
  arc.push(curveLength);
}
curveLength+=Math.hypot(samples[0][0]-samples.at(-1)[0],samples[0][1]-samples.at(-1)[1]);

// Spatial hash keeps this dense all-pairs clearance check inexpensive.
const cellSize=50;
const grid=new Map();
let minimumGap=Infinity;
for (let i=0; i<samples.length; i++) {
  const [x,z]=samples[i];
  const gx=Math.floor(x/cellSize), gz=Math.floor(z/cellSize);
  for (let ox=-1; ox<=1; ox++) {
    for (let oz=-1; oz<=1; oz++) {
      const nearby=grid.get(`${gx+ox},${gz+oz}`) || [];
      for (const j of nearby) {
        const delta=Math.abs(arc[i]-arc[j]);
        const alongTrack=Math.min(delta,curveLength-delta);
        if (alongTrack<80) continue;
        minimumGap=Math.min(minimumGap,Math.hypot(x-samples[j][0],z-samples[j][1]));
      }
    }
  }
  const key=`${gx},${gz}`;
  if (!grid.has(key)) grid.set(key,[]);
  grid.get(key).push(i);
}

const publishedLength=3500;
const normalizedGap=minimumGap*publishedLength/curveLength;
assert.ok(normalizedGap>=46, `Actual curved Monaco road sections are too close: ${normalizedGap.toFixed(2)}m centreline clearance for a 44m road`);

assert.match(html,/const MONACO_PUBLISHED_LENGTH_M=3500;/);
assert.match(html,/curve\.arcLengthDivisions=8192;/,"Monaco lap scaling must use a dense arc-length table");
assert.match(html,/const MONACO_TRACK_HALF_WIDTH=22;/,"Monaco road half-width must match the other tracks at 22m (44m total)");
assert.match(html,/TRACK_HALF_WIDTH=isMonza[\s\S]{0,120}isMonaco\s*\?MONACO_TRACK_HALF_WIDTH/);
assert.match(html,/PIT_LANE_PATH_LATERAL=isMonza\?35:isMonaco\?35\.5/);
assert.match(html,/PIT_BOX_LATERAL=isMonza\?41\.5:isMonaco\?42/);
assert.match(html,/PIT_ENTRY_LATERAL=isMonza\?23:isMonaco\?24\.5/);
assert.match(html,/PIT_EXIT_LATERAL=isMonza\?23:isMonaco\?24\.5/);

const builderStart=html.indexOf("function loadMonacoWorld()");
const builderEnd=html.indexOf("function setActiveTrack(id)",builderStart);
assert.ok(builderStart>=0&&builderEnd>builderStart,"Track-only Monaco world builder must exist");
const builder=html.slice(builderStart,builderEnd);
assert.match(builder,/createRibbon\(MONACO_TRACK_HALF_WIDTH,\.015,asphaltMaterial/,"Wider racing surface must use mapped track ribbon");
assert.match(builder,/buildPitStrip\(/,"Pit lane must remain");
assert.match(builder,/isNearKerbCorner\(/,"Kerbs must follow mapped corner positions");
assert.match(builder,/startLine/,"Start/finish line must remain");
assert.match(builder,/const monacoGlassMat=new THREE\\.MeshPhysicalMaterial/,"Monaco must use transparent physical glass panels");
assert.match(builder,/new THREE\\.BoxGeometry\\(\\.16,2\\.45,METERS_PER_SAMPLE\\*4\\.08\\)/,"Glass guardrails must form continuous road-edge panels");
assert.match(builder,/MONACO_TRACK_HALF_WIDTH\\+4\\.6/,"Guardrails must sit outside the road and kerbs");
assert.match(builder,/if\\(side===PIT_SIDE&&isInPitCorridor\\(i\\)\\)continue/,"Pit entry and exit must remain open");
assert.match(builder,/monacoGuardrailPosts/,"Glass barriers must have visible support posts");
assert.match(builder,/monacoGuardrailCaps/,"Glass barriers must have a continuous top rail");
for (const removed of ["addBuilding(","buildingInstances","yachtSpots","crowdGeo","tunnelStart","Casino de Monte-Carlo","Hotel de Paris","Street lamps","TreeGeometry"]) {
  assert.ok(!builder.includes(removed), `Monaco track-only builder must not contain ${removed}`);
}
assert.match(builder,/new THREE\.PlaneGeometry\(groundW,groundD\)/,"Only a flat neutral base should remain behind the circuit");
console.log(`Monaco checks passed: ${sourcePoints.length} mapped points, ${sourceLength.toFixed(0)}m source trace, 3.50 km lap, 44m road width, ${normalizedGap.toFixed(2)}m actual-curve clearance, pit lane and kerbs.`);
