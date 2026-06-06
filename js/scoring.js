import { RECOMMENDATION_LEVELS } from './config.js';

/**
 * Score a convenience facility.
 * - Within ideal distance: full score (weight * 10)
 * - 1x-2x ideal: linear decrease to 0
 * - 2x-3x ideal: linear decrease to -(weight * 5)
 * - >3x ideal or not found: -(weight * 5)
 */
export function scoreConvenienceFacility(actualDistance, idealDistance, weight) {
  const maxScore = weight * 10;
  const maxPenalty = weight * 5;

  if (actualDistance === null) {
    // Not found within search radius → significant penalty
    return { score: -maxPenalty, status: 'not_found' };
  }

  const ratio = actualDistance / idealDistance;

  if (ratio <= 1) {
    return { score: maxScore, status: 'excellent' };
  } else if (ratio <= 2) {
    const score = maxScore * (2 - ratio);
    return { score, status: ratio <= 1.5 ? 'good' : 'ok' };
  } else if (ratio <= 3) {
    const score = -maxPenalty * (ratio - 2);
    return { score, status: 'poor' };
  } else {
    return { score: -maxPenalty, status: 'bad' };
  }
}

/**
 * Score a nuisance facility.
 * - Not found within search radius: small bonus (it's far)
 * - ≥ 2x min distance: full bonus (weight * 5)
 * - min ≤ actual < 2x min: linear from 0 to bonus
 * - 0.5x min ≤ actual < min: linear from 0 to -(weight * 10)
 * - < 0.5x min: max penalty -(weight * 10)
 */
export function scoreNuisanceFacility(actualDistance, minDistance, weight) {
  const maxBonus = weight * 5;
  const maxPenalty = weight * 10;

  if (actualDistance === null) {
    // Not found within search radius → positive (safe distance)
    return { score: maxBonus, status: 'not_found_good' };
  }

  const ratio = actualDistance / minDistance;

  if (ratio >= 2) {
    return { score: maxBonus, status: 'excellent' };
  } else if (ratio >= 1) {
    const score = maxBonus * (ratio - 1);
    return { score, status: ratio >= 1.5 ? 'good' : 'ok' };
  } else if (ratio >= 0.5) {
    const score = -maxPenalty * (1 - ratio) / 0.5;
    return { score, status: 'poor' };
  } else {
    return { score: -maxPenalty, status: 'bad' };
  }
}

/**
 * Calculate theoretical max and min raw scores for normalization.
 * includeMarket: true when market data is present, extends bounds by ±15.
 */
export function calculateScoreBounds(convenienceFacilities, nuisanceFacilities, conditions, includeMarket = false) {
  let maxRaw = 0;
  let minRaw = 0;

  for (const f of convenienceFacilities.filter(f => f.enabled)) {
    maxRaw += f.weight * 10;
    minRaw -= f.weight * 5;
  }

  for (const f of nuisanceFacilities.filter(f => f.enabled)) {
    maxRaw += f.weight * 5;
    minRaw -= f.weight * 10;
  }

  for (const c of conditions.filter(c => c.enabled)) {
    if (c.score > 0) maxRaw += c.score;
    else minRaw += c.score;
  }

  if (includeMarket) {
    maxRaw += 15;
    minRaw -= 15;
  }

  return { maxRaw, minRaw };
}

/**
 * Calculate market appreciation score from user-entered market data.
 * Returns { rawScore: -15..+15, details: {...} }
 */
export function calculateMarketScore(marketData) {
  if (!marketData) return { rawScore: 0, details: {} };

  const VOLUME_SCORES = { rising: 6, stable: 2, falling: -5 };
  const SUPPLY_SCORES = { undersupply: 5, balanced: 1, oversupply: -6 };

  const volumeScore = VOLUME_SCORES[marketData.volumeTrend] ?? 0;
  const supplyScore = SUPPLY_SCORES[marketData.supplyDemand] ?? 0;

  let priceScore = 0;
  const pct = parseFloat(marketData.priceChange);
  if (!isNaN(pct)) {
    if      (pct >= 10)  priceScore =  4;
    else if (pct >=  5)  priceScore =  3;
    else if (pct >=  0)  priceScore =  1;
    else if (pct >= -5)  priceScore = -2;
    else if (pct >= -10) priceScore = -4;
    else                 priceScore = -6;
  }

  const projectScore = marketData.hasMajorProject === true ? 4 : 0;
  const rawScore = Math.max(-15, Math.min(15,
    volumeScore + supplyScore + priceScore + projectScore
  ));

  return { rawScore, details: { volumeScore, supplyScore, priceScore, projectScore } };
}

