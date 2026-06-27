// engine/profileValidator.js
// 学生画像校验 —— 判断画像是否足够运行引擎

const REQUIRED = ['score', 'province', 'subject', 'family_income'];
const OPTIONAL = ['rank', 'interest', 'city_preference', 'postgraduate'];
const ALL = [...REQUIRED, ...OPTIONAL];

const PROVINCE_WHITELIST = [
  '北京','上海','广东','浙江','江苏','山东','河南','河北','湖北',
  '湖南','四川','重庆','福建','安徽','江西','陕西','山西','辽宁',
  '吉林','黑龙江','天津','广西','云南','贵州','甘肃','内蒙古',
  '新疆','海南','宁夏','青海','西藏'
];

function isProfileReady(profile) {
  if (!profile) return false;
  return REQUIRED.every(k => profile[k] != null && profile[k] !== '');
}

function getMissingFields(profile) {
  if (!profile) return REQUIRED;
  return REQUIRED.filter(k => profile[k] == null || profile[k] === '');
}

function getCompleteness(profile) {
  if (!profile) return { percent: 0, filled: [], missing: ALL };
  const filled = ALL.filter(k => profile[k] != null && profile[k] !== '');
  const missing = ALL.filter(k => profile[k] == null || profile[k] === '');
  return {
    percent: Math.round((filled.length / ALL.length) * 100),
    filled,
    missing
  };
}

function validateField(key, value) {
  if (value == null || value === '') return { valid: false, reason: 'empty' };

  switch (key) {
    case 'score': {
      const n = Number(value);
      if (isNaN(n) || n < 200 || n > 750) return { valid: false, reason: '分数应在200-750之间' };
      return { valid: true, normalized: n };
    }
    case 'rank': {
      const n = Number(value);
      if (isNaN(n) || n < 1) return { valid: false, reason: '位次无效' };
      return { valid: true, normalized: n };
    }
    case 'province':
      if (!PROVINCE_WHITELIST.includes(value)) return { valid: false, reason: '省份不在白名单' };
      return { valid: true };
    case 'subject':
      if (!['science', 'arts', '理科', '文科'].includes(value)) return { valid: false, reason: '科类无效' };
      return { valid: true, normalized: value === '理科' ? 'science' : value === '文科' ? 'arts' : value };
    case 'family_income':
      if (!['low', 'medium', 'high', '低', '中', '高'].includes(value)) return { valid: false, reason: '家庭条件无效' };
      return { valid: true };
    case 'interest':
      return { valid: true };
    case 'city_preference': {
      if (typeof value === 'boolean') return { valid: true };
      if (value === 'true' || value === '是') return { valid: true, normalized: true };
      if (value === 'false' || value === '否') return { valid: true, normalized: false };
      return { valid: true };
    }
    case 'postgraduate': {
      if (typeof value === 'boolean') return { valid: true };
      if (value === 'true' || value === '是') return { valid: true, normalized: true };
      if (value === 'false' || value === '否') return { valid: true, normalized: false };
      return { valid: true };
    }
    default:
      return { valid: true };
  }
}

function mergeProfile(existing, updates) {
  const merged = { ...existing };
  for (const [key, value] of Object.entries(updates)) {
    if (!ALL.includes(key)) continue;
    const result = validateField(key, value);
    if (result.valid) {
      merged[key] = result.normalized !== undefined ? result.normalized : value;
    }
  }
  return merged;
}

function mapToEngineInput(profile) {
  const income = profile.family_income;
  let wealth;
  if (income === 'low' || income === '低') wealth = 2;
  else if (income === 'high' || income === '高') wealth = 9;
  else wealth = 5;

  return {
    family_wealth: wealth,
    subject: profile.subject === '理科' ? 'science' : profile.subject === '文科' ? 'arts' : profile.subject,
    interest_clarity: !!(profile.interest && profile.interest.trim()),
    prefers_big_city: profile.city_preference !== false,
    family_finance_bg: income === 'high' || income === '高',
    postgraduate: !!profile.postgraduate,
    score: profile.score || 0,
    rank: profile.rank || 0,
    province: profile.province || ''
  };
}

module.exports = {
  REQUIRED, OPTIONAL, ALL,
  isProfileReady,
  getMissingFields,
  getCompleteness,
  validateField,
  mergeProfile,
  mapToEngineInput
};
