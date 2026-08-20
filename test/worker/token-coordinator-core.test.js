import assert from "node:assert/strict";
import test from "node:test";

import { MEO_BROKER_TTL_MS } from "../../worker/meo-token.js";
import { TokenCoordinatorCore } from "../../worker/token-coordinator-core.js";

const STORAGE_KEY = "current-token";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function createStorage(initialValue) {
  const records = new Map();
  if (initialValue !== undefined) records.set(STORAGE_KEY, initialValue);
  const calls = { get: 0, put: 0, delete: 0 };
  return {
    calls,
    records,
    async get(key) {
      calls.get += 1;
      return records.get(key);
    },
    async put(key, value) {
      calls.put += 1;
      records.set(key, value);
    },
    async delete(key) {
      calls.delete += 1;
      return records.delete(key);
    }
  };
}

function createCoordinator({
  storage = createStorage(),
  timestamp = 1_000,
  fetchToken,
  revisions = ["revision-1", "revision-2", "revision-3"],
  createRevision
} = {}) {
  let currentTime = timestamp;
  let fetches = 0;
  let revisionIndex = 0;
  const coordinator = new TokenCoordinatorCore({
    storage,
    fetchToken: fetchToken ?? (async () => {
      fetches += 1;
      return `fixture-token-${fetches}`;
    }),
    now: () => currentTime,
    createRevision: createRevision ?? (() => revisions[revisionIndex++])
  });
  return {
    coordinator,
    storage,
    fetchCount: () => fetches,
    setNow(value) {
      currentTime = value;
    }
  };
}

test("first miss fetches once and stores one complete token record", async () => {
  const harness = createCoordinator();

  const record = await harness.coordinator.getToken();

  assert.deepEqual(record, {
    token: "fixture-token-1",
    revision: "revision-1",
    fetchedAt: 1_000,
    refreshAt: 1_000 + MEO_BROKER_TTL_MS
  });
  assert.deepEqual(harness.storage.records.get(STORAGE_KEY), record);
  assert.equal(harness.fetchCount(), 1);
  assert.equal(harness.storage.calls.put, 1);
  assert.equal(harness.storage.calls.delete, 0);
});

test("refresh boundary is exactly 72,000,000 ms and never slides on reads", async () => {
  assert.equal(MEO_BROKER_TTL_MS, 72_000_000);
  const harness = createCoordinator({ timestamp: 25_000 });
  const first = await harness.coordinator.getToken();

  harness.setNow(first.refreshAt - 1);
  const beforeBoundary = await harness.coordinator.getToken();
  harness.setNow(first.refreshAt);
  const atBoundary = await harness.coordinator.getToken();

  assert.equal(beforeBoundary === first, true);
  assert.equal(beforeBoundary.fetchedAt, 25_000);
  assert.equal(beforeBoundary.refreshAt, 25_000 + 72_000_000);
  assert.equal(atBoundary.revision, "revision-2");
  assert.equal(atBoundary.fetchedAt, first.refreshAt);
  assert.equal(atBoundary.refreshAt, first.refreshAt + 72_000_000);
  assert.equal(harness.fetchCount(), 2);
  assert.equal(harness.storage.calls.put, 2);
});

test("concurrent cache misses share one in-flight acquisition", async () => {
  const tokenResult = deferred();
  let fetches = 0;
  const harness = createCoordinator({
    fetchToken: async () => {
      fetches += 1;
      return tokenResult.promise;
    }
  });

  const firstPromise = harness.coordinator.getToken();
  const secondPromise = harness.coordinator.getToken();
  await Promise.resolve();
  assert.equal(fetches, 1);

  tokenResult.resolve("fixture-concurrent-token");
  const [first, second] = await Promise.all([firstPromise, secondPromise]);

  assert.equal(first === second, true);
  assert.equal(first.revision, "revision-1");
  assert.equal(harness.storage.calls.put, 1);
  assert.equal(harness.storage.calls.delete, 0);
});

