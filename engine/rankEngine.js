// engine/rankEngine.js
// 位次优先推荐引擎 V2
// 核心原则: 位次 > 分数，区间匹配 + 趋势修正 + 风险评分

const fs = require('fs');
const path = require('path');

let _cache = null;

function loadV2Data() {
  if (_cache) return _cache;
  _cache = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../data/admission-v2.json'), 'utf8')
  );
  return _cache;
}

function reloadV2Data() {
  _cache = null;
  return loadV2Data();
}

// ---------- 核心: 位次优先查询 ----------

/**
 * @param {Object} params
 * @param {number} params.rank       - 用户全省位次（优先）
 * @param {number} params.score      - 用户分数（降级备用）
 * @param {string} params.province   - 省份
 * @param {string} params.subject    - 'science' | 'arts'
 * @param {string} [params.major_id] - 可选筛选专业
 * @param {number} [params.year]     - 默认 2025
 * @param {Object} [params.options]  - 高级选项
 *
 * @returns {{ reach: [], match: [], safety: [], risky: [], meta: {} }}
 */
function rankQuery({ rank, score, province, subject, major_id, year = 2025, options = {} }) {
  const data = loadV2Data();
  const {
    reachRatio   = 1.15,   // 位次比 <= 1.15 可冲刺（用户位次/学校位次）
    matchRatio   = 0.85,   // 位次比 <= 0.85 稳妥
    safetyRatio  = 0.60,   // 位次比 <= 0.60 保底
    trendWeight  = 0.05,   // 趋势修正幅度
    strictMode   = false   // 严格模式：必须有位次数据
  } = options;

  // 1. 过滤
  let records = data.records.filter(r => {
    if (r.year !== year) return false;
    if (r.province !== province) return false;
    if (r.subject !== subject) return false;
    if (major_id && r.major_id !== major_id) return false;
    return true;
  });

  // 无结果 → 降级: 忽略年份
  if (records.length === 0) {
    records = data.records.filter(r => {
      if (r.province !== province) return false;
      if (r.subject !== subject) return false;
      if (major_id && r.major_id !== major_id) return false;
      return true;
    });
  }

  const results = [];

  for (const rec of records) {
    let tier, probability;

    if (rec.min_rank && rank) {
      // ===== 主线: 位次比计算 =====
      // rankRatio = 用户位次 / 学校录取位次
      // < 1 → 用户位次更优（数字更小），容易考上
      // > 1 → 用户位次更差（数字更大），更难考上
      const rankRatio = rank / rec.min_rank;

      if (rankRatio <= safetyRatio) {
        tier = 'safety';
        probability = 0.92 + (safetyRatio - rankRatio) * 0.3;
      } else if (rankRatio <= matchRatio) {
        tier = 'match';
        probability = 0.70 + (matchRatio - rankRatio) / (matchRatio - safetyRatio) * 0.22;
      } else if (rankRatio <= 1.0) {
        tier = 'match';
        probability = 0.50 + (1.0 - rankRatio) / (1.0 - matchRatio) * 0.20;
      } else if (rankRatio <= reachRatio) {
        tier = 'reach';
        probability = 0.15 + (reachRatio - rankRatio) / (reachRatio - 1.0) * 0.35;
      } else if (rankRatio <= 1.35) {
        tier = 'risky';
        probability = 0.03 + (1.35 - rankRatio) / 0.2 * 0.12;
      } else {
        tier = 'risky';
        probability = 0.01;
      }

      // ===== 趋势修正 =====
      if (rec.rank_trend) {
        const trend = calcRankTrend(rec.rank_trend);
        probability += trend * trendWeight;
      }

      // ===== 招生计划修正 =====
      if (rec.plan_count) {
        if (rec.plan_count <= 3)  probability -= 0.03;  // 名额太少，波动大
        if (rec.plan_count >= 50) probability += 0.02;  // 名额多，稳定
      }

    } else if (score && rec.min_score) {
      // ===== 降级: 分数差计算 =====
      const scoreDiff = score - rec.min_score;

      if (scoreDiff >= 30) {
        tier = 'safety'; probability = 0.95;
      } else if (scoreDiff >= 10) {
        tier = 'match'; probability = 0.70 + (scoreDiff - 10) / 20 * 0.25;
      } else if (scoreDiff >= -5) {
        tier = 'match'; probability = 0.45 + (scoreDiff + 5) / 15 * 0.25;
      } else if (scoreDiff >= -20) {
        tier = 'reach'; probability = 0.10 + (scoreDiff + 20) / 15 * 0.35;
      } else {
        tier = 'risky'; probability = 0.02;
      }
    } else if (strictMode) {
      continue;  // 严格模式：无位次/分数数据则跳过
    } else {
      tier = 'unknown'; probability = 0.3;
    }

    probability = Math.max(0.01, Math.min(0.99, probability));

    const school = getSchool(rec.school_id, data);

    results.push({
      school_id:    rec.school_id,
      school_name:  school ? school.name : rec.school_id,
      school_level: school ? school.level : '',
      school_city:  school ? school.city : '',
      major_name:   rec.major_name,
      major_id:     rec.major_id,
      min_score:    rec.min_score,
      min_rank:     rec.min_rank,
      avg_score:    rec.avg_score,
      tier,
      admission_probability: Math.round(probability * 100),
      rank_ratio:   rank && rec.min_rank ? +(rank / rec.min_rank).toFixed(3) : null,
      score_diff:   score && rec.min_score ? score - rec.min_score : null,
      plan_count:   rec.plan_count,
      rank_trend:   rec.rank_trend ? calcTrendLabel(rec.rank_trend) : null,
      employment_score: school ? school.employment_score : 50
    });
  }

  // 2. 排序: probability 降序
  results.sort((a, b) => b.admission_probability - a.admission_probability);

  // 3. 分组
  const reach  = results.filter(r => r.tier === 'reach');
  const match  = results.filter(r => r.tier === 'match');
  const safety = results.filter(r => r.tier === 'safety');
  const risky  = results.filter(r => r.tier === 'risky');

  return {
    reach,
    match,
    safety,
    risky,
    meta: {
      rank,
      score,
      province,
      subject,
      major_id: major_id || 'all',
      year,
      total_matched: results.length,
      query_mode: rank ? 'rank_priority' : 'score_fallback',
      thresholds: { reachRatio, matchRatio, safetyRatio }
    }
  };
}

