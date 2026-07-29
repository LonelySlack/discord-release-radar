/**
 * Match provider names from APIs against the user's configured streaming services.
 */
function matchServices(providerNames, servicesConfig) {
  if (!providerNames || providerNames.length === 0) return [];

  const hits = [];
  const seen = new Set();

  for (const service of servicesConfig) {
    for (const provider of providerNames) {
      const p = String(provider).toLowerCase();
      const matched = service.match.some((m) => p.includes(m.toLowerCase()));
      if (matched && !seen.has(service.id)) {
        seen.add(service.id);
        hits.push(service.label);
      }
    }
  }

  return hits;
}

/**
 * availabilityByRegion: { MY: ["Netflix"], SG: ["Disney+"], ... }
 * Returns structured availability preferring primary region, then fallbacks.
 */
function formatAvailability(availabilityByRegion, primaryRegion, fallbackRegions, servicesConfig) {
  const regions = [primaryRegion, ...fallbackRegions.filter((r) => r !== primaryRegion)];
  const byRegion = {};

  for (const region of regions) {
    const names = availabilityByRegion[region] || [];
    const matched = matchServices(names, servicesConfig);
    if (matched.length) {
      byRegion[region] = matched;
    }
  }

  const primaryServices = byRegion[primaryRegion] || [];
  const otherRegions = Object.entries(byRegion).filter(([r]) => r !== primaryRegion);

  return {
    primaryServices,
    otherRegions, // [[region, services[]], ...]
    hasAny: primaryServices.length > 0 || otherRegions.length > 0,
    onPrimary: primaryServices.length > 0,
  };
}

module.exports = { matchServices, formatAvailability };
