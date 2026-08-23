import {
  createStaticPrimitiveOutcomeAnalyzer
} from "./static-primitive-outcomes.js";

function createCredentialKeyOutcomeAnalyzer(credentialLabel, diagnostics) {
  const analyzer = createStaticPrimitiveOutcomeAnalyzer({
    diagnosticPrefix: "credentialKeyOutcome",
    diagnostics
  });

  function findLabel(node) {
    const outcome = analyzer.outcomes(node);
    if (outcome.conservative || outcome.opaque) {
      return credentialLabel("wmsAuthSign");
    }
    return outcome.values.map((value) => credentialLabel(String(value))).find(Boolean) ?? null;
  }

  function findExplicitLabel(node) {
    const outcome = analyzer.outcomes(node);
    if (outcome.conservative) return credentialLabel("wmsAuthSign");
    return outcome.values.map((value) => credentialLabel(String(value))).find(Boolean) ?? null;
  }

  return {findExplicitLabel, findLabel};
}

export {createCredentialKeyOutcomeAnalyzer};
