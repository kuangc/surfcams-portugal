# Contributing

This project is intentionally small and dependency-light. Keep changes focused, testable, and respectful of upstream Beachcam/MEO content ownership.

## Local Workflow

1. Run `npm test` before and after code changes.
2. Run `npm run dev` and inspect `http://127.0.0.1:8766/` for UI changes.
3. Keep crawled cache files out of commits. The cache lives in `.cache/` and is gitignored.
4. If you refresh `data/beachcam-cameras.json`, run `npm run embed-data` before committing so `index.html` has the same embedded DB.

## Code Style

- Prefer plain browser APIs and small ES modules.
- Do not add a build step unless the app needs one.
- Treat camera page content as untrusted external data; insert it with `textContent` or DOM APIs.
- Keep default favorites in `src/config.js` and add tests for any default behavior change.

## Data Refresh

Use the crawler politely:

```bash
npm run crawl -- --refresh
npm run embed-data
npm test
```

The crawler indexes public Beachcam/MEO pages and stream URLs for personal viewing. Do not redistribute upstream video content or imply affiliation.

