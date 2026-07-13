const REUSE_MS = 60 * 60 * 1000;

function coordinateKey(camera) {
  if (!Number.isFinite(camera?.lat) || !Number.isFinite(camera?.lon)) return null;
  return `${camera.lat},${camera.lon}`;
}

export function createTodayForecastStore({
  fetchForecast,
  now = () => Date.now(),
  concurrency = 6
} = {}) {
  if (typeof fetchForecast !== "function") throw new TypeError("fetchForecast is required");
  const limit = Math.max(1, Math.floor(Number(concurrency) || 1));
  const entriesByCoordinate = new Map();
  const coordinateByCameraId = new Map();
  const listeners = new Set();
  let generation = 0;

  function notify(update) {
    for (const listener of listeners) {
      try {
        listener(Object.freeze(update));
      } catch {
        // Rendering subscribers must not interrupt forecast loading.
      }
    }
  }

  function entryFor(camera) {
    const key = coordinateByCameraId.get(camera?.id) || coordinateKey(camera);
    return key ? entriesByCoordinate.get(key) : null;
  }

  async function load(cameras = []) {
    const loadGeneration = generation += 1;
    const groups = new Map();
    for (const camera of cameras) {
      const key = coordinateKey(camera);
      if (!key) continue;
      coordinateByCameraId.set(camera.id, key);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(camera);
    }

    const currentNow = Number(now());
    const queue = [];
    for (const [key, aliases] of groups) {
      const existing = entriesByCoordinate.get(key);
      const reusable = existing?.status === "ready"
        && Number.isFinite(existing.loadedAt)
        && currentNow - existing.loadedAt >= 0
        && currentNow - existing.loadedAt < REUSE_MS;
      if (reusable) continue;
      entriesByCoordinate.set(key, { status: "loading", payload: null, loadedAt: null, error: null });
      notify({ status: "loading", cameraIds: aliases.map((camera) => camera.id) });
      queue.push({ key, aliases, camera: aliases[0] });
    }

    let nextIndex = 0;
    async function worker() {
      while (nextIndex < queue.length) {
        const item = queue[nextIndex];
        nextIndex += 1;
        try {
          const payload = await fetchForecast(item.camera);
          if (!payload) throw new Error("Forecast provider returned no data");
          if (generation === loadGeneration) {
            entriesByCoordinate.set(item.key, {
              status: "ready",
              payload,
              loadedAt: Number(now()),
              error: null
            });
            notify({ status: "ready", cameraIds: item.aliases.map((camera) => camera.id) });
          }
        } catch (error) {
          if (generation === loadGeneration) {
            entriesByCoordinate.set(item.key, {
              status: "error",
              payload: null,
              loadedAt: Number(now()),
              error
            });
            notify({ status: "error", cameraIds: item.aliases.map((camera) => camera.id) });
          }
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, () => worker()));

    let ready = 0;
    let failed = 0;
    for (const camera of cameras) {
      const status = api.status(camera);
      if (status === "ready") ready += 1;
      if (status === "error") failed += 1;
    }
    return { ready, failed };
  }

  const api = {
    load,
    get(camera) {
      const entry = entryFor(camera);
      return entry?.status === "ready" ? entry.payload : null;
    },
    status(camera) {
      return entryFor(camera)?.status || "idle";
    },
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("listener must be a function");
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    clear() {
      generation += 1;
      entriesByCoordinate.clear();
      coordinateByCameraId.clear();
    }
  };

  return Object.freeze(api);
}
