import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";

const readJson = (path) => JSON.parse(fs.readFileSync(path, "utf8"));
const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
};
const digestClaim = (claim) => crypto.createHash("sha256")
  .update(`${JSON.stringify(canonicalize(claim), null, 2)}\n`)
  .digest("hex");

const promotions = readJson("data/surfline-promotions.json").promoted.map((row) => row.surflineSpotId);
const document = readJson("data/spot-advice.json");
const claimsById = new Map(document.advice.map((claim) => [claim.id, claim]));
const decisionTopics = new Set(["size-translation", "tide", "swell", "wind", "mechanics"]);
const expectedGroups = {
  nazarePeniche: ["surfline-nazare", "surfline-baleal", "surfline-lagide", "surfline-cantinho-da-baia", "surfline-supertubos", "surfline-consolacao"],
  santaCruzEriceira: ["surfline-santa-cruz", "surfline-cave", "surfline-ribeira-d-ilhas", "surfline-reef", "surfline-pedra-branca", "surfline-matadouro", "surfline-praia-do-sul", "surfline-foz-do-lizandro", "surfline-sao-juliao"],
  sintraGuincho: ["surfline-praia-das-macas", "surfline-praia-pequena", "surfline-praia-grande", "surfline-praia-da-adraga", "surfline-praia-da-ursa", "surfline-praia-do-guincho"],
  linha: ["surfline-praia-de-caxias", "surfline-sao-pedro-do-estoril", "surfline-paco-de-arcos", "surfline-parede", "surfline-praia-da-laje", "surfline-santo-amaro", "surfline-carcavelos", "surfline-praia-de-torre"],
  caparica: ["surfline-cova-do-vapor", "surfline-sao-joao-da-caparica", "surfline-marcelino", "surfline-praia-do-barbas", "surfline-costa-da-caparica", "surfline-praia-da-saude", "surfline-praia-da-cornelia", "surfline-praia-da-rainha", "surfline-castelo", "surfline-praia-do-pescador", "surfline-praia-do-rei", "surfline-fonte-da-telha"],
  south: ["surfline-lagoa-de-albufeira", "surfline-bicas", "surfline-sesimbra"]
};
const caparicaIds = expectedGroups.caparica;

test("spot advice keeps the exact 44-spot promotion order and six research batches", () => {
  assert.equal(promotions.length, 44);
  assert.deepEqual(document.spotResearch.map((row) => row.spotId), promotions);
  assert.deepEqual(Object.values(expectedGroups).flat(), promotions);
  assert.equal(claimsById.size, document.advice.length, "duplicate advice ids must fail");
});

test("direction rules match the published Nazaré and Carcavelos summaries", () => {
  const nazare = claimsById.get("research-nazare-swell");
  assert.match(nazare.summary, /West to northwest/);
  assert.deepEqual(nazare.rule, { type: "direction-preference", input: "primary-swell-direction-deg", arcs: [{ start: 270, end: 315 }] });

  const carcavelos = claimsById.get("research-carcavelos-swell");
  assert.match(carcavelos.summary, /West through southwest/);
  assert.deepEqual(carcavelos.rule, { type: "direction-preference", input: "primary-swell-direction-deg", arcs: [{ start: 225, end: 270 }] });
});

test("research, source, claim, and rule enums are valid", () => {
  const enums = {
    outcome: new Set(["found", "no-credible-spot-source-found"]),
    location: new Set(["exact-spot", "stretch", "area", "mismatch"]),
    decision: new Set(["accepted", "rejected"]),
    topic: new Set(["size-translation", "tide", "swell", "period-energy", "wind", "season", "mechanics", "ability", "hazard", "crowd-access"]),
    scope: new Set(["spot", "stretch", "area"]),
    confidence: new Set(["high", "medium", "low"]),
    publication: new Set(["draft", "published", "rejected"]),
    consensus: new Set(["settled", "unresolved"]),
    evidenceKind: new Set(["user-observed", "local-guide", "specialist-guide", "provider", "inference"]),
    rule: new Set(["minimum", "tide-preference", "direction-preference", "qualitative"])
  };
  for (const row of document.spotResearch) {
    assert.equal(row.status, "complete");
    assert.ok(enums.outcome.has(row.directEvidenceOutcome));
    assert.ok(row.checkedSources.length > 0);
    for (const source of row.checkedSources) {
      assert.ok(source.title && source.publisher && source.url && source.rationale);
      assert.ok(enums.location.has(source.locationMatch));
      assert.ok(enums.decision.has(source.decision));
    }
  }
  for (const claim of document.advice) {
    assert.ok(enums.topic.has(claim.topic));
    assert.ok(enums.scope.has(claim.scope.type));
    assert.ok(enums.confidence.has(claim.confidence));
    assert.ok(enums.publication.has(claim.publicationStatus));
    assert.ok(enums.consensus.has(claim.consensus));
    assert.ok(!claim.rule || enums.rule.has(claim.rule.type));
    assert.ok(claim.evidence.every((item) => enums.evidenceKind.has(item.kind)));
    if (claim.publicationStatus === "published" && claim.scope.type === "spot") {
      const accepted = claim.evidence.filter((item) => item.status === "accepted");
      assert.ok(accepted.length > 0);
      assert.ok(!accepted.every((item) => item.quality === "general-beach-directory"), `${claim.id}: general directory alone cannot support a published spot claim`);
    }
    for (const inference of claim.evidence.filter((item) => item.kind === "inference" && item.status === "accepted")) {
      assert.ok(Array.isArray(inference.inputClaimIds) && inference.inputClaimIds.length >= 2, `${claim.id}: inference must cite at least two inputs`);
      for (const inputId of inference.inputClaimIds) {
        const input = claimsById.get(inputId);
        assert.ok(input?.evidence.some((item) => item.status === "accepted"), `${claim.id}: inference input ${inputId} is not accepted`);
      }
    }
  }
});

