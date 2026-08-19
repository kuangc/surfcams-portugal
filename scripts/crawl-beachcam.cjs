#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");

const ROOT = path.resolve(__dirname, "..");
const CACHE_DIR = path.join(ROOT, ".cache", "beachcam");
const OUTPUT_PATH = path.join(ROOT, "data", "beachcam-cameras.json");
const LISTING_URL = "https://beachcam.meo.pt/livecams/";
const CONCURRENCY = 4;

const NAMED_ENTITIES = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: "\""
};

function decodeEntities(value) {
  return String(value || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
    }
    if (lower.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, lower) ? NAMED_ENTITIES[lower] : match;
  });
}

function stripTags(value) {
  return decodeEntities(String(value || ""))
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeIdentityText(value) {
  return stripTags(value).replace(/\s*\|\s*/g, " | ");
}

function attrsFromTag(tag) {
  const attrs = {};
  const attrPattern = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = attrPattern.exec(tag))) {
    attrs[match[1]] = decodeEntities(match[2] ?? match[3] ?? "");
  }
  return attrs;
}

function firstMatch(value, pattern) {
  const match = pattern.exec(value);
  return match ? match[1] : "";
}

function absoluteUrl(url, base = LISTING_URL) {
  if (!url) return "";
  return new URL(decodeEntities(url), base).toString();
}

function slugFromUrl(url) {
  const parsed = new URL(url);
  const parts = parsed.pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] || "livecams";
}

function cacheNameForUrl(url) {
  return `${slugFromUrl(url)}.html`;
}

