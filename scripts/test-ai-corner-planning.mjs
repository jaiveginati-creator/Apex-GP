import fs from "node:fs";
import assert from "node:assert/strict";
import vm from "node:vm";

const html = fs.readFileSync("index.html", "utf8");
const helperMatch = html.match(/function getAICornerTargetSpeed\\(cornerPlan,wearTop\\)\\s*\\{[\\s\\S]*?\\n\\}/);
assert.ok(helperMatch, "AI corner target speed helper must exist");

const helper = vm.runInNewContext(
  `(${helperMatch[0]})`,
  { AI_TARGET_SPEED: 96, Number, Math }
);

// A tight corner must be allowed to demand a genuinely low speed.
assert.equal(helper({ targetSpeed: 42 }, 96), 42);
// A fast corner keeps its planned speed.
assert.equal(helper({ targetSpeed: 91 }, 96), 91);
// Tyre condition remains a hard ceiling.
assert.equal(helper({ targetSpeed: 91 }, 74), 74);
// Invalid planner data safely falls back to the normal car cap.
assert.equal(helper({}, 96), 96);
// The old 78% top-speed floor must never return.
assert.doesNotMatch(html, /Math\\.max\\(\\s*cornerPlan\\.targetSpeed,\\s*AI_TARGET_SPEED\\*\\.78/);

console.log("AI corner-planning checks passed: tight-corner braking, fast-corner pace, tyre ceiling and safe fallback.");
