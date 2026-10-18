// scripts/ui-live.mjs
// Drives the real UI in a browser against a running TIKI IDE server.
//
//   node server.mjs &                                  # or npm start
//   node scripts/ui-live.mjs                           # default http://127.0.0.1:4317
//   BASE=http://127.0.0.1:4401 node scripts/ui-live.mjs
//
// Playwright is deliberately not a dependency of this project — the runtime is
// zero-dependency. Provide it wherever you like and point PLAYWRIGHT_MODULE at
// it (defaults to "playwright", resolved from the current directory):
//
//   npm i --prefix /tmp/uiv playwright && PLAYWRIGHT_MODULE=/tmp/uiv/node_modules/playwright/index.mjs node scripts/ui-live.mjs
//
// TIKI_CHROMIUM selects the browser binary. It exists because a musl host
// cannot run Playwright's bundled glibc Chromium; the system one works.
//
// Not part of `check`, `test` or `test:smoke` — it needs a browser and a server.
import { existsSync } from "node:fs";

const BASE = process.env.BASE || "http://127.0.0.1:4317";
const SHOT_DIR = process.env.SHOT_DIR || "";
const LAUNCH = {
  ...(process.env.TIKI_CHROMIUM ? { executablePath: process.env.TIKI_CHROMIUM } : {}),
  args: ["--no-sandbox", "--disable-dev-shm-usage"]
};

async function loadPlaywright() {
  const spec = process.env.PLAYWRIGHT_MODULE || "playwright";
  if (spec.startsWith("/") && !existsSync(spec)) {
    throw new Error(`PLAYWRIGHT_MODULE points at ${spec}, which does not exist`);
  }
  try {
    return await import(spec);
  } catch (error) {
    throw new Error(
      `playwright could not be loaded (${error.message}).\n` +
        "Install it outside this zero-dependency project, e.g.\n" +
        "  npm i --prefix /tmp/uiv playwright\n" +
        "  PLAYWRIGHT_MODULE=/tmp/uiv/node_modules/playwright/index.mjs node scripts/ui-live.mjs"
    );
  }
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
}

const { chromium } = await loadPlaywright();
const browser = await chromium.launch(LAUNCH);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const problems = [];
page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("response", (r) => { if (r.status() >= 400) problems.push(`http ${r.status()} ${r.url()}`); });

