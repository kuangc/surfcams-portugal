import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { afterEach, test, vi } from "vitest";

afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});

test("one named coordinator persists and conditionally replaces a global revision", async ({ expect }) => {
  let tokenSequence = 0;
  const upstream = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    if (request.url !== "https://beachcam.meo.pt/api/video-token") {
      throw new Error("Unexpected outbound request");
    }
    tokenSequence += 1;
    return new Response(`fixture-token-${tokenSequence}`, {
      status: 200,
      headers: { "Content-Type": "text/plain" }
    });
  });

  const firstStub = env.MEO_TOKEN_COORDINATOR.getByName("global");
  let firstRecord;
  {
    const [first, concurrent] = await Promise.all([
      firstStub.getToken(),
      firstStub.getToken()
    ]);
    try {
      expect(first.revision === concurrent.revision).toBe(true);
      expect(first.token === concurrent.token).toBe(true);
      firstRecord = {
        token: first.token,
        revision: first.revision
      };
    } finally {
      first[Symbol.dispose]();
      concurrent[Symbol.dispose]();
    }
  }
  expect(upstream).toHaveBeenCalledTimes(1);

  const secondStub = env.MEO_TOKEN_COORDINATOR.getByName("global");
  {
    using persisted = await secondStub.getToken();
    expect(persisted.revision === firstRecord.revision).toBe(true);
    expect(persisted.token === firstRecord.token).toBe(true);
    expect(upstream).toHaveBeenCalledTimes(1);
  }

  let replacementRecord;
  {
    using replacement = await secondStub.refreshToken(firstRecord.revision);
    expect(replacement.revision === firstRecord.revision).toBe(false);
    expect(replacement.token === firstRecord.token).toBe(false);
    replacementRecord = {
      token: replacement.token,
      revision: replacement.revision
    };
    expect(upstream).toHaveBeenCalledTimes(2);
  }

  {
    using staleRefresh = await firstStub.refreshToken(firstRecord.revision);
    expect(staleRefresh.revision === replacementRecord.revision).toBe(true);
    expect(staleRefresh.token === replacementRecord.token).toBe(true);
  }
  expect(upstream).toHaveBeenCalledTimes(2);
});