/**
 * Normalize raw score to 0-100.
 */
export function normalizeScore(rawScore, maxRaw, minRaw) {
  const range = maxRaw - minRaw;
  if (range === 0) return 50;
  const normalized = (rawScore - minRaw) / range * 100;
  return Math.max(0, Math.min(100, Math.round(normalized)));
}

/**
 * Get recommendation label based on normalized score.
 */
export function getRecommendation(normalizedScore) {
  for (const level of RECOMMENDATION_LEVELS) {
    if (normalizedScore >= level.min) return level;
  }
  return RECOMMENDATION_LEVELS[RECOMMENDATION_LEVELS.length - 1];
}

/**
 * Run the full scoring calculation.
 * Returns detailed results for each facility and conditions, plus final score.
 */
export function calculateFullScore(nearestMap, convenienceFacilities, nuisanceFacilities, conditions, conditionValues, marketData = null) {
  const results = {
    convenience: [],
    nuisance: [],
    conditions: [],
    rawScore: 0,
    normalizedScore: 0,
    recommendation: null
  };

  // Score convenience facilities
  for (const f of convenienceFacilities.filter(f => f.enabled)) {
    const info = nearestMap ? (nearestMap.get(f.id) ?? null) : null;
    const dist = info?.distance ?? null;
    const { score, status } = scoreConvenienceFacility(dist, f.idealDistance, f.weight);
    results.rawScore += score;
    results.convenience.push({
      id: f.id,
      name: f.name,
      icon: f.icon,
      actualDistance: dist,
      poiLat: info?.lat ?? null,
      poiLng: info?.lng ?? null,
      idealDistance: f.idealDistance,
      weight: f.weight,
      score,
      status
    });
  }

  // Score nuisance facilities
  for (const f of nuisanceFacilities.filter(f => f.enabled)) {
    const info = nearestMap ? (nearestMap.get(f.id) ?? null) : null;
    const dist = info?.distance ?? null;
    const { score, status } = scoreNuisanceFacility(dist, f.minDistance, f.weight);
    results.rawScore += score;
    results.nuisance.push({
      id: f.id,
      name: f.name,
      icon: f.icon,
      actualDistance: dist,
      poiLat: info?.lat ?? null,
      poiLng: info?.lng ?? null,
      minDistance: f.minDistance,
      weight: f.weight,
      score,
      status
    });
  }

  // Score conditions (only if user has answered)
  for (const c of conditions.filter(c => c.enabled)) {
    const value = conditionValues ? conditionValues[c.id] : null;
    const appliedScore = value === true ? c.score : 0;
    results.rawScore += appliedScore;
    results.conditions.push({
      id: c.id,
      name: c.name,
      icon: c.icon,
      score: c.score,
      appliedScore,
      value
    });
  }

  // Market appreciation score
  const marketResult = calculateMarketScore(marketData);
  results.rawScore += marketResult.rawScore;
  results.market = { rawScore: marketResult.rawScore, details: marketResult.details, data: marketData };

  // Normalize
  const { maxRaw, minRaw } = calculateScoreBounds(
    convenienceFacilities, nuisanceFacilities, conditions, marketData !== null
  );
  results.normalizedScore = normalizeScore(results.rawScore, maxRaw, minRaw);
  results.recommendation = getRecommendation(results.normalizedScore);

  return results;
}

export function formatDistance(meters) {
  if (meters === null || meters === undefined) return '未找到';
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

// Estimate travel time from straight-line distance.
// Actual road distance is ~1.3× straight-line on average.
export function travelTime(meters) {
  if (meters === null || meters === undefined) return null;
  const d = meters * 1.3; // road-distance factor
  return {
    walk:  Math.max(1, Math.round(d / 80)),   // 80 m/min ≈ 4.8 km/h
    cycle: Math.max(1, Math.round(d / 250)),  // 250 m/min ≈ 15 km/h
    drive: Math.max(1, Math.round(d / 400))   // 400 m/min ≈ 24 km/h (urban)
  };
}
