// engine/userDataLoader.js
// V4 自定义数据加载器 — 读取 自定义数据.xlsx 覆盖数据库查询
//
// 表格格式:
//   学校名称 | 专业名称 | 科类 | 省份 | 2024最低分 | 2024最低位次 | 2025最低分 | 2025最低位次 | 备注
//
// 当用户填写了某省数据，该省查询只用用户数据，不用数据库

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const XLSX_PATH = path.join(__dirname, '..', '自定义数据.xlsx');

let _userData = null;

function cleanNum(v) {
  if (v === null || v === undefined) return null;
  let s = String(v).trim();
  if (!s) return null;
  s = s.replace(/[,， ]/g, '').replace(/[分位]/g, '');
  const n = parseInt(s);
  return isNaN(n) ? null : n;
}

function loadUserData(filepath) {
  const fp = filepath || XLSX_PATH;
  if (!fs.existsSync(fp)) {
    console.log('[userData] 自定义数据.xlsx 不存在，跳过');
    _userData = [];
    return [];
  }

  try {
    const wb = XLSX.readFile(fp, { type: 'file', cellDates: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    const results = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const school = String(row[0] || '').trim();
      if (!school || school.length < 2 || ['学校名称', '院校名称'].includes(school)) continue;

      const note = String(row[8] || '').trim();
      if (note.includes('示例') || note.includes('不参与排序')) continue;

      const major = String(row[1] || '').trim();
      const catRaw = String(row[2] || '').trim();
      let category = catRaw || '';
      if (category.includes('物理')) category = '物理类';
      else if (category.includes('历史')) category = '历史类';
      else if (category.includes('综合')) category = '综合';

      let province = String(row[3] || '').trim();
      province = province.replace(/[省市]/g, '').trim();

      let s24 = cleanNum(row[4]), r24 = cleanNum(row[5]);
      let s25 = cleanNum(row[6]), r25 = cleanNum(row[7]);

      // Auto-detect swapped score/rank columns
      if (s24 && s24 < 100 && r24 && r24 > 300) [s24, r24] = [r24, s24];
      if (s25 && s25 < 100 && r25 && r25 > 300) [s25, r25] = [r25, s25];

      if (s24 || r24) {
        results.push({ school, major, year: 2024, category, score: s24, rank: r24, province });
      }
      if (s25 || r25) {
        results.push({ school, major, year: 2025, category, score: s25, rank: r25, province });
      }
    }

    _userData = results;
    const provinces = [...new Set(results.map(r => r.province))];
    console.log(`[userData] 加载成功: ${results.length}条, 省份: ${provinces.join(', ') || '无'}`);
    return results;
  } catch (e) {
    console.warn(`[userData] 加载失败: ${e.message}`);
    _userData = [];
    return [];
  }
}

function getUserData() {
  return _userData;
}

function hasUserDataForProvince(province) {
  if (!_userData || !_userData.length) return false;
  return _userData.some(r => r.province && province && r.province.includes(province));
}

/**
 * 查询用户自定义数据 — 冲/稳/保分类
 * @returns null 表示无用户数据（走数据库），否则返回 { chong, wen, bao, all }
 */
function queryUserData({ province, rank, score, keyword, major }) {
  if (!_userData || !_userData.length) return null;
  if (!hasUserDataForProvince(province)) return null;

  let filtered = _userData.filter(r => r.province && province.includes(r.province));

  if (keyword) {
    const kws = keyword.split(/[,，]/).map(k => k.trim()).filter(Boolean);
    if (kws.length) {
      filtered = filtered.filter(r =>
        kws.some(kw => r.major.includes(kw) || r.school.includes(kw))
      );
    }
  }
  if (major) {
    filtered = filtered.filter(r => r.major.includes(major));
  }

  // Dedup by school+major
  const deduped = new Map();
  for (const r of filtered) {
    const key = r.school + '|' + (r.major || '');
    if (!deduped.has(key)) {
      deduped.set(key, { school: r.school, major: r.major, scores: [], ranks: [], years: [] });
    }
    const entry = deduped.get(key);
    if (r.score) entry.scores.push(r.score);
    if (r.rank) entry.ranks.push(r.rank);
    entry.years.push(r.year);
  }

  const all = [];
  for (const [, v] of deduped) {
    const avgScore = v.scores.length ? Math.round(v.scores.reduce((a, b) => a + b, 0) / v.scores.length) : null;
    const avgRank = v.ranks.length ? Math.round(v.ranks.reduce((a, b) => a + b, 0) / v.ranks.length) : null;
    let label = v.major;
    if (v.ranks.length >= 2) {
      const y0 = v.years[0], y1 = v.years[1];
      label += ` [${y0}:${v.scores[0] || '-'}分/${v.ranks[0] || '-'}位 ${y1}:${v.scores[1] || '-'}分/${v.ranks[1] || '-'}位]`;
    } else if (v.ranks.length === 1) {
      label += ` [${v.years[0]}:${v.scores[0] || '-'}分/${v.ranks[0] || '-'}位]`;
    }
    all.push({ school: v.school, major: label, score: avgScore, rank: avgRank, year: '综合', source: 'user' });
  }

  all.sort((a, b) => (a.rank || 999999) - (b.rank || 999999));
  const n = all.length;
  if (n < 3) return { chong: all, wen: [], bao: [], all, source: 'user_data' };

  const chong = all.slice(0, Math.ceil(n / 3));
  const wen = all.slice(Math.ceil(n / 3), Math.ceil(2 * n / 3));
  const bao = all.slice(Math.ceil(2 * n / 3));

  return { chong, wen, bao, all, source: 'user_data' };
}

// 启动时自动加载
loadUserData();

module.exports = { loadUserData, getUserData, hasUserDataForProvince, queryUserData };
