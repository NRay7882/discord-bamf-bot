import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveInvokeBaseUrl } from "./module-url.js";

test("returns the manifest URL unchanged with no overrides", () => {
  assert.equal(
    resolveInvokeBaseUrl("http://localhost:8082"),
    "http://localhost:8082"
  );
});

test("drops a trailing slash so the caller can append a path", () => {
  assert.equal(
    resolveInvokeBaseUrl("http://localhost:8082/"),
    "http://localhost:8082"
  );
});

test("adds the port offset (dev stack beside prod)", () => {
  assert.equal(
    resolveInvokeBaseUrl("http://localhost:8082", { portOffset: 1000 }),
    "http://localhost:9082"
  );
});

test("a zero offset leaves the port untouched", () => {
  assert.equal(
    resolveInvokeBaseUrl("http://localhost:8081", { portOffset: 0 }),
    "http://localhost:8081"
  );
});

test("replaces the host (e.g. a container service name)", () => {
  assert.equal(
    resolveInvokeBaseUrl("http://localhost:8082", { host: "astrogoblin" }),
    "http://astrogoblin:8082"
  );
});

test("applies host and port offset together", () => {
  assert.equal(
    resolveInvokeBaseUrl("http://localhost:8082", { host: "dev-host", portOffset: 1000 }),
    "http://dev-host:9082"
  );
});

test("preserves a non-root path on the invoke URL", () => {
  assert.equal(
    resolveInvokeBaseUrl("http://localhost:8082/api", { portOffset: 1000 }),
    "http://localhost:9082/api"
  );
});

test("throws when an offset is asked for but the URL has no explicit port", () => {
  assert.throws(
    () => resolveInvokeBaseUrl("http://localhost", { portOffset: 1000 }),
    /no explicit port/
  );
});
