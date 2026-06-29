#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const cacheDir = path.join(repoRoot, ".cache", "surfline", "pages");
const surflineDbPath = path.join(repoRoot, "data", "surfline-spots.json");

const args = process.argv.slice(2);
const options = {
  port: Number(readArg("--port") || 9223),
  batchSize: Number(readArg("--batch-size") || 2),
  delayMs: Number(readArg("--delay-ms") || 400),
  ids: new Set(readArg("--ids")?.split(",").map((id) => id.trim()).filter(Boolean) || [])
};

function readArg(name) {
  const exact = args.find((arg) => arg.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1];
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function relativePath(absolutePath) {
  return path.relative(repoRoot, absolutePath);
}

async function cdpFetchJson(pathname) {
  const response = await fetch(`http://127.0.0.1:${options.port}${pathname}`);
  if (!response.ok) {
    throw new Error(`Chrome CDP ${pathname} failed: HTTP ${response.status}`);
  }
  return response.json();
}

async function surflinePageWebSocketUrl() {
  const targets = await cdpFetchJson("/json/list");
  const page = targets.find((target) => (
    target.type === "page"
    && target.url?.startsWith("https://www.surfline.com/")
    && target.webSocketDebuggerUrl
  ));

  if (!page) {
    throw new Error(`No Surfline page target found on Chrome CDP port ${options.port}. Open a Surfline report in that browser first.`);
  }
  return page.webSocketDebuggerUrl;
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    this.socket.addEventListener("message", (event) => this.handleMessage(event));
    this.socket.addEventListener("error", (error) => {
      for (const { reject } of this.pending.values()) reject(error);
      this.pending.clear();
    });
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
  }

  handleMessage(event) {
    const message = JSON.parse(event.data);
    if (!message.id || !this.pending.has(message.id)) return;

    const { resolve, reject } = this.pending.get(message.id);
    this.pending.delete(message.id);
    if (message.error) {
      reject(new Error(message.error.message || JSON.stringify(message.error)));
    } else {
      resolve(message.result);
    }
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  close() {
    this.socket?.close();
  }
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    timeout: 120000
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "Browser evaluation failed");
  }
  return result.result.value;
}

async function fetchBatchInBrowser(client, batch) {
  const expression = `(${async function fetchSurflinePages(spots, delayMs) {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const out = [];

    for (const spot of spots) {
      const response = await fetch(spot.url, {
        credentials: "include",
        headers: {
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }
      });
      const html = await response.text();
      out.push({
        ...spot,
        status: response.status,
        ok: response.ok,
        responseUrl: response.url,
        fetchedAt: new Date().toISOString(),
        html
      });
      if (delayMs) await sleep(delayMs);
    }

    return out;
  }})(${JSON.stringify(batch)}, ${JSON.stringify(options.delayMs)})`;

  return evaluate(client, expression);
}

function validateFetchedPage(page) {
  if (!page.ok || page.status !== 200) {
    return `HTTP ${page.status}`;
  }
  if (!page.html.includes("__NEXT_DATA__")) {
    return "missing __NEXT_DATA__";
  }
  if (page.html.includes("cf-mitigated") || /<title[^>]*>\s*Just a moment/i.test(page.html)) {
    return "Cloudflare challenge page";
  }
  if (page.html.includes("x-surfcams-cache-kind")) {
    return "generated snapshot marker found";
  }
  return null;
}

async function writeFetchedPage(page) {
  const htmlPath = path.join(cacheDir, `${page.id}.html`);
  const metaPath = path.join(cacheDir, `${page.id}.json`);
  await fs.writeFile(htmlPath, page.html, "utf8");
  await fs.writeFile(metaPath, `${JSON.stringify({
    id: page.id,
    url: page.url,
    responseUrl: page.responseUrl,
    status: page.status,
    fetchedAt: page.fetchedAt,
    cacheStatus: "browser-fetched",
    source: "chrome-cdp"
  }, null, 2)}\n`, "utf8");
  return { htmlPath, metaPath };
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function main() {
  if (!Number.isInteger(options.port) || options.port <= 0) throw new Error("Invalid --port");
  if (!Number.isInteger(options.batchSize) || options.batchSize <= 0) throw new Error("Invalid --batch-size");
  if (!Number.isFinite(options.delayMs) || options.delayMs < 0) throw new Error("Invalid --delay-ms");

  const surflineDb = await readJson(surflineDbPath);
  const spots = surflineDb.spots
    .filter((spot) => !options.ids.size || options.ids.has(spot.id))
    .map(({ id, url }) => ({ id, url }));

  if (!spots.length) throw new Error("No Surfline spots selected.");

  await fs.mkdir(cacheDir, { recursive: true });
  const client = new CdpClient(await surflinePageWebSocketUrl());
  await client.connect();

  const failures = [];
  let written = 0;

  try {
    await evaluate(client, "document.title");
    for (const batch of chunk(spots, options.batchSize)) {
      const pages = await fetchBatchInBrowser(client, batch);
      for (const page of pages) {
        const validationError = validateFetchedPage(page);
        if (validationError) {
          failures.push(`${page.id}: ${validationError}`);
          continue;
        }
        const { htmlPath } = await writeFetchedPage(page);
        written += 1;
        console.log(`Fetched ${page.id} -> ${relativePath(htmlPath)}`);
      }
    }
  } finally {
    client.close();
  }

  if (failures.length) {
    console.error(failures.join("\n"));
    throw new Error(`Failed to fetch ${failures.length}/${spots.length} Surfline pages through browser CDP.`);
  }

  console.log(`Browser-fetched ${written}/${spots.length} Surfline pages.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
