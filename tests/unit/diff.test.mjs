import test from "node:test";
import assert from "node:assert/strict";
import { diffOps, unifiedDiff, diffStat } from "../../src/workspace/diff.mjs";

test("diffOps: identical sequences produce only equals", () => {
  const ops = diffOps(["a", "b"], ["a", "b"]);
  assert.ok(ops.every((o) => o.type === "equal"));
});

test("diffOps: insertion and deletion are isolated", () => {
  assert.deepEqual(diffOps([], ["x"]), [{ type: "insert", bIndex: 0 }]);
  assert.deepEqual(diffOps(["x"], []), [{ type: "delete", aIndex: 0 }]);
});

test("unifiedDiff: reports additions and deletions with a hunk header", () => {
  const d = unifiedDiff("a\nb\nc", "a\nB\nc");
  assert.equal(d.identical, false);
  assert.equal(d.additions, 1);
  assert.equal(d.deletions, 1);
  assert.equal(d.hunks.length, 1);
  assert.match(d.hunks[0].header, /^@@ -\d+,\d+ \+\d+,\d+ @@$/);
  const signs = d.hunks[0].lines.map((l) => l.t);
  assert.ok(signs.includes("+") && signs.includes("-"));
});

test("unifiedDiff: identical text yields no hunks", () => {
  const d = unifiedDiff("same\ntext", "same\ntext");
  assert.equal(d.identical, true);
  assert.equal(d.hunks.length, 0);
});

test("unifiedDiff: added file diffs against empty baseline", () => {
  const d = unifiedDiff("", "line1\nline2");
  assert.equal(d.additions, 2);
  assert.equal(d.deletions, 0);
});

test("diffStat returns counts only", () => {
  assert.deepEqual(diffStat("a\nb", "a\nc\nd"), { additions: 2, deletions: 1 });
});
