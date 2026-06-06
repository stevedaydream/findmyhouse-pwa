const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];

// Haversine distance in meters between two lat/lng points
export function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Build a combined Overpass query for all enabled facilities.
// Uses `nwr` shorthand (node/way/relation) to reduce query size by ~3×.
export function buildCombinedQuery(lat, lng, convenienceFacilities, nuisanceFacilities) {
  const allFacilities = [
    ...convenienceFacilities.filter(f => f.enabled),
    ...nuisanceFacilities.filter(f => f.enabled)
  ];

  if (allFacilities.length === 0) return null;

  // Deduplicate: same tag+radius pair from multiple facilities only needs one query
  const seen = new Set();
  const parts = [];
  for (const facility of allFacilities) {
    const radius = facility.searchRadius || 2000;
    for (const tag of facility.tags) {
      const key = `${tag.key}=${tag.value}@${radius}`;
      if (seen.has(key)) continue;
      seen.add(key);
      parts.push(`  nwr["${tag.key}"="${tag.value}"](around:${radius},${lat},${lng});`);
    }
  }

  return `[out:json][timeout:90];\n(\n${parts.join('\n')}\n);\nout center tags;`;
}

// Send query to one endpoint; rejects on HTTP error or timeout
function fetchFromEndpoint(endpoint, query, timeoutMs = 85000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(query),
    signal: controller.signal
  }).then(res => {
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }).then(data => {
    return data.elements || [];
  }).catch(err => {
    clearTimeout(timer);
    throw err;
  });
}

// Execute query: stagger requests across all endpoints.
// - Non-empty result → adopt immediately (fastest wins)
// - Empty result     → skip, keep waiting for others (may be overload artifact)
// - All done (errors + empties) → resolve with empty (genuine no-results area)
// 本地查詢快取，避免微調座標時重複發送相同區域的查詢
let lastQueryCache = null; // { lat, lng, elements, templateQuery }

export async function executeQuery(query, onProgress) {
  // 解析當前查詢的座標與模板特徵值（移除具體座標後的查詢字串，作為設定特徵）
  const match = query.match(/\(around:\d+,([-+]?\d*\.?\d*),([-+]?\d*\.?\d*)\)/);
  const lat = match ? parseFloat(match[1]) : null;
  const lng = match ? parseFloat(match[2]) : null;
  const templateQuery = query.replace(/\(around:\d+,[-+]?\d*\.?\d*,[-+]?\d*\.?\d*\)/g, '(around:template)');

  if (lat !== null && lng !== null && lastQueryCache) {
    const isSameSettings = templateQuery === lastQueryCache.templateQuery;
    const distance = haversineDistance(lat, lng, lastQueryCache.lat, lastQueryCache.lng);

    // 如果設施設定完全相同，且本次點選座標與上次距離小於 50 公尺，則複用快取資料
    if (isSameSettings && distance < 50) {
      if (onProgress) onProgress(`使用快取資料 (距離上次 ${Math.round(distance)}m)…`);
      return Promise.resolve(lastQueryCache.elements);
    }
  }

  if (onProgress) onProgress('連接 OpenStreetMap 資料庫…');

  return new Promise((resolve, reject) => {
    let settled = false;
    let done = 0;        // endpoints that have finished (error or empty)
    let allErrors = 0;
    const total = OVERPASS_ENDPOINTS.length;

    // Safety: if still unsettled after 95s, resolve with empty
    const safetyTimer = setTimeout(() => {
      if (!settled) { settled = true; resolve([]); }
    }, 95000);

    function finish(elements) {
      clearTimeout(safetyTimer);
      settled = true;
      
      // 寫入快取 (只有在有取得資料時才快取)
      if (elements.length > 0 && lat !== null && lng !== null) {
        lastQueryCache = { lat, lng, elements, templateQuery };
      }

      if (onProgress) onProgress('解析資料中…');
      resolve(elements);
    }

    OVERPASS_ENDPOINTS.forEach((endpoint, i) => {
      setTimeout(() => {
        if (settled) return;
        if (i > 0 && onProgress) onProgress(`嘗試備用伺服器 ${i}…`);

        fetchFromEndpoint(endpoint, query)
          .then(elements => {
            if (settled) return;
            if (elements.length > 0) {
              finish(elements);          // Got real data → done
            } else {
              done++;                    // Empty: might be overloaded server
              if (done + allErrors === total) finish([]); // All empty = genuine
            }
          })
          .catch(() => {
            allErrors++;
            done++;
            if (done === total && !settled) {
              clearTimeout(safetyTimer);
              reject(new Error('所有 OpenStreetMap 伺服器均無回應，請稍後再試'));
            }
          });
      }, i * 1500); // 1.5s stagger: 0s / 1.5s / 3s / 4.5s
    });
  });
}


