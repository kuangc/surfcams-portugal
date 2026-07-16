import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";

import { resolveConditions } from "../src/forecast-sources.js";
import { monitorCameraSlots } from "../src/monitor-cameras.js";
import {
  formatSpotPlaybook,
  normalizeSpotAdviceRuntime,
  selectLocalLens
} from "../src/spot-advice.js";
import { DEFAULT_SURF_PREFERENCES } from "../src/surf-preferences.js";
import { rateSurfSpot } from "../src/surf-rating.js";

const mainSource = fs.readFileSync("src/main.js", "utf8");
const styleSource = fs.readFileSync("src/styles/app.css", "utf8");
const runtimePayload = JSON.parse(fs.readFileSync("data/spot-advice-resolved.json", "utf8"));
const advice = normalizeSpotAdviceRuntime(runtimePayload);
const spotData = { advice, promotedById: new Map() };

function functionSource(name) {
  const start = mainSource.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const parametersStart = mainSource.indexOf("(", start);
  let parameterDepth = 0;
  let parametersEnd = -1;
  for (let index = parametersStart; index < mainSource.length; index += 1) {
    if (mainSource[index] === "(") parameterDepth += 1;
    if (mainSource[index] === ")") parameterDepth -= 1;
    if (parameterDepth === 0) {
      parametersEnd = index;
      break;
    }
  }
  const bodyStart = mainSource.indexOf("{", parametersEnd);
  let depth = 0;
  for (let index = bodyStart; index < mainSource.length; index += 1) {
    if (mainSource[index] === "{") depth += 1;
    if (mainSource[index] === "}") depth -= 1;
    if (depth === 0) return mainSource.slice(start, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

class FakeElement {
  constructor(tagName, document) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = document;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.className = "";
    this.dataset = {};
    this.hidden = false;
    this.textContent = "";
    this.tabIndex = 0;
  }

  append(...children) {
    children.forEach((child) => this.appendChild(child));
  }

  appendChild(child) {
    this.children.push(child);
    child.parentElement = this;
    return child;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type, init = {}) {
    const event = {
      type,
      detail: init.detail ?? 0,
      key: init.key,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }
    };
    (this.listeners.get(type) || []).forEach((listener) => listener(event));
    return event;
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }
}

function descendants(root) {
  return root.children.flatMap((child) => [child, ...descendants(child)]);
}

function byClass(root, className) {
  return descendants(root).filter((element) => element.className.split(/\s+/).includes(className));
}

function textOf(root) {
  return [root.textContent, ...root.children.map(textOf)].join(" ").replace(/\s+/g, " ").trim();
}

function loadUiHelpers({ mobile = false } = {}) {
  const document = {
    activeElement: null,
    createElement(tagName) {
      return new FakeElement(tagName, document);
    }
  };
  const context = {
    URL,
    document,
    window: { matchMedia: () => ({ matches: mobile }) }
  };
  const helperNames = [
    "safeAdviceSourceUrl",
    "appendAdviceMeta",
    "createAdviceClaim",
    "createAdviceSource",
    "createSpotPlaybook"
  ];
  const script = `let spotPlaybookRegionSequence = 0;\n${helperNames.map(functionSource).join("\n")}\n`
    + "globalThis.helpers = { safeAdviceSourceUrl, createSpotPlaybook };";
  vm.runInNewContext(script, context);
  return { ...context, ...context.helpers };
}

function executeLocalLens(lens) {
  const document = {
    createElement(tagName) {
      return new FakeElement(tagName, document);
    }
  };
  const container = document.createElement("div");
  const calls = [];
  const context = {
    Date,
    document,
    state: { spotData: { advice: true }, tideData: { events: true } },
    getConditions(camera) {
      calls.push(["conditions", camera.id]);
      return { source: "fixture" };
    },
    findAdviceTideSnapshot(camera) {
      calls.push(["tide", camera.id]);
      return { phase: { stage: "mid" } };
    },
    selectLocalLens(camera) {
      calls.push(["lens", camera.id]);
      return lens;
    }
  };
  vm.runInNewContext(`${functionSource("updateLocalLensSlot")}\n${functionSource("renderLocalLens")}\nglobalThis.run = renderLocalLens;`, context);
  const result = context.run(container, { id: "fixture" });
  return { calls, container, result };
}

test("compact Local lens is wired once per requested surface as inert text", () => {
  assert.match(mainSource, /function renderLocalLens\(container, camera\)/);
  assert.match(mainSource, /line\.className = "local-lens"/);
  assert.match(mainSource, /line\.dataset\.role = "local-lens"/);
  assert.match(mainSource, /createMonitorTile[\s\S]*?renderLocalLens\(/);
  assert.match(mainSource, /createFavoriteCard[\s\S]*?renderLocalLens\(/);
  assert.match(mainSource, /renderExploreSelection[\s\S]*?renderLocalLens\(/);
  assert.doesNotMatch(mainSource, /local-lens[^\n]*addEventListener/);
  assert.doesNotMatch(mainSource, /local-lens[^\n]*(?:button|href|tabIndex)/i);
  for (const surface of ["createMonitorTile", "createFavoriteCard", "renderExploreConditions"]) {
    assert.equal(functionSource(surface).match(/renderLocalLens\(/g)?.length, 1, `${surface} renders at most one lens`);
  }
});

test("compact Local lens behavior emits only one inert paragraph for a decisive result", () => {
  const rendered = executeLocalLens({ scopeLabel: "Your observation", text: "May start working" });
  assert.deepEqual(rendered.calls, [["conditions", "fixture"], ["tide", "fixture"], ["lens", "fixture"]]);
  assert.equal(rendered.container.children.length, 1);
  assert.equal(rendered.result.tagName, "P");
  assert.equal(rendered.result.dataset.role, "local-lens");
  assert.equal(rendered.result.textContent, "Your observation · May start working");
  assert.equal(rendered.result.getAttribute("tabindex"), null);
  assert.equal(rendered.result.children.length, 0);

  const omitted = executeLocalLens(null);
  assert.equal(omitted.result.tagName, "P");
  assert.equal(omitted.result.hidden, true);
  assert.equal(omitted.result.textContent, "");
  assert.equal(omitted.container.children.length, 1, "a persistent hidden slot can become eligible later");
});

test("detail playbook source contains an explicit accessible disclosure and five groups", () => {
  assert.match(mainSource, /Local playbook/);
  assert.match(mainSource, /aria-expanded/);
  assert.match(mainSource, /aria-controls/);
  for (const heading of ["Size here", "Best window", "How it breaks", "Know before you go", "Why we say this"]) {
    assert.match(mainSource, new RegExp(heading));
  }
  assert.match(mainSource, /Needs revalidation/);
  assert.match(mainSource, /Guidance differs/);
  assert.match(mainSource, /Guide only · no live camera or conditions/);
  assert.match(mainSource, /link\.setAttribute\("target", "_blank"\)/);
  assert.match(mainSource, /link\.setAttribute\("rel", "noopener noreferrer"\)/);
});

test("playbook behavior owns unique regions, toggles hidden state, and handles mobile Escape", () => {
  const { createSpotPlaybook, document } = loadUiHelpers({ mobile: true });
  const fixture = {
    subjectId: "fixture",
    name: "Fixture",
    guideOnly: false,
    conflicts: [],
    sections: [
      { id: "size-here", title: "Size here", claims: [] },
      { id: "best-window", title: "Best window", claims: [] },
      { id: "how-it-breaks", title: "How it breaks", claims: [] },
      { id: "know-before-you-go", title: "Know before you go", claims: [] },
      { id: "why-we-say-this", title: "Why we say this", claims: [], sources: [] }
    ]
  };
  const first = createSpotPlaybook(fixture);
  const second = createSpotPlaybook(fixture);
  const toggle = byClass(first, "spot-playbook-toggle")[0];
  const region = byClass(first, "spot-playbook")[0];
  const secondToggle = byClass(second, "spot-playbook-toggle")[0];

  assert.notEqual(toggle.getAttribute("aria-controls"), secondToggle.getAttribute("aria-controls"));
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(region.hidden, true);

  toggle.dispatch("click", { detail: 0 });
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.equal(region.hidden, false);
  assert.equal(document.activeElement, region);

  const escape = region.dispatch("keydown", { key: "Escape" });
  assert.equal(escape.defaultPrevented, true);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(region.hidden, true);
  assert.equal(document.activeElement, toggle);
  assert.equal(toggle.listeners.get("click").length, 1);
  assert.equal(region.listeners.get("keydown").length, 1);

  toggle.dispatch("click", { detail: 1 });
  toggle.dispatch("click", { detail: 1 });
  assert.equal(region.hidden, true);
  assert.equal(document.activeElement, toggle);

  const desktop = loadUiHelpers({ mobile: false });
  const desktopShell = desktop.createSpotPlaybook(fixture);
  const desktopToggle = byClass(desktopShell, "spot-playbook-toggle")[0];
  const desktopRegion = byClass(desktopShell, "spot-playbook")[0];
  desktopToggle.dispatch("click", { detail: 1 });
  desktopRegion.dispatch("keydown", { key: "Escape" });
  assert.equal(desktopRegion.hidden, false, "inline desktop disclosure preserves normal focus");
});

test("playbook renders scope, confidence, expiry, conflicts, and safe external sources", () => {
  const { createSpotPlaybook, safeAdviceSourceUrl } = loadUiHelpers();
  const fixture = {
    subjectId: "fixture",
    name: "Fixture",
    guideOnly: true,
    conflicts: [{ id: "conflict" }],
    sections: [
      {
        id: "size-here", title: "Size here", claims: [{
          id: "claim", summary: "User observation text.", provenanceLabel: "Your observation",
          scopeLabel: "Spot advice", confidence: "medium", needsRevalidation: true,
          consensus: "unresolved"
        }]
      },
      { id: "best-window", title: "Best window", claims: [] },
      { id: "how-it-breaks", title: "How it breaks", claims: [] },
      { id: "know-before-you-go", title: "Know before you go", claims: [] },
      {
        id: "why-we-say-this", title: "Why we say this", claims: [], sources: [
          { title: "Safe source", publisher: "Publisher", url: "https://example.com/advice", supportedClaim: "This source supports the exact advice.", scopeLabel: "Spot advice", confidence: "medium", needsRevalidation: false },
          { title: "Unsafe source", publisher: "Publisher", url: "javascript:alert(1)", scopeLabel: "Spot advice", confidence: "low", needsRevalidation: false }
        ]
      }
    ]
  };
  const shell = createSpotPlaybook(fixture);
  const anchors = descendants(shell).filter((element) => element.tagName === "A");
  const copy = textOf(shell);

  assert.match(copy, /Guide only · no live camera or conditions/);
  assert.match(copy, /Your observation/);
  assert.match(copy, /Confidence: medium/);
  assert.match(copy, /Needs revalidation/);
  assert.match(copy, /Guidance differs/);
  assert.match(copy, /This source supports the exact advice/);
  assert.equal(anchors.length, 1);
  assert.equal(anchors[0].getAttribute("href"), "https://example.com/advice");
  assert.equal(anchors[0].getAttribute("target"), "_blank");
  assert.equal(anchors[0].getAttribute("rel"), "noopener noreferrer");
  assert.equal(safeAdviceSourceUrl("javascript:alert(1)"), null);
});

test("compiled fixtures preserve guide-only, conflict, and user-observation behavior", () => {
  const cave = formatSpotPlaybook({ id: "surfline-cave", adviceGuideOnly: true }, spotData);
  const ursa = formatSpotPlaybook({ id: "surfline-praia-da-ursa", adviceGuideOnly: true }, spotData);
  const supertubos = formatSpotPlaybook({ id: "surfline-supertubos", promoted: true }, spotData);
  const sesimbra = formatSpotPlaybook({ id: "surfline-sesimbra", promoted: true }, spotData);
  const snapshot = {
    fetchedAt: "2026-07-12T10:00:00Z", ageHours: 1, primarySwellHeightM: 1.7,
    primarySwellDirectionDeg: 280, windDirectionDeg: 20
  };

  assert.equal(cave.guideOnly, true);
  assert.equal(ursa.guideOnly, true);
  assert.match(cave.sections.flatMap((section) => section.claims).map((claim) => claim.summary).join(" "), /dangerous reef/i);
  assert.match(ursa.sections.flatMap((section) => section.claims).map((claim) => claim.summary).join(" "), /remote beach/i);
  assert.equal(selectLocalLens({ id: "surfline-supertubos", promoted: true }, spotData, snapshot, null, Date.parse("2026-07-12T11:00:00Z")), null);
  assert.equal(supertubos.conflicts.length, 1);
  assert.match(sesimbra.sections.flatMap((section) => section.claims).map((claim) => claim.summary).join(" "), /2 m primary swell/i);
});

test("Explore water summary uses the selected real spot, clears for a guide, and restores", () => {
  const monitorWaterSummary = { name: "monitor", textContent: "", hidden: true };
  const favoritesWaterSummary = { name: "favorites", textContent: "", hidden: true };
  const detailWaterSummary = { name: "detail", textContent: "", hidden: true };
  const calls = [];
  const context = {
    state: { selectedExploreCamera: { id: "real", adviceGuideOnly: false } },
    els: { monitorWaterSummary, favoritesWaterSummary, detailWaterSummary },
    renderWaterSummary(container, camera) {
      calls.push([container.name, camera?.id || "fallback"]);
      container.textContent = camera
        ? `Selected ${camera.id} · Sea 17°C · Tide rising`
        : "Favorite fallback · Sea 19°C · Tide falling";
      container.hidden = false;
    }
  };
  vm.runInNewContext(`${functionSource("renderWaterSummaries")}\nglobalThis.run = renderWaterSummaries;`, context);

  context.run();
  assert.equal(detailWaterSummary.hidden, false);
  assert.match(detailWaterSummary.textContent, /Selected real/);
  assert.doesNotMatch(detailWaterSummary.textContent, /Favorite fallback/);

  context.state.selectedExploreCamera = { id: "surfline-cave", adviceGuideOnly: true };
  context.run();
  assert.equal(detailWaterSummary.hidden, true);
  assert.equal(detailWaterSummary.textContent, "");
  assert.doesNotMatch(detailWaterSummary.textContent, /Sea|Tide|light/i);
  assert.match(monitorWaterSummary.textContent, /Favorite fallback/);
  assert.match(favoritesWaterSummary.textContent, /Favorite fallback/);

  context.state.selectedExploreCamera = { id: "real", adviceGuideOnly: false };
  context.run();
  assert.equal(detailWaterSummary.hidden, false);
  assert.match(detailWaterSummary.textContent, /Selected real/);
  assert.deepEqual(calls, [
    ["monitor", "fallback"], ["favorites", "fallback"], ["detail", "real"],
    ["monitor", "fallback"], ["favorites", "fallback"],
    ["monitor", "fallback"], ["favorites", "fallback"], ["detail", "real"]
  ]);
});

test("resolved live forecast refreshes conditions in place without closing or defocusing playbook", async () => {
  const sourceLink = { id: "source-link" };
  const body = { id: "body" };
  const playbook = { hidden: false };
  const document = { activeElement: sourceLink, body };
  const calls = [];
  const camera = { id: "camera" };
  const context = {
    document,
    state: {
      selectedExploreCamera: camera,
      liveForecastPending: new Set(),
      liveForecastCache: new Map()
    },
    getConditions: () => ({ source: "meo-static" }),
    fetchLiveForecast: async () => ({ fetchedAt: "2026-07-12T12:00:00Z", waveMinM: 1 }),
    renderExploreSelection() {
      calls.push("full-render");
      playbook.hidden = true;
      document.activeElement = body;
    },
    renderExploreConditions() {
      calls.push("conditions-only");
    }
  };
  vm.runInNewContext(`${functionSource("requestLiveForecastForSelection")}\nglobalThis.run = requestLiveForecastForSelection;`, context);

  context.run(camera);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(calls, ["conditions-only"]);
  assert.equal(playbook.hidden, false);
  assert.equal(document.activeElement, sourceLink);
  assert.equal(context.state.selectedExploreCamera, camera);
  assert.equal(context.state.liveForecastCache.has(camera.id), true);
  assert.equal(context.state.liveForecastPending.size, 0);
});

test("one advice scheduler updates persistent lens and expiry nodes in place without focus loss", () => {
  const slot = new FakeElement("p", { activeElement: null });
  slot.dataset.role = "local-lens";
  slot.dataset.cameraId = "camera";
  slot.hidden = true;
  const expiry = new FakeElement("span", { activeElement: null });
  expiry.dataset.revalidateAt = "120000";
  expiry.hidden = true;
  const sourceLink = { id: "source-link" };
  const document = {
    activeElement: sourceLink,
    querySelectorAll(selector) {
      if (selector.includes("local-lens")) return [slot];
      if (selector.includes("revalidate-at")) return [expiry];
      return [];
    }
  };
  const camera = { id: "camera" };
  let nowMs = 1_000;
  const timers = new Map();
  let nextTimerId = 1;
  const setTimer = (callback, delay) => {
    const id = nextTimerId++;
    timers.set(id, { callback, delay });
    return id;
  };
  const clearTimer = (id) => timers.delete(id);
  const context = {
    Date,
    document,
    state: { cameras: [camera], spotData: {}, tideData: {}, adviceRefreshTimerId: null, adviceRefreshGeneration: 0 },
    getConditions: () => ({ source: "fixture" }),
    findAdviceTideSnapshot: () => null,
    selectLocalLens(_camera, _spotData, _resolved, _tide, evaluatedAt) {
      if (evaluatedAt < 60_000) return null;
      if (evaluatedAt >= 180_000) return null;
      return { scopeLabel: "Spot advice", text: evaluatedAt < 120_000 ? "Target in 1m" : "Target now" };
    },
    window: { setTimeout: setTimer, clearTimeout: clearTimer }
  };
  const names = ["updateLocalLensSlot", "updateAdviceExpiryLabel", "refreshAdviceUiInPlace", "startAdviceRefreshScheduler"];
  vm.runInNewContext(`${names.map(functionSource).join("\n")}\nglobalThis.helpers = { refreshAdviceUiInPlace, startAdviceRefreshScheduler };`, context);

  const stopFirst = context.helpers.startAdviceRefreshScheduler({
    now: () => nowMs,
    setTimer,
    clearTimer,
    refresh: context.helpers.refreshAdviceUiInPlace
  });
  assert.equal(timers.size, 1);

  const stopSecond = context.helpers.startAdviceRefreshScheduler({
    now: () => nowMs,
    setTimer,
    clearTimer,
    refresh: context.helpers.refreshAdviceUiInPlace
  });
  assert.equal(timers.size, 1, "restarting replaces rather than accumulates timers");
  stopFirst();
  assert.equal(timers.size, 1, "an obsolete stopper cannot cancel the replacement generation");

  nowMs = 61_000;
  let [timerId, timer] = timers.entries().next().value;
  timers.delete(timerId);
  timer.callback();
  assert.equal(timers.size, 1);
  assert.equal(slot.hidden, false);
  assert.equal(slot.textContent, "Spot advice · Target in 1m");
  assert.equal(slot.children.length, 0);
  assert.equal(expiry.hidden, true);
  assert.equal(document.activeElement, sourceLink);

  nowMs = 121_000;
  [timerId, timer] = timers.entries().next().value;
  timers.delete(timerId);
  timer.callback();
  assert.equal(slot.textContent, "Spot advice · Target now");
  assert.equal(expiry.hidden, false);
  assert.equal(expiry.textContent, "Needs revalidation");
  assert.equal(document.activeElement, sourceLink);

  nowMs = 181_000;
  [timerId, timer] = timers.entries().next().value;
  timers.delete(timerId);
  timer.callback();
  assert.equal(slot.hidden, true, "stale or expired advice disappears without replacing its slot");
  assert.equal(slot.textContent, "");
  assert.equal(timers.size, 1);
  stopSecond();
  assert.equal(timers.size, 0);
});

test("advice presentation leaves legacy conditions and Favorites ordering unchanged", () => {
  assert.match(mainSource, /recommendationAdviceFor/);
  assert.match(mainSource, /recommendTodaySpots/);
  assert.doesNotMatch(mainSource, /rateSurfSpot\([^)]*(?:lens|advice|claim|playbook)/);
  assert.doesNotMatch(mainSource, /(?:waveMinM|waveMaxM|providerSpotSurfMinM|providerSpotSurfMaxM)\s*[+*]?=/);

  const cameras = [{ id: "far" }, { id: "near" }];
  const options = { getDriveDistanceKm: (camera) => camera.id === "near" ? 10 : 40 };
  const before = monitorCameraSlots(cameras, new Set(["far", "near"]), ["far", "near"], 2, options);
  const after = monitorCameraSlots(cameras.map((camera) => ({ ...camera, advice: { localLens: true } })), new Set(["far", "near"]), ["far", "near"], 2, options);
  assert.deepEqual(after.map((slot) => slot.camera.id), before.map((slot) => slot.camera.id));

  const camera = {
    id: "fixture", name: "Fixture", forecast: { wave: "1.0 m", wind: "8Km/h", windDirection: "north" },
    detailMetrics: { "Período das ondas": "10s", "Direção das ondas": "Noroeste" },
    surfMetadata: { coastExposure: { bearing: 270, confidence: "spot" } }
  };
  const emptySpotData = { conditionsById: new Map(), spotMetadataById: new Map(), advice: null };
  const populatedSpotData = { ...emptySpotData, advice: { subjectsById: new Map([["fixture", { id: "fixture" }]]) } };
  const emptyResolved = resolveConditions(camera, emptySpotData);
  const populatedResolved = resolveConditions(camera, populatedSpotData);
  assert.deepEqual(populatedResolved, emptyResolved);
  assert.deepEqual(
    rateSurfSpot(camera, DEFAULT_SURF_PREFERENCES, populatedResolved),
    rateSurfSpot(camera, DEFAULT_SURF_PREFERENCES, emptyResolved)
  );
});

test("Local lens and playbook styles preserve focus and mobile internal scrolling", () => {
  for (const selector of [".local-lens", ".spot-playbook-toggle", ".spot-playbook", ".advice-scope", ".advice-confidence", ".advice-source-list", ".advice-conflict", ".advice-expired"]) {
    assert.match(styleSource, new RegExp(selector.replace(".", "\\.")));
  }
  assert.match(styleSource, /\.spot-playbook-toggle:focus-visible/);
  assert.match(styleSource, /@media \(max-width: 900px\)[\s\S]*\.spot-playbook[\s\S]*max-height[\s\S]*overflow-y:\s*auto/);
});
