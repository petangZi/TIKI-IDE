import test from "node:test";
import assert from "node:assert/strict";
import { isBlockedIp, assertSafeUrl, NetworkPolicyError } from "../../src/tools/netguard.mjs";
import { validateSchema } from "../../src/tools/schema.mjs";

test("private and loopback IPv4 ranges are blocked", () => {
  for (const ip of ["127.0.0.1", "10.0.0.5", "192.168.1.1", "172.16.0.1", "169.254.1.1", "0.0.0.0"]) {
    assert.equal(isBlockedIp(ip), true, ip);
  }
  assert.equal(isBlockedIp("8.8.8.8"), false);
});

test("IPv6 loopback and unique-local ranges are blocked", () => {
  assert.equal(isBlockedIp("::1"), true);
  assert.equal(isBlockedIp("fd00::1"), true);
  assert.equal(isBlockedIp("fe80::1"), true);
});

test("assertSafeUrl rejects loopback, internal hostnames, and bad protocols", () => {
  assert.throws(() => assertSafeUrl("http://127.0.0.1/x"), NetworkPolicyError);
  assert.throws(() => assertSafeUrl("http://localhost/x"), NetworkPolicyError);
  assert.throws(() => assertSafeUrl("file:///etc/passwd"), NetworkPolicyError);
  assert.throws(() => assertSafeUrl("http://api.internal/x"), NetworkPolicyError);
});

test("assertSafeUrl enforces the allowlist and honours wildcards", () => {
  assert.throws(() => assertSafeUrl("https://evil.example.com/x", ["good.com"]), NetworkPolicyError);
  assert.equal(assertSafeUrl("https://good.com/x", ["good.com"]).hostname, "good.com");
  assert.equal(assertSafeUrl("https://api.good.com/x", ["*.good.com"]).hostname, "api.good.com");
});

test("validateSchema enforces required, type, and bounds", () => {
  const schema = { type: "object", required: ["a"], properties: { a: { type: "string", maxLength: 3 }, n: { type: "number", maximum: 10 } } };
  assert.equal(validateSchema(schema, { a: "ok", n: 5 }).length, 0);
  assert.ok(validateSchema(schema, { n: 5 }).length >= 1);
  assert.ok(validateSchema(schema, { a: "toolong" }).length >= 1);
  assert.ok(validateSchema(schema, { a: "x", n: 99 }).length >= 1);
});
