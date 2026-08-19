export function stretchMembers(camera, spotData, camerasById) {
  const stretch = spotData.stretchBySpotId?.get(camera.id);
  if (!stretch) return null;
  return {
    stretchId: stretch.id,
    stretchName: stretch.name,
    cams: stretch.meoCamIds.map((id) => camerasById.get(id)).filter(Boolean),
    spots: stretch.surflineSpotIds.map((id) => {
      const spot = spotData.surflineById?.get(id) ?? spotData.promotedById?.get(id);
      return spot ? {
        id,
        name: spot.name,
        conditions: spotData.conditionsById?.get(id) ?? null
      } : null;
    }).filter(Boolean)
  };
}
