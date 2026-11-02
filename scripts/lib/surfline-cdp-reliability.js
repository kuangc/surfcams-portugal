export async function waitForHydratedReport({ readState, sleep, maxAttempts = 30, intervalMs = 3000 }) {
  let state = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      state = await readState();
    } catch (error) {
      // Chrome may replace the execution context while the report navigates.
      if (!/Execution context was destroyed|Cannot find context with specified id/i.test(error.message)) throw error;
    }
    if (state?.hasNextData && !/just a moment/i.test(state.title || "")) return state;
    if (attempt < maxAttempts - 1) await sleep(intervalMs);
  }
  throw new Error(`Surfline report did not hydrate after ${maxAttempts} checks (title: ${JSON.stringify(state?.title || "")}).`);
}

export async function fetchValidatedPages({ spots, fetchBatch, validate, sleep, retryDelayMs = 15000 }) {
  const pages = [];
  let pending = spots;
  let failures = [];

  for (let attempt = 0; attempt < 2 && pending.length; attempt += 1) {
    const fetched = await fetchBatch(pending);
    const nextPending = [];
    failures = [];
    for (const spot of pending) {
      const page = fetched.find((item) => item.id === spot.id);
      const error = page ? validate(page) : "missing browser response";
      if (error) {
        nextPending.push(spot);
        failures.push(`${spot.id}: ${error}`);
      } else {
        pages.push(page);
      }
    }
    pending = nextPending;
    if (pending.length && attempt === 0) await sleep(retryDelayMs);
  }

  return { pages, failures };
}
