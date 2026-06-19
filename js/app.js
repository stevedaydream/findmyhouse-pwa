import {
  loadConvenience, saveConvenience,
  loadNuisance, saveNuisance,
  loadConditions, saveConditions,
  loadEvaluations, saveEvaluation, deleteEvaluation,
  generateId
} from './storage.js';
import { DEFAULT_CONVENIENCE_FACILITIES, DEFAULT_NUISANCE_FACILITIES } from './config.js';
import {
  buildCombinedQuery, executeQuery, processResults, parseGoogleMapsUrl
} from './overpass.js';
import {
  calculateFullScore, calculateMarketScore, formatDistance, travelTime, getRecommendation
} from './scoring.js';

const DONORS_DATA = [
  { name: 'boyprince0', amount: 150, message: '感謝您！您讓一隻海龜免於吸管的痛苦 🐢' },
  { name: '廖先生', amount: 300, message: '感謝您！您支持了 5 平方公尺的珊瑚礁修復 🪸' },
  { name: '匿名房客', amount: 150, message: '感謝您！今天有一隻海豚因您的善意快樂翻滾 🐬' },
  { name: 'A-Kuei', amount: 500, message: '感謝您！您協助黑潮小組多進行了 10 公路的海洋微塑膠調查 🌊' },
  { name: 'Taipei_buyer', amount: 200, message: '感謝您！有一隻信天翁寶寶避開了塑料垃圾的傷害 🐦' },
  { name: '大安路林小姐', amount: 1000, message: '感謝您！贊助了淨灘志工們 1 箱無毒可重複使用水壺 🧼' }
];

const RECEIPTS_DATA = [
  { date: '2026-06-01', charity: '黑潮海洋文教基金會', amount: 3500, id: 'KO-2026-0592' },
  { date: '2026-05-15', charity: '中華民國荒野保護協會', amount: 4200, id: 'SOW-M-7731' },
  { date: '2026-04-20', charity: '台灣海洋保育協會', amount: 3200, id: 'TOCA-2026-118' },
  { date: '2026-03-05', charity: '黑潮海洋文教基金會', amount: 4520, id: 'KO-2026-0214' }
];

// ─── State ────────────────────────────────────────────────────────────────────
let state = {
  convenienceFacilities: [],
  nuisanceFacilities: [],
  conditions: [],
  evaluations: [],
  currentLocation: null,       // {lat, lng}
  currentEvaluationId: null,
  conditionValues: {},         // {conditionId: true/false/null}
  marketData: null,            // {volumeTrend, supplyDemand, priceChange, hasMajorProject}
  facilityResults: null,       // nearestMap from processResults
  scoreResults: null,
  isEvaluating: false
};

let leafletMap = null;
let leafletMarker = null;
let resultsMap = null;
let poiMarkers = {};
let activePropertyCoords = null;
let danmakuInterval = null;

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Load stored data
  state.convenienceFacilities = loadConvenience();
  state.nuisanceFacilities = loadNuisance();
  state.conditions = loadConditions();
  state.evaluations = loadEvaluations();

  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  setupTabs();
  initMap();
  setupInputListeners();
  setupEvaluationButtons();
  renderFacilitiesTab();
  renderConditionsTab();
  renderHistoryTab();
  
  // Register About tab donate button
  document.getElementById('about-donate-btn')?.addEventListener('click', showDonateModal);
});

// ─── Tab Navigation ───────────────────────────────────────────────────────────
function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      
      // 清除彈幕牆定時器，防止切換分頁後背景耗能
      clearDanmakus();

      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${tab}`).classList.add('active');

      if (tab === 'history') renderHistoryTab();
      if (tab === 'facilities') renderFacilitiesTab();
      if (tab === 'conditions') renderConditionsTab();
      if (tab === 'about') {
        renderAboutTab();
        startDanmakuWall();
      }
      if (tab === 'evaluate') {
        if (leafletMap) setTimeout(() => leafletMap.invalidateSize(), 100);
        if (resultsMap) setTimeout(() => resultsMap.invalidateSize(), 100);
      }
    });
  });
}

// ─── Leaflet Map ──────────────────────────────────────────────────────────────
function initMap() {
  // Default center: Taiwan
  leafletMap = L.map('map-picker', { zoomControl: true }).setView([23.6978, 120.9605], 7);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(leafletMap);

  leafletMap.on('click', (e) => {
    setLocation(e.latlng.lat, e.latlng.lng, 'map');
  });
}

function setLocation(lat, lng, source = 'map') {
  state.currentLocation = { lat, lng };

  // Update marker
  if (leafletMarker) {
    leafletMarker.setLatLng([lat, lng]);
  } else {
    leafletMarker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: 'custom-marker',
        html: '<div class="marker-pin">🏠</div>',
        iconSize: [36, 36],
        iconAnchor: [18, 36]
      })
    }).addTo(leafletMap);
  }

  if (source !== 'manual') {
    leafletMap.setView([lat, lng], 16);
  }

  // Update coordinate display
  document.getElementById('coord-display').style.display = 'flex';
  document.getElementById('coord-text').textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

  // Sync manual inputs
  if (source !== 'manual') {
    document.getElementById('manual-lat').value = lat.toFixed(6);
    document.getElementById('manual-lng').value = lng.toFixed(6);
  }
}

// ─── Input Listeners ──────────────────────────────────────────────────────────
function setupInputListeners() {
  // Manual coordinate inputs
  const latInput = document.getElementById('manual-lat');
  const lngInput = document.getElementById('manual-lng');

  function applyManualCoords() {
    const lat = parseFloat(latInput.value);
    const lng = parseFloat(lngInput.value);
    if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      setLocation(lat, lng, 'manual');
    }
  }

  latInput.addEventListener('change', applyManualCoords);
  lngInput.addEventListener('change', applyManualCoords);

  // Smart Address Search and Geocoding via Nominatim / Google Maps URL
  const searchBtn = document.getElementById('search-address-btn');
  const nameInput = document.getElementById('property-name');

  async function performAddressSearch() {
    const query = nameInput.value.trim();
    if (!query) {
      showToast('請輸入搜尋地址、地名或 Google Maps 連結', 'warning');
      return;
    }

    searchBtn.disabled = true;
    const originalText = searchBtn.textContent;
    searchBtn.textContent = '…';

    // 1. Check if the query is a Google Maps link
    if (query.startsWith('http://') || query.startsWith('https://') || query.includes('maps')) {
      const result = parseGoogleMapsUrl(query);
      if (result) {
        if (result.error === 'short_url') {
          showToast('請展開縮短網址後再貼入（點擊連結後複製瀏覽器網址列的完整網址）', 'warning');
        } else {
          setLocation(result.lat, result.lng, 'url');
          showToast('已成功解析 Google 地圖座標！', 'success');
        }
        searchBtn.disabled = false;
        searchBtn.textContent = originalText;
        return;
      }
    }

    // 2. Otherwise, treat as normal address or place query and call Nominatim API
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`, {
        headers: {
          'Accept-Language': 'zh-TW,zh;q=0.9'
        }
      });
      const data = await response.json();
      if (data && data.length > 0) {
        const lat = parseFloat(data[0].lat);
        const lng = parseFloat(data[0].lon);
        setLocation(lat, lng, 'search');
        showToast('定位成功！已在地圖上標記', 'success');
      } else {
        showToast('找不到該位置，請輸入更精確的地址', 'warning');
      }
    } catch (err) {
      console.error(err);
      showToast('搜尋失敗，請檢查網路連線', 'error');
    } finally {
      searchBtn.disabled = false;
      searchBtn.textContent = originalText;
    }
  }

  // Auto geocode pasted URL directly on input
  nameInput.addEventListener('paste', () => {
    setTimeout(() => {
      const value = nameInput.value.trim();
      if (value.startsWith('http://') || value.startsWith('https://') || value.includes('maps')) {
        const result = parseGoogleMapsUrl(value);
        if (result && !result.error) {
          setLocation(result.lat, result.lng, 'url');
          showToast('已自動解析貼入的 Google 地圖座標！', 'success');
        }
      }
    }, 50);
  });

  if (searchBtn) {
    searchBtn.addEventListener('click', performAddressSearch);
  }
  if (nameInput) {
    nameInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        performAddressSearch();
      }
    });
  }
}

