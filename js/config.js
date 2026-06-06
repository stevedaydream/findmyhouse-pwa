// Bump this number whenever defaults change (tags, enabled status, new facilities).
// Storage will clear old facility cache and load fresh defaults.
export const CONFIG_VERSION = 2;

// Default convenience facilities (便利設施) - closer is better
export const DEFAULT_CONVENIENCE_FACILITIES = [
  {
    id: 'mrt',
    name: '捷運/地鐵站',
    icon: '🚇',
    enabled: true,
    idealDistance: 500,
    weight: 5,
    tags: [
      { key: 'station', value: 'subway' },
      { key: 'railway', value: 'subway_entrance' },
      { key: 'railway', value: 'light_rail' }
    ],
    searchRadius: 3000,
    isCustom: false
  },
  {
    id: 'train',
    name: '火車/高鐵站',
    icon: '🚆',
    enabled: true,
    idealDistance: 1000,
    weight: 3,
    tags: [
      { key: 'railway', value: 'station' },
      { key: 'railway', value: 'halt' }
    ],
    searchRadius: 5000,
    isCustom: false
  },
  {
    id: 'bus_stop',
    name: '公車站',
    icon: '🚌',
    enabled: true,
    idealDistance: 300,
    weight: 3,
    tags: [
      { key: 'highway', value: 'bus_stop' },
      { key: 'amenity', value: 'bus_station' }
    ],
    searchRadius: 800,
    isCustom: false
  },
  {
    id: 'convenience_store',
    name: '便利商店',
    icon: '🏪',
    enabled: true,
    idealDistance: 300,
    weight: 3,
    tags: [
      { key: 'shop', value: 'convenience' }
    ],
    searchRadius: 1000,
    isCustom: false
  },
  {
    id: 'supermarket',
    name: '超市/量販店',
    icon: '🛒',
    enabled: true,
    idealDistance: 800,
    weight: 2,
    tags: [
      { key: 'shop', value: 'supermarket' },
      { key: 'shop', value: 'hypermarket' }
    ],
    searchRadius: 2000,
    isCustom: false
  },
  {
    id: 'department_store',
    name: '百貨公司/購物中心',
    icon: '🏬',
    enabled: true,
    idealDistance: 1000,
    weight: 2,
    tags: [
      { key: 'shop', value: 'department_store' },
      { key: 'shop', value: 'mall' }
    ],
    searchRadius: 3000,
    isCustom: false
  },
  {
    id: 'hospital',
    name: '醫院',
    icon: '🏥',
    enabled: true,
    idealDistance: 1500,
    weight: 3,
    tags: [
      { key: 'amenity', value: 'hospital' }
    ],
    searchRadius: 4000,
    isCustom: false
  },
  {
    id: 'clinic',
    name: '診所',
    icon: '⚕️',
    enabled: true,
    idealDistance: 500,
    weight: 2,
    tags: [
      { key: 'amenity', value: 'clinic' },
      { key: 'amenity', value: 'doctors' }
    ],
    searchRadius: 1500,
    isCustom: false
  },
  {
    id: 'pharmacy',
    name: '藥局',
    icon: '💊',
    enabled: true,
    idealDistance: 500,
    weight: 2,
    tags: [
      { key: 'amenity', value: 'pharmacy' }
    ],
    searchRadius: 1500,
    isCustom: false
  },
  {
    id: 'school',
    name: '學校',
    icon: '🏫',
    enabled: false,
    idealDistance: 800,
    weight: 3,
    tags: [
      { key: 'amenity', value: 'school' }
    ],
    searchRadius: 2000,
    isCustom: false
  },
  {
    id: 'university',
    name: '大學',
    icon: '🎓',
    enabled: false,
    idealDistance: 1500,
    weight: 2,
    tags: [
      { key: 'amenity', value: 'university' },
      { key: 'amenity', value: 'college' }
    ],
    searchRadius: 4000,
    isCustom: false
  },
  {
    id: 'park',
    name: '公園/綠地',
    icon: '🌳',
    enabled: true,
    idealDistance: 500,
    weight: 2,
    tags: [
      { key: 'leisure', value: 'park' }
    ],
    searchRadius: 1500,
    isCustom: false
  },
  {
    id: 'bank',
    name: '銀行/ATM',
    icon: '🏦',
    enabled: false,
    idealDistance: 500,
    weight: 1,
    tags: [
      { key: 'amenity', value: 'bank' },
      { key: 'amenity', value: 'atm' }
    ],
    searchRadius: 1500,
    isCustom: false
  },
  {
    id: 'gym',
    name: '健身房',
    icon: '🏋️',
    enabled: false,
    idealDistance: 800,
    weight: 2,
    tags: [
      { key: 'leisure', value: 'fitness_centre' },
      { key: 'leisure', value: 'gym' }
    ],
    searchRadius: 2000,
    isCustom: false
  },
  {
    id: 'market',
    name: '傳統市場',
    icon: '🥬',
    enabled: false,
    idealDistance: 500,
    weight: 2,
    tags: [
      { key: 'amenity', value: 'marketplace' }
    ],
    searchRadius: 1500,
    isCustom: false
  }
];

