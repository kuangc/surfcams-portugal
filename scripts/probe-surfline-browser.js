// scripts/probe-surfline-browser.js
//
// Isolates the one variable the plain-fetch probe can't: does a REAL browser,
// running on this machine's IP, get past Surfline's Cloudflare? Connects to an
// already-launched headful Chrome over CDP (same mechanism as the daily refresh)
// and reports whether the three things the refresh depends on actually work:
//   1. the navigated report page hydrated (__NEXT_DATA__ present)
//   2. an in-page fetch of a report URL returns HTML with __NEXT_DATA__
//   3. an in-page fetch of the KBYG JSON API returns conditions
// Always exits 0 — it reports, it does not fail the workflow.

const args = Object.fromEntries(process.argv.slice(2)
  .map((a) => a.match(/^--([^=]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const PORT = Number(args.port || 9333);
const REPORT_URL = args.url
  || "https://www.surfline.com/surf-report/praia-da-cruz-quebrada/640b9d294878ebc4c91e3d61";
const KBYG_SPOT_ID = args.spotId || "640b9d294878ebc4c91e3d61";
const MAX_WAIT_MS = Number(args.maxWaitMs || 120000);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function cdpJson(pathname) {
  const res = await fetch(`http://127.0.0.1:${PORT}${pathname}`);
  if (!res.ok) throw new Error(`CDP ${pathname} -> HTTP ${res.status}`);
  return res.json();
}

async function surflinePageSocketUrl() {
  const targets = await cdpJson("/json/list");
  const page = targets.find((t) => t.type === "page"
    && t.url?.startsWith("https://www.surfline.com/")
    && t.webSocketDebuggerUrl);
  return page?.webSocketDebuggerUrl || null;
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message || JSON.stringify(message.error)));
      else resolve(message.result);
    });
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  close() { this.socket?.close(); }
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression, awaitPromise: true, returnByValue: true, timeout: 60000
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "in-page evaluation failed");
  }
  return result.result?.value;
}

function report(lines, verdict) {
  const text = lines.join("\n");
  console.log(text);
  console.log(`\nverdict: ${verdict}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    return import("node:fs/promises")
      .then((fs) => fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `${text}\n\n**verdict: ${verdict}**\n`))
      .catch(() => {});
  }
  return Promise.resolve();
}

async function main() {
  // 1. Wait for the Surfline page target to exist AND clear the challenge.
  const deadline = Date.now() + MAX_WAIT_MS;
  let socketUrl = null;
  while (Date.now() < deadline && !socketUrl) {
    socketUrl = await surflinePageSocketUrl().catch(() => null);
    if (!socketUrl) await sleep(2000);
  }
  if (!socketUrl) {
    await report(["| check | result |", "|---|---|", "| chrome CDP target | NOT FOUND |"],
      "INCONCLUSIVE — Chrome never exposed a Surfline page target");
    return;
  }

  const client = new CdpClient(socketUrl);
  await client.connect();
  await client.send("Runtime.enable").catch(() => {});

  // Poll the live page until it hydrates past the Cloudflare interstitial.
  let pageState = { title: "", hasNextData: false };
  while (Date.now() < deadline) {
    pageState = await evaluate(client, `(() => ({
      title: document.title || "",
      hasNextData: !!document.getElementById("__NEXT_DATA__")
    }))()`).catch(() => pageState);
    if (pageState.hasNextData && !/just a moment/i.test(pageState.title)) break;
    await sleep(3000);
  }

  // 2. In-page fetch of a report URL — exactly what the daily refresh does.
  const pageFetch = await evaluate(client, `(async () => {
    try {
      const r = await fetch(${JSON.stringify(REPORT_URL)}, {
        credentials: "include",
        headers: { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" }
      });
      const html = await r.text();
      return { status: r.status, hasNextData: html.includes("__NEXT_DATA__"), bytes: html.length };
    } catch (e) { return { status: "ERR", error: String(e) }; }
  })()`).catch((e) => ({ status: "ERR", error: String(e) }));

  // 3. In-page fetch of the KBYG JSON API (the cleanest path, if it works).
  const kbyg = await evaluate(client, `(async () => {
    try {
      const r = await fetch("https://services.surfline.com/kbyg/spots/forecasts/conditions?spotId=${KBYG_SPOT_ID}&days=1", {
        credentials: "include", headers: { accept: "application/json" }
      });
      let conditionsArray = false;
      if (r.ok) { const j = await r.json(); conditionsArray = Array.isArray(j?.data?.conditions); }
      return { status: r.status, conditionsArray };
    } catch (e) { return { status: "ERR", error: String(e) }; }
  })()`).catch((e) => ({ status: "ERR", error: String(e) }));

  client.close();

  const navOk = pageState.hasNextData && !/just a moment/i.test(pageState.title);
  const fetchOk = pageFetch.status === 200 && pageFetch.hasNextData === true;
  const kbygOk = kbyg.status === 200 && kbyg.conditionsArray === true;

  const lines = [
    "| check | result |",
    "|---|---|",
    `| navigated page title | ${JSON.stringify(pageState.title).slice(0, 60)} |`,
    `| navigated page hydrated (__NEXT_DATA__) | ${navOk ? "YES" : "no"} |`,
    `| in-page report fetch | ${pageFetch.status}${fetchOk ? " + __NEXT_DATA__" : ""}${pageFetch.error ? " (" + pageFetch.error + ")" : ""} |`,
    `| in-page KBYG API fetch | ${kbyg.status}${kbygOk ? " + conditions[]" : ""}${kbyg.error ? " (" + kbyg.error + ")" : ""} |`
  ];

  let verdict;
  if (fetchOk || kbygOk) {
    verdict = "PURE-CLOUD VIABLE — a browser on this runner passed Surfline's Cloudflare. "
      + (fetchOk ? "Report-page fetch works" : "KBYG API works") + "; wire the scheduled refresh to run here.";
  } else if (navOk) {
    verdict = "PARTIAL — the page rendered but the in-page data fetches were blocked. Not usable for the refresh.";
  } else {
    verdict = "PURE-CLOUD BLOCKED — the runner never got past Cloudflare. Use the Mac (launchd/self-hosted runner).";
  }
  await report(lines, verdict);
}

main().catch((error) => {
  console.error(error.message);
  // Probe never fails the workflow.
});
