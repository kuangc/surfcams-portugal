import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createStaticServer, isPathInsideRoot, parsePort, resolveRequestPath } from "../scripts/dev-server.js";

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

test("createStaticServer serves the web app manifest with manifest content type", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "surfcams-dev-server-"));
  await fs.writeFile(path.join(tmpRoot, "manifest.webmanifest"), "{}");

  const server = createStaticServer({ root: tmpRoot, port: 0 });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/manifest.webmanifest`);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/manifest+json; charset=utf-8");
  assert.equal(await response.text(), "{}");
});
