# Favorites, Focus, and Map Emphasis UX Design

Date: 2026-08-12

Status: Approved for implementation

Builds on:

- `2026-06-08-surfcams-v3-responsive-app-design.md`
- `2026-07-15-surfline-feed-precedence-design.md`

## 1. Goal

Make saved cameras easier to manage and substantially easier to watch on desktop and mobile.

The change removes the arbitrary seven-camera Monitor cap, lets users add and remove favorites without changing sections, adds an in-page large viewing mode for one or two cameras, and makes an explicitly selected Explore spot become the primary content without hiding the map completely.

The experience remains camera-led. Only records in the configured feed-backed camera roster are addable or rendered as user-facing spots.

## 2. Approved product decisions

1. Favorites have no product-level count limit.
2. Monitor renders every favorite in a scrollable gallery instead of truncating or padding to seven slots.
3. Favorites opens with saved cameras, not the entire camera catalog.
4. Users can search for and add a playable camera from inside Favorites.
5. Users can remove a favorite through an explicit labeled action and briefly undo the removal.
6. A Monitor camera can open in an in-page Focus view. Focus is not browser fullscreen.
7. Focus supports one camera or exactly two cameras in an equal-width comparison layout.
8. Ordinary Monitor gallery previews retain the existing 60-second expiry and `Tap to restart` behavior.
9. Focus and Compare have no fixed viewing timeout while the document is visible. They stop when the user exits the view or when lifecycle cleanup is required, such as hiding or leaving the page.
10. The app supplies a consistent fullscreen action for the Focus container. Focus remains usable if fullscreen is unsupported or rejected.
11. Explore starts map-primary. An explicit marker or result selection automatically promotes that spot; there is no global layout toggle.
12. In spot-primary Explore, the smaller map contains an `Expand map` action. Returning to map-primary preserves spatial context and selection.

## 3. Scope

This design changes:

- Favorites management and add-by-name discovery;
- the Monitor collection and playback lifecycle;
- one-camera Focus and two-camera Compare layouts;
- app-owned fullscreen behavior;
- Explore map/detail emphasis on desktop and mobile; and
- the accessibility, error, responsive, and test behavior required by those flows.

This design does not add accounts, cloud synchronization, favorite folders, manual favorite reordering, more than two focused feeds, a new camera provider, or a new recommendation model. It does not change the secondary `Might be good` product concept.

## 4. Product state model

The existing app routes remain `monitor`, `favorites`, `explore`, and `configure`.

New view state is session-only:

```text
monitorView = gallery | focus-one | compare-two
focusedCameraIds = [] | [primaryId] | [leftId, rightId]
exploreEmphasis = map | detail
```

Favorite IDs continue to persist locally. Focus composition and Explore emphasis do not persist across reloads. Reloading therefore returns to the predictable Monitor gallery and map-primary Explore state.

`selectedExploreCamera` and `exploreEmphasis` are deliberately separate. The app may initialize a selected camera for continuity, but only a user action on a marker, result, or `Open selected spot` changes emphasis to `detail`.

## 5. Favorites

### 5.1 Default surface

The route remains titled `Favorites`; it is no longer presented as a general all-location browser.

The default content is the complete saved-camera list. There is no seven-item limit and no empty-slot padding. Each row or card includes:

- static camera poster thumbnail;
- spot name and distinguishing region/location;
- feed availability status;
- an `Open large` action;
- the familiar favorite state; and
- an explicit `Remove` action.

The primary page action is `Add camera`. An empty Favorites state uses the same action and explains that only cameras with supported feeds can be added.

`Open large` from Favorites switches to Monitor in `focus-one` with that camera selected.

### 5.2 Add camera by name

On desktop, `Add camera` opens a compact dialog. On mobile, it opens a bottom sheet. Both keep the user inside Favorites and contain the same accessible editable combobox.

The suggestion source is the feed-backed `state.cameras` roster, not canonical no-feed research records. Search behavior is:

- case-insensitive and accent-insensitive;
- matched against name, location, and region;
- updated while typing;
- limited to configured playable cameras;
- explicit about region and provider/source when names are ambiguous; and
- clear about cameras that are already saved.

Typing `Sao Juliao`, for example, finds `São Julião`. Selecting a result is the add action; listbox options do not contain nested buttons or checkboxes. An already-saved result is marked and cannot be added twice.