function normalizeForecastLabel(label) {
  const lower = label.toLowerCase();
  if (lower.includes("ondul")) return "wave";
  if (lower.includes("mar")) return "tide";
  if (lower.includes("vento")) return "wind";
  return lower.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function parseListingForecast(itemHtml) {
  const forecast = {};
  const detailPattern = /<span\b[^>]*class="[^"]*liveCamsGrid__list-item-details-col[^"]*"[^>]*>([\s\S]*?)<\/span>/gi;
  let detailMatch;
  while ((detailMatch = detailPattern.exec(itemHtml))) {
    const block = detailMatch[1];
    const label = stripTags(firstMatch(block, /<p[^>]*>([\s\S]*?)<\/p>/i));
    const valueBlock = firstMatch(block, /<strong[^>]*>([\s\S]*?)<\/strong>/i);
    const value = stripTags(valueBlock);
    const iconAlt = stripTags(firstMatch(valueBlock, /<img\b[^>]*alt=(?:"([^"]*)"|'([^']*)')/i));
    const key = normalizeForecastLabel(label);

    if (key && value) forecast[key] = value;
    if (key === "tide" && iconAlt) forecast.tideState = iconAlt;
    if (key === "wind" && iconAlt) forecast.windDirection = iconAlt;
  }
  return forecast;
}

function parseListing(html) {
  const items = [];
  const itemPattern = /<li\b[^>]*class="[^"]*liveCamsGrid__list-item[^"]*"[^>]*>[\s\S]*?<\/li>/gi;
  let match;

  while ((match = itemPattern.exec(html))) {
    const itemHtml = match[0];
    const itemTag = firstMatch(itemHtml, /^(<li\b[^>]*>)/i);
    const attrs = attrsFromTag(itemTag);
    const linkTag = firstMatch(itemHtml, /(<a\b[^>]*class="[^"]*liveCamsGrid__list-item-link[^"]*"[^>]*>)/i);
    const linkAttrs = attrsFromTag(linkTag);
    const pageUrl = absoluteUrl(linkAttrs.href);

    if (!pageUrl) continue;

    const name = normalizeIdentityText(firstMatch(itemHtml, /<p\b[^>]*class="[^"]*liveCamsGrid__list-item-name[^"]*"[^>]*>([\s\S]*?)<\/p>/i));
    const location = stripTags(firstMatch(itemHtml, /<label\b[^>]*class="[^"]*liveCamsGrid__list-item-location[^"]*"[^>]*>([\s\S]*?)<\/label>/i));

    items.push({
      id: slugFromUrl(pageUrl),
      name: name || normalizeIdentityText(attrs["data-name"]) || slugFromUrl(pageUrl),
      location,
      region: stripTags(attrs["data-region"]),
      pageUrl,
      lat: Number.parseFloat(attrs["data-lat"]),
      lon: Number.parseFloat(attrs["data-lon"]),
      clicks: Number.parseInt(attrs["data-clicks"] || "0", 10),
      isMulti: /liveCamsGrid__(?:feature--multicam|list-item-cam)/i.test(itemHtml),
      forecast: parseListingForecast(itemHtml)
    });
  }

  return items;
}

function metaContent(html, key) {
  const propertyPattern = new RegExp(`(<meta\\b[^>]*(?:property|name)=["']${key}["'][^>]*>)`, "i");
  const tag = firstMatch(html, propertyPattern);
  if (!tag) return "";
  return attrsFromTag(tag).content || "";
}

function parseDetailMetrics(html) {
  const metrics = {};
  const listPattern = /<li\b[^>]*class="[^"]*liveCamsHeader__infoList-item[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  let match;
  while ((match = listPattern.exec(html))) {
    const block = match[1];
    const label = stripTags(firstMatch(block, /<label[^>]*>([\s\S]*?)<\/label>/i));
    const value = stripTags(firstMatch(block, /<p[^>]*>([\s\S]*?)<\/p>/i));
    if (label && value) metrics[label] = value;
  }
  return metrics;
}

function parseDetail(html, pageUrl) {
  const livecamTag = firstMatch(html, /(<[^>]+data-control=["']livecam["'][^>]*>)/i);
  const livecamAttrs = attrsFromTag(livecamTag);
  const headerTag = firstMatch(html, /(<section\b[^>]*class="[^"]*liveCamsHeader[^"]*"[^>]*>)/i);
  const headerAttrs = attrsFromTag(headerTag);
  const ogImage = metaContent(html, "og:image");

  return {
    name: normalizeIdentityText(headerAttrs["data-name"] || metaContent(html, "og:title")),
    livecamId: stripTags(headerAttrs["data-livecam-id"]),
    streamUrl: absoluteUrl(livecamAttrs["data-video-url"] || "", pageUrl),
    videoId: livecamAttrs["data-video-id"] || "",
    image: absoluteUrl(ogImage, pageUrl),
    description: metaContent(html, "description") || metaContent(html, "og:description") || "",
    detailMetrics: parseDetailMetrics(html)
  };
}

function fetchText(url, redirectCount = 0) {
  if (redirectCount > 5) {
    return Promise.reject(new Error(`Too many redirects for ${url}`));
  }

  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === "http:" ? http : https;
    const request = client.get(
      parsedUrl,
      {
        headers: {
          "User-Agent": "surfcams-portugal/0.1"
        }
      },
      (response) => {
        const status = response.statusCode || 0;
        const location = response.headers.location;

        if (status >= 300 && status < 400 && location) {
          response.resume();
          resolve(fetchText(new URL(location, parsedUrl).toString(), redirectCount + 1));
          return;
        }

        if (status < 200 || status >= 300) {
          response.resume();
          reject(new Error(`HTTP ${status} for ${url}`));
          return;
        }

        response.setEncoding("utf8");
        let body = "";
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => resolve(body));
      }
    );

    request.on("error", reject);
    request.setTimeout(20000, () => {
      request.destroy(new Error(`Timeout for ${url}`));
    });
  });
}

async function cachedFetch(url, cacheName, refresh) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const cachePath = path.join(CACHE_DIR, cacheName);

  if (!refresh) {
    try {
      return await fs.readFile(cachePath, "utf8");
    } catch (_error) {
      // Cache miss; fetch below.
    }
  }

  const html = await fetchText(url);
  await fs.writeFile(cachePath, html, "utf8");
  return html;
}

async function mapWithConcurrency(items, limit, callback) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await callback(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function parseCliArgs(args) {
  const options = {
    refresh: false,
    outputPath: OUTPUT_PATH
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--refresh") {
      options.refresh = true;
      continue;
    }
    if (arg === "--output") {
      const outputPath = args[index + 1];
      if (!outputPath || outputPath.startsWith("--")) {
        throw new Error("--output requires a path");
      }
      options.outputPath = outputPath;
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function isPlayableStreamUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === "video-auth1.iol.pt"
      && !url.port
      && !url.username
      && !url.password
      && /^\/(?:auth-)?beachcam\/[a-z0-9_-]+\/playlist\.m3u8$/i.test(url.pathname)
      && !url.hash;
  } catch (_error) {
    return false;
  }
}

function assertUniqueCameras(cameras) {
  const cameraIds = new Set();
  const livecamIds = new Set();
  const streamUrls = new Set();

  for (const camera of cameras) {
    const cameraId = String(camera?.id || "").trim();
    if (camera?.error) {
      throw new Error(`Detail failed for ${cameraId || "unknown camera"}: ${camera.error}`);
    }
    if (!cameraId) {
      throw new Error("Camera is missing an id");
    }
    if (cameraIds.has(cameraId)) {
      throw new Error(`Duplicate camera id: ${cameraId}`);
    }
    cameraIds.add(cameraId);

    const streamUrl = String(camera.streamUrl || "").trim();
    const isPlayable = camera.hasStream === true || Boolean(streamUrl);
    if (!isPlayable) continue;

    const livecamId = String(camera.livecamId || "").trim();
    if (!livecamId) {
      throw new Error(`Missing livecamId for camera ${cameraId}`);
    }
    if (livecamIds.has(livecamId)) {
      throw new Error(`Duplicate playable livecamId: ${livecamId}`);
    }
    livecamIds.add(livecamId);

    if (!isPlayableStreamUrl(streamUrl)) {
      throw new Error(`Non-playable stream URL for camera ${cameraId}: ${streamUrl || "missing"}`);
    }
    if (streamUrls.has(streamUrl)) {
      throw new Error(`Duplicate playable stream URL: ${streamUrl}`);
    }
    streamUrls.add(streamUrl);
  }
}

function normalizeCrawlOptions(optionsOrRefresh) {
  const options = typeof optionsOrRefresh === "boolean"
    ? { refresh: optionsOrRefresh }
    : (optionsOrRefresh || {});
  const refresh = Boolean(options.refresh);

  return {
    refresh,
    outputPath: path.resolve(options.outputPath || OUTPUT_PATH),
    fetchPage: options.fetchPage || ((url, cacheName) => cachedFetch(url, cacheName, refresh)),
    logger: options.logger || console.error
  };
}

async function crawl(optionsOrRefresh = {}) {
  const { refresh, outputPath, fetchPage, logger } = normalizeCrawlOptions(optionsOrRefresh);
  const listingHtml = await fetchPage(LISTING_URL, "livecams-index.html", refresh);
  const listingItems = parseListing(listingHtml);

  const cameras = await mapWithConcurrency(listingItems, CONCURRENCY, async (camera, index) => {
    try {
      const html = await fetchPage(camera.pageUrl, cacheNameForUrl(camera.pageUrl), refresh);
      const detail = parseDetail(html, camera.pageUrl);
      return {
        ...camera,
        name: detail.name || camera.name,
        livecamId: detail.livecamId,
        streamUrl: detail.streamUrl,
        videoId: detail.videoId,
        hasStream: Boolean(detail.streamUrl),
        image: detail.image,
        description: detail.description,
        detailMetrics: detail.detailMetrics
      };
    } catch (error) {
      throw new Error(`Detail failed for ${camera.id}: ${error.message}`, { cause: error });
    } finally {
      if ((index + 1) % 25 === 0 || index + 1 === listingItems.length) {
        logger(`Processed ${index + 1}/${listingItems.length}`);
      }
    }
  });

  assertUniqueCameras(cameras);
  cameras.sort((a, b) => b.clicks - a.clicks || a.name.localeCompare(b.name));

  const db = {
    generatedAt: new Date().toISOString(),
    source: {
      listingUrl: LISTING_URL,
      detailPageCount: listingItems.length
    },
    total: cameras.length,
    withCoordinates: cameras.filter((camera) => Number.isFinite(camera.lat) && Number.isFinite(camera.lon)).length,
    withStreams: cameras.filter((camera) => camera.hasStream).length,
    regions: [...new Set(cameras.map((camera) => camera.region).filter(Boolean))].sort(),
    cameras
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(db, null, 2)}\n`, "utf8");
  return db;
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const db = await crawl(options);
  console.log(`Wrote ${db.total} cameras (${db.withStreams} streams, ${db.withCoordinates} coordinates) to ${path.resolve(options.outputPath)}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  assertUniqueCameras,
  crawl,
  decodeEntities,
  parseCliArgs,
  parseListing,
  parseDetail,
  stripTags
};
