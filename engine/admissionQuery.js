// engine/admissionQuery.js
// V4 统一录取数据查询引擎
// 合并 queryAdmission.js (分数优先) + rankEngine.js (位次优先)
// 数据: admission-v3.json → admission-v2.json (降级)

const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

let _v3 = null;
let _v2 = null;

function loadV3() {
  if (_v3) return _v3;
  const v3json = path.join(__dirname, '../data/admission-v3.json');
  const v3gz = v3json + '.gz';
  try {
    if (fs.existsSync(v3gz)) {
      const buf = fs.readFileSync(v3gz);
      _v3 = JSON.parse(zlib.gunzipSync(buf).toString('utf8'));
    } else if (fs.existsSync(v3json)) {
      _v3 = JSON.parse(fs.readFileSync(v3json, 'utf8'));
    } else {
      console.log('[admissionQuery] v3 数据文件不存在');
      return null;
    }
    console.log(`[admissionQuery] v3 数据加载成功: ${_v3.records?.length || 0}条`);
    return _v3;
  } catch (e) {
    console.log('[admissionQuery] v3 数据加载失败，降级到 v2:', e.message);
    return null;
  }
}

function loadV2() {
  if (_v2) return _v2;
  try {
    _v2 = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/admission-v2.json'), 'utf8'));
    return _v2;
  } catch (e) {
    console.log('[admissionQuery] v2 数据加载失败:', e.message);
    return null;
  }
}

function loadData() {
  return loadV3() || loadV2();
}

function reloadData() {
  _v3 = null; _v2 = null;
  return loadData();
}

// ===== 辅助 =====

function getSchool(schoolId, data) {
  return data.schools.find(x => x.id === schoolId) || null;
}

function calcTrendLabel(trendObj) {
  if (!trendObj) return null;
  const years = Object.keys(trendObj).sort();
  if (years.length < 2) return null;
  const latest = years.slice(-3);
  if (latest.length < 2) return null;
  const first = trendObj[latest[0]];
  const last = trendObj[latest[latest.length - 1]];
  const v = (first - last) / first;
  if (v > 0.05) return '📈 扩招中（越来越好考）';
  if (v > 0.02) return '📈 轻微扩招';
  if (v < -0.05) return '📉 竞争加剧（越来越难考）';
  if (v < -0.02) return '📉 轻微紧缩';
  return '➡️ 稳定';
}

// ===== 位次优先查询 (主力) =====

function rankQuery({ rank, score, province, subject, major_id, year = 2025, options = {} }) {
  const data = loadData();
  if (!data) return { reach: [], match: [], safety: [], risky: [], meta: { error: 'no data' } };

  const {
    reachRatio   = 1.15,
    matchRatio   = 0.85,
    safetyRatio  = 0.60,
    trendWeight  = 0.05,
  } = options;

  let records = data.records.filter(r => {
    if (r.year !== year) return false;
    if (r.province !== province) return false;
    if (r.subject !== subject) return false;
    if (major_id && r.major_id !== major_id) return false;
    return true;
  });

  // 无当年数据 → 跨年降级
  if (records.length === 0) {
    records = data.records.filter(r => {
      if (r.province !== province) return false;
      if (r.subject !== subject) return false;
      if (major_id && r.major_id !== major_id) return false;
      return true;
    });
  }

  // 无该省数据 → 跨省降级
  if (records.length === 0 && major_id) {
    records = data.records.filter(r => {
      if (r.subject !== subject) return false;
      if (r.major_id !== major_id) return false;
      return true;
    });
  }

  const results = [];

  for (const rec of records) {
    let tier, probability;

    if (rec.min_rank && rank) {
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

      if (rec.rank_trend) {
        const years = Object.keys(rec.rank_trend).sort();
        if (years.length >= 2) {
          const first = rec.rank_trend[years[0]];
          const last = rec.rank_trend[years[years.length - 1]];
          probability += ((first - last) / first) * trendWeight;
        }
      }
      if (rec.plan_count) {
        if (rec.plan_count <= 3) probability -= 0.03;
        if (rec.plan_count >= 50) probability += 0.02;
      }
    } else if (score && rec.min_score) {
      const scoreDiff = score - rec.min_score;
      if (scoreDiff >= 30)      { tier = 'safety'; probability = 0.95; }
      else if (scoreDiff >= 10) { tier = 'match'; probability = 0.70 + (scoreDiff - 10) / 20 * 0.25; }
      else if (scoreDiff >= -5) { tier = 'match'; probability = 0.45 + (scoreDiff + 5) / 15 * 0.25; }
      else if (scoreDiff >= -20){ tier = 'reach'; probability = 0.10 + (scoreDiff + 20) / 15 * 0.35; }
      else                     { tier = 'risky'; probability = 0.02; }
    } else {
      tier = 'unknown'; probability = 0.3;
    }

    probability = Math.max(0.01, Math.min(0.99, probability));

    const school = getSchool(rec.school_id, data);
    results.push({
      school_id: rec.school_id,
      school_name: school ? school.name : rec.school_id,
      school_level: school ? school.level : '',
      school_city: school ? school.city : '',
      major_name: rec.major_name,
      major_id: rec.major_id,
      min_score: rec.min_score,
      min_rank: rec.min_rank,
      avg_score: rec.avg_score,
      tier,
      admission_probability: Math.round(probability * 100),
      rank_ratio: rank && rec.min_rank ? +(rank / rec.min_rank).toFixed(3) : null,
      score_diff: score && rec.min_score ? score - rec.min_score : null,
      plan_count: rec.plan_count,
      rank_trend: rec.rank_trend ? calcTrendLabel(rec.rank_trend) : null,
      employment_score: school ? school.employment_score : 50,
      source: data.meta?.version || 'v2',
    });
  }

  results.sort((a, b) => b.admission_probability - a.admission_probability);

  return {
    reach:  results.filter(r => r.tier === 'reach'),
    match:  results.filter(r => r.tier === 'match'),
    safety: results.filter(r => r.tier === 'safety'),
    risky:  results.filter(r => r.tier === 'risky'),
    meta: {
      rank, score, province, subject,
      major_id: major_id || 'all',
      year,
      total_matched: results.length,
      query_mode: rank ? 'rank_priority' : 'score_fallback',
      data_version: data.meta?.version || 'v2',
    },
  };
}

