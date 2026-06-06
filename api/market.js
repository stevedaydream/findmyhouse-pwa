/**
 * /api/market?lat=X&lng=Y
 *
 * 自動從內政部實價登錄公開 CSV 查詢周邊住宅成交資料，
 * 計算近期均價漲跌幅與交易量趨勢，無需 API Key。
 *
 * 使用 Vercel Edge Runtime（最長 25 秒，適合多個 CSV 並行下載）。
 */

export const config = { runtime: 'edge' };

// ─── 縣市代碼對照表（實價登錄 CSV 檔名首字母）─────────────────────────────
const COUNTY_CODES = {
  '台北市': 'A', '臺北市': 'A',
  '台中市': 'B', '臺中市': 'B',
  '基隆市': 'C',
  '台南市': 'D', '臺南市': 'D',
  '高雄市': 'E',
  '新北市': 'F',
  '宜蘭縣': 'G',
  '桃園市': 'H', '桃園縣': 'H',
  '嘉義市': 'I',
  '新竹縣': 'J',
  '苗栗縣': 'K',
  '南投縣': 'M',
  '彰化縣': 'N',
  '新竹市': 'O',
  '雲林縣': 'P',
  '嘉義縣': 'Q',
  '屏東縣': 'T',
  '花蓮縣': 'U',
  '台東縣': 'V', '臺東縣': 'V',
  '澎湖縣': 'X',
  '金門縣': 'W',
  '連江縣': 'Z'
};

function resolveCountyCode(name) {
  if (!name) return null;
  if (COUNTY_CODES[name]) return COUNTY_CODES[name];
  for (const [key, code] of Object.entries(COUNTY_CODES)) {
    if (name.includes(key) || key.includes(name)) return code;
  }
  return null;
}

// ─── 計算最近 N 個完整季度（民國年格式）──────────────────────────────────
function recentSeasons(n) {
  const now = new Date();
  const rocYear = now.getFullYear() - 1911;
  let q = Math.ceil((now.getMonth() + 1) / 3) - 1; // 上一個完整季
  let y = rocYear;
  if (q < 1) { q = 4; y--; }

  const seasons = [];
  for (let i = 0; i < n; i++) {
    seasons.push(`${y}S${q}`);
    q--;
    if (q < 1) { q = 4; y--; }
  }
  return seasons;
}

// ─── 簡易 CSV 解析（支援雙引號欄位）─────────────────────────────────────
function splitLine(line) {
  const fields = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) {
      fields.push(cur); cur = '';
    } else {
      cur += c;
    }
  }
  fields.push(cur);
  return fields;
}

function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length < 2) return [];

  // 移除 BOM
  const headerLine = lines[0].replace(/^\uFEFF/, '');
  const headers = splitLine(headerLine).map(h => h.trim());

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const vals = splitLine(line);
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = (vals[idx] || '').trim(); });
    rows.push(obj);
  }
  return rows;
}

// 民國日期字串（YYYMMDD）→ Date
function parseROCDate(s) {
  if (!s || s.length < 5) return null;
  const y = parseInt(s.slice(0, 3));
  const m = parseInt(s.slice(3, 5));
  if (isNaN(y) || isNaN(m) || m < 1 || m > 12) return null;
  return new Date(y + 1911, m - 1, 1);
}

// ─── 下載單季 CSV 並解析為結構化記錄 ─────────────────────────────────────
async function fetchSeason(season, countyCode) {
  const url = `https://plvr.land.moi.gov.tw/DownloadSeason?season=${season}&fileName=${countyCode}_lvr_land_a.csv`;

  // 嘗試從 Edge Cache 中讀取
  try {
    const cache = await caches.open('moi-csv-cache');
    const cachedRes = await cache.match(url);
    if (cachedRes) {
      const buf = await cachedRes.arrayBuffer();
      return processCsvBuffer(buf);
    }
  } catch (e) {
    console.error('[Cache Read Error]', e);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 FindMyHousePWA/1.0 (public data)' }
    });
    clearTimeout(timer);
    if (!res.ok) return [];

    const clonedRes = res.clone();
    const buf = await res.arrayBuffer();

    // 非同步寫入 Cache，避免阻塞回傳
    try {
      const cache = await caches.open('moi-csv-cache');
      await cache.put(url, clonedRes);
    } catch (e) {
      console.error('[Cache Write Error]', e);
    }

    return processCsvBuffer(buf);

  } catch {
    clearTimeout(timer);
    return [];
  }
}

