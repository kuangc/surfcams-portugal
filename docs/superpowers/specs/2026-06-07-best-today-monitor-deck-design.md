# Best Today And Monitor Deck Design

## Goal

Turn Surfcams Portugal from a camera directory into a fast surf decision board for a small group deciding where to surf today. The first screen should answer "where should we go?" and the monitor flow should let the group watch several candidate cameras at once before leaving.

## Users And Use Cases

- A surfer checks the app on a phone and wants the best current options in under 30 seconds.
- A group compares a few favorites before committing to a beach.
- A mixed-ability group needs a verdict that accounts for the group's preferred 0.3-1.5m range, offshore or light wind, period, and spot confidence.
- Friends want the exact practical data in one place: camera view, expected surf height, tide, wind speed and direction, swell direction, period, and rating for the group.
- The group selects up to six cameras and watches them together for one minute to validate the model against live video.

## Non-Goals

- Do not build voting, comments, accounts, or shared rooms in this pass.
- Do not claim a real scientific wave count.
- Do not depend on Surfline as a live runtime data source.
- Do not expand beyond existing Beachcam camera data unless a needed field already exists in the database.

## First Screen: Best Today

The primary surface becomes a ranked "Best Today" list rather than a camera directory. The list should appear before secondary browsing controls, especially on mobile.

Each Best Today card should show:

- Camera preview or current camera tile affordance.
- Spot name and region.
- Surfline-style rating label.
- Group verdict: `Best bet`, `Caution`, or `Skip for mixed group`.
- Expected surf height, with adjusted estimates marked when used.
- Tide in English.
- Wind speed and direction.
- Swell direction.
- Period.
- A one-line reason that explains the tradeoff before click.
- Confidence basis, such as spot-calibrated, regional estimate, or unknown exposure.
- A monitor selection control.

Rows should avoid false precision in the decision surface. Use softened language where appropriate, such as `~1.4m`, `short 6-7s period`, or `regional exposure`.

## Monitor Deck

Users can select up to six cameras from Best Today or the camera list and start `Monitor for 1 min`.

The monitor deck should:

- Show all selected feeds at once.
- Cap layout at three cameras per row.
- Use one row for one to three cameras and two rows for four to six cameras.
- Keep key metrics visible under each feed: expected surf height, tide, wind, swell, period, rating, verdict, and confidence.
- Show a clear 60-second countdown.
- Allow users to stop monitoring and return to the decision list.
- Preserve selected cameras until the user clears them or reloads.

If a selected camera has no stream, its tile should remain in the deck with a clear unavailable state and the metrics still visible.

## Wave Count Joke Field

The "how many waves will I catch?" field is intentionally unserious. It should always return surf slang, not a numeric forecast.

Examples:

- `So many mondo sick tubes, brahh`
- `Sets for days`
- `A suspicious number of party waves`
- `Enough to make your shoulders file a complaint`

The UI should make the joke obvious so users do not confuse it with model output. Suggested label: `Wave count forecast`.

## Data Flow

- Continue using `rateSurfSpot(camera)` as the source for rating, verdict inputs, wave estimate, wind fit, period, reasons, and recommendation sorting.
- Add a monitor selection state that tracks camera IDs independently from favorites.
- Selected monitor IDs should be capped at six.
- The monitor deck renders from the same camera records and rating helpers as the list, avoiding a second scoring path.
- The video player logic should support multiple simultaneous HLS elements in the deck without replacing the existing single selected-camera player.

## Error Handling

- If a stream fails in the monitor deck, show `Feed unavailable` on that tile and keep the rest of the deck running.
- If the user tries to select a seventh camera, keep the existing six and show a concise limit message.
- If no cameras are selected, disable `Monitor for 1 min`.
- If a selected camera is filtered out of the current list, it should remain in the monitor selection until cleared.

## Testing

- Unit test monitor selection state: add, remove, cap at six, preserve selected IDs across filtering.
- Unit test Best Today card data formatting: tide in English, adjusted surf height, confidence, wind, swell, period, and joke wave count.
- DOM/source tests should confirm the first screen includes Best Today and the monitor deck shell.
- Browser verification should cover desktop and mobile:
  - Best Today appears before secondary controls on mobile.
  - Six selected cameras render as two rows of three.
  - Monitor countdown starts and can be stopped.
  - Unavailable feed tiles do not break other tiles.

## Acceptance Criteria

- The app opens to a ranked Best Today decision surface.
- Users can select up to six cameras for monitoring.
- The monitor deck displays at most three cameras per row.
- A one-minute monitor flow runs with all selected camera tiles visible.
- Every monitored tile shows camera view state and the requested surf metrics.
- The wave count field is clearly a joke and never presents a numeric forecast.
