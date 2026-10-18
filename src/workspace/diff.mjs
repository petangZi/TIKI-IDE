// src/workspace/diff.mjs
// Myers O(ND) line diff with unified-hunk grouping. Pure and testable.

function toLines(text) {
  const s = String(text ?? "");
  return s === "" ? [] : s.split("\n");
}

export function diffOps(a, b) {
  const N = a.length;
  const M = b.length;
  if (N === 0 && M === 0) return [];
  if (N === 0) return b.map((_, i) => ({ type: "insert", bIndex: i }));
  if (M === 0) return a.map((_, i) => ({ type: "delete", aIndex: i }));

  const MAX = N + M;
  const v = new Map();
  v.set(1, 0);
  const trace = [];
  let found = false;

  for (let d = 0; d <= MAX && !found; d++) {
    trace.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && (v.get(k - 1) ?? -1) < (v.get(k + 1) ?? -1));
      let x = down ? (v.get(k + 1) ?? 0) : (v.get(k - 1) ?? 0) + 1;
      let y = x - k;
      while (x < N && y < M && a[x] === b[y]) { x++; y++; }
      v.set(k, x);
      if (x >= N && y >= M) { found = true; break; }
    }
  }

  // Backtrack through the trace to recover the edit script.
  const script = [];
  let x = N;
  let y = M;
  for (let d = trace.length - 1; d >= 0; d--) {
    const vv = trace[d];
    const k = x - y;
    const down = k === -d || (k !== d && (vv.get(k - 1) ?? -1) < (vv.get(k + 1) ?? -1));
    const prevK = down ? k + 1 : k - 1;
    const prevX = vv.get(prevK) ?? 0;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { script.push({ type: "equal", aIndex: x - 1, bIndex: y - 1 }); x--; y--; }
    if (d > 0) {
      if (x === prevX) { script.push({ type: "insert", bIndex: y - 1 }); y--; }
      else { script.push({ type: "delete", aIndex: x - 1 }); x--; }
    }
  }
  script.reverse();
  return script;
}

/**
 * Build a unified diff between two texts.
 * Returns { hunks, additions, deletions, text, identical }.
 */
export function unifiedDiff(aText, bText, { context = 3, pathA = "a", pathB = "b", maxLines = 60_000 } = {}) {
  const a = toLines(aText);
  const b = toLines(bText);
  if (a.length > maxLines || b.length > maxLines) {
    return { hunks: [], additions: 0, deletions: 0, text: "", identical: aText === bText, truncated: true };
  }
  const script = diffOps(a, b);

  // Flatten to display lines with position counters.
  let posOld = 1;
  let posNew = 1;
  const ops = [];
  for (const op of script) {
    if (op.type === "equal") {
      ops.push({ t: " ", text: a[op.aIndex], posOld, posNew, aLine: posOld, bLine: posNew });
      posOld++; posNew++;
    } else if (op.type === "delete") {
      ops.push({ t: "-", text: a[op.aIndex], posOld, posNew, aLine: posOld, bLine: null });
      posOld++;
    } else {
      ops.push({ t: "+", text: b[op.bIndex], posOld, posNew, aLine: null, bLine: posNew });
      posNew++;
    }
  }

  let additions = 0;
  let deletions = 0;
  const changedIdx = [];
  ops.forEach((op, i) => {
    if (op.t === "+") { additions++; changedIdx.push(i); }
    else if (op.t === "-") { deletions++; changedIdx.push(i); }
  });

  if (!changedIdx.length) {
    return { hunks: [], additions: 0, deletions: 0, text: "", identical: true, truncated: false };
  }

  // Group changed ops into hunks with `context` unchanged lines between.
  const ranges = [];
  let start = changedIdx[0];
  let end = changedIdx[0];
  for (let i = 1; i < changedIdx.length; i++) {
    if (changedIdx[i] - end <= context * 2 + 1) end = changedIdx[i];
    else { ranges.push([start, end]); start = changedIdx[i]; end = changedIdx[i]; }
  }
  ranges.push([start, end]);

  const hunks = [];
  for (const [s, e] of ranges) {
    const hs = Math.max(0, s - context);
    const he = Math.min(ops.length - 1, e + context);
    const slice = ops.slice(hs, he + 1);
    const aCount = slice.filter((o) => o.aLine !== null).length;
    const bCount = slice.filter((o) => o.bLine !== null).length;
    const aStart = aCount ? slice.find((o) => o.aLine !== null).aLine : slice[0].posOld;
    const bStart = bCount ? slice.find((o) => o.bLine !== null).bLine : slice[0].posNew;
    hunks.push({
      header: `@@ -${aStart},${aCount} +${bStart},${bCount} @@`,
      aStart, aCount, bStart, bCount,
      lines: slice.map((o) => ({ t: o.t, text: o.text, aLine: o.aLine, bLine: o.bLine }))
    });
  }

  const text = [
    `--- ${pathA}`,
    `+++ ${pathB}`,
    ...hunks.flatMap((h) => [h.header, ...h.lines.map((l) => `${l.t}${l.text}`)])
  ].join("\n");

  return { hunks, additions, deletions, text, identical: false, truncated: false };
}

/** Line-level diff summary between two texts (counts only). */
export function diffStat(aText, bText) {
  const { additions, deletions } = unifiedDiff(aText, bText, { context: 0 });
  return { additions, deletions };
}