test("refreshing the current revision fetches once and atomically overwrites", async () => {
  const harness = createCoordinator();
  const first = await harness.coordinator.getToken();

  const replacement = await harness.coordinator.refreshToken(first.revision);

  assert.equal(replacement.revision, "revision-2");
  assert.equal(harness.fetchCount(), 2);
  assert.equal(harness.storage.calls.put, 2);
  assert.equal(harness.storage.calls.delete, 0);
  assert.equal(harness.storage.records.get(STORAGE_KEY) === replacement, true);
});

test("refreshing a stale revision reuses the newer current record", async () => {
  const harness = createCoordinator();
  const first = await harness.coordinator.getToken();
  const second = await harness.coordinator.refreshToken(first.revision);

  const result = await harness.coordinator.refreshToken(first.revision);

  assert.equal(result === second, true);
  assert.equal(harness.fetchCount(), 2);
  assert.equal(harness.storage.calls.put, 2);
  assert.equal(harness.storage.calls.delete, 0);
});

test("concurrent conditional refreshes converge on one replacement revision", async () => {
  const tokenResult = deferred();
  let fetches = 0;
  const storage = createStorage({
    token: "fixture-prior-token",
    revision: "prior-revision",
    fetchedAt: 1_000,
    refreshAt: 1_000 + MEO_BROKER_TTL_MS
  });
  const harness = createCoordinator({
    storage,
    timestamp: 2_000,
    fetchToken: async () => {
      fetches += 1;
      return tokenResult.promise;
    }
  });

  const firstPromise = harness.coordinator.refreshToken("prior-revision");
  const secondPromise = harness.coordinator.refreshToken("prior-revision");
  await Promise.resolve();
  assert.equal(fetches, 1);

  tokenResult.resolve("fixture-replacement-token");
  const [first, second] = await Promise.all([firstPromise, secondPromise]);

  assert.equal(first === second, true);
  assert.equal(first.revision, "revision-1");
  assert.equal(storage.calls.put, 1);
  assert.equal(storage.calls.delete, 0);
});

test("blank and non-string revisions fail before storage or fetch access", async (t) => {
  for (const failedRevision of [undefined, null, 0, {}, "", "   "]) {
    await t.test(String(failedRevision), async () => {
      let fetches = 0;
      const storage = createStorage();
      const harness = createCoordinator({
        storage,
        fetchToken: async () => {
          fetches += 1;
          return "fixture-token";
        }
      });

      await assert.rejects(
        harness.coordinator.refreshToken(failedRevision),
        (error) => {
          assert.equal(error.name, "Error");
          assert.equal(error.message, "Token refresh unavailable");
          assert.equal(error.cause, undefined);
          return true;
        }
      );
      assert.deepEqual(storage.calls, { get: 0, put: 0, delete: 0 });
      assert.equal(fetches, 0);
    });
  }
});

test("failed forced refresh preserves the previous record and sanitizes failure", async () => {
  const sensitive = "fixture-secret-token-and-upstream-body";
  const previous = {
    token: "fixture-prior-token",
    revision: "prior-revision",
    fetchedAt: 1_000,
    refreshAt: 1_000 + MEO_BROKER_TTL_MS,
    nested: { preserve: "byte-for-byte" }
  };
  const before = JSON.stringify(previous);
  const storage = createStorage(previous);
  const harness = createCoordinator({
    storage,
    timestamp: 2_000,
    fetchToken: async () => {
      throw new Error(sensitive);
    }
  });

  await assert.rejects(
    harness.coordinator.refreshToken(previous.revision),
    (error) => {
      assert.equal(error.name, "Error");
      assert.equal(error.message, "Token acquisition unavailable");
      assert.equal(error.cause, undefined);
      assert.equal(`${error.stack}`.includes(sensitive), false);
      return true;
    }
  );

  assert.equal(JSON.stringify(storage.records.get(STORAGE_KEY)), before);
  assert.equal(storage.records.get(STORAGE_KEY) === previous, true);
  assert.equal(storage.calls.put, 0);
  assert.equal(storage.calls.delete, 0);
});