// ─── Evaluation ───────────────────────────────────────────────────────────────
function setupEvaluationButtons() {
  document.getElementById('start-evaluation').addEventListener('click', startEvaluation);
  document.getElementById('progress-donate-btn')?.addEventListener('click', showDonateModal);
}

async function startEvaluation() {
  if (!state.currentLocation) {
    showToast('請先選取物件位置（可在下方搜尋、貼上 Google Maps 連結或點擊地圖）', 'error');
    return;
  }

  if (state.isEvaluating) return;

  const enabledConvenience = state.convenienceFacilities.filter(f => f.enabled);
  const enabledNuisance = state.nuisanceFacilities.filter(f => f.enabled);

  if (enabledConvenience.length === 0 && enabledNuisance.length === 0) {
    showToast('請至少啟用一項便利或嫌惡設施', 'warning');
    return;
  }

  state.isEvaluating = true;
  state.conditionValues = {};
  state.currentEvaluationId = generateId();

  // Show results section with progress
  document.getElementById('results-section').style.display = 'block';
  document.getElementById('progress-card').style.display = 'block';
  document.getElementById('score-summary').style.display = 'none';
  document.getElementById('results-map-card').style.display = 'none';
  document.getElementById('convenience-results').style.display = 'none';
  document.getElementById('nuisance-results').style.display = 'none';
  document.getElementById('conditions-results').style.display = 'none';
  document.getElementById('market-results').style.display = 'none';
  document.querySelector('.save-buttons')?.remove();
  document.querySelector('.donate-card')?.remove();

  document.getElementById('start-evaluation').disabled = true;
  document.getElementById('start-evaluation').textContent = '評估中…';

  // Scroll to results
  document.getElementById('results-section').scrollIntoView({ behavior: 'smooth' });

  // 1. Initialize 8-second countdown timer and prompts
  const totalSeconds = 8;
  let remainingSeconds = totalSeconds;
  
  const loadingPrompts = [
    '正在偵測周邊區域',
    'AI分析便利設施',
    '偵測嫌惡設施',
    '正在計算距離',
    '正在編寫報告',
    '查詢周圍房市分析'
  ];

  const progressTextEl = document.getElementById('progress-text');
  const progressBarEl = document.getElementById('progress-bar');
  const countdownEl = document.getElementById('ad-countdown');

  let descEl = document.getElementById('progress-desc');
  let timeLeftEl = document.getElementById('progress-time-left');
  if (!descEl) {
    progressTextEl.innerHTML = `<span id="progress-desc" class="progress-desc">準備中</span><span id="progress-time-left" style="margin-left: 6px; opacity: 0.75; font-size: 0.72rem;"></span>`;
    descEl = document.getElementById('progress-desc');
    timeLeftEl = document.getElementById('progress-time-left');
  }

  let currentPromptIndex = 0;
  let timerFinished = false;

  // 更新秒數函數 (不閃爍)
  function updateTimeLeftUI() {
    if (remainingSeconds <= 0) {
      if (countdownEl) countdownEl.textContent = '分析完成';
      timeLeftEl.textContent = '';
    } else {
      if (countdownEl) countdownEl.textContent = `AI 分析中 (${remainingSeconds}s)`;
      timeLeftEl.textContent = `(剩餘 ${remainingSeconds} 秒)…`;
    }
  }

  // 更換提示詞函數 (0.5 秒淡出淡入)
  function updatePromptUI() {
    if (timerFinished) return;
    const nextPrompt = loadingPrompts[currentPromptIndex] || '正在解析周邊設施';
    
    descEl.classList.add('fade-out');
    setTimeout(() => {
      descEl.textContent = nextPrompt;
      descEl.classList.remove('fade-out');
    }, 250);

    currentPromptIndex = (currentPromptIndex + 1) % loadingPrompts.length;
  }

  // 初始繪製
  updateTimeLeftUI();
  updatePromptUI();

  // 統一的 50ms 定時器更新進度、時間與提示詞
  let elapsedMs = 0;
  const totalMs = totalSeconds * 1000;
  const progressTimer = setInterval(() => {
    elapsedMs += 50;

    // 進度條
    const limit = timerFinished ? 99 : 98;
    const pct = Math.min(limit, (elapsedMs / totalMs) * 100);
    progressBarEl.style.width = `${pct}%`;

    // 每 1000ms 更新剩餘秒數
    if (elapsedMs % 1000 === 0) {
      remainingSeconds = Math.max(0, totalSeconds - (elapsedMs / 1000));
      updateTimeLeftUI();
    }

    // 每 1500ms 更換提示詞 (在結束前)
    if (elapsedMs % 1500 === 0 && elapsedMs < totalMs) {
      updatePromptUI();
    }

    if (elapsedMs >= totalMs) {
      clearInterval(progressTimer);
      timerFinished = true;
    }
  }, 50);

  // Promise for countdown completion
  const countdownPromise = new Promise(resolve => {
    setTimeout(() => {
      resolve();
    }, totalMs);
  });

  // 2. Start geocoding and OSM evaluation
  const apiPromise = (async () => {
    const { lat, lng } = state.currentLocation;
    const query = buildCombinedQuery(lat, lng, state.convenienceFacilities, state.nuisanceFacilities);
    if (!query) throw new Error('no_facilities');

    const elements = await executeQuery(query, (msg) => {
      console.log('OSM Progress:', msg);
    });

    const nearestMap = processResults(elements, lat, lng, state.convenienceFacilities, state.nuisanceFacilities);
    state.facilityResults = nearestMap;

    const results = calculateFullScore(
      nearestMap,
      state.convenienceFacilities,
      state.nuisanceFacilities,
      state.conditions,
      state.conditionValues,
      state.marketData
    );
    state.scoreResults = results;
    return results;
  })();

  try {
    // Wait for both OSM API and the 6s countdown timer to resolve
    const [results] = await Promise.all([apiPromise, countdownPromise]);

    // Cleanup timers
    clearInterval(progressTimer);

    // Speed up to 100% on success
    progressBarEl.style.width = '100%';
    descEl.textContent = '完成！';
    timeLeftEl.textContent = '';
    await sleep(200);

    renderResults(results);

  } catch (err) {
    console.error(err);
    clearInterval(progressTimer);
    let msg = '查詢失敗，請檢查網路連線後重試';
    if (err.message === 'no_facilities') msg = '請先在「設施」頁面啟用至少一項設施';
    showToast(msg, 'error');
    document.getElementById('progress-card').style.display = 'none';
  } finally {
    state.isEvaluating = false;
    document.getElementById('start-evaluation').disabled = false;
    document.getElementById('start-evaluation').textContent = '開始評估';
  }
}

function setProgress(percent, text) {
  document.getElementById('progress-bar').style.width = `${percent}%`;
  document.getElementById('progress-text').textContent = text;
}

