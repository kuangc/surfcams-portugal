const signedQueryName = "wmsauthsign";
const idleState = 0;
const nameStateOffset = 1;
const firstPercentStateOffset = nameStateOffset + signedQueryName.length + 1;
const secondPercentStateOffset = firstPercentStateOffset + signedQueryName.length;
const completeState = secondPercentStateOffset + signedQueryName.length;
const relationStateCount = completeState + 1;
const lowStateCount = 32;
const staticRelationCache = new Map();

function hexNibble(character) {
  const code = character.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 65 && code <= 70) return code - 55;
  if (code >= 97 && code <= 102) return code - 87;
  return -1;
}

function nameState(progress) {
  return nameStateOffset + progress;
}

function firstPercentState(progress) {
  return firstPercentStateOffset + progress;
}

function secondPercentState(progress) {
  return secondPercentStateOffset + progress;
}

function newRelation() {
  return {
    high: new Uint32Array(relationStateCount),
    low: new Uint32Array(relationStateCount),
    unsafe: new Uint8Array(relationStateCount)
  };
}

function addOutput(target, input, output) {
  if (output < lowStateCount) {
    target.low[input] = (target.low[input] | (1 << output)) >>> 0;
  } else {
    target.high[input] = (target.high[input] | (1 << (output - lowStateCount))) >>> 0;
  }
}

function forEachOutput(source, input, visitor) {
  let low = source.low[input];
  while (low !== 0) {
    const output = 31 - Math.clz32(low);
    visitor(output);
    low = (low & ~(1 << output)) >>> 0;
  }
  let high = source.high[input];
  while (high !== 0) {
    const offset = 31 - Math.clz32(high);
    visitor(lowStateCount + offset);
    high = (high & ~(1 << offset)) >>> 0;
  }
}

function identityRelation() {
  const result = newRelation();
  for (let state = 0; state < relationStateCount; state += 1) addOutput(result, state, state);
  return result;
}

function barrierRelation() {
  const result = newRelation();
  for (let state = 0; state < relationStateCount; state += 1) {
    addOutput(result, state, idleState);
  }
  return result;
}

const emptyOutputRelation = identityRelation();
const dynamicOutputRelation = barrierRelation();

function transitionMarkerState(state, rawCharacter) {
  if (/[\t\r\n]/.test(rawCharacter)) return {state};
  const character = rawCharacter.toLowerCase();
  if (state === completeState) {
    if (character === "&") return {state: nameState(0)};
    if (character === "#") return {state: idleState};
    return {unsafe: true};
  }
  if (character === "?" || character === "&") return {state: nameState(0)};
  if (state >= firstPercentStateOffset && state < secondPercentStateOffset) {
    const progress = state - firstPercentStateOffset;
    const expected = signedQueryName.charCodeAt(progress);
    const nibble = hexNibble(rawCharacter);
    return (nibble === (expected >> 4) || nibble === (expected - 32 >> 4))
      ? {state: secondPercentState(progress)}
      : {state: idleState};
  }
  if (state >= secondPercentStateOffset && state < completeState) {
    const progress = state - secondPercentStateOffset;
    const expected = signedQueryName.charCodeAt(progress);
    return hexNibble(rawCharacter) === (expected & 0x0f)
      ? {state: nameState(progress + 1)}
      : {state: idleState};
  }
  if (state >= nameStateOffset && state < firstPercentStateOffset) {
    const progress = state - nameStateOffset;
    if (progress === signedQueryName.length) {
      return character === "=" ? {state: completeState} : {state: idleState};
    }
    if (character === "%") return {state: firstPercentState(progress)};
    return character === signedQueryName[progress]
      ? {state: nameState(progress + 1)}
      : {state: idleState};
  }
  return {state: idleState};
}

function relationForStaticText(text, diagnostics) {
  const value = String(text);
  if (diagnostics) {
    diagnostics.signedStaticInputCharacters =
      (diagnostics.signedStaticInputCharacters ?? 0) + value.length;
  }
  if (value.length === 0) return emptyOutputRelation;
  if (staticRelationCache.has(value)) return staticRelationCache.get(value);
  const result = newRelation();
  for (let input = 0; input < relationStateCount; input += 1) {
    let state = input;
    let unsafe = false;
    for (const character of value) {
      const advanced = transitionMarkerState(state, character);
      if (advanced.unsafe) {
        unsafe = true;
        break;
      }
      state = advanced.state;
    }
    if (unsafe) result.unsafe[input] = 1;
    else addOutput(result, input, state);
  }
  staticRelationCache.set(value, result);
  return result;
}

function composeRelations(first, second, diagnostics) {
  if (diagnostics) {
    diagnostics.signedRelationCompositions =
      (diagnostics.signedRelationCompositions ?? 0) + 1;
  }
  const result = newRelation();
  for (let input = 0; input < relationStateCount; input += 1) {
    if (first.unsafe[input]) result.unsafe[input] = 1;
    forEachOutput(first, input, (middle) => {
      if (second.unsafe[middle]) result.unsafe[input] = 1;
      result.low[input] = (result.low[input] | second.low[middle]) >>> 0;
      result.high[input] = (result.high[input] | second.high[middle]) >>> 0;
    });
  }
  return result;
}

function composeRelationList(relations, diagnostics, empty = dynamicOutputRelation) {
  if (relations.length === 0) return empty;
  let result = relations[0];
  for (let index = 1; index < relations.length; index += 1) {
    result = composeRelations(result, relations[index], diagnostics);
  }
  return result;
}

function unionRelations(...relations) {
  const result = newRelation();
  for (const source of relations) {
    for (let input = 0; input < relationStateCount; input += 1) {
      result.low[input] = (result.low[input] | source.low[input]) >>> 0;
      result.high[input] = (result.high[input] | source.high[input]) >>> 0;
      if (source.unsafe[input]) result.unsafe[input] = 1;
    }
  }
  return result;
}

function relationIsUnsafe(relation) {
  return relation.unsafe[idleState] === 1;
}

export {
  composeRelationList,
  composeRelations,
  dynamicOutputRelation,
  emptyOutputRelation,
  relationForStaticText,
  relationIsUnsafe,
  unionRelations
};
