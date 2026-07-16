# Surfline Feed Precedence Design

Date: 2026-07-15

Status: Approved; implementation authorized

Builds on: `2026-07-11-spot-advice-local-lens-design.md`

## 1. Goal

Make every user-facing surf spot camera-led. When a configured raw Surfline camera feed exists for a spot, that feed must represent the spot. MEO is the fallback only when Surfline has no configured raw feed. A spot with neither feed must not appear in the app.

The app must never ask the user to open a Surfline report as a substitute for a camera.

## 2. Product decision

For each researched Surfline subject, the feed precedence is:

1. a valid raw Surfline feed matched to one of that subject's Surfline cameras;
2. the subject's exact trusted MEO camera, when it has a stream; or
3. exclusion from every user-facing spot roster.

This precedence is unconditional at resolution time. A configured Surfline feed wins even when the same subject also has a working MEO stream.

`stretchCamIds` do not satisfy the MEO fallback. They are nearby area cameras, not a feed of the selected spot. Evidence links in the Local playbook remain available as provenance, but they are not camera actions.

Discovery-only aggregators such as GoSurf/Viewsurf do not enter this precedence and do not satisfy feed availability. Their inventory may inform offline research, but the runtime has no resolver, health job, or playback dependency for them.

## 3. Meaning of “available”

A Surfline feed is available when all of the following are true:

- a provider camera appears in the subject's ordered `surflineCams` list;
- its still-image URL yields a camera id;
- `data/local-stream-overrides.json.__rawSurflineFeeds` contains a valid entry for that id; and
- the entry has a valid HTTPS stream URL.

The first matching camera in Surfline's provider order wins. The optional image in the raw registry becomes the video poster.

This design does not add live health probing. If a configured Surfline HLS stream later fails during playback, the player shows an unavailable state. It does not switch to MEO and does not expose a report link. MEO is used only when no valid Surfline registry match exists at resolution time.

## 4. Scope

This change applies to:

- the 42 promoted Surfline subjects inside the established proximity boundary;
- the two researched guide-only subjects, Cave and Praia da Ursa;
- trusted MEO camera records that resolve to one of those subjects through the canonical advice identity map; and
- Monitor, Might be good, Favorites, and Explore.

The canonical research and advice records remain in the repository even when their subject has no feed. They stop being selectable or renderable as spots until a feed is added.

Provider-native MEO cameras without a trusted Surfline subject retain their own MEO stream. This change does not delete source records or redesign the broader camera database.

## 5. Current data outcome

The current 44 researched subjects resolve as follows.

### 5.1 Surfline raw feed: 22

- Nazaré
- Baleal
- Lagide
- Cantinho da Baía
- Supertubos
- Ribeira D'Ilhas
- Reef
- Pedra Branca
- Praia do Sul
- Foz do Lizandro
- Praia Pequena
- Praia Grande
- Praia do Guincho
- Paco de Arcos
- Santo Amaro
- Carcavelos
- Cova do Vapor
- São João da Caparica
- Praia do Barbas
- Costa da Caparica
- Castelo
- Fonte da Telha

### 5.2 Exact MEO fallback: 14

- Consolação
- Santa Cruz
- Matadouro
- São Julião
- Praia das Maçãs
- Praia da Adraga
- São Pedro do Estoril
- Parede
- Praia da Laje
- Praia de Torre
- Praia da Rainha
- Lagoa de Albufeira
- Bicas
- Sesimbra

### 5.3 Excluded: 8

- Praia de Caxias
- Marcelino
- Praia da Saude
- Praia da Cornelia
- Praia do Pescador
- Praia do Rei
- Cave
- Praia da Ursa

The first six are promoted subjects without a raw Surfline feed or exact linked MEO feed. Cave and Praia da Ursa are guide-only subjects with no feed.

## 6. Runtime architecture

Feed resolution is a single pure data step before any user-facing roster, ranking, favorite sanitation, or playback code runs.

The runtime pipeline becomes:

1. load the base camera database, normalized spot data, tide data, and local stream registry;
2. apply spot metadata to the base MEO cameras;
3. merge promoted Surfline subjects and canonical advice subjects;
4. normalize the raw Surfline feed registry;
5. resolve the preferred feed for every camera record;
6. derive the feed-backed user-facing roster; and
7. render all product surfaces from that same roster.

The merged canonical database remains available for conditions, advice, and source lookups. It must not be used as an alternate unfiltered roster by Favorites or any other surface.

## 7. Feed normalization and matching

### 7.1 Raw registry

Normalize `__rawSurflineFeeds` into a map keyed by camera id. Ignore entries with:

- a missing or malformed id;
- a duplicate id after the first valid entry;
- a missing or non-HTTPS stream URL; or
- malformed optional image data.

The reserved metadata keys must never be interpreted as ordinary camera ids. Existing direct camera overrides remain supported for native camera records, but they do not outrank a matched raw Surfline feed.

### 7.2 Surfline camera id extraction

Extract the provider camera id from the final directory of a valid Surfline still-image URL, for example:

```text
https://camstills.cdn-surfline.com/eu-west-1/pt-carcavelosov/latest_small.jpg
                                                    ^^^^^^^^^^^^^^^^^
```