function renderResults(results) {
  document.getElementById('progress-card').style.display = 'none';

  const propertyName = document.getElementById('property-name').value.trim() || '未命名物件';

  // Score summary
  const scoreCard = document.getElementById('score-summary');
  scoreCard.style.display = 'flex';
  scoreCard.style.backgroundColor = results.recommendation.bg;

  const circle = document.getElementById('score-circle');
  circle.style.borderColor = results.recommendation.color;
  circle.style.color = results.recommendation.color;
  document.getElementById('score-number').textContent = results.normalizedScore;

  const recEl = document.getElementById('recommendation');
  recEl.textContent = `${results.recommendation.emoji} ${results.recommendation.label}`;
  recEl.style.color = results.recommendation.color;

  document.getElementById('property-name-display').textContent = propertyName;

  // Convenience facilities
  const convCard = document.getElementById('convenience-results');
  if (results.convenience.length > 0) {
    convCard.style.display = 'block';
    const totalScore = results.convenience.reduce((s, r) => s + r.score, 0);
    document.getElementById('convenience-total-score').textContent = formatScore(totalScore);
    document.getElementById('convenience-total-score').style.color = totalScore >= 0 ? '#059669' : '#DC2626';
    document.getElementById('convenience-list').innerHTML = results.convenience.map(renderFacilityResult).join('');
  }

  // Nuisance facilities
  const nuisCard = document.getElementById('nuisance-results');
  if (results.nuisance.length > 0) {
    nuisCard.style.display = 'block';
    const totalScore = results.nuisance.reduce((s, r) => s + r.score, 0);
    document.getElementById('nuisance-total-score').textContent = formatScore(totalScore);
    document.getElementById('nuisance-total-score').style.color = totalScore >= 0 ? '#059669' : '#DC2626';
    document.getElementById('nuisance-list').innerHTML = results.nuisance.map(renderNuisanceResult).join('');
  }

  // Custom conditions
  const condCard = document.getElementById('conditions-results');
  const enabledConditions = state.conditions.filter(c => c.enabled);
  if (enabledConditions.length > 0) {
    condCard.style.display = 'block';
    renderConditionCheckboxes();
  }

  // Results map
  renderResultsMap(state.currentLocation.lat, state.currentLocation.lng, results);

  // Market appreciation card - auto-fetch
  autoFetchMarketData(state.currentLocation.lat, state.currentLocation.lng);

  // Save buttons
  const saveArea = document.createElement('div');
  saveArea.className = 'card save-buttons';
  saveArea.innerHTML = `
    <button class="btn btn-primary btn-full" id="save-evaluation">儲存評估結果</button>
    <button class="btn btn-secondary btn-full" id="new-evaluation" style="margin-top:8px">評估新物件</button>
  `;
  document.getElementById('results-section').appendChild(saveArea);
  document.getElementById('save-evaluation').addEventListener('click', saveCurrentEvaluation);
  document.getElementById('new-evaluation').addEventListener('click', resetEvaluation);

  // Donate card
  const donateArea = document.createElement('div');
  donateArea.className = 'card donate-card';
  donateArea.style.marginTop = '16px';
  donateArea.style.textAlign = 'center';
  donateArea.innerHTML = `
    <p style="font-size: 0.82rem; color: var(--text-muted); line-height: 1.5; margin-bottom: 12px;">
      覺得這個評估工具有幫到您嗎？<br>您的支持是我們持續維護地圖與算力的最大動力！☕
    </p>
    <button class="btn btn-secondary btn-full" id="results-donate-btn" style="gap: 8px;">
      <span>💖</span> 贊助支持作者 ☕
    </button>
  `;
  document.getElementById('results-section').appendChild(donateArea);
  document.getElementById('results-donate-btn')?.addEventListener('click', showDonateModal);

  // Bind facility item clicks to map zoom, polyline path drawing, and popup trigger
  const bindFacilityClicks = (listId) => {
    const listEl = document.getElementById(listId);
    if (!listEl) return;
    listEl.addEventListener('click', (e) => {
      const item = e.target.closest('.facility-result');
      if (!item) return;

      const key = item.dataset.poiKey;
      const lat = parseFloat(item.dataset.poiLat);
      const lng = parseFloat(item.dataset.poiLng);

      if (isNaN(lat) || isNaN(lng) || !resultsMap) return;

      // 1. Zoom and center map to show both property and POI
      if (activePropertyCoords) {
        resultsMap.fitBounds([
          [activePropertyCoords.lat, activePropertyCoords.lng],
          [lat, lng]
        ], { padding: [50, 50], maxZoom: 17 });

        // 2. Draw active polyline connection
        if (activePolyline) {
          resultsMap.removeLayer(activePolyline);
        }
        activePolyline = L.polyline(
          [[activePropertyCoords.lat, activePropertyCoords.lng], [lat, lng]],
          { color: '#6366F1', weight: 4, dashArray: '8, 8', opacity: 0.85 }
        ).addTo(resultsMap);
      } else {
        resultsMap.setView([lat, lng], 17);
      }

      // 3. Trigger marker popup
      const marker = poiMarkers[key];
      if (marker) {
        marker.openPopup();
      }
    });
  };

  bindFacilityClicks('convenience-list');
  bindFacilityClicks('nuisance-list');
}