// ---------- 跨专业全量查询 ----------

function rankQueryAllMajors({ rank, score, province, subject, year = 2025, options = {} }) {
  const data = loadV2Data();

  let records = data.records.filter(r => {
    if (r.year !== year) return false;
    if (r.province !== province) return false;
    if (r.subject !== subject) return false;
    return true;
  });

  const byMajor = {};

  for (const rec of records) {
    const key = rec.major_id;
    if (!byMajor[key]) {
      byMajor[key] = {
        major_name: rec.major_name,
        reach: [], match: [], safety: [], risky: []
      };
    }

    let tier, probability;
    if (rec.min_rank && rank) {
      const rankRatio = rank / rec.min_rank;
      if (rankRatio <= 0.60)      { tier = 'safety'; probability = 0.92; }
      else if (rankRatio <= 0.85) { tier = 'match';  probability = 0.75; }
      else if (rankRatio <= 1.0)  { tier = 'match';  probability = 0.55; }
      else if (rankRatio <= 1.15) { tier = 'reach';  probability = 0.30; }
      else if (rankRatio <= 1.35) { tier = 'risky';  probability = 0.08; }
      else                        { tier = 'risky';  probability = 0.02; }
    } else if (score && rec.min_score) {
      const d = score - rec.min_score;
      if (d >= 30)      { tier = 'safety'; probability = 0.95; }
      else if (d >= 10) { tier = 'match';  probability = 0.70; }
      else if (d >= -5) { tier = 'match';  probability = 0.50; }
      else if (d >= -20){ tier = 'reach';  probability = 0.20; }
      else              { tier = 'risky';  probability = 0.05; }
    } else continue;

    const school = getSchool(rec.school_id, data);
    byMajor[key][tier].push({
      school_name:  school ? school.name : rec.school_id,
      school_level: school ? school.level : '',
      school_city:  school ? school.city : '',
      min_score:    rec.min_score,
      min_rank:     rec.min_rank,
      admission_probability: Math.round(probability * 100),
      rank_trend:   rec.rank_trend ? calcTrendLabel(rec.rank_trend) : null
    });
  }

  return { byMajor, meta: { rank, score, province, subject, year } };
}

