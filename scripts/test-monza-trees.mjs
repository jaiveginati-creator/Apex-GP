import fs from "node:fs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const html = fs.readFileSync("index.html", "utf8");
assert.match(html, /const MONZA_TREE_CAP=18000;/, "Monza tree capacity must support the denser forest");
assert.match(html, /x\+=18\)/, "Monza tree grid must be denser than the previous 34m spacing");
assert.match(html, /if\(distanceToTrackXZ\(tx,tz\)<54\)continue;/, "Monza trees should extend closer to the roadside while staying clear of the racing corridor");
assert.match(html, /const forestGroundY=\(x,z\)=>spaTerrainHeightAt\(x,z\);/, "Monza must retain Spa terrain alignment");

const expectedCanopyMasses = [
  "{r:1.9,x:-2.9,y:9.2,z:1.5,c:[.16,.33,.15]}",
  "{r:1.55,x:2.7,y:12.1,z:-1.8,c:[.25,.44,.22]}",
  "{r:2.15,x:2.9,y:10.0,z:1.8,c:[.17,.35,.17]}",
  "{r:1.75,x:-1.8,y:13.4,z:-2.0,c:[.23,.41,.20]}",
  "{r:1.55,x:-1.8,y:10.8,z:1.1,c:[.15,.32,.16]}",
  "{r:1.35,x:1.6,y:13.2,z:-1.1,c:[.19,.38,.18]}"
];
for (const mass of expectedCanopyMasses) {
  assert.equal(html.split(mass).length - 1, 1, `Missing or duplicated canopy mass: ${mass}`);
}

const scriptTags = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
let checked = 0;
for (const match of scriptTags) {
  const attrs = match[1];
  const body = match[2];
  const type = (attrs.match(/\btype\s*=\s*["']([^"']+)["']/i) || [])[1]?.toLowerCase();
  if (/\bsrc\s*=/.test(attrs) || !body.trim()) continue;
  if (type && !["module", "text/javascript", "application/javascript"].includes(type)) continue;
  const result = spawnSync(process.execPath, ["--check", "--input-type=module"], {
    input: body,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, `Inline script syntax check failed:\n${result.stderr || result.stdout}`);
  checked++;
}
assert.ok(checked > 0, "No inline JavaScript was checked");
console.log(`Monza tree checks passed. Verified 6 added canopy masses and parsed ${checked} inline JavaScript block(s).`);