// 處理 CSV 的 ArrayBuffer 內容，轉為結構化紀錄
function processCsvBuffer(buf) {
  // 嘗試 UTF-8，失敗則用 Big5
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    text = new TextDecoder('big5').decode(buf);
  }

  const rows = parseCSV(text);

  return rows
    .filter(r => {
      const target = r['交易標的'] || '';
      const use    = r['主要用途'] || '';
      // 只保留有建物的住宅類成交
      return target.includes('建物') &&
             (use === '' || use.includes('住') || use.includes('見使用執照'));
    })
    .map(r => ({
      district:  r['鄉鎮市區'] || '',
      date:      parseROCDate(r['交易年月日']),
      unitPrice: parseFloat(r['單價元平方公尺']) || 0
    }))
    .filter(r => r.unitPrice > 0 && r.date !== null);
}


// ─── 統計分析：漲跌幅、量趨勢、供需判斷 ─────────────────────────────────
function analyze(records) {
  // 依時間排序，切成前後兩半比較
  records.sort((a, b) => a.date - b.date);
  const half   = Math.floor(records.length / 2);
  const older  = records.slice(0, half);
  const recent = records.slice(half);

  const avg = arr => arr.reduce((s, r) => s + r.unitPrice, 0) / arr.length;
  const olderAvg  = older.length  ? avg(older)  : 0;
  const recentAvg = recent.length ? avg(recent) : 0;

  const priceChangePct = olderAvg > 0
    ? Math.round((recentAvg - olderAvg) / olderAvg * 1000) / 10
    : null;

  // 交易量趨勢（±15% 為門檻）
  const volRatio    = older.length > 0 ? recent.length / older.length : 1;
  const volumeTrend = volRatio >= 1.15 ? 'rising' : volRatio <= 0.85 ? 'falling' : 'stable';

  // 供需判斷（以均價趨勢 + 量趨勢估算）
  let supplyDemand = 'balanced';
  if (priceChangePct !== null && priceChangePct > 5 && volumeTrend !== 'falling') {
    supplyDemand = 'undersupply';
  } else if ((priceChangePct !== null && priceChangePct < -3) || volumeTrend === 'falling') {
    supplyDemand = 'oversupply';
  }

  return {
    priceChangePct,
    volumeTrend,
    supplyDemand,
    sampleSize:     records.length,
    recentAvgPrice: Math.round(recentAvg),
    olderAvgPrice:  Math.round(olderAvg)
  };
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req) {
  const headers = {
    'Content-Type':                'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control':               's-maxage=21600, stale-while-revalidate=86400' // 快取 6 小時
  };

  const { searchParams } = new URL(req.url);
  const lat = parseFloat(searchParams.get('lat'));
  const lng = parseFloat(searchParams.get('lng'));
  const cityParam = searchParams.get('city');
  const districtParam = searchParams.get('district');

  if (isNaN(lat) || isNaN(lng)) {
    return new Response(JSON.stringify({ error: 'bad_coords' }), { status: 400, headers });
  }

  try {
    let city = cityParam ? decodeURIComponent(cityParam).trim() : '';
    let district = districtParam ? decodeURIComponent(districtParam).trim() : '';

    // 若前端未傳入行政區，則進行伺服器端反地理編碼（Fallback 機制）
    if (!city) {
      const geoRes = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=zh-TW`,
        { headers: { 'User-Agent': 'FindMyHousePWA/1.0' } }
      );
      if (!geoRes.ok) {
        return new Response(JSON.stringify({ supported: false, reason: 'geocode_failed' }), { headers });
      }

      const geo = await geoRes.json();
      if (geo.address?.country_code !== 'tw') {
        return new Response(JSON.stringify({ supported: false, reason: 'not_taiwan' }), { headers });
      }

      city     = geo.address?.city     || geo.address?.county || geo.address?.state || '';
      district = geo.address?.city_district || geo.address?.suburb || geo.address?.town || '';
    }

    const countyCode = resolveCountyCode(city);
    if (!countyCode) {
      return new Response(JSON.stringify({ supported: false, reason: 'unknown_county', city }), { headers });
    }


    // 2. 並行下載近 4 季 CSV
    const seasons = recentSeasons(4);
    const fetched = await Promise.all(seasons.map(s => fetchSeason(s, countyCode)));
    let records   = fetched.flat();

    // 3. 優先用行政區篩選，不足 10 筆則退回縣市全區
    if (district) {
      const distFiltered = records.filter(r => r.district === district);
      if (distFiltered.length >= 10) records = distFiltered;
    }

    if (records.length < 10) {
      return new Response(
        JSON.stringify({ supported: false, reason: 'no_data', sampleSize: records.length }),
        { headers }
      );
    }

    // 4. 分析
    const result = analyze(records);
    return new Response(
      JSON.stringify({ supported: true, city, district, ...result }),
      { headers }
    );

  } catch (err) {
    return new Response(JSON.stringify({ supported: false, reason: 'error', detail: err.message }), { headers });
  }
}
