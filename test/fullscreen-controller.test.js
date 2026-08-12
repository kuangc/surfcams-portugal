import assert from "node:assert/strict";
import test from "node:test";

import { createFullscreenController } from "../src/fullscreen-controller.js";

function createDocumentStub({ fullscreenEnabled = true } = {}) {
  const listeners = new Map();

  return {
    fullscreenEnabled,
    fullscreenElement: null,
    exitCalls: 0,
    exitFullscreen() {
      this.exitCalls += 1;
      return Promise.resolve();
    },
    addEventListener(type, listener) {
      const typeListeners = listeners.get(type) || new Set();
      typeListeners.add(listener);
      listeners.set(type, typeListeners);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type) {
      [...(listeners.get(type) || [])].forEach((listener) => listener());
    },
    listenerCount(type) {
      return listeners.get(type)?.size || 0;
    }
  };
}

function createTargetStub() {
  return {
    requestCalls: 0,
    requestFullscreen() {
      this.requestCalls += 1;
      return Promise.resolve();
    }
  };
}

test("unsupported fullscreen reports an unavailable state and performs no request", async () => {
  const document = createDocumentStub({ fullscreenEnabled: false });
  const target = createTargetStub();
  const states = [];
  const controller = createFullscreenController({
    target,
    document,
    onStateChange: (state) => states.push(state)
  });

  assert.deepEqual(states, [{
    supported: false,
    active: false,
    label: "Fullscreen unavailable"
  }]);
  assert.equal(await controller.toggle(), false);
  assert.equal(target.requestCalls, 0);
  assert.equal(document.exitCalls, 0);
});

test("enter calls requestFullscreen directly on the complete composition target", async () => {
  const document = createDocumentStub();
  let requestedTarget = null;
  const target = createTargetStub();
  target.requestFullscreen = function requestFullscreen() {
    requestedTarget = this;
    this.requestCalls += 1;
    return Promise.resolve();
  };
  const controller = createFullscreenController({ target, document });

  const request = controller.enter();

  assert.equal(target.requestCalls, 1, "request happens in the user-call stack");
  assert.equal(requestedTarget, target);
  assert.equal(await request, true);
});

test("toggle exits an active composition through document.exitFullscreen", async () => {
  const document = createDocumentStub();
  const target = createTargetStub();
  document.fullscreenElement = target;
  const controller = createFullscreenController({ target, document });

  const request = controller.toggle();

  assert.equal(document.exitCalls, 1, "exit happens in the user-call stack");
  assert.equal(target.requestCalls, 0);
  assert.equal(await request, true);
});

test("request and exit rejection are reported without optimistic state changes", async () => {
  for (const operation of ["request", "exit"]) {
    const document = createDocumentStub();
    const target = createTargetStub();
    const failure = new Error(`${operation} rejected`);
    const errors = [];
    const states = [];
    const monitorState = { route: "monitor", mode: "favorites" };

    if (operation === "request") {
      target.requestFullscreen = () => Promise.reject(failure);
    } else {
      document.fullscreenElement = target;
      document.exitFullscreen = () => Promise.reject(failure);
    }

    const controller = createFullscreenController({
      target,
      document,
      onStateChange: (state) => states.push(state),
      onError: (error) => errors.push(error)
    });
    const initialState = structuredClone(monitorState);

    assert.equal(await controller.toggle(), false);
    assert.deepEqual(errors, [failure]);
    assert.equal(states.length, 1, "rejection does not fake a fullscreenchange");
    assert.deepEqual(monitorState, initialState, "external Monitor state remains untouched");
  }
});

test("fullscreenchange synchronizes active state and button labels", () => {
  const document = createDocumentStub();
  const target = createTargetStub();
  const states = [];
  const controller = createFullscreenController({
    target,
    document,
    onStateChange: (state) => states.push(state)
  });

  document.fullscreenElement = target;
  document.dispatch("fullscreenchange");
  assert.equal(controller.isFullscreen(), true);

  document.fullscreenElement = null;
  document.dispatch("fullscreenchange");
  assert.equal(controller.isFullscreen(), false);

  assert.deepEqual(states, [
    { supported: true, active: false, label: "Enter fullscreen" },
    { supported: true, active: true, label: "Exit fullscreen" },
    { supported: true, active: false, label: "Enter fullscreen" }
  ]);
});

test("destroy removes the fullscreenchange listener", () => {
  const document = createDocumentStub();
  const target = createTargetStub();
  const states = [];
  const controller = createFullscreenController({
    target,
    document,
    onStateChange: (state) => states.push(state)
  });

  assert.equal(document.listenerCount("fullscreenchange"), 1);
  controller.destroy();
  assert.equal(document.listenerCount("fullscreenchange"), 0);

  document.fullscreenElement = target;
  document.dispatch("fullscreenchange");
  assert.equal(states.length, 1);
});