// Default nuisance facilities (嫌惡設施) - farther is better
export const DEFAULT_NUISANCE_FACILITIES = [
  {
    id: 'cemetery',
    name: '墓地/公墓',
    icon: '⚰️',
    enabled: true,
    minDistance: 300,
    weight: 4,
    tags: [
      { key: 'landuse', value: 'cemetery' },
      { key: 'amenity', value: 'grave_yard' }
    ],
    searchRadius: 1000,
    isCustom: false
  },
  {
    id: 'industrial',
    name: '工廠/工業區',
    icon: '🏭',
    enabled: true,
    minDistance: 500,
    weight: 4,
    tags: [
      { key: 'landuse', value: 'industrial' }
    ],
    searchRadius: 1500,
    isCustom: false
  },
  {
    id: 'fuel',
    name: '加油站',
    icon: '⛽',
    enabled: true,
    minDistance: 100,
    weight: 2,
    tags: [
      { key: 'amenity', value: 'fuel' }
    ],
    searchRadius: 500,
    isCustom: false
  },
  {
    id: 'substation',
    name: '變電站',
    icon: '⚡',
    enabled: true,
    minDistance: 200,
    weight: 3,
    tags: [
      { key: 'power', value: 'substation' }
    ],
    searchRadius: 600,
    isCustom: false
  },
  {
    id: 'power_tower',
    name: '高壓電塔',
    icon: '🗼',
    enabled: false,
    minDistance: 100,
    weight: 3,
    tags: [
      { key: 'power', value: 'tower' }
    ],
    searchRadius: 400,
    isCustom: false
  },
  {
    id: 'landfill',
    name: '垃圾場/掩埋場',
    icon: '🗑️',
    enabled: true,
    minDistance: 500,
    weight: 5,
    tags: [
      { key: 'landuse', value: 'landfill' }
    ],
    searchRadius: 2000,
    isCustom: false
  },
  {
    id: 'waste_treatment',
    name: '焚化爐/廢棄物處理',
    icon: '♻️',
    enabled: true,
    minDistance: 500,
    weight: 4,
    tags: [
      { key: 'amenity', value: 'waste_disposal' },
      { key: 'man_made', value: 'works' }
    ],
    searchRadius: 2000,
    isCustom: false
  },
  {
    id: 'nightclub',
    name: '夜店/酒吧',
    icon: '🍺',
    enabled: false,
    minDistance: 200,
    weight: 2,
    tags: [
      { key: 'amenity', value: 'nightclub' },
      { key: 'amenity', value: 'bar' }
    ],
    searchRadius: 600,
    isCustom: false
  },
  {
    id: 'slaughterhouse',
    name: '屠宰場',
    icon: '🥩',
    enabled: false,
    minDistance: 500,
    weight: 3,
    tags: [
      { key: 'landuse', value: 'slaughterhouse' }
    ],
    searchRadius: 1500,
    isCustom: false
  },
  {
    id: 'prison',
    name: '監獄/看守所',
    icon: '🔒',
    enabled: false,
    minDistance: 300,
    weight: 2,
    tags: [
      { key: 'amenity', value: 'prison' }
    ],
    searchRadius: 1000,
    isCustom: false
  }
];

// Default custom conditions (附加條件) - boolean yes/no with fixed score
export const DEFAULT_CONDITIONS = [
  { id: 'parking', name: '有停車位', icon: '🅿️', score: 10, enabled: true, isCustom: false },
  { id: 'standalone_house', name: '一戶建/透天厝', icon: '🏠', score: 15, enabled: true, isCustom: false },
  { id: 'elevator', name: '有電梯', icon: '🛗', score: 8, enabled: true, isCustom: false },
  { id: 'management', name: '有管理員/保全', icon: '💂', score: 8, enabled: true, isCustom: false },
  { id: 'furnished', name: '附家具家電', icon: '🛋️', score: 5, enabled: true, isCustom: false },
  { id: 'airbnb_ok', name: '可做民宿/短租', icon: '🏡', score: 10, enabled: false, isCustom: false },
  { id: 'new_building', name: '新成屋/預售屋', icon: '✨', score: 5, enabled: false, isCustom: false },
  { id: 'view', name: '有良好景觀', icon: '🌅', score: 5, enabled: false, isCustom: false },
  { id: 'top_floor', name: '頂樓（漏水/隔熱疑慮）', icon: '🏢', score: -8, enabled: false, isCustom: false },
  { id: 'first_floor', name: '一樓（潮濕/安全疑慮）', icon: '1️⃣', score: -5, enabled: false, isCustom: false },
  { id: 'roadside_noise', name: '臨大馬路（噪音）', icon: '🛣️', score: -5, enabled: false, isCustom: false },
  { id: 'old_building', name: '老舊建築（30年以上）', icon: '🏚️', score: -10, enabled: false, isCustom: false }
];

export const RECOMMENDATION_LEVELS = [
  { min: 85, label: '強烈推薦', color: '#059669', bg: '#D1FAE5', emoji: '🏆' },
  { min: 70, label: '推薦購買', color: '#2563EB', bg: '#DBEAFE', emoji: '👍' },
  { min: 55, label: '尚可考慮', color: '#D97706', bg: '#FEF3C7', emoji: '🤔' },
  { min: 40, label: '需謹慎評估', color: '#EA580C', bg: '#FFEDD5', emoji: '⚠️' },
  { min: 0,  label: '不建議購買', color: '#DC2626', bg: '#FEE2E2', emoji: '❌' }
];
