import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { isPathInsideRoot, parsePort, resolveRequestPath } from "../scripts/dev-server.js";

const root = path.resolve("/tmp/surfcams-portugal");

test("resolveRequestPath maps root to index.html", () => {
  assert.equal(
    resolveRequestPath("/", { root, port: 8766 }),
    path.join(root, "index.html")
  );
});

test("resolveRequestPath rejects traversal outside the root", () => {
  assert.throws(
    () => resolveRequestPath("/..%2fsecret.txt", { root, port: 8766 }),
    /Path escapes project root/
  );
});

test("isPathInsideRoot rejects sibling paths with the same prefix", () => {
  assert.equal(isPathInsideRoot(path.resolve("/tmp/surfcams-portugal-other/index.html"), root), false);
});

test("parsePort validates configured ports", () => {
  assert.equal(parsePort("8767"), 8767);
  assert.throws(() => parsePort("99999"), /Invalid PORT/);
});
