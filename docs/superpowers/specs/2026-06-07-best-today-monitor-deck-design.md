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

On mobile, the first viewport should prioritize the ranked Best Today cards. Counts, search, region filters, and the map move below this decision surface so the page answers "where should we go?" before exposing browsing controls.

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
- Ability fit, such as `mellow`, `mixed`, or `experienced`, so the rating does not imply the spot is safe for every surfer.
- A clear `Add to Monitor` control.

The selected-camera count should remain visible once any monitor cameras are selected. Suggested copy: `3/6 selected` and `Monitor 3 cams for 1 min`. The monitor action is disabled until at least one camera is selected.

Rows should avoid false precision in the decision surface. Use softened language where appropriate, such as `~1.4m`, `short 6-7s period`, or `regional exposure`.

## Monitor Deck

Users can select up to six cameras from Best Today or the camera list and start `Monitor for 1 min`.

The monitor deck should:

- Show all selected feeds at once.
- Cap layout at three cameras per row.
- Use one row for one to three cameras and two rows for four to six cameras.
- Use a video-first tile hierarchy so six simultaneous feeds remain readable.
- Keep a strict metric budget under each feed: spot name, verdict, expected surf height, wind, tide, period, confidence, and wave-count slang. Lower-priority details can move behind an expanded details view.
- Show a clear 60-second countdown.
- Start the countdown when the Monitor view opens, not when every stream has successfully loaded.
- Stop all active monitor players when the timer expires and offer `Run again`.
- Allow users to stop monitoring and return to the decision list.
- Preserve selected cameras until the user clears them or reloads.
- Preserve shortlist order in the monitor deck so the group can refer to tiles by position.

If a selected camera has no stream, its tile should remain in the deck with a clear unavailable state and the metrics still visible.

On desktop, one to three feeds fit in one row and four to six feeds fit in two rows. On mobile, the deck can stack tiles vertically or use a readable two-column layout if space allows; the mobile deck should not shrink six videos into unreadable thumbnails.

## Group Summary

After a monitor session, the app should provide a `Copy group summary` action. It should copy a plain-text summary for group chat with selected spots, ranking, verdicts, one-line reasons, confidence, and wave-count slang. This completes the group decision workflow without adding voting, comments, accounts, or shared rooms.

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
- Each monitor tile should own its stream lifecycle so one loading, failed, stalled, or unavailable stream does not affect the rest of the deck.

## Error Handling

- If a stream fails in the monitor deck, show a tile-level state such as `Feed unavailable`, `Retrying`, or `Expired` and keep the rest of the deck running.
- If the user tries to select a seventh camera, keep the existing six and show a concise limit message.
- If no cameras are selected, disable `Monitor for 1 min`.
- If a selected camera is filtered out of the current list, it should remain in the monitor selection until cleared.

## Testing

- Unit test monitor selection state: add, remove, cap at six, preserve selected IDs across filtering.
- Unit test Best Today card data formatting: tide in English, adjusted surf height, confidence, ability fit, wind, swell, period, and joke wave count.
- Unit test monitor tile lifecycle states: loading, playing, unavailable, retrying, and expired.
- Unit test copied group summary content.
- DOM/source tests should confirm the first screen includes Best Today and the monitor deck shell.
- Browser verification should cover desktop and mobile:
  - Best Today appears before secondary controls on mobile.
  - Six selected cameras render as two rows of three.
  - Monitor countdown starts and can be stopped.
  - Unavailable feed tiles do not break other tiles.
  - The post-monitor group summary can be copied.

## Acceptance Criteria

- The app opens to a ranked Best Today decision surface.
- Users can select up to six cameras for monitoring.
- The monitor deck displays at most three cameras per row.
- A one-minute monitor flow runs with all selected camera tiles visible.
- Every monitored tile shows camera view state and the requested surf metrics.
- Monitor tile failures remain isolated to the failed tile.
- The app can copy a group-chat summary after monitoring.
- The wave count field is clearly a joke and never presents a numeric forecast.
