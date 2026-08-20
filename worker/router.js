import { requireAccessJwt } from "./access-jwt.js";
import { handlePlaybackApi } from "./playback-api.js";

export function createWorker({
  authenticate = requireAccessJwt,
  playbackApi = handlePlaybackApi
} = {}) {
  return {
    async fetch(request, env) {
      const path = new URL(request.url).pathname;
      if (path === "/api" || path.startsWith("/api/")) {
        try {
          await authenticate(request, env);
        } catch {
          return Response.json(
            { error: "Access denied" },
            {
              status: 403,
              headers: {
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff"
              }
            }
          );
        }
        return playbackApi(request, env);
      }
      return env.ASSETS.fetch(request);
    }
  };
}