function renderResultsMap(propertyLat, propertyLng, results) {
  document.getElementById('results-map-card').style.display = 'block';

  if (resultsMap) {
    resultsMap.remove();
    resultsMap = null;
  }

  // Reset POI states
  poiMarkers = {};
  activePropertyCoords = { lat: propertyLat, lng: propertyLng };
  if (activePolyline) {
    activePolyline = null;
  }

  resultsMap = L.map('results-map').setView([propertyLat, propertyLng], 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(resultsMap);

  // Property marker
  L.marker([propertyLat, propertyLng], {
    icon: L.divIcon({
      className: 'custom-marker',
      html: '<div class="marker-pin">🏠</div>',
      iconSize: [36, 36],
      iconAnchor: [18, 36]
    })
  }).addTo(resultsMap).bindPopup('<strong>物件位置</strong>');

  // POI markers
  const allPOI = [...(results.convenience || []), ...(results.nuisance || [])];
  const bounds = [[propertyLat, propertyLng]];

  allPOI.forEach(r => {
    if (r.poiLat != null && r.poiLng != null) {
      const bg = r.score >= 0 ? '#059669' : '#DC2626';
      const markerKey = `${r.name}-${r.poiLat}-${r.poiLng}`;
      const marker = L.marker([r.poiLat, r.poiLng], {
        icon: L.divIcon({
          className: '',
          html: `<div class="poi-marker-icon" style="background:${bg}">${r.icon}</div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15]
        })
      })
        .bindPopup(`<strong>${r.icon} ${r.name}</strong><br>距離：${formatDistance(r.actualDistance)}`)
        .addTo(resultsMap);
      
      poiMarkers[markerKey] = marker;
      bounds.push([r.poiLat, r.poiLng]);
    }
  });

  if (bounds.length > 1) {
    resultsMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 });
  }

  setTimeout(() => resultsMap.invalidateSize(), 200);
}

async function autoFetchMarketData(lat, lng) {
  const card   = document.getElementById('market-results');
  const scoreEl = document.getElementById('market-total-score');
  const formEl  = document.getElementById('market-form');

  card.style.display = 'block';
  scoreEl.textContent   = '查詢中…';
  scoreEl.style.color   = 'var(--text-muted)';
  formEl.innerHTML = `
    <div class="market-loading">
      <span class="market-spinner"></span>
      自動查詢實價登錄資料中…
    </div>`;

  try {
    // 1. 前端呼叫 Nominatim 逆地理編碼，使用使用者瀏覽器 IP，分散 Rate Limit
    let city = '';
    let district = '';
    try {
      const geoRes = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=zh-TW`,
        { headers: { 'Accept': 'application/json' } }
      );
      if (geoRes.ok) {
        const geo = await geoRes.json();
        if (geo.address) {
          city = geo.address.city || geo.address.county || geo.address.state || '';
          district = geo.address.city_district || geo.address.suburb || geo.address.town || '';
        }
      }
    } catch (e) {
      console.warn('[Client Geocode Failed, fallback to server]', e);
    }

    // 2. 將行政區參數傳遞給後端 API
    let apiPath = `/api/market?lat=${lat}&lng=${lng}`;
    if (city) apiPath += `&city=${encodeURIComponent(city)}`;
    if (district) apiPath += `&district=${encodeURIComponent(district)}`;

    const res  = await fetch(apiPath);
    if (!res.ok) throw new Error('api_error');
    const data = await res.json();


    if (data.supported) {
      // 自動帶入查詢結果（重大建設無法自動偵測，留空由使用者填寫）
      state.marketData = {
        volumeTrend:    data.volumeTrend  || null,
        supplyDemand:   data.supplyDemand || null,
        priceChange:    data.priceChangePct !== null && data.priceChangePct !== undefined
                          ? String(data.priceChangePct) : '',
        hasMajorProject: null
      };
      recalculateWithConditions();
      renderMarketCard();

      // 在表單最上方插入來源標註 banner
      const banner = document.createElement('div');
      banner.className = 'market-auto-banner';
      const priceInfo = data.priceChangePct !== null
        ? `，近期均價 ${data.priceChangePct >= 0 ? '+' : ''}${data.priceChangePct}%`
        : '';
      banner.innerHTML =
        `📊 已從<strong>實價登錄</strong>自動查詢 <strong>${data.district || data.city}</strong>` +
        ` 共 <strong>${data.sampleSize}</strong> 筆住宅成交紀錄${priceInfo}，結果僅供參考，可手動調整。`;
      document.getElementById('market-form').prepend(banner);

      showToast('已自動查詢市場資料', 'success');
    } else {
      // 非台灣地區或資料不足 → 顯示手動填寫表單
      renderMarketCard();
      if (data.reason === 'not_taiwan') {
        document.getElementById('market-form').prepend(
          Object.assign(document.createElement('p'), {
            className: 'market-hint',
            textContent: '⚠️ 目前自動查詢僅支援台灣地區，請手動填寫以下資料。'
          })
        );
      }
    }
  } catch {
    // 網路失敗 → 靜默退回手動模式
    renderMarketCard();
  }
}

function renderMarketCard() {
  const card = document.getElementById('market-results');
  card.style.display = 'block';

  const md = state.marketData || {};
  const marketResult = calculateMarketScore(state.marketData);
  const scoreEl = document.getElementById('market-total-score');
  if (state.marketData) {
    const s = marketResult.rawScore;
    scoreEl.textContent = `${s >= 0 ? '+' : ''}${s} 分`;
    scoreEl.style.color = s >= 0 ? '#059669' : '#DC2626';
  } else {
    scoreEl.textContent = '未填寫';
    scoreEl.style.color = '#9CA3AF';
  }

  document.getElementById('market-form').innerHTML = `
    <p class="market-hint">依據實價登錄、成交量趨勢填寫，系統將額外計入 -15 ～ +15 分的增值潛力評分。</p>

    <div class="market-field">
      <label class="market-label">近三年成交量趨勢</label>
      <div class="radio-group">
        <label class="radio-chip ${md.volumeTrend === 'rising' ? 'active' : ''}">
          <input type="radio" name="volumeTrend" value="rising" ${md.volumeTrend === 'rising' ? 'checked' : ''}> 📈 增加中
        </label>
        <label class="radio-chip ${md.volumeTrend === 'stable' ? 'active' : ''}">
          <input type="radio" name="volumeTrend" value="stable" ${md.volumeTrend === 'stable' ? 'checked' : ''}> 📊 持平
        </label>
        <label class="radio-chip ${md.volumeTrend === 'falling' ? 'active' : ''}">
          <input type="radio" name="volumeTrend" value="falling" ${md.volumeTrend === 'falling' ? 'checked' : ''}> 📉 減少
        </label>
      </div>
    </div>

    <div class="market-field">
      <label class="market-label">供需狀況</label>
      <div class="radio-group">
        <label class="radio-chip ${md.supplyDemand === 'undersupply' ? 'active' : ''}">
          <input type="radio" name="supplyDemand" value="undersupply" ${md.supplyDemand === 'undersupply' ? 'checked' : ''}> 🔥 供不應求
        </label>
        <label class="radio-chip ${md.supplyDemand === 'balanced' ? 'active' : ''}">
          <input type="radio" name="supplyDemand" value="balanced" ${md.supplyDemand === 'balanced' ? 'checked' : ''}> ⚖️ 供需平衡
        </label>
        <label class="radio-chip ${md.supplyDemand === 'oversupply' ? 'active' : ''}">
          <input type="radio" name="supplyDemand" value="oversupply" ${md.supplyDemand === 'oversupply' ? 'checked' : ''}> 🏚️ 供過於求
        </label>
      </div>
    </div>

    <div class="market-field">
      <label class="market-label">實價登錄近三年均價漲跌幅（%）</label>
      <input id="market-price-change" type="number" step="0.1" placeholder="例：5.2 或 -3.0"
        value="${md.priceChange !== undefined ? md.priceChange : ''}" class="market-input">
      <small class="hint">正數為漲、負數為跌；留空則不計入</small>
    </div>

    <div class="market-field">
      <label class="market-label">附近有重大建設計畫（捷運、園區、商場等）</label>
      <div class="radio-group">
        <label class="radio-chip ${md.hasMajorProject === true ? 'active' : ''}">
          <input type="radio" name="hasMajorProject" value="yes" ${md.hasMajorProject === true ? 'checked' : ''}> ✅ 有
        </label>
        <label class="radio-chip ${md.hasMajorProject === false ? 'active' : ''}">
          <input type="radio" name="hasMajorProject" value="no" ${md.hasMajorProject === false ? 'checked' : ''}> ❌ 無
        </label>
      </div>
    </div>

    <button class="btn btn-primary" id="apply-market-btn" style="width:100%;margin-top:8px">套用增值指標</button>
  `;

  // Sync radio chip active state on click
  document.getElementById('market-form').querySelectorAll('.radio-group').forEach(group => {
    group.querySelectorAll('.radio-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        chip.closest('.radio-group').querySelectorAll('.radio-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
      });
    });
  });

  document.getElementById('apply-market-btn').addEventListener('click', updateMarketData);
}

function updateMarketData() {
  const form = document.getElementById('market-form');

  const volumeTrend = form.querySelector('input[name="volumeTrend"]:checked')?.value || null;
  const supplyDemand = form.querySelector('input[name="supplyDemand"]:checked')?.value || null;
  const priceChangeRaw = document.getElementById('market-price-change').value.trim();
  const priceChange = priceChangeRaw !== '' ? priceChangeRaw : null;
  const hasMajorProjectVal = form.querySelector('input[name="hasMajorProject"]:checked')?.value;
  const hasMajorProject = hasMajorProjectVal === 'yes' ? true : hasMajorProjectVal === 'no' ? false : null;

  // At least one field filled → treat as user-entered
  const anyFilled = volumeTrend || supplyDemand || priceChange !== null || hasMajorProject !== null;
  state.marketData = anyFilled ? { volumeTrend, supplyDemand, priceChange, hasMajorProject } : null;

  recalculateWithConditions();
  renderMarketCard();
  showToast('增值指標已套用，評分已更新', 'success');
}

function renderTravelTime(meters) {
  if (meters === null) return '';
  const t = travelTime(meters);
  return `<span class="travel-time">🚶${t.walk}分 · 🚲${t.cycle}分 · 🚗${t.drive}分</span>`;
}

function renderFacilityResult(r) {
  const isGood = r.score >= 0;
  const distText = r.actualDistance !== null
    ? formatDistance(r.actualDistance)
    : '<span class="not-found">未找到（視為不符合）</span>';
  const statusIcon = getStatusIcon(r.status);

  return `
    <div class="facility-result ${isGood ? 'result-good' : 'result-bad'}" 
         data-poi-key="${r.name}-${r.poiLat}-${r.poiLng}" 
         data-poi-lat="${r.poiLat || ''}" 
         data-poi-lng="${r.poiLng || ''}" 
         style="cursor: pointer;">
      <div class="facility-result-left">
        <span class="facility-icon">${r.icon}</span>
        <div class="facility-result-info">
          <span class="facility-result-name">${r.name}</span>
          <span class="facility-result-dist">
            ${statusIcon} ${distText}
            <span class="target-dist">（理想 ${formatDistance(r.idealDistance)}）</span>
          </span>
          ${renderTravelTime(r.actualDistance)}
        </div>
      </div>
      <div class="facility-result-score ${isGood ? 'score-pos' : 'score-neg'}">
        ${isGood ? '+' : ''}${r.score.toFixed(1)}
      </div>
    </div>
  `;
}

function renderNuisanceResult(r) {
  const isGood = r.score >= 0;
  const distText = r.actualDistance !== null
    ? formatDistance(r.actualDistance)
    : '<span class="not-found">未找到（代表距離安全）</span>';
  const statusIcon = getStatusIcon(r.status);

  return `
    <div class="facility-result ${isGood ? 'result-good' : 'result-bad'}" 
         data-poi-key="${r.name}-${r.poiLat}-${r.poiLng}" 
         data-poi-lat="${r.poiLat || ''}" 
         data-poi-lng="${r.poiLng || ''}" 
         style="cursor: pointer;">
      <div class="facility-result-left">
        <span class="facility-icon">${r.icon}</span>
        <div class="facility-result-info">
          <span class="facility-result-name">${r.name}</span>
          <span class="facility-result-dist">
            ${statusIcon} ${distText}
            <span class="target-dist">（安全距離 ${formatDistance(r.minDistance)}）</span>
          </span>
          ${renderTravelTime(r.actualDistance)}
        </div>
      </div>
      <div class="facility-result-score ${isGood ? 'score-pos' : 'score-neg'}">
        ${isGood ? '+' : ''}${r.score.toFixed(1)}
      </div>
    </div>
  `;
}

function getStatusIcon(status) {
  const icons = {
    excellent: '✅',
    good: '👍',
    ok: '🆗',
    poor: '⚠️',
    bad: '❌',
    not_found: '❓',
    not_found_good: '✅'
  };
  return icons[status] || '';
}

function renderConditionCheckboxes() {
  const container = document.getElementById('conditions-list');
  const enabledConditions = state.conditions.filter(c => c.enabled);

  container.innerHTML = enabledConditions.map(c => {
    const isPositive = c.score >= 0;
    const checked = state.conditionValues[c.id] === true;
    return `
      <label class="condition-check-item">
        <input type="checkbox" class="condition-checkbox" data-id="${c.id}" data-score="${c.score}" ${checked ? 'checked' : ''}>
        <span class="condition-icon">${c.icon}</span>
        <span class="condition-check-name">${c.name}</span>
        <span class="condition-check-score ${isPositive ? 'score-pos' : 'score-neg'}">
          ${isPositive ? '+' : ''}${c.score}分
        </span>
      </label>
    `;
  }).join('');

  container.querySelectorAll('.condition-checkbox').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const id = e.target.dataset.id;
      state.conditionValues[id] = e.target.checked;
      recalculateWithConditions();
    });
  });
}

