#!/usr/bin/env node

import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_PORT = 8766;
const PORT = parsePort(process.env.PORT);

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml"]
]);

export function parsePort(value, fallback = DEFAULT_PORT) {
  const port = Number.parseInt(value || String(fallback), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT value: ${value}`);
  }
  return port;
}

export function isPathInsideRoot(filePath, root = ROOT) {
  const relative = path.relative(root, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function resolveRequestPath(url, { root = ROOT, port = PORT } = {}) {
  const parsed = new URL(url, `http://127.0.0.1:${port}`);
  const pathname = parsed.pathname === "/" ? "/index.html" : parsed.pathname;
  const decoded = decodeURIComponent(pathname);
  const resolved = path.resolve(root, `.${decoded}`);

  if (!isPathInsideRoot(resolved, root)) {
    throw new Error("Path escapes project root");
  }

  return resolved;
}

export function createStaticServer({ root = ROOT, port = PORT } = {}) {
  return http.createServer(async (request, response) => {
    try {
      const filePath = resolveRequestPath(request.url || "/", { root, port });
      const body = await fs.readFile(filePath);
      response.writeHead(200, {
        "Content-Type": MIME_TYPES.get(path.extname(filePath)) || "application/octet-stream"
      });
      response.end(body);
    } catch (error) {
      const status = error.code === "ENOENT" ? 404 : 400;
      response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(status === 404 ? "Not found" : error.message);
    }
  });
}

export function startServer({ port = PORT } = {}) {
  const server = createStaticServer({ port });
  server.on("error", (error) => {
    console.error(`Unable to start dev server on 127.0.0.1:${port}: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`Surfcams Portugal dev server running at http://127.0.0.1:${port}/`);
  });
  return server;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