test("ordinary reads keep using a fresh prior record during forced replacement", async () => {
  const tokenResult = deferred();
  let fetches = 0;
  const previous = {
    token: "fixture-prior-token",
    revision: "prior-revision",
    fetchedAt: 1_000,
    refreshAt: 1_000 + MEO_BROKER_TTL_MS
  };
  const storage = createStorage(previous);
  const harness = createCoordinator({
    storage,
    timestamp: 2_000,
    fetchToken: async () => {
      fetches += 1;
      return tokenResult.promise;
    }
  });

  const replacementPromise = harness.coordinator.refreshToken(previous.revision);
  await Promise.resolve();
  const ordinaryRead = await harness.coordinator.getToken();
  const secondRefresh = harness.coordinator.refreshToken(previous.revision);

  assert.equal(ordinaryRead === previous, true);
  assert.equal(fetches, 1);
  tokenResult.resolve("fixture-new-token");
  const [replacement, sharedReplacement] = await Promise.all([
    replacementPromise,
    secondRefresh
  ]);
  assert.equal(replacement === sharedReplacement, true);
  assert.equal(replacement.revision, "revision-1");
  assert.equal(storage.calls.put, 1);
  assert.equal(storage.calls.delete, 0);
});

test("ordinary reads share in-flight acquisition when no fresh prior exists", async () => {
  const tokenResult = deferred();
  let fetches = 0;
  const stale = {
    token: "fixture-stale-token",
    revision: "stale-revision",
    fetchedAt: 1_000,
    refreshAt: 1_000 + MEO_BROKER_TTL_MS
  };
  const storage = createStorage(stale);
  const harness = createCoordinator({
    storage,
    timestamp: stale.refreshAt,
    fetchToken: async () => {
      fetches += 1;
      return tokenResult.promise;
    }
  });

  const forcedRefresh = harness.coordinator.refreshToken(stale.revision);
  await Promise.resolve();
  const ordinaryRead = harness.coordinator.getToken();
  assert.equal(fetches, 1);

  tokenResult.resolve("fixture-replacement-token");
  const [replacement, sharedResult] = await Promise.all([
    forcedRefresh,
    ordinaryRead
  ]);

  assert.equal(replacement === sharedResult, true);
  assert.equal(storage.calls.put, 1);
  assert.equal(storage.calls.delete, 0);
});

test("every refresh caller joins a forced replacement already in flight", async () => {
  const tokenResult = deferred();
  let fetches = 0;
  const previous = {
    token: "fixture-prior-token",
    revision: "revision-1",
    fetchedAt: 1_000,
    refreshAt: 1_000 + MEO_BROKER_TTL_MS
  };
  const storage = createStorage(previous);
  const harness = createCoordinator({
    storage,
    timestamp: 2_000,
    revisions: ["revision-2"],
    fetchToken: async () => {
      fetches += 1;
      return tokenResult.promise;
    }
  });

  const currentRevisionRefresh = harness.coordinator.refreshToken("revision-1");
  await Promise.resolve();
  const differentStaleRevisionRefresh = harness.coordinator.refreshToken("revision-0");
  assert.equal(fetches, 1);

  tokenResult.resolve("fixture-new-token");
  const [first, second] = await Promise.all([
    currentRevisionRefresh,
    differentStaleRevisionRefresh
  ]);

  assert.equal(first === second, true);
  assert.equal(first.revision, "revision-2");
  assert.equal(storage.calls.put, 1);
  assert.equal(storage.calls.delete, 0);
});

test("invalid persisted records are never reused as fresh", async (t) => {
  const base = {
    token: "fixture-prior-token",
    revision: "revision-1",
    fetchedAt: 1_000,
    refreshAt: 1_000 + MEO_BROKER_TTL_MS
  };
  const invalidRecords = [
    { label: "control token", value: { ...base, token: "token\u0085value" } },
    { label: "control revision", value: { ...base, revision: "revision\u0085value" } },
    { label: "oversized revision", value: { ...base, revision: "r".repeat(257) } },
    { label: "non-finite fetchedAt", value: { ...base, fetchedAt: Number.NaN } },
    { label: "non-finite refreshAt", value: { ...base, refreshAt: Number.POSITIVE_INFINITY } },
    { label: "wrong refresh boundary", value: { ...base, refreshAt: base.refreshAt + 1 } }
  ];

  for (const { label, value } of invalidRecords) {
    await t.test(label, async () => {
      const storage = createStorage(value);
      const harness = createCoordinator({
        storage,
        timestamp: 2_000,
        revisions: ["revision-2"]
      });

      const replacement = await harness.coordinator.getToken();

      assert.equal(replacement.revision, "revision-2");
      assert.equal(replacement === value, false);
      assert.equal(harness.fetchCount(), 1);
      assert.equal(storage.calls.put, 1);
      assert.equal(storage.calls.delete, 0);
    });
  }
});

