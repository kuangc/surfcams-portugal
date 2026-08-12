# Design QA

## Evidence

- Source visual truth: `/Users/kuangchen/.codex/visualizations/2026/08/11/019fef77-8303-7d30-9a69-d452e279463f/map-auto-drill-flow-retry.png`
- Local implementation: `http://127.0.0.1:61931/`
- Primary desktop screenshots:
  - `docs/design-qa/monitor-desktop.png`
  - `docs/design-qa/favorites-desktop.png`
  - `docs/design-qa/focus-desktop.png`
  - `docs/design-qa/compare-desktop.png`
  - `docs/design-qa/explore-map-primary-desktop.png`
  - `docs/design-qa/explore-detail-desktop.png`
- Responsive screenshots:
  - `docs/design-qa/focus-mobile.png`
  - `docs/design-qa/favorites-add-mobile.png`
  - `docs/design-qa/explore-map-mobile.png`
  - `docs/design-qa/explore-detail-mobile.png`
- Combined comparison inputs:
  - `docs/design-qa/explore-map-comparison.png`
  - `docs/design-qa/explore-detail-comparison.png`
- Desktop viewport and CSS size: 1280 × 720 px at device pixel ratio 1.
- Source and desktop implementation pixels: 1280 × 720 px each. No density normalization was needed before composing each 2560 × 720 comparison.
- Responsive captures: 390 × 844 px at device pixel ratio 1.
- State: Explore map-primary before explicit selection, then detail-primary after a result selection; the selected camera, marker bounds, filters, and map instance remain intact.

## Findings

No actionable P0, P1, or P2 findings remain.

### Required fidelity surfaces

- Fonts and typography: the existing product's Inter/system stack, compact uppercase eyebrow, strong section hierarchy, line heights, weights, and wrapping are retained. The larger detail state gives the camera name and conditions the same dominant scan order as the source.
- Spacing and layout rhythm: the map-primary state keeps the map dominant; explicit selection moves the map to the smaller contextual rail and gives the video/details the larger column. Margins, 8 px radii, 12–14 px internal spacing, and existing elevation tokens remain consistent with the product. One-camera Focus is centered; Compare is equal-width on desktop and stacked on mobile.
- Colors and visual tokens: the implementation preserves the existing white/green-gray surfaces, dark video canvas, teal active state, gold focus ring, semantic red/green camera states, and accessible foreground contrast. No new decorative palette was introduced.
- Image quality and asset fidelity: all camera imagery uses the application's real poster/live feed assets with intrinsic aspect ratio and `object-fit` behavior. Map tiles and camera pins remain the live Leaflet assets. No placeholder or generated imagery substitutes an image from the source.
- Copy and content: contextual actions read “Open large,” “Compare,” “Expand map,” “Add camera,” “Remove,” and “Undo.” There is no global map/detail toggle; controls are placed on the content they affect. Status copy identifies playable-feed and mutation outcomes.
- Icons and controls: the existing icon language is preserved. Persistent controls remain visible, keyboard focus is clear, the add-camera combobox exposes text options, and fullscreen includes its own exit control inside the fullscreen target.
- Accessibility and responsiveness: keyboard navigation was exercised for the Favorites combobox (Arrow, End, and two-stage Escape with focus restoration). Focus/Compare, Favorites add, and both Explore emphases were checked at the responsive breakpoint with no horizontal overflow. The promoted Explore summary receives programmatic focus without scroll anchoring the moved result row.

## Primary interactions tested

- Open a gallery camera into untimed Focus, add a distinct camera to Compare, and return to the gallery.
- Enter and exit app-owned fullscreen while preserving the Focus composition and controls.
- Add a playable camera from Favorites, remove it, and undo the mutation.
- Confirm duplicate provider records for one physical feed share the same favorite heart, marker state, Favorites filter behavior, removal, and Undo result.
- Search and navigate the add-camera combobox via keyboard; Escape first closes results and then the dialog, restoring focus.
- Select an Explore result to promote the spot automatically, confirm the page remains at route top, and use “Expand map” to restore map-primary emphasis.
- Confirmed browser console output contained no application errors during Monitor and Explore checks.

## Focused evidence

The full-view comparisons are readable at native resolution, and focused screen captures cover the interaction-heavy regions independently: Focus/Compare composition, Favorites cards/dialog, and both Explore emphasis states. No additional crop was necessary because typography, controls, feed imagery, map markers, and the map/detail track proportions are legible in those captures.

## Comparison history

1. **P1 — hidden gallery remained visible under Focus.** The initial capture showed Focus panes and gallery cards simultaneously because `.monitor-grid` author CSS overrode the HTML `hidden` behavior. Fixed with an explicit `.monitor-grid[hidden] { display: none; }` rule. Post-fix evidence: `docs/design-qa/focus-desktop.png`.
2. **P2 — mobile Focus header overflowed.** The first 390 px capture showed the camera select and action row exceeding the viewport. Fixed by stacking the Focus header, allowing the action row and select to shrink to 100%, and removing the select minimum width. Post-fix evidence: `docs/design-qa/focus-mobile.png`.
3. **P2 — explicit Explore selection stayed scroll-anchored to the moved result.** The first desktop detail capture began partway down the route after the clicked result moved into the lower browse region. Fixed by focusing the promoted summary with `preventScroll` and restoring the route top after layout paint. Post-fix evidence: `docs/design-qa/explore-detail-desktop.png`.
4. **P2 — detail-primary track direction was reversed.** The first comparison placed the video/details in the narrow left track and the contextual map in the wide right track, opposite the selected source. Fixed by using a narrow left map track and a wide right summary/detail track, with browse below the map. The “Expand map” action was moved to the map's top-right so it remains immediately discoverable. Post-fix combined evidence: `docs/design-qa/explore-detail-comparison.png`.

## Follow-up polish

- P3: consider replacing the remaining legacy text-glyph navigation symbols across the whole product in a future icon-system pass; this feature intentionally preserved the established shell rather than mixing icon families.

## Implementation checklist

- [x] Unlimited playable-only Favorites with in-place add, remove, and one 10-second Undo.
- [x] Exact 60-second gallery preview lifecycle with retry and late-failure reconciliation.
- [x] Untimed one-camera Focus and two-camera Compare with pane-local recovery.
- [x] Automatic Explore detail promotion and persistent map-context restoration.
- [x] Desktop and responsive visual checks, keyboard checks, fullscreen check, and console check.

final result: passed
