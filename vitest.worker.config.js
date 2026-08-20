import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          ACCESS_TEAM_DOMAIN: "https://family.cloudflareaccess.com",
          ACCESS_AUD: "surfcams-access-audience"
        }
      }
    })
  ],
  test: {
    include: ["test/workerd/**/*.test.js"]
  }
});