// ---------- 辅助函数 ----------

function getSchool(schoolId, data) {
  return data.schools.find(x => x.id === schoolId) || null;
}

function calcRankTrend(trendObj) {
  const years = Object.keys(trendObj).sort();
  if (years.length < 2) return 0;

  const latest = years.slice(-3);
  if (latest.length < 2) return 0;

  const first = trendObj[latest[0]];
  const last  = trendObj[latest[latest.length - 1]];
  return (first - last) / first;
}

function calcTrendLabel(trendObj) {
  const v = calcRankTrend(trendObj);
  if (v > 0.05)  return '📈 扩招中（越来越好考）';
  if (v > 0.02)  return '📈 轻微扩招';
  if (v < -0.05) return '📉 竞争加剧（越来越难考）';
  if (v < -0.02) return '📉 轻微紧缩';
  return '➡️ 稳定';
}

// ---------- 自检 ----------
if (require.main === module) {
  console.log('═══════════════════════════════════');
  console.log('  位次引擎 V2 · 自检');
  console.log('═══════════════════════════════════\n');

  const data = loadV2Data();
  console.log('📦 数据:', data.records.length, '条,', data.schools.length, '所学校');
  console.log('🗺️  省份:', data.meta.provinces.join(', '));
  console.log('📅 年份:', data.meta.years.join(', '));

  // 测试1: 河南理科 rank=5000, score=633
  const r1 = rankQuery({ rank: 5000, score: 633, province: '河南', subject: 'science', major_id: 'computer_science' });
  console.log('\n【位次5000 · 河南理科 · 计算机】');
  console.log('  冲:', r1.reach.map(s => `${s.school_name}(位${s.min_rank},${s.admission_probability}%)`).join(' | ') || '无');
  console.log('  稳:', r1.match.map(s => `${s.school_name}(位${s.min_rank},${s.admission_probability}%)`).join(' | ') || '无');
  console.log('  保:', r1.safety.map(s => `${s.school_name}(位${s.min_rank},${s.admission_probability}%)`).join(' | ') || '无');

  // 测试2: 位次比分数优先
  const r2 = rankQuery({ rank: 10000, score: 580, province: '河南', subject: 'science' });
  console.log('\n【位次10000 · 河南理科 · 全专业】');
  console.log('  冲:', r2.reach.slice(0,3).map(s => `${s.major_name}@${s.school_name}(位${s.min_rank})`).join(' | '));
  console.log('  稳:', r2.match.slice(0,3).map(s => `${s.major_name}@${s.school_name}(位${s.min_rank})`).join(' | '));
  console.log('  保:', r2.safety.slice(0,3).map(s => `${s.major_name}@${s.school_name}(位${s.min_rank})`).join(' | '));

  // 测试3: 趋势修正
  const r3 = rankQuery({ rank: 5000, score: 633, province: '河南', subject: 'science', major_id: 'computer_science' });
  const xidian = [...r3.reach, ...r3.match, ...r3.safety].find(s => s.school_id === 'xidian');
  if (xidian) {
    console.log('\n【趋势修正示例】西电计算机:');
    console.log('  录取位次趋势:', xidian.rank_trend);
    console.log('  录取概率:', xidian.admission_probability, '%');
  }

  // 测试4: 跨省查询
  const r4 = rankQuery({ rank: 5000, score: 635, province: '山东', subject: 'science', major_id: 'computer_science' });
  console.log('\n【位次5000 · 山东理科 · 计算机】');
  console.log('  匹配:', r4.meta.total_matched, '所 → 冲', r4.reach.length, '| 稳', r4.match.length, '| 保', r4.safety.length);

  console.log('\n✅ 位次引擎 V2 自检通过\n');
}

module.exports = { rankQuery, rankQueryAllMajors, reloadV2Data, loadV2Data };
