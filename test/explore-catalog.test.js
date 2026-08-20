import assert from "node:assert/strict";
import test from "node:test";

import {
  buildExploreCatalog,
  createExplorePlaybackIndex,
  explorePlaybackCamera
} from "../src/explore-catalog.js";
import {
  createFavoriteCatalogIndex
} from "../src/favorite-catalog.js";
import {
  favoriteExploreIds
} from "../src/explore-catalog.js";

const playback = [
  {
    id: "riviera",
    name: "Costa de Caparica | Riviera",
    location: "ALMADA",
    region: "almada",
    hasStream: true,
    streamUrl: "https://video-auth1.iol.pt/beachcam/riviera/playlist.m3u8"
  },
  {
    id: "fonte",
    name: "Fonte da Telha",
    location: "ALMADA",
    region: "almada",
    hasStream: true,
    streamUrl: "https://video-auth1.iol.pt/beachcam/fonte/playlist.m3u8"
  }
];

test("Explore combines playable MEO cameras with media-free Surfline information subjects", () => {
  const canonicalDb = { cameras: [
    { ...playback[0], name: "stale duplicate" },
    { id: "offline-meo", name: "Offline", hasStream: false },
    {
      id: "surfline-castelo",
      name: "Castelo",
      region: "almada",
      promoted: true,
      linkedCamId: "riviera",
      hasStream: true,
      streamUrl: "https://hls.cdn-surfline.com/raw/playlist.m3u8",
      poster: "https://camstills.cdn-surfline.com/raw.jpg",
      surflineCams: [{ stillUrl: "https://camstills.cdn-surfline.com/raw.jpg" }]
    },
    {
      id: "surfline-cave",
      name: "Cave",
      region: "peniche",
      adviceGuideOnly: true,
      stillUrl: "https://camstills.cdn-surfline.com/cave.jpg"
    }
  ] };

  const catalog = buildExploreCatalog(playback, canonicalDb);

  assert.deepEqual(catalog.map(({ id }) => id), [
    "riviera",
    "fonte",
    "surfline-castelo",
    "surfline-cave"
  ]);
  assert.equal(catalog[0], playback[0], "playback identity wins a canonical collision");
  for (const subject of catalog.filter(({ exploreInformationOnly }) => exploreInformationOnly)) {
    assert.equal(subject.hasStream, false);
    for (const field of ["streamUrl", "videoId", "livecamId", "image", "poster", "stillUrl", "surflineCams"]) {
      assert.equal(Object.hasOwn(subject, field), false, `${subject.id} omits ${field}`);
    }
  }
});

test("Explore resolves playback only to the named native MEO camera or stretch fallback", () => {
  assert.equal(explorePlaybackCamera(playback[0], playback), playback[0]);
  assert.equal(explorePlaybackCamera({ linkedCamId: "riviera" }, playback), playback[0]);
  assert.equal(explorePlaybackCamera({ linkedCamId: "missing", stretchCamIds: ["missing", "fonte"] }, playback), playback[1]);
  assert.equal(explorePlaybackCamera({ adviceGuideOnly: true }, playback), null);
  assert.equal(explorePlaybackCamera(null, playback), null);
});

test("Explore playback and favorite lookups reuse prebuilt indexes", () => {
  const playbackIndex = createExplorePlaybackIndex(playback);
  const favoriteIndex = createFavoriteCatalogIndex(playback, new Set(["riviera"]));
  const subjects = [
    ...playback,
    { id: "surfline-castelo", linkedCamId: "riviera", exploreInformationOnly: true },
    { id: "surfline-cave", adviceGuideOnly: true, exploreInformationOnly: true }
  ];

  assert.equal(explorePlaybackCamera({ linkedCamId: "riviera" }, playbackIndex), playback[0]);
  assert.equal(explorePlaybackCamera({ linkedCamId: "missing", stretchCamIds: ["fonte"] }, playbackIndex), playback[1]);
  assert.deepEqual(
    [...favoriteExploreIds(subjects, playbackIndex, favoriteIndex)],
    ["riviera", "surfline-castelo"]
  );
});