function recalculateWithConditions() {
  if (!state.facilityResults) return;

  const results = calculateFullScore(
    state.facilityResults,
    state.convenienceFacilities,
    state.nuisanceFacilities,
    state.conditions,
    state.conditionValues,
    state.marketData
  );
  state.scoreResults = results;

  // Update score display only
  const circle = document.getElementById('score-circle');
  circle.style.borderColor = results.recommendation.color;
  circle.style.color = results.recommendation.color;
  document.getElementById('score-number').textContent = results.normalizedScore;

  const recEl = document.getElementById('recommendation');
  recEl.textContent = `${results.recommendation.emoji} ${results.recommendation.label}`;
  recEl.style.color = results.recommendation.color;

  document.getElementById('score-summary').style.backgroundColor = results.recommendation.bg;
}

function saveCurrentEvaluation() {
  if (!state.scoreResults || !state.currentLocation) {
    showToast('請先完成評估', 'warning');
    return;
  }

  const propertyName = document.getElementById('property-name').value.trim() || '未命名物件';
  const mapsUrl = document.getElementById('maps-url').value.trim();

  const evaluation = {
    id: state.currentEvaluationId || generateId(),
    timestamp: Date.now(),
    propertyName,
    location: state.currentLocation,
    mapsUrl,
    scoreResults: state.scoreResults,
    conditionValues: { ...state.conditionValues },
    marketData: state.marketData ? { ...state.marketData } : null
  };

  saveEvaluation(evaluation);
  state.evaluations = loadEvaluations();

  const saveBtn = document.getElementById('save-evaluation');
  if (saveBtn) {
    saveBtn.textContent = '已儲存 ✓';
    saveBtn.disabled = true;
  }

  showToast('評估結果已儲存', 'success');
}

function resetEvaluation() {
  state.currentLocation = null;
  state.conditionValues = {};
  state.marketData = null;
  state.facilityResults = null;
  state.scoreResults = null;
  state.currentEvaluationId = null;

  if (leafletMarker) {
    leafletMarker.remove();
    leafletMarker = null;
  }

  document.getElementById('property-name').value = '';
  document.getElementById('maps-url').value = '';
  document.getElementById('manual-lat').value = '';
  document.getElementById('manual-lng').value = '';
  document.getElementById('coord-display').style.display = 'none';
  document.getElementById('results-section').style.display = 'none';

  if (resultsMap) {
    resultsMap.remove();
    resultsMap = null;
  }

  leafletMap.setView([23.6978, 120.9605], 7);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ─── Facilities Settings Tab ──────────────────────────────────────────────────
function renderFacilitiesTab() {
  renderFacilityList('convenience-facilities-list', state.convenienceFacilities, 'convenience');
  renderFacilityList('nuisance-facilities-list', state.nuisanceFacilities, 'nuisance');

  document.getElementById('add-convenience').onclick = () => openFacilityModal(null, 'convenience');
  document.getElementById('add-nuisance').onclick = () => openFacilityModal(null, 'nuisance');
}

function renderFacilityList(containerId, facilities, type) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = facilities.map((f, idx) => `
    <div class="facility-item" data-id="${f.id}" data-type="${type}">
      <div class="facility-item-header">
        <label class="toggle">
          <input type="checkbox" class="facility-toggle" data-id="${f.id}" data-type="${type}" ${f.enabled ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
        <span class="facility-icon-sm">${f.icon}</span>
        <span class="facility-item-name ${f.enabled ? '' : 'disabled-text'}">${f.name}</span>
        <div class="facility-item-actions">
          <button class="btn-icon edit-facility" data-id="${f.id}" data-type="${type}" title="編輯">✏️</button>
          ${f.isCustom ? `<button class="btn-icon delete-facility" data-id="${f.id}" data-type="${type}" title="刪除">🗑️</button>` : ''}
        </div>
      </div>
      ${f.enabled ? `
      <div class="facility-item-details">
        <div class="detail-row">
          <span class="detail-label">${type === 'convenience' ? '理想距離' : '最小距離'}</span>
          <span class="detail-value">${formatDistance(type === 'convenience' ? f.idealDistance : f.minDistance)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">重要程度</span>
          <span class="detail-value">${'⭐'.repeat(f.weight)}</span>
        </div>
      </div>
      ` : ''}
    </div>
  `).join('');

  // Toggle events
  container.querySelectorAll('.facility-toggle').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const id = e.target.dataset.id;
      const ftype = e.target.dataset.type;
      toggleFacility(id, ftype, e.target.checked);
    });
  });

  // Edit events
  container.querySelectorAll('.edit-facility').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.dataset.id;
      const ftype = e.currentTarget.dataset.type;
      openFacilityModal(id, ftype);
    });
  });

  // Delete events
  container.querySelectorAll('.delete-facility').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.dataset.id;
      const ftype = e.currentTarget.dataset.type;
      if (confirm('確定要刪除此設施嗎？')) deleteFacility(id, ftype);
    });
  });
}

function toggleFacility(id, type, enabled) {
  if (type === 'convenience') {
    const f = state.convenienceFacilities.find(f => f.id === id);
    if (f) f.enabled = enabled;
    saveConvenience(state.convenienceFacilities);
  } else {
    const f = state.nuisanceFacilities.find(f => f.id === id);
    if (f) f.enabled = enabled;
    saveNuisance(state.nuisanceFacilities);
  }
  renderFacilitiesTab();
}

function deleteFacility(id, type) {
  if (type === 'convenience') {
    state.convenienceFacilities = state.convenienceFacilities.filter(f => f.id !== id);
    saveConvenience(state.convenienceFacilities);
  } else {
    state.nuisanceFacilities = state.nuisanceFacilities.filter(f => f.id !== id);
    saveNuisance(state.nuisanceFacilities);
  }
  renderFacilitiesTab();
}