test("invalid acquisition candidates never overwrite storage", async (t) => {
  const prior = {
    token: "fixture-prior-token",
    revision: "prior-revision",
    fetchedAt: 1_000,
    refreshAt: 1_000 + MEO_BROKER_TTL_MS
  };
  const cases = [
    {
      label: "blank revision",
      options: { revisions: ["   "] }
    },
    {
      label: "control revision",
      options: { revisions: ["revision\u0085value"] }
    },
    {
      label: "oversized revision",
      options: { revisions: ["r".repeat(257)] }
    },
    {
      label: "repeated current revision",
      options: { revisions: [prior.revision] }
    },
    {
      label: "non-finite fetchedAt",
      options: { timestamp: Number.NaN }
    },
    {
      label: "invalid token",
      options: { fetchToken: async () => "token\u0085value" }
    }
  ];

  for (const { label, options } of cases) {
    await t.test(label, async () => {
      const storage = createStorage(prior);
      const harness = createCoordinator({ storage, ...options });
      const before = JSON.stringify(storage.records.get(STORAGE_KEY));

      await assert.rejects(
        harness.coordinator.refreshToken(prior.revision),
        (error) => {
          assert.equal(error.name, "Error");
          assert.equal(error.message, "Token acquisition unavailable");
          assert.equal(error.cause, undefined);
          return true;
        }
      );

      assert.equal(JSON.stringify(storage.records.get(STORAGE_KEY)), before);
      assert.equal(storage.records.get(STORAGE_KEY) === prior, true);
      assert.equal(storage.calls.put, 0);
      assert.equal(storage.calls.delete, 0);
    });
  }
});

test("createRevision and storage failures are sanitized without losing prior storage", async (t) => {
  const sensitive = "fixture-secret-token-or-upstream-body";
  const prior = {
    token: "fixture-prior-token",
    revision: "prior-revision",
    fetchedAt: 1_000,
    refreshAt: 1_000 + MEO_BROKER_TTL_MS
  };

  await t.test("createRevision", async () => {
    const storage = createStorage(prior);
    const harness = createCoordinator({
      storage,
      timestamp: 2_000,
      createRevision: () => {
        throw new Error(sensitive);
      }
    });

    await assert.rejects(
      harness.coordinator.refreshToken(prior.revision),
      (error) => {
        assert.equal(error.message, "Token acquisition unavailable");
        assert.equal(error.cause, undefined);
        assert.equal(`${error.stack}`.includes(sensitive), false);
        return true;
      }
    );
    assert.equal(storage.records.get(STORAGE_KEY) === prior, true);
    assert.equal(storage.calls.put, 0);
    assert.equal(storage.calls.delete, 0);
  });

  await t.test("storage.put", async () => {
    const storage = createStorage(prior);
    storage.put = async () => {
      storage.calls.put += 1;
      throw new Error(sensitive);
    };
    const harness = createCoordinator({ storage, timestamp: 2_000 });

    await assert.rejects(
      harness.coordinator.refreshToken(prior.revision),
      (error) => {
        assert.equal(error.message, "Token acquisition unavailable");
        assert.equal(error.cause, undefined);
        assert.equal(`${error.stack}`.includes(sensitive), false);
        return true;
      }
    );
    assert.equal(storage.records.get(STORAGE_KEY) === prior, true);
    assert.equal(storage.calls.put, 1);
    assert.equal(storage.calls.delete, 0);
  });
});
