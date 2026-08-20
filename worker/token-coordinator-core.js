import {
  fetchMeoToken,
  MEO_BROKER_TTL_MS,
  validateMeoToken
} from "./meo-token.js";

const STORAGE_KEY = "current-token";
const MAX_REVISION_BYTES = 256;
const textEncoder = new TextEncoder();

function acquisitionUnavailable() {
  return new Error("Token acquisition unavailable");
}

function refreshUnavailable() {
  return new Error("Token refresh unavailable");
}

function isValidRevision(revision) {
  return Boolean(
    typeof revision === "string"
    && revision.trim()
    && revision.length <= MAX_REVISION_BYTES
    && textEncoder.encode(revision).byteLength <= MAX_REVISION_BYTES
    && !/\p{Cc}/u.test(revision)
  );
}

function isNonblankRevision(revision) {
  return typeof revision === "string" && Boolean(revision.trim());
}

function isValidStoredToken(token) {
  try {
    return validateMeoToken(token) === token;
  } catch {
    return false;
  }
}

export class TokenCoordinatorCore {
  constructor({
    storage,
    fetchToken = fetchMeoToken,
    now = () => Date.now(),
    createRevision = () => crypto.randomUUID()
  }) {
    this.storage = storage;
    this.fetchToken = fetchToken;
    this.now = now;
    this.createRevision = createRevision;
    this.inFlight = null;
    this.generation = 0;
  }

  isFresh(record, timestamp) {
    return Boolean(
      record
      && isValidStoredToken(record.token)
      && isValidRevision(record.revision)
      && Number.isFinite(record.fetchedAt)
      && Number.isFinite(record.refreshAt)
      && record.refreshAt === record.fetchedAt + MEO_BROKER_TTL_MS
      && record.fetchedAt <= timestamp
      && timestamp < record.refreshAt
    );
  }

  async acquire(excludedRevisions = []) {
    if (this.inFlight) return this.inFlight;
    const operation = (async () => {
      try {
        const token = validateMeoToken(await this.fetchToken());
        const fetchedAt = this.now();
        const revision = this.createRevision();
        const refreshAt = fetchedAt + MEO_BROKER_TTL_MS;
        if (
          !isValidRevision(revision)
          || excludedRevisions.includes(revision)
          || !Number.isFinite(fetchedAt)
          || !Number.isFinite(refreshAt)
        ) {
          throw acquisitionUnavailable();
        }
        const record = {
          token,
          revision,
          fetchedAt,
          refreshAt
        };
        await this.storage.put(STORAGE_KEY, record);
        this.generation += 1;
        return record;
      } catch {
        throw acquisitionUnavailable();
      }
    })();
    this.inFlight = operation;
    try {
      return await operation;
    } finally {
      if (this.inFlight === operation) this.inFlight = null;
    }
  }

  async getToken() {
    while (true) {
      const generation = this.generation;
      const record = await this.storage.get(STORAGE_KEY);
      if (generation !== this.generation) continue;
      if (this.isFresh(record, this.now())) return record;
      if (this.inFlight) return this.inFlight;
      return this.acquire([record?.revision]);
    }
  }

  async refreshToken(failedRevision) {
    if (!isNonblankRevision(failedRevision)) {
      throw refreshUnavailable();
    }
    while (true) {
      if (this.inFlight) return this.inFlight;
      const generation = this.generation;
      const record = await this.storage.get(STORAGE_KEY);
      if (generation !== this.generation) continue;
      if (this.inFlight) return this.inFlight;
      if (
        this.isFresh(record, this.now())
        && record.revision !== failedRevision
      ) {
        return record;
      }
      return this.acquire([record?.revision, failedRevision]);
    }
  }
}