After a successful add, the app persists the favorite, announces a non-blocking confirmation, clears the query, and keeps the add surface ready for another camera. The existing region and provider/source filters move into a collapsed `Filters` disclosure within the add surface. The current favorite-status, stream-status, distance, and sort controls do not appear in this focused add flow. No filter controls occupy the main Favorites screen or push saved items below the mobile fold.

### 5.3 Remove and undo

`Remove` immediately updates Favorites and Monitor and persists the new favorite set. A confirmation offers `Undo` for 10 seconds or until the next favorite mutation, whichever comes first. Activating it restores and persists the camera using the collection's existing derived order. This feature does not introduce manual reordering.

A transient playback error never removes a favorite. If a previously configured feed is permanently absent from the loaded feed-backed roster, startup sanitation may remove the orphaned ID under the existing feed-precedence rules.

## 6. Monitor gallery

### 6.1 Unlimited collection, bounded playback

Monitor renders every favorite in a responsive, scrollable gallery. Collection size and simultaneous playback are separate concerns: removing the collection cap must not cause every saved stream to stay active.

Only tiles intersecting the visible gallery own active HLS streams. Tiles within one viewport above or below retain their poster and player shell but do not begin stream playback. A playing tile that leaves the visible gallery is cleared and can reactivate when it becomes visible again. This is provider-neutral and applies to both native HLS and hls.js playback.

Ordinary gallery previews preserve the current behavior:

- a preview expires after 60 seconds;
- expiry unloads the stream and displays `Tap to restart`; and
- restarting supplies another 60-second preview window.

The 60 seconds begin when a visible tile requests playback. A tile re-entering the visible gallery receives a fresh preview window. This timer exists only for gallery previews. It is not inherited by Focus, Compare, or the selected Explore player.

### 6.2 Entering and leaving Focus

Every populated Monitor tile has an explicit `Open large` action. It changes `monitorView` to `focus-one`, keeps the chosen camera playing in a large in-page area, and presents the remaining favorites in a compact switcher.

Focus is an ordinary page layout, not a modal and not fullscreen. The user can:

- replace the focused camera from the switcher;
- add a second camera through `Compare`;
- enter fullscreen when supported; or
- exit Focus and return to the prior gallery scroll position.

Focus has no fixed playback deadline while the document remains visible. The player is cleared when Focus exits, the route changes, or `document.hidden` becomes true. When the document becomes visible again, the still-selected Focus or Compare composition reactivates without adopting the gallery's 60-second timer. If browser autoplay policy blocks reactivation, the affected pane shows a clear manual play action.

### 6.3 Compare

Compare contains exactly two equal-width feeds whenever each pane can remain at least 320 CSS pixels wide. Below that threshold, the panes stack at equal visual weight. Neither feed is designated as secondary. Each side retains its own camera identity, condition summary, replace action, local playback state, and error state.

The user can replace either camera, remove either side to return to one-camera Focus, exit to the gallery, or fullscreen the complete comparison container.

The app must not create duplicate comparison entries for the same camera. Compare is session-only and is not added to Favorites as a separate object.

### 6.4 Mobile Focus and Compare

One-camera Focus fills the useful content width above a compact favorite switcher.

Two-camera Compare stacks in portrait so both feeds remain large enough to read wave texture. It becomes equal-width side by side only when each pane can remain at least 320 CSS pixels wide. The implementation must not force two narrow portrait columns.

## 7. Fullscreen

Focus and Compare expose one app-owned fullscreen action in a stable location. For Compare, the target is the wrapper containing both feeds, not an individual video.

Fullscreen behavior must:

- feature-detect the Fullscreen API;
- run directly from a user activation;
- handle its promise rejection;
- listen for `fullscreenchange` so labels and state remain accurate;
- provide a clear exit action; and
- keep Focus or Compare intact when fullscreen is unavailable or denied.

Native provider/video controls may remain, but they are not the only discoverable fullscreen path. The in-page large view is always the fallback.

## 8. Explore map and spot emphasis

### 8.1 Map-primary state

Explore initially shows the map as primary, with search/results and a compact selected-spot summary. Initialization may select a useful default record, but initialization alone does not promote the camera.

When a spot is selected but the map is primary, its compact card contains `Open selected spot`. This is a contextual route into detail emphasis, not a top-level layout toggle.

### 8.2 Automatic drill-in

An explicit user selection from a marker or result sets the selected camera and automatically changes `exploreEmphasis` to `detail`.

In detail emphasis:

- the selected camera, conditions, favorite action, and local playbook occupy most of the screen;
- the map remains present, smaller, and interactive;
- nearby results remain available; and
- the smaller map contains `Expand map`.