// Match an OSM element to the facility it belongs to
function matchElementToFacility(element, facilities) {
  const tags = element.tags || {};
  const matched = [];
  for (const facility of facilities) {
    for (const tag of facility.tags) {
      if (tags[tag.key] === tag.value) {
        matched.push(facility.id);
        break;
      }
    }
  }
  return matched;
}

// Get the coordinates of an element (node, way center, relation center)
function getElementCoords(element) {
  if (element.type === 'node') {
    return { lat: element.lat, lng: element.lon };
  }
  if (element.center) {
    return { lat: element.center.lat, lng: element.center.lon };
  }
  return null;
}

// Process Overpass results and find nearest POI for each facility
// Returns Map: facilityId -> { distance, lat, lng } | null
export function processResults(elements, lat, lng, convenienceFacilities, nuisanceFacilities) {
  const allFacilities = [
    ...convenienceFacilities.filter(f => f.enabled),
    ...nuisanceFacilities.filter(f => f.enabled)
  ];

  const nearestMap = new Map();
  allFacilities.forEach(f => nearestMap.set(f.id, null));

  for (const element of elements) {
    const coords = getElementCoords(element);
    if (!coords) continue;

    const dist = haversineDistance(lat, lng, coords.lat, coords.lng);
    const matchedIds = matchElementToFacility(element, allFacilities);

    for (const fid of matchedIds) {
      const current = nearestMap.get(fid);
      if (current === null || dist < current.distance) {
        nearestMap.set(fid, { distance: dist, lat: coords.lat, lng: coords.lng });
      }
    }
  }

  return nearestMap;
}

// Parse Google Maps URL to extract coordinates
export function parseGoogleMapsUrl(url) {
  if (!url || !url.trim()) return null;

  // Detect short URLs - can't follow redirects from browser
  if (/goo\.gl\/maps|maps\.app\.goo\.gl/.test(url)) {
    return { error: 'short_url' };
  }

  // Format: /@lat,lng,zoom
  const atMatch = url.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*),\d+\.?\d*[z]/);
  if (atMatch) {
    const lat = parseFloat(atMatch[1]);
    const lng = parseFloat(atMatch[2]);
    if (isValidCoord(lat, lng)) return { lat, lng };
  }

  // Format: ?q=lat,lng or &q=lat,lng
  const qMatch = url.match(/[?&]q=(-?\d+\.?\d*),(-?\d+\.?\d*)/);
  if (qMatch) {
    const lat = parseFloat(qMatch[1]);
    const lng = parseFloat(qMatch[2]);
    if (isValidCoord(lat, lng)) return { lat, lng };
  }

  // Format: ?ll=lat,lng
  const llMatch = url.match(/[?&]ll=(-?\d+\.?\d*),(-?\d+\.?\d*)/);
  if (llMatch) {
    const lat = parseFloat(llMatch[1]);
    const lng = parseFloat(llMatch[2]);
    if (isValidCoord(lat, lng)) return { lat, lng };
  }

  // Format: !3dlat!4dlng (newer Google Maps data URLs, most precise)
  const dataMatch = url.match(/!3d(-?\d+\.?\d+)!4d(-?\d+\.?\d+)/);
  if (dataMatch) {
    const lat = parseFloat(dataMatch[1]);
    const lng = parseFloat(dataMatch[2]);
    if (isValidCoord(lat, lng)) return { lat, lng };
  }

  // Format: /place/name/lat,lng or similar
  const placeMatch = url.match(/\/(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
  if (placeMatch) {
    const lat = parseFloat(placeMatch[1]);
    const lng = parseFloat(placeMatch[2]);
    if (isValidCoord(lat, lng)) return { lat, lng };
  }

  return null;
}

function isValidCoord(lat, lng) {
  return !isNaN(lat) && !isNaN(lng) &&
    lat >= -90 && lat <= 90 &&
    lng >= -180 && lng <= 180 &&
    !(lat === 0 && lng === 0);
}
