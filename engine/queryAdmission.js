// engine/queryAdmission.js
// 高考录取数据查询引擎
// 输入: major + score + province → 输出: 冲/稳/保 分类学校列表

const fs = require('fs');
const path = require('path');

let _cache = null;

function loadData() {
  if (_cache) return _cache;
  _cache = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../data/admission.json'), 'utf8')
  );
  return _cache;
}

function reloadData() {
  _cache = null;
  return loadData();
}

// ---------- 核心查询 ----------

/**
 * 查询指定专业在指定省份的可报考学校
 *
 * @param {Object} params
 * @param {string} params.major      - 专业 ID，如 'computer_science'
 * @param {number} params.score      - 用户高考分数
 * @param {string} params.province   - 省份，如 '河南'
 * @param {string} [params.subject]  - 科类 'science' | 'arts'，不传则全查
 * @param {number} [params.year]     - 年份，默认 2025
 *
 * @returns {Object} { reach, match, safety, meta }
 */
function querySchools({ major, score, province, subject, year = 2025 }) {
  const data = loadData();

  // 1. 过滤
  let records = data.records.filter(r => {
    if (r.year !== year) return false;
    if (r.province !== province) return false;
    if (r.major_id !== major) return false;
    if (subject && r.subject !== subject) return false;
    return true;
  });

  // 无结果时尝试宽松匹配（仅专业ID，忽略省份）
  if (records.length === 0) {
    records = data.records.filter(r => {
      if (r.year !== year) return false;
      if (r.major_id !== major) return false;
      if (subject && r.subject !== subject) return false;
      return true;
    });
  }

  // 2. 按 min_score 降序排列（高分学校在前）
  records.sort((a, b) => b.min_score - a.min_score);

  // 3. 冲/稳/保 分类（高考志愿标准逻辑）
  // diff = 学校录取分 - 用户分。正值=学校更高（难考），负值=用户更高（好考）
  const reach  = [];  // 冲: 学校录取分略高于用户分，需要大小年运气
  const match  = [];  // 稳: 学校录取分接近用户分，主力填报区
  const safety = [];  // 保: 学校录取分明显低于用户分，绝对兜底

  for (const rec of records) {
    const diff = rec.min_score - score;

    if (diff > 20) {
      // 差距 > 20 分 → 基本没戏，跳过
      continue;
    } else if (diff > 0) {
      // diff ∈ (0, 20] → 冲: 学校在我之上，可以赌
      reach.push(formatRecord(rec, diff, score));
    } else if (diff > -10) {
      // diff ∈ (-10, 0] → 稳: 我略高于学校线，最合理
      match.push(formatRecord(rec, diff, score));
    } else {
      // diff ≤ -10 → 保: 我明显高于学校线，不会掉档
      safety.push(formatRecord(rec, diff, score));
    }
  }

  return {
    reach,
    match,
    safety,
    meta: {
      major,
      province,
      score,
      year,
      total: records.length,
      filterNote: records.length === 0
        ? `无 ${province} ${major} 的录取数据，当前展示其他省份数据`
        : null
    }
  };
}

/**
 * 查询某用户分数下所有可报考专业的学校
 * 用于"不限专业、看有哪些学校"的场景
 */
function queryAllMajors({ score, province, subject, year = 2025 }) {
  const data = loadData();

  let records = data.records.filter(r => {
    if (r.year !== year) return false;
    if (r.province !== province) return false;
    if (subject && r.subject !== subject) return false;
    return true;
  });

  // 按专业分组
  const byMajor = {};
  for (const rec of records) {
    const key = rec.major_id;
    if (!byMajor[key]) {
      byMajor[key] = { major_name: rec.major_name, reach: [], match: [], safety: [] };
    }
    const diff = rec.min_score - score;
    const formatted = formatRecord(rec, diff, score);

    if (diff > 20) continue;
    else if (diff > 0) byMajor[key].reach.push(formatted);
    else if (diff > -10) byMajor[key].match.push(formatted);
    else byMajor[key].safety.push(formatted);
  }

  return { byMajor, meta: { province, score, year } };
}

// ---------- 辅助 ----------

function formatRecord(rec, diff, userScore) {
  return {
    school_name: rec.school_name,
    school_level: rec.school_level,
    school_city: rec.school_city,
    major_name: rec.major_name,
    min_score: rec.min_score,
    min_rank: rec.min_rank,
    diff: diff,                             // 正值=学校更高，负值=用户更高
    confidence: getConfidence(diff),        // 录取置信度
    batch: rec.batch
  };
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

// ---------- 自检 ----------
if (require.main === module) {
  console.log('\n📊 录取数据查询引擎自检\n');

  // 测试1: 620分河南理科计算机
  const r1 = querySchools({ major: 'computer_science', score: 620, province: '河南', subject: 'science' });
  console.log('【测试1】620分 · 河南理科 · 计算机');
  console.log('  冲:', r1.reach.map(s => `${s.school_name}(${s.min_score},${s.confidence})`).join(' | ') || '无');
  console.log('  稳:', r1.match.map(s => `${s.school_name}(${s.min_score},${s.confidence})`).join(' | ') || '无');
  console.log('  保:', r1.safety.map(s => `${s.school_name}(${s.min_score},${s.confidence})`).join(' | ') || '无');

  // 测试2: 580分河南理科电气
  const r2 = querySchools({ major: 'electrical_engineering', score: 580, province: '河南', subject: 'science' });
  console.log('\n【测试2】580分 · 河南理科 · 电气');
  console.log('  冲:', r2.reach.map(s => `${s.school_name}(${s.min_score})`).join(' | ') || '无');
  console.log('  稳:', r2.match.map(s => `${s.school_name}(${s.min_score})`).join(' | ') || '无');
  console.log('  保:', r2.safety.map(s => `${s.school_name}(${s.min_score})`).join(' | ') || '无');

  // 测试3: 660分河南文科金融
  const r3 = querySchools({ major: 'finance', score: 660, province: '河南', subject: 'arts' });
  console.log('\n【测试3】660分 · 河南文科 · 金融');
  console.log('  冲:', r3.reach.map(s => `${s.school_name}(${s.min_score})`).join(' | ') || '无');
  console.log('  稳:', r3.match.map(s => `${s.school_name}(${s.min_score})`).join(' | ') || '无');
  console.log('  保:', r3.safety.map(s => `${s.school_name}(${s.min_score})`).join(' | ') || '无');

  console.log('\n✅ 查询引擎自检通过\n');
}

module.exports = { querySchools, queryAllMajors, reloadData };