Selecting a nearby result replaces the primary spot directly. The user does not need to restore the map before browsing another spot.

### 8.3 Returning to the map

`Expand map` changes only the emphasis. It does not clear the selected camera, filters, marker, center, bounds, pan position, or zoom.

The same Leaflet instance remains mounted across emphasis changes. After the CSS layout paints, the app calls `invalidateSize({ pan: false })` or its supported equivalent so the map redraws correctly without a surprise pan. Selection remains visible and spatial context is preserved.

### 8.4 Mobile Explore

Mobile uses the same two-state model. Map-primary devotes the useful viewport to the map and browsable result cards. An explicit selection promotes the spot to a camera-first detail surface; the compact map sits directly below the camera summary and before longer conditions/playbook content. `Expand map` returns to the same map position and selection.

Portrait mobile uses normal document flow in detail emphasis: camera summary, compact map, longer conditions/playbook content, then nearby results. It does not squeeze a detailed camera and map into two narrow columns.

## 9. Component and lifecycle boundaries

Implementation should avoid adding more intertwined responsibilities to the existing app controller. The feature has four conceptual boundaries:

1. **Favorite catalog and mutations**: derives addable feed-backed cameras, normalizes search text, adds/removes IDs, and persists changes.
2. **Monitor view coordinator**: owns `gallery`, `focus-one`, and `compare-two` transitions plus restoration of gallery scroll position.
3. **Feed lifecycle policy**: distinguishes timed gallery previews from untimed deliberate viewing, visibility cleanup, and per-player failure state without branching by provider.
4. **Explore emphasis controller**: keeps selection distinct from emphasis and resizes the persistent Leaflet map after layout changes.

Pure search, state-transition, and selection helpers should be extracted into focused modules where that makes behavior directly testable. DOM rendering may continue through the existing app controller, but view transitions and playback policy must have named interfaces rather than scattered timer branches.

## 10. Error and recovery behavior

- **No search results:** explain that only supported playable cameras are offered and preserve the query for editing.
- **Favorite persistence failure:** keep the current UI state, report that it could not be saved, and avoid claiming success.
- **Transient stream failure:** isolate the error to that tile or focused pane and retain the favorite.
- **Gallery expiry:** show `Tap to restart`, distinct from `Feed unavailable`.
- **Blocked autoplay:** show a visible manual play action.
- **Fullscreen rejection:** remain in the same Focus/Compare composition and show a short non-blocking message.
- **One failed comparison feed:** keep the other feed playing and let the failed side be replaced or retried.
- **Map resize failure:** retain results and selected spot so the non-map browsing route remains usable.
- **Late asynchronous player setup:** lifecycle cleanup must prevent a cleared or expired player from attaching after its view has been replaced.

## 11. Accessibility

- The add-camera field follows the WAI-ARIA editable combobox pattern, including keyboard suggestion navigation, explicit acceptance, Escape dismissal, and a named controlled popup.
- Listbox options contain text only; choosing an option performs the add.
- `Add camera`, `Remove`, `Undo`, `Open large`, `Compare`, `Replace`, `Exit focus`, `Fullscreen`, `Open selected spot`, and `Expand map` have explicit accessible names.
- Opening a dialog or mobile sheet moves focus inside it. Closing returns focus to its initiating control.
- Entering Focus moves focus to its heading or primary controls. Exiting restores focus to the originating camera tile when it still exists.
- Status changes use a small dedicated live region. The complete Favorites or Explore detail panel is not an `aria-live` region.
- Color is never the only signal for feed or surf state.
- Map markers have unique descriptive labels, and the results list remains a keyboard- and screen-reader-accessible alternative to direct marker interaction.
- Focus indicators remain visible across map controls, cards, media controls, and switchers.
- Layout transitions honor `prefers-reduced-motion`.

## 12. Responsive behavior

### Desktop

- Favorites uses a saved-camera list with a compact add dialog.
- Monitor uses a responsive gallery with a large Focus area when activated.
- Compare is equal width.
- Explore alternates between map-primary and spot-primary grid proportions while keeping both surfaces present.

### Portrait mobile

- Favorites uses a full-width list and add bottom sheet.
- Monitor is a readable single-column gallery.
- One focused camera fills the width; Compare stacks vertically.
- Explore presents one primary task at a time while preserving a direct return to the same map state.

### Landscape mobile and tablet

- Compare becomes equal-width side by side only when each pane is at least 320 CSS pixels wide; otherwise it remains stacked.
- Explore places the smaller map beside the detail surface only when the map can remain at least 280 CSS pixels wide and detail can remain at least 480 CSS pixels wide. Otherwise it uses the same camera-first ordering as portrait mobile, with the compact map directly below the camera summary.