test("direct and inherited evidence are traceable and rejected sources never support claims", () => {
  const stretchClaim = claimsById.get("user-caparica-high-tide");
  const stretchDigest = digestClaim(stretchClaim);
  for (const row of document.spotResearch) {
    const acceptedUrls = new Set(row.checkedSources.filter((source) => source.decision === "accepted").map((source) => source.url));
    const rejectedUrls = new Set(row.checkedSources.filter((source) => source.decision === "rejected").map((source) => source.url));
    const directClaims = (row.directClaimIds || []).map((id) => claimsById.get(id));
    assert.ok(directClaims.every(Boolean));
    if (row.directEvidenceOutcome === "found") assert.ok(directClaims.length > 0);
    if (row.directEvidenceOutcome === "no-credible-spot-source-found") assert.equal(directClaims.length, 0);
    for (const claim of directClaims) {
      assert.deepEqual(claim.scope, { type: "spot", id: row.spotId });
      assert.ok(claim.evidence.some((item) => item.status === "accepted" && (item.kind === "user-observed" || item.locationMatch === "exact-spot")));
      for (const evidence of claim.evidence.filter((item) => item.url)) {
        assert.ok(acceptedUrls.has(evidence.url), `${row.spotId}: evidence URL was not accepted`);
        assert.ok(!rejectedUrls.has(evidence.url), `${row.spotId}: rejected source supports claim`);
      }
    }
    if (caparicaIds.includes(row.spotId)) {
      assert.deepEqual(row.inheritedApprovals, [{ claimId: stretchClaim.id, claimDigest: stretchDigest }]);
    }
    const approvedInherited = (row.inheritedApprovals || []).map((approval) => {
      assert.match(approval.claimDigest, /^[a-f0-9]{64}$/);
      const claim = claimsById.get(approval.claimId);
      assert.ok(claim);
      assert.equal(approval.claimDigest, digestClaim(claim));
      return claim;
    });
    assert.ok([...directClaims, ...approvedInherited].some((claim) => claim.publicationStatus === "published" && decisionTopics.has(claim.topic)), `${row.spotId}: no decision-relevant effective claim`);
  }
});

test("Rainha overrides the approved Caparica tide pattern and shifting banks expire", () => {
  const rainha = document.spotResearch.find((row) => row.spotId === "surfline-praia-da-rainha");
  const rainhaClaim = rainha.directClaimIds.map((id) => claimsById.get(id)).find((claim) => claim.overrideKey === "tide.preferred-stage");
  assert.equal(rainhaClaim.rule.stage, "mid");
  assert.ok(rainha.inheritedApprovals.some((approval) => approval.claimId === "user-caparica-high-tide"));
  for (const id of ["research-praia-da-cornelia-mechanics", "research-castelo-mechanics"]) {
    assert.match(claimsById.get(id).revalidateAfter, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test("the five user observations preserve their exact structured rules", () => {
  const expected = {
    "user-sesimbra-minimum-primary-swell": { scope: { type: "spot", id: "surfline-sesimbra" }, rule: { type: "minimum", input: "primary-swell-height-m", value: 2, comparison: "greater-than-or-equal", effectBelow: "likely-flat" } },
    "user-caxias-minimum-primary-swell": { scope: { type: "spot", id: "surfline-praia-de-caxias" }, rule: { type: "minimum", input: "primary-swell-height-m", value: 2, comparison: "greater-than-or-equal", effectBelow: "likely-flat" } },
    "user-torre-minimum-primary-swell": { scope: { type: "spot", id: "surfline-praia-de-torre" }, rule: { type: "minimum", input: "primary-swell-height-m", value: 1.5, comparison: "greater-than-or-equal", effectBelow: "likely-flat", effectAtOrAbove: "may-start-working" } },
    "user-caparica-high-tide": { scope: { type: "stretch", id: "caparica" }, rule: { type: "tide-preference", stage: "high" } },
    "user-sao-juliao-mid-tide": { scope: { type: "spot", id: "surfline-sao-juliao" }, rule: { type: "tide-preference", stage: "mid" } }
  };
  for (const [id, shape] of Object.entries(expected)) {
    const claim = claimsById.get(id);
    assert.ok(claim, `missing ${id}`);
    assert.equal(claim.publicationStatus, "published");
    assert.equal(claim.calculationCandidate, false);
    assert.deepEqual({ scope: claim.scope, rule: claim.rule }, shape);
  }
  const saoJuliao = document.spotResearch.find((row) => row.spotId === "surfline-sao-juliao");
  assert.ok(saoJuliao.checkedSources.every((source) => !source.rationale.includes("numeric threshold")));
});
