import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createStore } from "../../src/storage/store.mjs";
import { createPriceCatalog, DEFAULT_MARKUP } from "../../src/engine/prices.mjs";

function catalog() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tiki-prices-"));
  const store = createStore({ dataDir });
  return { prices: createPriceCatalog({ store, logger: { warn() {}, info() {} } }), store };
}

test("default markup is applied to provider cost", () => {
  const { prices, store } = catalog();
  const cost = prices.computeCost({ provider: "local", model: "*", usage: { input_tokens: 1000, output_tokens: 1000 } });
  assert.equal(cost.user_charge, 0);
  assert.equal(prices.markup(), DEFAULT_MARKUP);
  store.close();
});

test("cached input tokens are not double-charged", () => {
  const { prices, store } = catalog();
  prices.upsert({ provider: "test", model_id: "m", input_per_million: 1, output_per_million: 0, cached_input_per_million: 0.5, currency: "USD" });
  const cost = prices.computeCost({ provider: "test", model: "m", usage: { input_tokens: 1000, cached_input_tokens: 1000, output_tokens: 0 } });
  assert.equal(cost.provider_cost, 0.0005);
  store.close();
});

test("unknown provider resolves to unpriced zero cost", () => {
  const { prices, store } = catalog();
  const cost = prices.computeCost({ provider: "nope", model: "nope", usage: { input_tokens: 5, output_tokens: 5 } });
  assert.equal(cost.provider_cost, 0);
  assert.equal(cost.price_version, "unpriced");
  store.close();
});

test("setMarkup accepts only positive numbers", () => {
  const { prices, store } = catalog();
  assert.equal(prices.setMarkup(3), 3);
  assert.equal(prices.setMarkup(-1), DEFAULT_MARKUP);
  store.close();
});
