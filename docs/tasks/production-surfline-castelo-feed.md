# Task: Production Surfline Castelo Feed

## Goal

Move the `surfline-castelo` feed from local testing into the production app with an approved Surfline feed source.

## Current Test Wiring

- Local-only file: `data/local-stream-overrides.json`
- Camera id: `surfline-castelo`
- Test HLS URL: `https://hls.cdn-surfline.com/ireland/pt-castelo/playlist.m3u8`
- Test still URL: `https://camstills.cdn-surfline.com/eu-west-1/pt-castelo/latest_full.jpg`

## Production Work

- Decide whether production should use checked-in static data, a private runtime config file, or a Surfline API-backed feed resolver.
- Confirm the production feed URL is approved for direct playback in this personal app.
- Add/update tests proving `surfline-castelo` is rendered as a live first-class favorite in production mode.
- Regenerate embedded data if the production source is checked into `data/beachcam-cameras.json`.
- Verify the deployed app renders the feed without relying on `data/local-stream-overrides.json`.
