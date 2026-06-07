#!/usr/bin/env node

const http = require("node:http");
const https = require("node:https");

function extractVideoUrl(html) {
  const livecamBlock = html.match(/<[^>]+data-control=["']livecam["'][^>]*>/i);
  if (!livecamBlock) return null;

  const videoUrlMatch = livecamBlock[0].match(/\sdata-video-url=["']([^"']+)["']/i);
  return videoUrlMatch ? videoUrlMatch[1].replaceAll("&amp;", "&") : null;
}

function fetchText(url, redirectCount = 0) {
  if (redirectCount > 5) {
    return Promise.reject(new Error("Too many redirects"));
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
          reject(new Error(`Request failed with HTTP ${status}`));
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
    request.setTimeout(15000, () => {
      request.destroy(new Error("Request timed out"));
    });
  });
}

async function main() {
  const pageUrl = process.argv[2];
  if (!pageUrl) {
    console.error("Usage: node scripts/extract-beachcam-feed.cjs <beachcam-livecam-url>");
    process.exitCode = 1;
    return;
  }

  let normalizedUrl;
  try {
    normalizedUrl = new URL(pageUrl).toString();
  } catch (_error) {
    console.error("Invalid URL");
    process.exitCode = 1;
    return;
  }

  const html = await fetchText(normalizedUrl);
  const streamUrl = extractVideoUrl(html);

  if (!streamUrl) {
    console.error("No data-video-url found on the page");
    process.exitCode = 1;
    return;
  }

  console.log(streamUrl);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
