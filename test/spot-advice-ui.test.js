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
  const bodyStart = mainSource.indexOf("{", start);
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
  vm.runInNewContext(`${functionSource("renderLocalLens")}\nglobalThis.run = renderLocalLens;`, context);
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
  for (const surface of ["createMonitorTile", "createFavoriteCard", "renderExploreSelection"]) {
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
  assert.equal(omitted.result, null);
  assert.equal(omitted.container.children.length, 0);
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
  assert.match(mainSource, /target = "_blank"/);
  assert.match(mainSource, /rel = "noopener noreferrer"/);
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

test("advice UI remains display-only and monitor ordering remains byte-equivalent", () => {
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