function openFacilityModal(id, type) {
  const isConvenience = type === 'convenience';
  const facilities = isConvenience ? state.convenienceFacilities : state.nuisanceFacilities;
  const existing = id ? facilities.find(f => f.id === id) : null;
  const isNew = !existing;

  const distLabel = isConvenience ? '理想距離（公尺）' : '最小安全距離（公尺）';
  const distValue = existing ? (isConvenience ? existing.idealDistance : existing.minDistance) : (isConvenience ? 500 : 200);
  const distKey = isConvenience ? 'idealDistance' : 'minDistance';

  // Build preset chips (only when adding new)
  const defaults = isConvenience ? DEFAULT_CONVENIENCE_FACILITIES : DEFAULT_NUISANCE_FACILITIES;
  const presetHTML = isNew ? `
    <div class="preset-section">
      <div class="preset-label">快速套組（點擊帶入）</div>
      <div class="preset-list">
        ${defaults.map(d => `
          <button type="button" class="preset-chip"
            data-name="${d.name}"
            data-icon="${d.icon}"
            data-dist="${isConvenience ? d.idealDistance : d.minDistance}"
            data-weight="${d.weight}"
            data-tags="${d.tags.map(t => `${t.key}=${t.value}`).join('|')}">
            ${d.icon} ${d.name}
          </button>`).join('')}
      </div>
    </div>
    <div class="preset-divider"></div>
  ` : '';

  showModal(
    isNew ? `新增${isConvenience ? '便利' : '嫌惡'}設施` : `編輯：${existing.name}`,
    `
    ${presetHTML}
    <div class="form-group">
      <label>名稱</label>
      <input id="m-name" type="text" value="${existing?.name || ''}" placeholder="例：捷運站" required>
    </div>
    <div class="form-group">
      <label>圖示（Emoji）</label>
      <input id="m-icon" type="text" value="${existing?.icon || '📍'}" maxlength="4" placeholder="📍">
    </div>
    <div class="form-group">
      <label>${distLabel}</label>
      <input id="m-dist" type="number" value="${distValue}" min="10" max="10000" step="50">
      <small class="hint">搜尋半徑為此距離的 4 倍</small>
    </div>
    <div class="form-group">
      <label>重要程度（1-5，越高越重要）</label>
      <input id="m-weight" type="range" min="1" max="5" value="${existing?.weight || 3}" oninput="document.getElementById('m-weight-val').textContent=this.value">
      <span id="m-weight-val">${existing?.weight || 3}</span> 星
    </div>
    <div class="form-group">
      <label>OpenStreetMap 標籤（key=value，多個用換行分隔）</label>
      <textarea id="m-tags" rows="3" placeholder="shop=convenience&#10;amenity=fuel">${existing ? existing.tags.map(t => `${t.key}=${t.value}`).join('\n') : ''}</textarea>
      <small class="hint">可至 <a href="https://taginfo.openstreetmap.org/tags" target="_blank" rel="noopener" class="hint-link">taginfo.openstreetmap.org</a> 查詢正確標籤</small>
    </div>
    `,
    [
      { label: '取消', class: 'btn-secondary', action: 'close' },
      {
        label: isNew ? '新增' : '儲存', class: 'btn-primary', action: () => {
          const name = document.getElementById('m-name').value.trim();
          const icon = document.getElementById('m-icon').value.trim() || '📍';
          const dist = parseInt(document.getElementById('m-dist').value);
          const weight = parseInt(document.getElementById('m-weight').value);
          const tagsRaw = document.getElementById('m-tags').value.trim();

          if (!name) { showToast('請輸入設施名稱', 'error'); return; }
          if (isNaN(dist) || dist < 10) { showToast('請輸入有效距離', 'error'); return; }

          const tags = tagsRaw
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)
            .map(line => {
              const [key, ...rest] = line.split('=');
              return { key: key.trim(), value: rest.join('=').trim() };
            })
            .filter(t => t.key && t.value);

          if (tags.length === 0) { showToast('請輸入至少一個 OSM 標籤', 'error'); return; }

          const facilityData = {
            id: existing?.id || generateId(),
            name,
            icon,
            enabled: existing?.enabled ?? true,
            [distKey]: dist,
            weight,
            tags,
            searchRadius: dist * 4,
            isCustom: true
          };

          if (isConvenience) {
            if (isNew) {
              state.convenienceFacilities.push(facilityData);
            } else {
              const idx = state.convenienceFacilities.findIndex(f => f.id === id);
              if (idx >= 0) state.convenienceFacilities[idx] = facilityData;
            }
            saveConvenience(state.convenienceFacilities);
          } else {
            if (isNew) {
              state.nuisanceFacilities.push(facilityData);
            } else {
              const idx = state.nuisanceFacilities.findIndex(f => f.id === id);
              if (idx >= 0) state.nuisanceFacilities[idx] = facilityData;
            }
            saveNuisance(state.nuisanceFacilities);
          }

          closeModal();
          renderFacilitiesTab();
          showToast(isNew ? '已新增設施' : '已更新設施', 'success');
        }
      }
    ]
  );

  // Attach preset chip click handlers after modal is rendered
  if (isNew) {
    document.querySelectorAll('.preset-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('m-name').value = btn.dataset.name;
        document.getElementById('m-icon').value = btn.dataset.icon;
        document.getElementById('m-dist').value = btn.dataset.dist;
        const w = parseInt(btn.dataset.weight);
        document.getElementById('m-weight').value = w;
        document.getElementById('m-weight-val').textContent = w;
        document.getElementById('m-tags').value = btn.dataset.tags.split('|').join('\n');
        document.querySelectorAll('.preset-chip').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
  }
}

// ─── Conditions Settings Tab ──────────────────────────────────────────────────
function renderConditionsTab() {
  const container = document.getElementById('conditions-settings-list');
  if (!container) return;

  container.innerHTML = state.conditions.map(c => {
    const isPositive = c.score >= 0;
    return `
      <div class="condition-item">
        <div class="condition-item-header">
          <label class="toggle">
            <input type="checkbox" class="condition-toggle" data-id="${c.id}" ${c.enabled ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
          <span class="condition-icon-sm">${c.icon}</span>
          <span class="condition-item-name ${c.enabled ? '' : 'disabled-text'}">${c.name}</span>
          <span class="condition-item-score ${isPositive ? 'score-pos' : 'score-neg'}">
            ${isPositive ? '+' : ''}${c.score}分
          </span>
          <div class="condition-item-actions">
            <button class="btn-icon edit-condition" data-id="${c.id}" title="編輯">✏️</button>
            ${c.isCustom ? `<button class="btn-icon delete-condition" data-id="${c.id}" title="刪除">🗑️</button>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Toggle events
  container.querySelectorAll('.condition-toggle').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const c = state.conditions.find(c => c.id === e.target.dataset.id);
      if (c) c.enabled = e.target.checked;
      saveConditions(state.conditions);
      renderConditionsTab();
    });
  });

  // Edit events
  container.querySelectorAll('.edit-condition').forEach(btn => {
    btn.addEventListener('click', (e) => openConditionModal(e.currentTarget.dataset.id));
  });

  // Delete events
  container.querySelectorAll('.delete-condition').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.dataset.id;
      if (confirm('確定要刪除此條件嗎？')) {
        state.conditions = state.conditions.filter(c => c.id !== id);
        saveConditions(state.conditions);
        renderConditionsTab();
      }
    });
  });

  document.getElementById('add-condition').onclick = () => openConditionModal(null);
}

function openConditionModal(id) {
  const existing = id ? state.conditions.find(c => c.id === id) : null;
  const isNew = !existing;

  showModal(
    isNew ? '新增附加條件' : `編輯：${existing.name}`,
    `
    <div class="form-group">
      <label>條件名稱</label>
      <input id="c-name" type="text" value="${existing?.name || ''}" placeholder="例：有停車位">
    </div>
    <div class="form-group">
      <label>圖示（Emoji）</label>
      <input id="c-icon" type="text" value="${existing?.icon || '📌'}" maxlength="4" placeholder="📌">
    </div>
    <div class="form-group">
      <label>分數（正數加分、負數扣分）</label>
      <input id="c-score" type="number" value="${existing?.score ?? 5}" min="-100" max="100" step="1" placeholder="5">
      <small class="hint">建議範圍：-20 ~ +20</small>
    </div>
    `,
    [
      { label: '取消', class: 'btn-secondary', action: 'close' },
      {
        label: isNew ? '新增' : '儲存', class: 'btn-primary', action: () => {
          const name = document.getElementById('c-name').value.trim();
          const icon = document.getElementById('c-icon').value.trim() || '📌';
          const score = parseInt(document.getElementById('c-score').value);

          if (!name) { showToast('請輸入條件名稱', 'error'); return; }
          if (isNaN(score)) { showToast('請輸入有效分數', 'error'); return; }

          const condData = {
            id: existing?.id || generateId(),
            name, icon, score,
            enabled: existing?.enabled ?? true,
            isCustom: true
          };

          if (isNew) {
            state.conditions.push(condData);
          } else {
            const idx = state.conditions.findIndex(c => c.id === id);
            if (idx >= 0) state.conditions[idx] = condData;
          }

          saveConditions(state.conditions);
          closeModal();
          renderConditionsTab();
          showToast(isNew ? '已新增條件' : '已更新條件', 'success');
        }
      }
    ]
  );
}

