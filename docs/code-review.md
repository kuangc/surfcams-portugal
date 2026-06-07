# Code Review

Date: 2026-06-07

Scope: root static app, source modules, scripts, tests, and open-source project documentation.

Method: Dimagi-style five-pass review across design, quality, code smells, security, and maintainability.

## Findings Addressed

- Hardened `scripts/dev-server.js` path handling so encoded traversal and sibling-prefix paths cannot escape the project root. Added tests in `test/dev-server.test.js`.
- Replaced camera-ID CSS selector interpolation in `src/main.js` with DOM iteration over row datasets. Added a regression in `test/source-safety.test.js`.
- Extracted pure camera filtering, region, bounds, and first-camera selection rules into `src/camera-filters.js`. Added focused tests in `test/camera-filters.test.js`.
- Pinned the lazy HLS dependency URL instead of using `@latest`, and added Leaflet subresource integrity attributes in `index.html`.
- Excluded generated prototype artifacts and internal planning notes from the public repository with `.gitignore`.

## Residual Notes

- The app still depends on public Beachcam/MEO page structure and stream availability. The crawler and data refresh tests verify the current indexed dataset but cannot guarantee upstream stability.
- The app is a static personal viewer. It does not proxy or redistribute upstream video content.
