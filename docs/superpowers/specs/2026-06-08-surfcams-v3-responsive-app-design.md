# Surfcams Portugal V3 Responsive App Design

## Goal

Replace the v2 decision-list layout with a v3 app shell for checking surf cameras quickly on mobile and desktop. V3 should feel like a focused surf-planning app, not a directory, and not a ranking model pretending to be more precise than it is.

## Approved Direction

Use the approved blend of layout options A and C:

- Mobile-first monitor experience from option C.
- Desktop expansion from option A.
- Four icon-only nav destinations: `monitor`, `favorites`, `explore`, and `configure`.
- `monitor` is the default route.
- V1 and V2 do not need backward-compatible UI support.

The product brief is: a surfer or small group opens the app, checks up to six trusted cameras first, glances at a compact condition line under each feed, and only moves to favorites, map exploration, or configuration when needed.

## Non-Goals

- Do not auto-fill the default monitor with heuristic-ranked "best fit" cameras.
- Do not make the heuristic the primary product truth.
- Do not add accounts, group voting, comments, rooms, or trip planning.
- Do not implement driving distance in v3; that is tracked separately in GitHub issue #1.
- Do not preserve the v2 left-sidebar ranked card interface.
- Do not keep the v2 monitor overlay as the primary experience.

## Navigation

V3 has one app shell with four icon-only nav items:

- `monitor`: live camera grid.
- `favorites`: saved spots and location-level detail.
- `explore`: map view for discovering spots.
- `configure`: fit preferences and surf-size translation settings.

Desktop uses a narrow left rail with icons and accessible labels. Mobile uses a fixed bottom nav with the same icons and accessible labels. The active section is visible through icon color, background, and `aria-current`; visible text labels are not required in the nav.

Recommended icons:

- Monitor: video or broadcast camera icon.
- Favorites: star icon.
- Explore: map icon.
- Configure: sliders icon.

## Monitor Screen

Monitor is the default screen and should show up to six camera feeds, starting with favorites.

Rules:

- Show favorites only by default, capped at six.
- Preserve the user's favorite order when possible; otherwise fall back to the current default favorite order.
- If there are fewer than six favorites, leave the remaining slots empty with a lightweight affordance to add favorites from `favorites` or `explore`.
- Do not silently fill empty slots with heuristic picks.
- Provide a secondary `Might be good` toggle or segmented control inside Monitor. When enabled, show heuristic candidates separately from favorites and clearly label the mode as exploratory.

Each monitor tile is video-first:

- Video or poster image dominates the tile.
- One condition line sits directly below the video.
- The line should use visuals and numbers, not prose-heavy summaries.
- Keep the tile compact enough for six cameras to be visible on desktop and easy to scan on mobile.

The condition line should include the most important decision signals:

- Group fit color or icon: good, caution, poor, unknown.
- Estimated surf height, using the configured surf-size translation.
- Swell direction and period.
- Wind direction and speed, with an arrow showing where wind is blowing.
- Optional tide abbreviation when space allows.

Example line shape:

`● 0.8m · NW 8s · wind ↘ 6km/h · low 1.2m`

The condition line should avoid false certainty. It may use `~` for estimates and unknown states for weak exposure data.

## Favorites Screen

Favorites is where users manage the spots they actually care about.

It should show location cards or rows with:

- Camera thumbnail or live/pause affordance.
- Spot name and region.
- Favorite remove control.
- Group fit label.
- Surf height, swell direction, period, wind speed and direction, tide, coast exposure confidence, and sea temperature if available.
- A compact explanation of why the spot is good, caution, or poor for the configured group.
- A link or action to open the spot in Explore.

Users can remove favorites here. Users can add favorites from Explore, and the Favorites screen should reflect those changes immediately.

Favorites is not a dense ranked "Best Today" list. It is the trusted-place management screen.

## Explore Screen

Explore is the map view.

It should:

- Reuse the existing Leaflet map and markers.
- Show all indexed cameras by default, with lightweight filters for search, region, stream availability, favorites, and optionally `Might be good`.
- Open a compact spot panel or popup when a marker is clicked.
- Include richer detail than Monitor: camera preview, conditions, coast/wind/swell visuals, surf fit explanation, and add/remove favorite action.
- Avoid duplicating a permanent right detail panel on desktop unless the selected spot needs a persistent inspector.

Explore is for discovery. It should not compete with Monitor as the first screen.

## Configure Screen

Configure owns user preferences.

It should include:

- Preferred surf height range, default `0.3m-1.5m`.
- Wind preference controls, default offshore or light wind.
- Wind speed tolerance.
- Period preference or minimum period.
- Surf-size translation controls for spots where observed wave height differs from exposed swell forecasts.
- A clear explanation that the heuristic is a model, not a guarantee.
- Reset-to-defaults action.