// ─── History Tab ──────────────────────────────────────────────────────────────
function renderHistoryTab() {
  state.evaluations = loadEvaluations();
  const container = document.getElementById('history-list');

  if (state.evaluations.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">📋</span>
        <p>尚無評估紀錄</p>
        <p class="empty-hint">在「評估」頁面完成物件評估後儲存，紀錄將顯示於此</p>
      </div>`;
    return;
  }

  let html = '';
  state.evaluations.forEach((ev, index) => {
    const rec = getRecommendation(ev.scoreResults?.normalizedScore ?? 0);
    const date = new Date(ev.timestamp).toLocaleDateString('zh-TW', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });

    html += `
      <div class="history-item" style="border-left: 4px solid ${rec.color}; background: ${rec.bg}">
        <div class="history-item-top">
          <div>
            <div class="history-name">${ev.propertyName}</div>
            <div class="history-date">${date}</div>
          </div>
          <div class="history-score-wrap">
            <div class="history-score" style="color:${rec.color}">${ev.scoreResults?.normalizedScore ?? '--'}</div>
            <div class="history-label" style="color:${rec.color}">${rec.emoji} ${rec.label}</div>
          </div>
        </div>
        <div class="history-actions">
          <button class="btn btn-sm btn-secondary view-history" data-id="${ev.id}">查看詳情</button>
          <button class="btn btn-sm btn-danger-outline delete-history" data-id="${ev.id}">刪除</button>
        </div>
      </div>
    `;

    // Insert Feed Ad after the first item (index === 0)
    if (index === 0) {
      html += `
        <div class="card ad-card-feed" style="margin-top: 0; margin-bottom: 12px;">
          <div class="ad-header-row">
            <span class="ad-badge">SPONSORED</span>
            <span class="ad-title-text">微風山莊 - 頂級奢華莊園</span>
          </div>
          <div class="ad-image-container">
            <img src="/test-ad.png" alt="Sponsor Project" class="ad-image">
          </div>
          <p class="ad-description">極簡奢華美學建案，全新三房露台戶，附雙車位。近捷運與森林公園，立即預約賞屋！</p>
          <a href="https://example.com" target="_blank" class="btn btn-primary btn-sm btn-full ad-action-btn">查看詳情</a>
        </div>
      `;
    }
  });
  container.innerHTML = html;

  container.querySelectorAll('.view-history').forEach(btn => {
    btn.addEventListener('click', (e) => showHistoryDetail(e.currentTarget.dataset.id));
  });

  container.querySelectorAll('.delete-history').forEach(btn => {
    btn.addEventListener('click', (e) => {
      if (confirm('確定要刪除這筆評估紀錄嗎？')) {
        deleteEvaluation(e.currentTarget.dataset.id);
        renderHistoryTab();
        showToast('已刪除評估紀錄', 'success');
      }
    });
  });
}

function showHistoryDetail(id) {
  const ev = state.evaluations.find(e => e.id === id);
  if (!ev || !ev.scoreResults) return;

  const r = ev.scoreResults;
  const rec = r.recommendation || getRecommendation(r.normalizedScore);

  const convRows = (r.convenience || []).map(f => {
    const isGood = f.score >= 0;
    return `<tr>
      <td>${f.icon} ${f.name}</td>
      <td>${formatDistance(f.actualDistance)}（理想：${formatDistance(f.idealDistance)}）</td>
      <td class="${isGood ? 'score-pos' : 'score-neg'}">${isGood ? '+' : ''}${f.score.toFixed(1)}</td>
    </tr>`;
  }).join('');

  const nuisRows = (r.nuisance || []).map(f => {
    const isGood = f.score >= 0;
    return `<tr>
      <td>${f.icon} ${f.name}</td>
      <td>${formatDistance(f.actualDistance)}（最小：${formatDistance(f.minDistance)}）</td>
      <td class="${isGood ? 'score-pos' : 'score-neg'}">${isGood ? '+' : ''}${f.score.toFixed(1)}</td>
    </tr>`;
  }).join('');

  const condRows = (r.conditions || []).filter(c => c.value !== null).map(c => {
    const applied = c.appliedScore !== 0;
    return `<tr>
      <td>${c.icon} ${c.name}</td>
      <td>${c.value ? '符合' : '不符合'}</td>
      <td class="${c.appliedScore >= 0 ? 'score-pos' : 'score-neg'}">${applied ? (c.appliedScore >= 0 ? '+' : '') + c.appliedScore : '0'}</td>
    </tr>`;
  }).join('');

  const date = new Date(ev.timestamp).toLocaleString('zh-TW');

  const VOLUME_LABELS = { rising: '📈 增加中', stable: '📊 持平', falling: '📉 減少' };
  const SUPPLY_LABELS = { undersupply: '🔥 供不應求', balanced: '⚖️ 供需平衡', oversupply: '🏚️ 供過於求' };
  const marketSection = r.market?.data ? (() => {
    const md = r.market.data;
    const s = r.market.rawScore;
    const scoreStr = `${s >= 0 ? '+' : ''}${s} 分`;
    const rows = [
      md.volumeTrend ? `<tr><td>成交量趨勢</td><td>${VOLUME_LABELS[md.volumeTrend] || md.volumeTrend}</td></tr>` : '',
      md.supplyDemand ? `<tr><td>供需狀況</td><td>${SUPPLY_LABELS[md.supplyDemand] || md.supplyDemand}</td></tr>` : '',
      md.priceChange !== null && md.priceChange !== undefined ? `<tr><td>均價漲跌幅</td><td>${md.priceChange}%</td></tr>` : '',
      md.hasMajorProject !== null && md.hasMajorProject !== undefined ? `<tr><td>重大建設</td><td>${md.hasMajorProject ? '✅ 有' : '❌ 無'}</td></tr>` : ''
    ].filter(Boolean).join('');
    return `<h4>房價增值指標 <span class="${s >= 0 ? 'score-pos' : 'score-neg'}">${scoreStr}</span></h4>
    <table class="result-table"><tbody>${rows}</tbody></table>`;
  })() : '';

  showModal(`${ev.propertyName} 詳細評估`,
    `
    <div class="history-detail-score" style="background:${rec.bg}; color:${rec.color}">
      <span class="hd-score">${r.normalizedScore}</span>
      <span class="hd-label">${rec.emoji} ${rec.label}</span>
    </div>
    <p class="detail-date">評估時間：${date}</p>
    ${ev.mapsUrl ? `<p><a href="${ev.mapsUrl}" target="_blank" rel="noopener" class="maps-link">在 Google Maps 開啟</a></p>` : ''}
    ${convRows ? `
    <h4>便利設施</h4>
    <table class="result-table"><thead><tr><th>設施</th><th>距離</th><th>得分</th></tr></thead>
    <tbody>${convRows}</tbody></table>` : ''}
    ${nuisRows ? `
    <h4>嫌惡設施</h4>
    <table class="result-table"><thead><tr><th>設施</th><th>距離</th><th>得分</th></tr></thead>
    <tbody>${nuisRows}</tbody></table>` : ''}
    ${condRows ? `
    <h4>附加條件</h4>
    <table class="result-table"><thead><tr><th>條件</th><th>狀況</th><th>得分</th></tr></thead>
    <tbody>${condRows}</tbody></table>` : ''}
    ${marketSection}
    `,
    [
      { label: '關閉', class: 'btn-secondary', action: 'close' },
      { label: '載入到評估', class: 'btn-primary', action: () => loadHistoryToEvaluate(ev) }
    ]
  );
}

function loadHistoryToEvaluate(ev) {
  closeModal();

  // Switch to evaluate tab
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelector('[data-tab="evaluate"]').classList.add('active');
  document.getElementById('tab-evaluate').classList.add('active');

  // Reset current state first
  resetEvaluation();

  // Fill in property info
  if (ev.location) {
    setLocation(ev.location.lat, ev.location.lng, 'history');
  }
  document.getElementById('property-name').value = ev.propertyName || '';
  document.getElementById('maps-url').value = ev.mapsUrl || '';

  window.scrollTo({ top: 0, behavior: 'smooth' });
  showToast('已載入物件資訊，可重新評估', 'success');
}

// ─── Modal ────────────────────────────────────────────────────────────────────
function showModal(title, bodyHTML, buttons) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHTML;

  const footer = document.getElementById('modal-footer');
  footer.innerHTML = '';
  buttons.forEach(btn => {
    const el = document.createElement('button');
    el.className = `btn ${btn.class}`;
    el.textContent = btn.label;
    el.addEventListener('click', () => {
      if (btn.action === 'close') closeModal();
      else btn.action();
    });
    footer.appendChild(el);
  });

  document.getElementById('modal-overlay').style.display = 'flex';
}

function closeModal() {
  document.getElementById('modal-overlay').style.display = 'none';
}

document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
});

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('toast-show'));

  setTimeout(() => {
    toast.classList.remove('toast-show');
    toast.addEventListener('transitionend', () => toast.remove());
  }, 3000);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatScore(score) {
  return `${score >= 0 ? '+' : ''}${score.toFixed(1)} 分`;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function showDonateModal() {
  const bodyHTML = `
    <div class="donate-modal-container">
      <p class="donate-intro">
        這個評估工具完全免費，維持乾淨不干擾的版面，且不追蹤任何隱私數據。<br>
        如果您覺得有幫到您，歡迎小額打賞支持作者，維持地圖與算力伺服器運行！💖
      </p>

      <div class="donate-options-grid">
        <div class="donate-option-card active" id="donate-opt-bmc">
          <div class="donate-option-icon">💳</div>
          <div class="donate-option-title">線上刷卡 / 行動支付</div>
          <div class="donate-option-desc">免註冊 / 支援 Apple Pay</div>
        </div>
        
        <div class="donate-option-card" id="donate-opt-jk">
          <div class="donate-option-icon">🔴</div>
          <div class="donate-option-title">街口轉帳</div>
          <div class="donate-option-desc">台灣在地免手續費</div>
        </div>

        <div class="donate-option-card" id="donate-opt-lp">
          <div class="donate-option-icon">🟢</div>
          <div class="donate-option-title">LINE Pay 轉帳</div>
          <div class="donate-option-desc">LINE 一對一好友轉帳</div>
        </div>
      </div>

      <div class="donate-panel-container">
        <!-- ECPay -->
        <div class="donate-detail-panel active" id="donate-panel-bmc">
          <p style="font-size:0.82rem; color:var(--text-muted); margin-bottom:12px; line-height: 1.5;">
            透過綠界科技安全付款，支援 Apple Pay、Google Pay、國內外信用卡：
          </p>
          <div style="display: flex; flex-direction: column; gap: 8px;">
            <a href="https://p.ecpay.com.tw/E6CB764" target="_blank" class="btn btn-primary btn-full" style="gap:8px; text-decoration: none; justify-content: center; align-items: center; display: flex;">
              <span>☕</span> 請一杯咖啡 (NT$ 50)
            </a>
            <a href="https://p.ecpay.com.tw/EFC53E1" target="_blank" class="btn btn-primary btn-full" style="gap:8px; text-decoration: none; justify-content: center; align-items: center; display: flex;">
              <span>🍱</span> 請吃一個便當 (NT$ 150)
            </a>
            <a href="https://p.ecpay.com.tw/F01156E" target="_blank" class="btn btn-primary btn-full" style="gap:8px; text-decoration: none; justify-content: center; align-items: center; display: flex;">
              <span>🎁</span> 大力支持作者 (NT$ 500)
            </a>
          </div>
        </div>

        <!-- Jieko -->
        <div class="donate-detail-panel" id="donate-panel-jk">
          <p style="font-size:0.82rem; color:var(--text-muted); margin-bottom:6px; line-height: 1.5;">
            請打開街口支付 App，掃描下方二維碼，或是手動輸入您的街口帳號：
          </p>
          <p style="font-size:0.9rem; font-weight:700; color:var(--accent); margin-bottom:8px;">
            街口帳號：902122356
          </p>
          <div class="qr-code-wrapper">
            <img src="img/donate-jk.png" alt="街口支付 QR Code" class="donate-qr-img">
          </div>
        </div>

        <!-- LINE Pay -->
        <div class="donate-detail-panel" id="donate-panel-lp">
          <p style="font-size:0.82rem; color:var(--text-muted); margin-bottom:6px; line-height: 1.5;">
            請打開 LINE 掃描下方 QR Code 轉帳，或者直接加作者 LINE 好友付款：
          </p>
          <p style="font-size:0.9rem; font-weight:700; color:var(--accent); margin-bottom:8px;">
            LINE ID：princeomg
          </p>
          <div class="qr-code-wrapper">
            <img src="img/donate-lp.png" alt="LINE Pay QR Code" class="donate-qr-img">
          </div>
          <a href="https://line.me/ti/p/T6pcAfods9" target="_blank" class="btn btn-secondary btn-full" style="gap:8px; text-decoration: none;">
            <span>💬</span> 加好友前往 LINE 轉帳
          </a>
        </div>
      </div>
    </div>
  `;

  showModal('支持「找好房」工具', bodyHTML, [
    { label: '關閉', class: 'btn-secondary btn-full', action: 'close' }
  ]);

  // 綁定動態點擊事件來切換 Panel
  const options = ['bmc', 'jk', 'lp'];
  options.forEach(opt => {
    document.getElementById(`donate-opt-${opt}`).addEventListener('click', () => {
      options.forEach(o => {
        document.getElementById(`donate-opt-${o}`).classList.remove('active');
        document.getElementById(`donate-panel-${o}`).classList.remove('active');
      });
      document.getElementById(`donate-opt-${opt}`).classList.add('active');
      document.getElementById(`donate-panel-${opt}`).classList.add('active');
    });
  });
}

function renderAboutTab() {
  // 1. Calculate values dynamically
  const totalDonated = RECEIPTS_DATA.reduce((sum, r) => sum + r.amount, 0);
  const turtlesSaved = Math.floor(totalDonated / 400);

  document.getElementById('ocean-total-donated').textContent = `NT$ ${totalDonated.toLocaleString()}`;
  document.getElementById('ocean-turtles-saved').textContent = `${turtlesSaved} 隻`;

  // 2. Render Receipts table
  const receiptsEl = document.getElementById('receipts-list');
  if (receiptsEl) {
    receiptsEl.innerHTML = RECEIPTS_DATA.map(r => `
      <tr>
        <td>${r.date}</td>
        <td><strong>${r.charity}</strong></td>
        <td class="receipt-amount">NT$ ${r.amount.toLocaleString()}</td>
        <td><code>${r.id}</code></td>
      </tr>
    `).join('');
  }
}

function clearDanmakus() {
  if (danmakuInterval) {
    clearInterval(danmakuInterval);
    danmakuInterval = null;
  }
  const donorsEl = document.getElementById('donors-list');
  if (donorsEl) {
    donorsEl.innerHTML = '';
  }
}

function startDanmakuWall() {
  clearDanmakus(); // 先安全重置

  const donorsEl = document.getElementById('donors-list');
  if (!donorsEl) return;

  const tracks = [18, 62, 106, 150, 194]; // 5 個彈幕軌道高度，與 250px 卡片高度完美分配
  const trackOccupied = [false, false, false, false, false];

  function spawnDanmaku() {
    const freeTracks = [];
    trackOccupied.forEach((occupied, idx) => {
      if (!occupied) freeTracks.push(idx);
    });

    if (freeTracks.length === 0) return; // 軌道已滿

    const trackIndex = freeTracks[Math.floor(Math.random() * freeTracks.length)];
    trackOccupied[trackIndex] = true;

    // 隨機抽選一位贊助者
    const donor = DONORS_DATA[Math.floor(Math.random() * DONORS_DATA.length)];

    // 根據金額判斷彈幕等級：
    // - 5美金 (NT$ 150) -> 海龜款
    // - 10美金 (NT$ 300) -> 海豚款
    // - 20美金以上 (NT$ 500+) -> Manta款
    let danmakuClass = 'danmaku-turtle';
    let badgeText = '🐢 海龜款';
    let speed = 9 + Math.random() * 2; // 9s ~ 11s

    if (donor.amount >= 500) {
      danmakuClass = 'danmaku-manta';
      badgeText = '🐋 Manta款';
      speed = 13 + Math.random() * 2; // 13s ~ 15s (尊榮慢速滾動)
    } else if (donor.amount >= 300) {
      danmakuClass = 'danmaku-dolphin';
      badgeText = '🐬 海豚款';
      speed = 11 + Math.random() * 2; // 11s ~ 13s
    }

    const danmakuEl = document.createElement('div');
    danmakuEl.className = `donor-danmaku ${danmakuClass}`;
    danmakuEl.style.top = `${tracks[trackIndex]}px`;
    danmakuEl.style.animation = `danmakuRun ${speed}s linear forwards`;

    danmakuEl.innerHTML = `
      <span class="danmaku-badge">${badgeText}</span>
      <span class="danmaku-name">${donor.name}</span>
      <span class="danmaku-msg">${donor.message}</span>
    `;

    donorsEl.appendChild(danmakuEl);

    // 3.5秒後釋放軌道佔用，防追尾重疊
    setTimeout(() => {
      trackOccupied[trackIndex] = false;
    }, 3500);

    // 播放結束後銷毀 DOM
    danmakuEl.addEventListener('animationend', () => {
      danmakuEl.remove();
    });
  }

  // 初始發射兩條
  spawnDanmaku();
  setTimeout(spawnDanmaku, 1200);

  // 每 2.2 秒定時發射一條
  danmakuInterval = setInterval(spawnDanmaku, 2200);
}
