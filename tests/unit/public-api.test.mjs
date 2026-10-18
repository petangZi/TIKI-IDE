// tests/unit/public-api.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { search, getById, catalogHosts, stats, catalogSize } from "../../src/tools/public-apis/catalog.mjs";
import { createPublicApiProvider } from "../../src/tools/providers/public-api.mjs";
import { createToolRegistry } from "../../src/tools/registry.mjs";

test("catalog is populated and well-formed", () => {
  assert.ok(catalogSize > 500, `expected a large catalog, got ${catalogSize}`);
  const sample = search({ limit: 5 }).results;
  assert.equal(sample.length, 5);
  for (const e of sample) {
    assert.equal(typeof e.id, "string");
    assert.equal(typeof e.name, "string");
    assert.equal(typeof e.category, "string");
    assert.equal(typeof e.host, "string");
    assert.ok(e.host.length > 0);
  }
});

test("every catalog id is unique and resolvable", () => {
  const ids = new Set();
  for (const e of search({ limit: 100 }).results) {
    assert.ok(!ids.has(e.id));
    ids.add(e.id);
    assert.equal(getById(e.id).id, e.id);
  }
});

test("search filters by category, query, and auth", () => {
  const animals = search({ category: "Animals", limit: 50 });
  assert.ok(animals.total > 3, "expected several animal APIs");
  assert.ok(animals.results.every((e) => e.category === "Animals"));

  const cats = search({ query: "cat", limit: 50 });
  assert.ok(cats.total > 0);

  const keyed = search({ auth: "apiKey", limit: 20 });
  assert.ok(keyed.results.every((e) => e.auth === "apiKey"));

  const httpsOnly = search({ httpsOnly: true, limit: 50 });
  assert.ok(httpsOnly.results.every((e) => e.https === true));
});

test("stats summarise the catalog", () => {
  const s = stats();
  assert.equal(s.count, catalogSize);
  assert.ok(s.categories > 10);
  assert.ok(s.by_auth["No"] > 0);
});

test("catalog hosts form the curated allowlist", () => {
  const hosts = catalogHosts();
  assert.ok(hosts.size > 500);
  for (const h of hosts) assert.equal(h, h.toLowerCase());
});

test("registry exposes the three public_api tools", () => {
  const registry = createToolRegistry({
    config: { toolHttpAllowlist: [], publicApisEnabled: true },
    logger: { warn() {} }
  });
  const ids = registry.list().map((t) => t.id);
  for (const id of ["public_api.search", "public_api.describe", "public_api.call"]) {
    assert.ok(ids.includes(id), `missing ${id}`);
  }
});

test("public_api.search runs offline", async () => {
  const [searchTool] = createPublicApiProvider({});
  assert.ok(Array.isArray(searchTool) === false);
  const out = await searchTool.run({ query: "weather", limit: 5 });
  assert.ok(out.data.count > 0);
  assert.ok(out.data.results.every((r) => typeof r.host === "string"));
});

test("public_api.call rejects hosts outside the catalog", async () => {
  const tools = createPublicApiProvider({});
  const call = tools.find((t) => t.id === "public_api.call");
  await assert.rejects(
    () => call.run({ url: "https://example.com/data" }),
    (e) => e.code === "NETWORK_BLOCKED"
  );
});

test("public_api.call requires HTTPS for catalog hosts", async () => {
  const hosts = [...catalogHosts()];
  const httpHost = hosts.find((h) => !h.includes("*")) || hosts[0];
  const tools = createPublicApiProvider({});
  const call = tools.find((t) => t.id === "public_api.call");
  await assert.rejects(
    () => call.run({ url: `http://${httpHost}/` }),
    (e) => e.code === "NETWORK_BLOCKED"
  );
});

test("public_api.call blocks private destinations", async () => {
  const tools = createPublicApiProvider({ allowlist: ["127.0.0.1"] });
  const call = tools.find((t) => t.id === "public_api.call");
  await assert.rejects(
    () => call.run({ url: "http://127.0.0.1:8080/", headers: {} }),
    (e) => e.code === "NETWORK_BLOCKED"
  );
});

test("public_api.call is disabled when the provider is off", async () => {
  const tools = createPublicApiProvider({ enabled: false });
  const call = tools.find((t) => t.id === "public_api.call");
  await assert.rejects(
    () => call.run({ url: "https://catfact.ninja/fact" }),
    (e) => e.code === "NETWORK_BLOCKED"
  );
});

test("public_api.describe returns a catalog record", async () => {
  const tools = createPublicApiProvider({});
  const describe = tools.find((t) => t.id === "public_api.describe");
  const first = search({ limit: 1 }).results[0];
  const out = await describe.run({ id: first.id });
  assert.equal(out.data.api.id, first.id);
  assert.equal(typeof out.data.host_allowlisted, "boolean");
  await assert.rejects(() => describe.run({ id: "definitely-not-a-real-api-id" }), (e) => e.code === "PUBLIC_API_UNKNOWN");
});