Only known Surfline still-image hosts and a safe camera-id token are accepted. A malformed still URL cannot become a lookup key.

### 7.3 Logical subject resolution

For a promoted record, the logical subject is its own Surfline id. For a native MEO record, use only the existing trusted canonical advice identity mapping. Do not infer identity from proximity or from `stretchCamIds`.

If the logical subject has a matched raw Surfline feed, materialize it on every user-facing representation of that subject. This ensures that a MEO-native record already associated with the subject cannot bypass Surfline precedence on Favorites or Explore.

When no Surfline feed matches:

- a promoted record may copy stream fields from its exact `linkedCamId` MEO record;
- a native MEO record retains its own valid stream; and
- any record still lacking a stream is excluded from the user-facing roster.

### 7.4 Resolved provenance

Every resolved record carries explicit runtime provenance:

```js
{
  streamSource: "surfline-raw" | "meo",
  feedCameraId: "provider-camera-id",
  streamUrl: "https://…",
  image: "https://…",
  hasStream: true
}
```

`streamSource` is the product rule, not a label inferred later from URL text.

## 8. User-facing behavior

### 8.1 Monitor and Might be good

- Every rendered tile or recommendation has a playable feed.
- A logical subject with both providers uses Surfline.
- Recommendation representative selection explicitly ranks `surfline-raw` above `meo` if duplicate records for a subject remain in the candidate set.
- There is no report-only tile and no report action.

### 8.2 Favorites

- The manager is built from the feed-backed roster, not the canonical unfiltered database.
- Stored favorite ids that are no longer feed-backed are sanitized out through the existing favorite cleanup path.
- Favorite cards never offer a report link.

### 8.3 Explore

- The list, map markers, selected spot, and player all use the same feed-backed roster.
- The nearby Surfline report selector is removed.
- Selecting a spot always attempts camera playback.
- Player failure produces a local unavailable status, not an external report action.

### 8.4 Local playbook

Source links attached to individual advice claims remain. They are evidence and continue to open their cited source. Removing camera-report navigation must not remove this provenance.

## 9. Removed behavior

Delete the report-substitute path rather than leaving it dormant:

- `Open Surfline report` actions;
- report-only monitor frames;
- report-only recommendation actions;
- the nearby Surfline report selector;
- report routing in Explore playback; and
- camera utilities that give a report page partial eligibility as a live camera.

No user-facing spot can qualify merely because it has `surfline.pageUrl` or `pageUrl`.

## 10. Failure handling

- Missing or unreadable local overrides: retain valid MEO streams, exclude unresolved promoted and guide-only subjects, and render no report substitutes.
- Invalid Surfline entry for a subject: treat it as absent and use the exact MEO fallback if one exists.
- Failed Surfline playback after resolution: show `Feed unavailable`; do not fall back to MEO automatically.
- Failed MEO playback: show `Feed unavailable`.
- Empty feed-backed roster: show the existing honest empty state instead of canonical no-feed records.

## 11. Testing strategy

Implementation follows test-driven development. Tests are added before behavior changes.

### 11.1 Pure feed-policy tests

- Surfline raw wins over an existing MEO stream for the same trusted subject.
- The first provider-ordered matching Surfline camera wins.
- A malformed first camera can be skipped for a later valid match.
- No Surfline match uses the exact linked MEO stream for a promoted subject.
- `stretchCamIds` do not become a spot feed.
- Neither provider produces an excluded record.
- A native MEO record with no trusted Surfline subject retains its own stream.
- Invalid schemes, hosts, ids, duplicate ids, and reserved keys are ignored safely.

### 11.2 Integration tests

- Startup resolves feeds before `state.cameras`, favorites, recommendations, and Explore are derived.
- The current fixture resolves the promoted subjects to 22 Surfline, 14 MEO, and 6 excluded, with two additional guide-only subjects excluded.
- Surfline wins in recommendation representative selection.
- Favorites and Explore do not read the unfiltered canonical roster.
- Canonical advice remains available for an excluded subject.

### 11.3 UI and source-safety tests

- No app source or generated user-facing markup contains `Open Surfline report`.
- Report-only frame, action, and playback branches are absent.
- The nearby report selector is absent.
- Advice evidence links still render with safe external-link attributes.
- Existing HLS playback, CSP, and source-safety checks continue to pass.

## 12. Acceptance criteria

The work is complete when:

1. the configured raw Surfline feed always represents a trusted logical subject when present;
2. exact MEO is used only when the subject has no configured Surfline feed;
3. the eight named no-feed research subjects are absent from all user-facing surfaces;
4. report-only spots, report cards, report buttons, and the nearby report selector are gone;
5. all product surfaces use one centrally resolved feed-backed roster;
6. advice and evidence remain available in canonical data without making no-feed subjects selectable;
7. a Surfline playback error does not silently switch providers or open a report; and
8. the full test suite passes.

## 13. Out of scope

- deleting canonical spot research or advice;
- publishing or discovering new private feed URLs;
- continuously probing HLS health;
- automatic provider failover after playback begins;
- redesigning the broader Favorites or Explore information architecture;
- changing Surfline forecast or face-height calibration logic; and
- integrating discovery-only camera aggregators into runtime feed resolution; and
- changing Local playbook evidence provenance.