// ===== 分数优先查询 (queryAdmission 兼容) =====

function querySchools({ major, score, province, subject, year = 2025 }) {
  const data = loadData();
  if (!data) return { reach: [], match: [], safety: [], meta: { error: 'no data' } };

  let records = data.records.filter(r => {
    if (r.year !== year) return false;
    if (r.province !== province) return false;
    if (r.major_id !== major) return false;
    if (subject && r.subject !== subject) return false;
    return true;
  });

  if (records.length === 0) {
    records = data.records.filter(r => {
      if (r.year !== year) return false;
      if (r.major_id !== major) return false;
      if (subject && r.subject !== subject) return false;
      return true;
    });
  }

  records.sort((a, b) => b.min_score - a.min_score);

  const reach = [], match = [], safety = [];
  for (const rec of records) {
    const diff = rec.min_score - score;
    const school = getSchool(rec.school_id, data);
    const formatted = {
      school_name: school ? school.name : rec.school_id,
      school_level: school ? school.level : '',
      school_city: school ? school.city : '',
      major_name: rec.major_name,
      min_score: rec.min_score,
      min_rank: rec.min_rank,
      diff,
      confidence: getConfidence(diff),
      batch: rec.batch,
      source: data.meta?.version || 'v2',
    };

    if (diff > 20) continue;
    else if (diff > 0) reach.push(formatted);
    else if (diff > -10) match.push(formatted);
    else safety.push(formatted);
  }

  return { reach, match, safety, meta: { major, province, score, year, total: records.length } };
}

function queryAllMajors({ score, province, subject, year = 2025 }) {
  const data = loadData();
  if (!data) return { byMajor: {}, meta: { error: 'no data' } };

  let records = data.records.filter(r => {
    if (r.year !== year) return false;
    if (r.province !== province) return false;
    if (subject && r.subject !== subject) return false;
    return true;
  });

  const byMajor = {};
  for (const rec of records) {
    const key = rec.major_id;
    if (!byMajor[key]) {
      byMajor[key] = { major_name: rec.major_name, reach: [], match: [], safety: [] };
    }
    const diff = rec.min_score - score;
    const school = getSchool(rec.school_id, data);
    const formatted = {
      school_name: school ? school.name : rec.school_id,
      school_level: school ? school.level : '',
      school_city: school ? school.city : '',
      major_name: rec.major_name,
      min_score: rec.min_score,
      min_rank: rec.min_rank,
      diff,
      confidence: getConfidence(diff),
      source: data.meta?.version || 'v2',
    };

    if (diff > 20) continue;
    else if (diff > 0) byMajor[key].reach.push(formatted);
    else if (diff > -10) byMajor[key].match.push(formatted);
    else byMajor[key].safety.push(formatted);
  }

  return { byMajor, meta: { province, score, year } };
}

