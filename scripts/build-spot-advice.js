import fs from "node:fs";

import { DEFAULT_FAVORITE_IDS } from "../src/config.js";
import { canonicalJson, compileSpotAdvice } from "./lib/spot-advice-build.js";

const OUTPUT_PATH = "data/spot-advice-resolved.json";
const readJson = (path) => JSON.parse(fs.readFileSync(path, "utf8"));

const document = readJson("data/spot-advice.json");
const context = {
  promotions: readJson("data/surfline-promotions.json"),
  surflineSpots: readJson("data/surfline-spots.json"),
  stretches: readJson("data/stretches.json"),
  promotedDb: readJson("data/promoted-spots.json"),
  enrichmentDb: readJson("data/spot-metadata-enrichment.json"),
  defaultFavoriteIds: DEFAULT_FAVORITE_IDS
};
const expected = canonicalJson(compileSpotAdvice(document, context));
const current = fs.existsSync(OUTPUT_PATH) ? fs.readFileSync(OUTPUT_PATH, "utf8") : null;

if (process.argv.includes("--check")) {
  if (current !== expected) {
    console.error(`${OUTPUT_PATH} is stale; run npm run build-spot-advice`);
    process.exitCode = 1;
  }
} else if (current !== expected) {
  fs.writeFileSync(OUTPUT_PATH, expected);
  console.log(`Wrote ${OUTPUT_PATH}`);
}
