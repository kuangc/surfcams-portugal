import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dataDir = path.join(repoRoot, "data");
const docsDir = path.join(repoRoot, "docs");
const cacheDir = path.join(repoRoot, ".cache", "surfline", "pages");
const surflineDbPath = path.join(dataDir, "surfline-spots.json");
const meoDbPath = path.join(dataDir, "meo-spots.json");
const mappingDbPath = path.join(dataDir, "meo-surfline-matches.json");
const reviewJsonPath = path.join(dataDir, "surfline-mapping-review.json");
const reviewMarkdownPath = path.join(docsDir, "surfline-mapping-review.md");

const args = new Set(process.argv.slice(2));
const options = {
  refresh: args.has("--refresh"),
  offline: args.has("--offline")
};

function relativePath(absolutePath) {
  return path.relative(repoRoot, absolutePath);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function htmlDecode(value = "") {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\""
  };

  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith("#x")) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
    return named[lower] ?? match;
  });
}

function cleanHtmlText(value = "") {
  return htmlDecode(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractAttribute(tag, attributeName) {
  const pattern = new RegExp(`${attributeName}\\s*=\\s*["']([^"']+)["']`, "i");
  return tag.match(pattern)?.[1] ?? null;
}

function extractBody(html) {
  return html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
}

function normalizeCachedHtml(rawHtml) {
  const trimmed = rawHtml.trim();
  if (!trimmed.startsWith("\"")) return rawHtml;

  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === "string" ? parsed : rawHtml;
  } catch {
    return rawHtml;
  }
}

function extractPageTitle(html) {
  const body = extractBody(html);
  const h1 = body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) {
    const title = cleanHtmlText(h1[1]);
    if (title) return { extractedTitle: title, titleSource: "h1" };
  }

  const ogTitleTag = html.match(/<meta[^>]+property=["']og:title["'][^>]*>/i);
  if (ogTitleTag) {
    const title = cleanHtmlText(extractAttribute(ogTitleTag[0], "content") ?? "");
    if (title) return { extractedTitle: title, titleSource: "og:title" };
  }

  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleTag) {
    const title = cleanHtmlText(titleTag[1]);
    if (title) return { extractedTitle: title, titleSource: "title" };
  }

  return { extractedTitle: null, titleSource: "missing" };
}

async function readCacheMeta(metaPath) {
  try {
    return JSON.parse(await fs.readFile(metaPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function fetchSurflinePage(spot) {
  const response = await fetch(spot.url, {
    headers: {
      "accept": "text/html,application/xhtml+xml",
      "user-agent": "surfcams-portugal mapping review"
    }
  });
  const html = await response.text();

  if (!response.ok) {
    throw new Error(`Failed to fetch ${spot.id} (${spot.url}): HTTP ${response.status}`);
  }

  return {
    html,
    status: response.status,
    fetchedAt: new Date().toISOString()
  };
}

async function loadPage(spot) {
  const htmlPath = path.join(cacheDir, `${spot.id}.html`);
  const metaPath = path.join(cacheDir, `${spot.id}.json`);
  const meta = await readCacheMeta(metaPath);
  const cacheMatchesUrl = meta?.url === spot.url;

  if (!options.refresh && cacheMatchesUrl) {
    try {
      return {
        html: normalizeCachedHtml(await fs.readFile(htmlPath, "utf8")),
        status: meta.status,
        fetchedAt: meta.fetchedAt,
        cacheStatus: "cached",
        htmlPath,
        metaPath
      };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  if (!options.refresh) {
    try {
      return {
        html: normalizeCachedHtml(await fs.readFile(htmlPath, "utf8")),
        status: meta?.status ?? null,
        fetchedAt: meta?.fetchedAt ?? null,
        cacheStatus: meta ? "cached-url-mismatch" : "cached-html",
        htmlPath,
        metaPath
      };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  if (options.offline) {
    throw new Error(`Missing cache for ${spot.id}; rerun without --offline to fetch ${spot.url}`);
  }

  const fetched = await fetchSurflinePage(spot);
  await fs.writeFile(htmlPath, fetched.html);
  await fs.writeFile(
    metaPath,
    `${JSON.stringify({
      id: spot.id,
      url: spot.url,
      status: fetched.status,
      fetchedAt: fetched.fetchedAt
    }, null, 2)}\n`
  );

  return {
    ...fetched,
    cacheStatus: "fetched",
    htmlPath,
    metaPath
  };
}

function compareMappedMatches(a, b) {
  const aDistance = a.distanceKm ?? Number.POSITIVE_INFINITY;
  const bDistance = b.distanceKm ?? Number.POSITIVE_INFINITY;
  return aDistance - bDistance || a.matchRank - b.matchRank;
}

function buildMappingReview({ mappingDb, meoById, pageById }) {
  return mappingDb.matches.map((mapping) => {
    const meoSpot = meoById.get(mapping.meoSpotId);
    const surflineMatches = mapping.surflineSpotIds
      .map((surflineSpotId, index) => {
        const page = pageById.get(surflineSpotId);
        if (!page) return null;

        return {
          id: page.id,
          name: page.name,
          extractedTitle: page.extractedTitle,
          titleSource: page.titleSource,
          url: page.url,
          distanceKm: mapping.distancesKm?.[page.id] ?? null,
          matchRank: index + 1,
          cachePath: page.cachePath
        };
      })
      .filter(Boolean);

    return {
      meoSpotId: mapping.meoSpotId,
      meoName: meoSpot?.name ?? mapping.meoSpotId,
      meoUrl: meoSpot?.url ?? null,
      meoLat: meoSpot?.lat ?? null,
      meoLon: meoSpot?.lon ?? null,
      proposedCloseRule: mapping.proposedCloseRule,
      notes: mapping.notes,
      surflineMatches,
      sortedByDistanceForReview: [...surflineMatches].sort(compareMappedMatches)
    };
  });
}

function markdownLink(label, url) {
  return `[${label.replaceAll("|", "\\|")}](${url})`;
}

function buildMarkdown(review) {
  const lines = [
    "# Surfline Mapping Review",
    "",
    `Generated: ${review.generatedAt}`,
    "",
    "Raw HTML is cached locally under `.cache/surfline/pages/`; this Markdown file only stores extracted titles, URLs, and mapping notes.",
    "",
    "## Pages",
    "",
    "| ID | DB name | Extracted title | Source | Cache | URL |",
    "| --- | --- | --- | --- | --- | --- |"
  ];

  review.pages.forEach((page) => {
    lines.push([
      page.id,
      page.name,
      page.extractedTitle ?? "(missing)",
      page.titleSource,
      page.cacheStatus,
      markdownLink("open", page.url)
    ].join(" | "));
  });

  lines.push(
    "",
    "## MEO To Surfline",
    "",
    "| MEO spot | Surfline matches | Review sort | Notes |",
    "| --- | --- | --- | --- |"
  );

  review.mappings.forEach((mapping) => {
    const matches = mapping.surflineMatches
      .map((match) => `${match.matchRank}. ${markdownLink(match.extractedTitle ?? match.name, match.url)} (${match.distanceKm ?? "?"}km)`)
      .join("<br>");
    const reviewSort = mapping.sortedByDistanceForReview
      .map((match) => `${match.extractedTitle ?? match.name} (${match.distanceKm ?? "?"}km)`)
      .join("<br>");

    lines.push([
      markdownLink(mapping.meoName, mapping.meoUrl ?? "#"),
      matches,
      reviewSort,
      (mapping.notes ?? "").replaceAll("|", "\\|")
    ].join(" | "));
  });

  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const [surflineDb, meoDb, mappingDb] = await Promise.all([
    readJson(surflineDbPath),
    readJson(meoDbPath),
    readJson(mappingDbPath)
  ]);
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.mkdir(docsDir, { recursive: true });

  const pages = [];
  for (const spot of surflineDb.spots) {
    const page = await loadPage(spot);
    const title = extractPageTitle(page.html);
    pages.push({
      id: spot.id,
      provider: spot.provider,
      name: spot.name,
      url: spot.url,
      lat: spot.lat,
      lon: spot.lon,
      region: spot.region,
      country: spot.country,
      ...title,
      cachePath: relativePath(page.htmlPath),
      cacheMetaPath: relativePath(page.metaPath),
      cacheStatus: page.cacheStatus,
      httpStatus: page.status,
      fetchedAt: page.fetchedAt
    });
  }

  const pageById = new Map(pages.map((page) => [page.id, page]));
  const meoById = new Map(meoDb.spots.map((spot) => [spot.id, spot]));
  const generatedAt = new Date().toISOString();
  const review = {
    schemaVersion: 1,
    generatedAt,
    source: {
      surflineDb: relativePath(surflineDbPath),
      meoDb: relativePath(meoDbPath),
      mappingDb: relativePath(mappingDbPath),
      cacheRoot: relativePath(cacheDir)
    },
    pages,
    mappings: buildMappingReview({ mappingDb, meoById, pageById })
  };

  await fs.writeFile(reviewJsonPath, `${JSON.stringify(review, null, 2)}\n`);
  await fs.writeFile(reviewMarkdownPath, buildMarkdown(review));
  console.log(`Cached ${pages.length} Surfline pages and wrote ${relativePath(reviewJsonPath)} + ${relativePath(reviewMarkdownPath)}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