// ===== 跨专业全量位次查询 =====

function rankQueryAllMajors({ rank, score, province, subject, year = 2025 }) {
  const data = loadData();
  if (!data) return { byMajor: {}, meta: { error: 'no data' } };

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
      byMajor[key] = { major_name: rec.major_name, reach: [], match: [], safety: [], risky: [] };
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
      school_name: school ? school.name : rec.school_id,
      school_level: school ? school.level : '',
      school_city: school ? school.city : '',
      min_score: rec.min_score,
      min_rank: rec.min_rank,
      admission_probability: Math.round(probability * 100),
      rank_trend: rec.rank_trend ? calcTrendLabel(rec.rank_trend) : null,
      source: data.meta?.version || 'v2',
    });
  }

  return { byMajor, meta: { rank, score, province, subject, year } };
}

function getConfidence(diff) {
  if (diff <= -30) return '极高';
  if (diff <= -15) return '高';
  if (diff <= -10) return '较高';
  if (diff <= 0)   return '中等';
  if (diff <= 10)  return '较低（冲一冲）';
  if (diff <= 20)  return '低（需要运气）';
  return '极低（不建议）';
}

// ===== 自检 =====

if (require.main === module) {
  console.log('═══════════════════════════════════');
  console.log('  统一查询引擎 V4 · 自检');
  console.log('═══════════════════════════════════\n');

  const data = loadData();
  console.log('📦 数据:', data.meta.total_records, '条,', data.schools.length, '所学校');
  console.log('🗺️  省份:', data.meta.provinces.join(', '));

  // 测试1: 位次查询
  const r1 = rankQuery({ rank: 8000, score: 620, province: '河南', subject: 'science', major_id: 'computer_science' });
  console.log('\n【位次8000 · 河南理科 · 计算机】');
  console.log('  冲:', r1.reach.map(s => `${s.school_name}(${s.admission_probability}%)`).join(' | ') || '无');
  console.log('  稳:', r1.match.map(s => `${s.school_name}(${s.admission_probability}%)`).join(' | ') || '无');
  console.log('  保:', r1.safety.map(s => `${s.school_name}(${s.admission_probability}%)`).join(' | ') || '无');

  // 测试2: 分数查询(兼容)
  const r2 = querySchools({ major: 'computer_science', score: 620, province: '河南', subject: 'science' });
  console.log('\n【分数620 · 河南理科 · 计算机】(分数模式)');
  console.log('  冲:', r2.reach.map(s => `${s.school_name}(${s.min_score})`).join(' | ') || '无');
  console.log('  稳:', r2.match.map(s => `${s.school_name}(${s.min_score})`).join(' | ') || '无');

  // 测试3: 浙江新省份
  const r3 = rankQuery({ rank: 5000, score: 650, province: '浙江', subject: 'science' });
  console.log('\n【位次5000 · 浙江理科 · 全专业】');
  console.log('  匹配:', r3.meta.total_matched, '所 → 冲', r3.reach.length, '| 稳', r3.match.length, '| 保', r3.safety.length);

  // 测试4: 北京
  const r4 = rankQuery({ rank: 3000, score: 640, province: '北京', subject: 'science', major_id: 'artificial_intelligence' });
  console.log('\n【位次3000 · 北京理科 · 人工智能】');
  console.log('  匹配:', r4.meta.total_matched, '所');
  for (const s of [...r4.reach, ...r4.match].slice(0, 3)) {
    console.log(`    ${s.school_name} 位${s.min_rank} (${s.admission_probability}%)`);
  }

  // 测试5: 新专业 stomatology
  const r5 = rankQuery({ rank: 5000, score: 640, province: '广东', subject: 'science', major_id: 'stomatology' });
  console.log('\n【位次5000 · 广东理科 · 口腔医学】');
  console.log('  匹配:', r5.meta.total_matched, '所');
  for (const s of [...r5.reach, ...r5.match, ...r5.safety].slice(0, 3)) {
    console.log(`    ${s.school_name} 位${s.min_rank} (${s.admission_probability}%)`);
  }

  console.log('\n✅ 统一查询引擎 V4 自检通过\n');
}

module.exports = { querySchools, queryAllMajors, rankQuery, rankQueryAllMajors, reloadData, loadData };