const shot = async (name) => {
  if (!SHOT_DIR) return;
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png`, fullPage: true });
};

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  check("page loads", (await page.title()).length > 0, await page.title());

  // --- MCP panel ---------------------------------------------------------
  await page.click('#panelTabs .ptab[data-view="mcp"]');
  await page.waitForSelector("#mcpBuiltins .list-item", { timeout: 15000 });

  const servers = await page.locator("#mcpList .list-item").count();
  const builtins = await page.locator("#mcpBuiltins .list-item").count();
  check("built-in catalog renders", builtins === 11, `${builtins} entries`);
  check("server list renders", servers >= 1, `${servers} rows`);
  await shot("01-mcp-panel");

  // --- layout audit ------------------------------------------------------
  const audit = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("#mcpList .list-item, #mcpBuiltins .list-item")];
    const boxes = [];
    const clipped = [];
    for (const row of rows) {
      if (row.scrollWidth > row.clientWidth + 1) clipped.push((row.querySelector(".nm")?.textContent || "").trim().slice(0, 30));
      boxes.push({ rect: row.getBoundingClientRect(), label: (row.querySelector(".nm")?.textContent || "").trim().slice(0, 30) });
    }
    const overlapping = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i].rect;
        const b = boxes[j].rect;
        const area = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) *
          Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
        if (area > 4) overlapping.push(`${boxes[i].label} ~ ${boxes[j].label}`);
      }
    }
    const tiny = [...document.querySelectorAll("#mcpList .list-item button, #mcpBuiltins .list-item button")]
      .filter((b) => { const r = b.getBoundingClientRect(); return r.width < 18 || r.height < 14; })
      .map((b) => b.textContent.trim());
    return {
      overlapping,
      clipped,
      tiny,
      overflowX: document.documentElement.scrollWidth - window.innerWidth
    };
  });
  check("no horizontal overflow", audit.overflowX <= 1, `${audit.overflowX}px`);
  check("no overlapping rows", audit.overlapping.length === 0, audit.overlapping.join(", "));
  check("no clipped rows", audit.clipped.length === 0, audit.clipped.join(", "));
  check("no undersized buttons", audit.tiny.length === 0, audit.tiny.join(", "));

  // --- trust toggle (idempotent: prior state may be either) --------------
  const trustedRow = page.locator("#mcpList .list-item").filter({ has: page.locator(".pill", { hasText: "built-in" }) }).first();
  if (await trustedRow.count() > 0) {
    const target = trustedRow;
    const btn = target.getByRole("button", { name: /^(Trust|Untrust)$/ });
    const labelBefore = (await btn.textContent()).trim();
    const before = (await target.locator(".pill.warn").count()) === 1;
    const expect = before ? "Trust" : "Untrust";
    await btn.click();
    await page.waitForFunction(
      (want) => {
        const row = [...document.querySelectorAll("#mcpList .list-item")].find((r) => [...r.querySelectorAll("button")].some((b) => /^(Trust|Untrust)$/.test(b.textContent.trim())));
        const b = row && [...row.querySelectorAll("button")].find((x) => /^(Trust|Untrust)$/.test(x.textContent.trim()));
        return b && b.textContent.trim() === want;
      },
      expect,
      { timeout: 8000 }
    );
    const after = (await target.locator(".pill.warn").count()) === 1;
    check("trust toggle flips state", after !== before, `trusted ${before} -> ${after} (button "${labelBefore}" -> "${expect}")`);
    // leave it as it was found
    await target.getByRole("button", { name: new RegExp(`^${labelBefore}$`) }).click().catch(() => {});
  } else {
    check("trust toggle flips state", true, "skipped — no built-in server installed");
  }
  await shot("02-mcp-trusted");

  // --- skills panel ------------------------------------------------------
  await page.click('#panelTabs .ptab[data-view="skills"]');
  await page.waitForSelector("#skillBuiltins .list-item", { timeout: 15000 });
  const skills = await page.locator("#skillBuiltins .list-item .nm").allInnerTexts();
  check("skills catalog renders", skills.length === 3, skills.map((s) => s.split(" ")[0]).join(", "));
  await shot("03-skills");

  // --- one-click install actually installs -------------------------------
  // Exercises the primary action: an install button that flips the badge and
  // lands the skill in the installed list. Restores the prior state after.
  const installable = page.locator("#skillBuiltins .list-item").filter({ has: page.getByRole("button", { name: "Install" }) }).first();
  if (await installable.count() > 0) {
    const name = (await installable.locator(".nm").innerText()).trim().replace(/\s+installed$/, "");
    // Re-scope by name afterwards: the list re-renders, so a "first row with an
    // Install button" locator would silently move to the next skill.
    const row = () => page.locator("#skillBuiltins .list-item").filter({ hasText: name });
    await installable.getByRole("button", { name: "Install" }).click();
    await page.waitForFunction(
      (want) => [...document.querySelectorAll("#skillInstalled .list-item .nm")].some((n) => n.textContent.trim() === want),
      name,
      { timeout: 8000 }
    );
    const installed = await page.locator("#skillInstalled .list-item").filter({ hasText: name }).count();
    const badge = await row().locator(".pill.ok").count();
    check("skill install lands in installed list", installed === 1 && badge === 1, `${name} · installed rows ${installed}, badge ${badge}`);
    await shot("04-skill-installed");

    await page.locator("#skillInstalled .list-item").filter({ hasText: name }).getByRole("button", { name: "×" }).click();
    await page.waitForFunction(
      (want) => ![...document.querySelectorAll("#skillInstalled .list-item .nm")].some((n) => n.textContent.trim() === want),
      name,
      { timeout: 8000 }
    );
    const stillInstalled = await page.locator("#skillInstalled .list-item").filter({ hasText: name }).count();
    const backToInstall = await row().getByRole("button", { name: "Install" }).count();
    check("skill uninstall restores state", stillInstalled === 0 && backToInstall === 1, `${name} removed, button back to Install`);
  } else {
    check("skill install lands in installed list", true, "skipped — every skill already installed");
  }

  // --- no bundle children left half-added --------------------------------
  const mcpProblems = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("#mcpList .list-item")];
    return rows.filter((r) => /undefined|NaN|null/.test(r.textContent)).map((r) => r.textContent.slice(0, 40));
  });
  check("server rows render clean values", mcpProblems.length === 0, mcpProblems.join(" | "));

  check("no console errors or failed requests", problems.length === 0, [...new Set(problems)].slice(0, 4).join(" | "));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n  ${results.length - failed.length}/${results.length} UI checks passed${SHOT_DIR ? `  (screenshots in ${SHOT_DIR})` : ""}`);
process.exit(failed.length === 0 ? 0 : 1);