Configuration changes should immediately affect condition lines, group fit labels, and `Might be good` candidates.

Configuration should persist locally in the browser, similar to favorites.

## Might Be Good Mode

The heuristic is secondary in v3.

`Might be good` should be a clearly separate mode, not an automatic default. It can appear as:

- A toggle or segmented control in Monitor.
- A filter in Explore.
- A secondary section in Favorites if useful.

When enabled, it should use `rateSurfSpot(camera)` and existing exposure logic, but the UI should label candidates as tentative. Suggested copy:

`Might be good`

`Based on current model. Check the cam.`

This keeps model output useful without letting weak assumptions drive the primary user workflow.

## Responsive Layout

Mobile:

- Default to Monitor.
- Bottom icon nav stays visible.
- Monitor tiles stack in a single column or readable two-column layout only if the viewport supports it.
- Video remains large enough to inspect wave shape.
- Condition line should wrap only if necessary; truncation must not hide the core surf height, swell, period, or wind.
- Favorites and Configure are single-column screens.
- Explore uses full-screen map with a bottom sheet for selected spot details.

Desktop:

- Left icon rail stays fixed.
- Monitor uses up to three columns and two rows for six feeds.
- Favorites can use a denser two-column list/detail layout if it remains scannable.
- Explore can use full map with an anchored selected-spot panel.
- Configure can use a constrained settings panel rather than a full-width form.

No page should use nested cards or decorative marketing layout. The app should feel utilitarian, scan-friendly, and built for repeated use.

## Data And State

Keep the app static and browser-only.

Existing helpers remain useful:

- `loadCameraDb()` and embedded camera DB for camera data.
- `favorites.js` for favorite persistence.
- `rateSurfSpot(camera)` for surf model labels.
- `getConditionVectors(camera)` for coast, wind, and swell visualization.
- `createFeedTilePlayer()` or equivalent per-tile player lifecycle for multiple feeds.

New or revised state should separate:

- Active route: `monitor`, `favorites`, `explore`, `configure`.
- Favorite IDs.
- Configure preferences.
- Monitor mode: `favorites` or `might-be-good`.
- Selected explore camera.

The v2 monitor selection model can be removed or simplified because Monitor is no longer a temporary overlay deck. The primary monitor grid is always the monitor screen.

## Error Handling

- If a favorite has no stream, keep the tile and show a clear unavailable state.
- If fewer than six favorites exist, show empty slots with an add/discover affordance.
- If a stream fails, the failed tile shows its own state without disrupting other tiles.
- If the camera DB fails to load, show one app-level error with recovery guidance.
- If settings are invalid, clamp to supported ranges and show the corrected value.
- If the model lacks enough coast exposure confidence, show `unknown` or `regional estimate` instead of making an offshore/onshore claim.

## Accessibility

- Icon-only nav must have accessible names.
- Active nav item uses `aria-current`.
- Video controls remain keyboard accessible.
- Add/remove favorite controls have explicit labels.
- Color-coded fit states also need text or icon shapes so color is not the only signal.
- Bottom sheets and popups must keep focus predictable when opened and closed.

## Testing

Unit/source tests should cover:

- App shell includes the four v3 nav destinations.
- Monitor is the default route.
- Monitor defaults to favorites only and caps at six.
- Monitor does not auto-fill heuristic picks.
- `Might be good` mode uses heuristic candidates only when explicitly enabled.
- Favorite add/remove updates Monitor and Favorites.
- Configure preferences persist and affect condition summaries.
- Condition summary line includes surf height, swell direction, period, wind direction, and wind speed.
- Direction arrows represent where wind is blowing, not where it comes from.

Browser verification should cover:

- Mobile default screen: monitor grid plus bottom icon nav.
- Desktop default screen: monitor grid plus left icon rail.
- Favorites add/remove flow.
- Explore marker click and add favorite flow.
- Configure preference edit and persisted reload.
- Six-camera desktop monitor layout at max three columns.
- Mobile monitor tiles remain readable and do not shrink into unusable thumbnails.

## Acceptance Criteria

- App opens on Monitor.
- Monitor shows up to six favorite cameras and no heuristic auto-fill.
- `Might be good` is available only as an explicit secondary mode.
- Nav has exactly four icon-only destinations: monitor, favorites, explore, configure.
- Mobile uses bottom nav; desktop uses left icon rail.
- Favorites screen supports viewing spot info and removing favorites.
- Explore screen supports map discovery and adding favorites.
- Configure screen supports group fit and surf-size translation settings.
- V2's busy left decision panel and temporary monitor overlay are removed from the primary UX.
