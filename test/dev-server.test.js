import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildSpotAdviceReviewFiles } from "../scripts/build-spot-advice-review-html.js";
import { createStaticServer, isPathInsideRoot, parsePort, resolveRequestPath } from "../scripts/dev-server.js";

const root = path.resolve("/tmp/surfcams-portugal");
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

test("createStaticServer serves a generated review cockpit and its imported module", async (t) => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "surfcams-review-server-"));
  let server;
  t.after(async () => {
    if (server?.listening) {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });
  const outputPath = path.join(tmpRoot, ".local", "spot-advice-review.html");
  buildSpotAdviceReviewFiles({ root: projectRoot, outputPath });

  const generatedHtml = await fs.readFile(outputPath, "utf8");
  const moduleSpecifier = generatedHtml.match(/from\s+["']([^"']+spot-advice-review\.js)["']/)?.[1];
  assert.equal(moduleSpecifier, "../scripts/lib/spot-advice-review.js");
  const servedModulePath = path.resolve(path.dirname(outputPath), moduleSpecifier);
  await fs.mkdir(path.dirname(servedModulePath), { recursive: true });
  await fs.copyFile(path.join(projectRoot, "scripts", "lib", "spot-advice-review.js"), servedModulePath);

  server = createStaticServer({ root: tmpRoot, port: 0 });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  const { port } = server.address();
  const cockpitUrl = `http://127.0.0.1:${port}/.local/spot-advice-review.html`;
  const cockpitResponse = await fetch(cockpitUrl);
  assert.equal(cockpitResponse.status, 200);
  assert.equal(cockpitResponse.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(await cockpitResponse.text(), generatedHtml);

  const moduleResponse = await fetch(new URL(moduleSpecifier, cockpitUrl));
  assert.equal(moduleResponse.status, 200);
  assert.equal(moduleResponse.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.equal(
    await moduleResponse.text(),
    await fs.readFile(path.join(projectRoot, "scripts", "lib", "spot-advice-review.js"), "utf8")
  );
});

test("README launches the generated review cockpit through the dev server", async () => {
  const readme = await fs.readFile(path.join(projectRoot, "README.md"), "utf8");
  assert.match(
    readme,
    /npm run build-spot-advice-review\nnpm run dev\n```\n\nOpen `http:\/\/127\.0\.0\.1:8766\/\.local\/spot-advice-review\.html`\./
  );
  assert.doesNotMatch(readme, /open \.local\/spot-advice-review\.html/);
});
