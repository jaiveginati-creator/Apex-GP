import fs from "node:fs";
import assert from "node:assert/strict";

const file = "index.html";
let html = fs.readFileSync(file, "utf8");

function replaceExactlyOnce(before, after, label) {
  const count = html.split(before).length - 1;
  assert.equal(count, 1, `Expected one occurrence of ${label}; found ${count}. Refusing to patch an unexpected version.`);
  html = html.replace(before, after);
}

// Add irregular outer canopy masses to each of Monza's three Spa-derived
// broadleaf variants. The existing shared geometry, placement and track code
// remain intact; this only fills out the silhouettes.
replaceExactlyOnce(
  `{r:2.1,x:-1.6,y:11.5,z:-.6,c:[.20,.42,.19]}
            ]`,
  `{r:2.1,x:-1.6,y:11.5,z:-.6,c:[.20,.42,.19]},
                {r:1.9,x:-2.9,y:9.2,z:1.5,c:[.16,.33,.15]},
                {r:1.55,x:2.7,y:12.1,z:-1.8,c:[.25,.44,.22]}
            ]`,
  "first tree-family canopy"
);

replaceExactlyOnce(
  `{r:2.3,x:2.2,y:12,z:-1,c:[.19,.38,.18]}
            ]`,
  `{r:2.3,x:2.2,y:12,z:-1,c:[.19,.38,.18]},
                {r:2.15,x:2.9,y:10.0,z:1.8,c:[.17,.35,.17]},
                {r:1.75,x:-1.8,y:13.4,z:-2.0,c:[.23,.41,.20]}
            ]`,
  "second tree-family canopy"
);

replaceExactlyOnce(
  `{r:1.9,x:.5,y:12,z:0,c:[.17,.36,.17]}
            ]`,
  `{r:1.9,x:.5,y:12,z:0,c:[.17,.36,.17]},
                {r:1.55,x:-1.8,y:10.8,z:1.1,c:[.15,.32,.16]},
                {r:1.35,x:1.6,y:13.2,z:-1.1,c:[.19,.38,.18]}
            ]`,
  "third tree-family canopy"
);

fs.writeFileSync(file, html);
console.log("Monza tree canopy upgrade applied: +6 foliage masses across 3 shared tree variants.");