## 13. Testing strategy

Implementation follows test-driven development. Existing baseline tests must continue to pass.

### 13.1 Favorites tests

- More than seven favorites are retained and returned to Monitor without truncation.
- The default Favorites view contains saved cameras only.
- Add results contain only the feed-backed playable roster.
- Search is case- and accent-insensitive.
- Duplicate names include distinguishing context.
- Already-saved results cannot be added twice.
- Remove updates both routes and Undo restores the favorite.
- A transient player failure does not mutate favorites.

### 13.2 Monitor and playback tests

- All favorites produce gallery entries with no padded slots.
- Active player resources are limited to visible/nearby entries.
- A gallery preview expires at 60 seconds and can restart for another 60 seconds.
- Gallery cleanup cancels delayed starts and expiration timers.
- Focus has no 60-second expiration while visible.
- Compare has no 60-second expiration while visible.
- Leaving Focus, leaving Monitor, or hiding the document performs the specified cleanup.
- Late native-HLS or hls.js completion cannot resurrect a cleared player.
- One comparison failure does not disrupt the other feed.

### 13.3 Focus, Compare, and fullscreen tests

- `Open large` enters one-camera Focus with the chosen camera.
- `Compare` adds one distinct second favorite and uses equal-width desktop layout.
- Replacing either side changes only that side.
- Removing a side returns to one-camera Focus.
- Exiting restores the gallery position and originating focus target.
- Portrait mobile stacks comparison feeds; supported landscape widths place them side by side.
- Fullscreen targets the composition wrapper, tracks `fullscreenchange`, and handles rejection without exiting Focus.

### 13.4 Explore tests

- Initial default selection does not activate detail emphasis.
- Marker and result activation set selection and detail emphasis.
- `Open selected spot` activates detail emphasis.
- `Expand map` restores map emphasis without clearing selection, filters, center, bounds, or zoom.
- Map resizing occurs after the new layout paints and does not pan unexpectedly.
- Nearby selection swaps the primary spot without an intermediate map reset.
- Mobile returns to the same map state.

### 13.5 Accessibility and browser checks

- Keyboard-only add, remove/undo, Focus, Compare, and Explore flows.
- Combobox roles, properties, active option, and dismissal behavior.
- Focus entry/return and dialog focus containment.
- Screen-reader names for icon and media actions.
- Reduced-motion behavior.
- Desktop, portrait mobile, and landscape mobile visual regression checks.
- Native HLS and hls.js paths, blocked autoplay, unavailable streams, and fullscreen rejection.

## 14. Acceptance criteria

The feature is complete when:

1. A user can save more than seven playable cameras and see every one in a scrollable Monitor.
2. A user can add a playable camera by name and remove or undo removal without leaving Favorites.
3. Ordinary gallery previews still expire after 60 seconds.
4. A user can deliberately watch one focused camera or two equal comparison cameras without a fixed timeout while the page is visible.
5. The app provides a reliable in-page large view even when browser fullscreen is unavailable.
6. Explicit Explore selection automatically promotes the spot, and `Expand map` returns to the preserved map state.
7. The flows work with keyboard input and remain readable on desktop, portrait mobile, and landscape mobile.
8. Playback, persistence, fullscreen, or map failures stay local and provide an actionable recovery path.

## 15. Design references

- [Surfline Favorites](https://support.surfline.com/hc/en-us/articles/360050973872-How-to-Add-Reorder-and-Delete-Favorites-on-the-Surfline-Website) supports add-by-search and in-place edit/remove workflows.
- [YouTube playlist management](https://support.google.com/youtube/answer/6109639?hl=en) establishes the add/search-within-collection pattern.
- [YouTube player sizing](https://support.google.com/youtube/answer/6052392?hl=en) establishes a large in-page player distinct from fullscreen.
- [Surfline Multi-Cam](https://support.surfline.com/hc/en-us/articles/360051013932-How-to-use-Multi-Cam-on-the-website) establishes deliberate multi-feed viewing and a composition-level fullscreen action.
- [WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/) defines the editable combobox interaction requirements.
- [Leaflet accessibility guidance](https://leafletjs.com/examples/accessibility/) supports retaining a non-map result alternative, while the Leaflet API requires resizing the persistent map after its container changes.

The approved design adapts those conventions to this product's existing visual language and feed-backed static architecture rather than introducing a new design system.
