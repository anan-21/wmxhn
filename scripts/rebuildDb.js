#!/usr/bin/env node
/**
 * 高考录取数据库 — 完全重建 (Node.js 版)
 * 逐省独立解析各省考试院 Excel 投档线，输出 JSON
 *
 * Usage: node scripts/rebuildDb.js [--dir <excel-dir>] [--out <output.json>]
 *
 * 数据来源: 各省考试院官方投档线 Excel
 * 目录结构: <excel-dir>/浙江/xxx.xls, <excel-dir>/山东/xxx.xls, ...
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

// CLI args
const args = process.argv.slice(2);
const DATA_BASE = args[args.indexOf('--dir') + 1] || process.env.GAOKAO_DATA_DIR || '';
const OUT_PATH = args[args.indexOf('--out') + 1] || path.join(__dirname, '..', 'data', 'admission-rebuilt.json');

// ============================================================
// 辅助函数
// ============================================================

function cleanCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') {
    if (v === Math.floor(v)) return String(Math.floor(v));
    return String(v);
  }
  return String(v).trim();
}

function detectCategory(filename, rowText, province) {
  const text = filename + ' ' + rowText;
  if (/物理类|物理科目|物理等科目|物理学科组|理工类|理科/.test(text)) return '物理类';
  if (/历史类|历史科目|历史等科目|历史学科组|文史类|文科/.test(text)) return '历史类';
  if (/艺术|美术|音乐|舞蹈|播音|编导|表演|书法|服表/.test(text)) return '艺术类';
  if (/体育|体理|体文/.test(text)) return '体育类';
  if (['浙江', '上海', '北京', '天津', '山东', '海南'].includes(province)) return '综合';
  return '';
}

/**
 * 读取 Excel（支持 .xls / .xlsx），返回二维数组 [row][col]
 */
function readSheet(filepath, sheetIndex = 0) {
  const wb = XLSX.readFile(filepath, { type: 'file', cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[sheetIndex]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
}

// ============================================================
// 各省解析器
// ============================================================

function parseZhejiang(provDir) {
  /** 浙江 — 学校+专业+分数+位次 */
  const results = [];
  if (!fs.existsSync(provDir)) return results;

  const batches = [
    ['浙江省2024年普通高校招生普通类第一段平行投档分数线表.xls', '普通类第一段', 'common'],
    ['浙江省2024年普通高校招生普通类第二段平行投档分数线表.xls', '普通类第二段', 'common'],
    ['浙江省2024年普通高校招生艺术类统考批第一段平行投档分数线表.xls', '艺术类第一段', 'art'],
    ['浙江省2024年普通高校招生艺术类统考批第二段平行投档分数线表.xls', '艺术类第二段', 'art'],
    ['浙江省2024年普通高校招生体育类第一段平行投档分数线表.xls', '体育类第一段', 'sport'],
  ];

  for (const [fname, batch, type] of batches) {
    const fp = path.join(provDir, fname);
    if (!fs.existsSync(fp)) continue;

    try {
      const rows = readSheet(fp);
      for (let r = 1; r < rows.length; r++) {
        const vals = rows[r].map(cleanCell);
        if (!vals[1] || vals[1].length < 2) continue;

        let score = null, rank = null;
        if (type === 'common') {
          // [school_code, school_name, major_code, major_name, quota, score, rank]
          try { score = parseInt(vals[5]); } catch {} // eslint-disable-line no-empty
          try { rank = parseInt(vals[6]); } catch {} // eslint-disable-line no-empty
          if (!score && !rank) continue;
          results.push({
            province: '浙江', year: 2024, category: '综合',
            batch, school_name: vals[1], major_name: vals[3],
            score, rank,
            quota: vals[4] ? parseInt(vals[4]) || null : null,
            source_file: fname,
          });
        } else if (type === 'art') {
          // [cat_code, cat_name, school_code, school_name, major_code, major_name, quota, score]
          try { score = parseInt(vals[7]); } catch {} // eslint-disable-line no-empty
          if (!score) continue;
          results.push({
            province: '浙江', year: 2024, category: `艺术类-${vals[1]}`,
            batch, school_name: vals[3], major_name: vals[5],
            score, rank: null,
            quota: vals[6] ? parseInt(vals[6]) || null : null,
            source_file: fname,
          });
        } else if (type === 'sport') {
          // [school_code, school_name, major_code, major_name, quota, score, rank?]
          try { score = parseInt(vals[5]); } catch {} // eslint-disable-line no-empty
          if (!score) continue;
          results.push({
            province: '浙江', year: 2024, category: '体育类',
            batch, school_name: vals[1], major_name: vals[3],
            score, rank: null,
            quota: vals[4] ? parseInt(vals[4]) || null : null,
            source_file: fname,
          });
        }
      }
    } catch (e) {
      console.warn(`  [WARN] ${fname}: ${e.message}`);
    }
  }
  return results;
}

function parseShandong(provDir) {
  /** 山东 — 有位次无分数，列: [空,专业,院校,计划数,最低位次] */
  const results = [];
  if (!fs.existsSync(provDir)) return results;

  for (const fname of fs.readdirSync(provDir)) {
    if (!fname.endsWith('.xls')) continue;
    const fp = path.join(provDir, fname);

    let cat, batch;
    if (fname.includes('常规批第1次')) { cat = '综合'; batch = '常规批第1次'; }
    else if (fname.includes('常规批第2次')) { cat = '综合'; batch = '常规批第2次'; }
    else if (fname.includes('常规批第3次')) { cat = '综合'; batch = '常规批第3次'; }
    else continue;

    try {
      const rows = readSheet(fp);
      for (let r = 2; r < rows.length; r++) {
        const majorRaw = cleanCell(rows[r][1]);
        let schoolRaw = cleanCell(rows[r][2]);
        const quotaStr = cleanCell(rows[r][3]);
        const rankStr = cleanCell(rows[r][4]);

        if (!schoolRaw || schoolRaw.length < 2) continue;

        // Remove school code prefix like "A001"
        const school = schoolRaw.replace(/^[A-Z]\d+\s*/, '').trim() || schoolRaw;
        // Clean major: remove leading number
        const major = majorRaw.replace(/^\d+\s*/, '').trim();

        // Parse rank (handle "前50" = top 50)
        let rank = null;
        try {
          if (rankStr.includes('前')) {
            rank = parseInt(rankStr.replace(/[^0-9]/g, '') || '0');
          } else {
            rank = parseInt(rankStr);
          }
        } catch {} // eslint-disable-line no-empty
        if (!rank) continue;

        const quota = quotaStr ? parseInt(quotaStr) || null : null;

        results.push({
          province: '山东', year: 2024, category: cat,
          batch, school_name: school, major_name: major,
          score: null, rank, quota, source_file: fname,
        });
      }
    } catch (e) {
      console.warn(`  [WARN] ${fname}: ${e.message}`);
    }
  }
  return results;
}

function parseHebei(provDir) {
  /** 河北 — 有分数无位次，历史/物理分文件，有具体专业 */
  const results = [];
  if (!fs.existsSync(provDir)) return results;

  for (const fname of fs.readdirSync(provDir)) {
    if (!fname.endsWith('.xlsx')) continue;
    const fp = path.join(provDir, fname);

    let cat = '';
    if (fname.includes('历史')) cat = '历史类';
    else if (fname.includes('物理')) cat = '物理类';

    let batch = '';
    if (fname.includes('本科批')) batch = '本科批';
    else if (fname.includes('本科提前批')) batch = '本科提前批';
    else if (fname.includes('专科批')) batch = '专科批';
    if (!batch) continue;

    try {
      const rows = readSheet(fp);
      for (let r = 3; r < rows.length; r++) { // skip 3 header rows
        const vals = rows[r].map(v => cleanCell(v));
        const school = vals[1] || '';
        const major = vals[3] || '';
        const scoreStr = vals[4] || '';
        if (!school || !scoreStr) continue;
        let score;
        try { score = parseInt(scoreStr); } catch { continue; } // eslint-disable-line no-empty

        results.push({
          province: '河北', year: 2024, category: cat,
          batch, school_name: school, major_name: major,
          score, rank: null, quota: null, source_file: fname,
        });
      }
    } catch (e) {
      console.warn(`  [WARN] ${fname}: ${e.message}`);
    }
  }
  return results;
}

function parseChongqing(provDir) {
  /** 重庆 — 有科类/专业/分数/位次 */
  const results = [];
  if (!fs.existsSync(provDir)) return results;

  for (const fname of fs.readdirSync(provDir)) {
    if (!fname.endsWith('.xlsx')) continue;
    const fp = path.join(provDir, fname);

    let cat = '';
    if (fname.includes('历史')) cat = '历史类';
    else if (fname.includes('物理')) cat = '物理类';

    let batch = '';
    if (fname.includes('本科批')) batch = '本科批';
    else if (fname.includes('提前批')) batch = '提前批';
    else if (fname.includes('专科')) batch = '专科批';

    try {
      const rows = readSheet(fp);
      for (let r = 2; r < rows.length; r++) { // skip 2 header rows
        const vals = rows[r].map(v => cleanCell(v));
        // [科类, 院校代号, 院校名称, 专业代号, 专业名称, 投档最低分, 位次之和, 备注]
        const school = vals[2] || '';
        const major = vals[4] || '';
        const scoreStr = vals[5] || '';
        const rankStr = vals[6] || '';

        // Override category from row if present
        let rowCat = cat;
        if (['历史类', '物理类', '历史', '物理'].includes(vals[0])) {
          rowCat = vals[0].replace('历史', '历史类').replace('物理', '物理类');
        }

        if (!school) continue;
        let score = null, rank = null;
        try { score = scoreStr ? parseInt(scoreStr) : null; } catch {} // eslint-disable-line no-empty
        try { rank = rankStr && /^\d+(\.\d+)?$/.test(rankStr) ? parseInt(rankStr) : null; } catch {} // eslint-disable-line no-empty
        if (!score && !rank) continue;

        results.push({
          province: '重庆', year: 2024, category: rowCat || cat,
          batch, school_name: school, major_name: major,
          score, rank, quota: null, source_file: fname,
        });
      }
    } catch (e) {
      console.warn(`  [WARN] ${fname}: ${e.message}`);
    }
  }
  return results;
}

function parseHubei(provDir) {
  /** 湖北 — 有科类/专业组/分数/位次之和 */
  const results = [];
  if (!fs.existsSync(provDir)) return results;

  for (const fname of fs.readdirSync(provDir)) {
    if (!fname.endsWith('.xls') && !fname.endsWith('.xlsx')) continue;
    if (fname.includes('一分一段')) continue;
    const fp = path.join(provDir, fname);

    let cat = '';
    if (fname.includes('历史')) cat = '历史类';
    else if (fname.includes('物理')) cat = '物理类';

    let batch = '';
    if (fname.includes('本科批') || fname.includes('普通类本科')) batch = '本科批';
    else if (fname.includes('提前批')) batch = '提前批';
    else if (fname.includes('专科')) batch = '专科批';
    else if (fname.includes('艺术')) { cat = '艺术类'; batch = '艺术批'; }
    else if (fname.includes('体育')) { cat = '体育类'; batch = '体育批'; }

    try {
      const rows = readSheet(fp);
      for (let r = 3; r < rows.length; r++) {
        const vals = rows[r].map(v => cleanCell(v));
        // [科类, 计划类别, 院校代号, 院校名称, 专业组代号, 专业组名称, 投档线]
        const school = vals[3] || '';
        const majorGroup = vals[5] || '';
        const scoreStr = vals[6] || '';
        if (!school) continue;
        let score;
        try { score = scoreStr ? parseInt(scoreStr) : null; } catch { continue; } // eslint-disable-line no-empty
        if (!score) continue;

        results.push({
          province: '湖北', year: 2024, category: cat,
          batch, school_name: school, major_name: majorGroup,
          score, rank: null, quota: null, source_file: fname,
        });
      }
    } catch (e) {
      console.warn(`  [WARN] ${fname}: ${e.message}`);
    }
  }
  return results;
}

function parseJiangsu(provDir) {
  /** 江苏 — 有分数无位次，学校+专业组级别 */
  const results = [];
  if (!fs.existsSync(provDir)) return results;

  for (const fname of fs.readdirSync(provDir)) {
    const fp = path.join(provDir, fname);
    if (!fname.endsWith('.xls')) continue;
    if (fname.includes('一分一段')) continue;

    let cat = '';
    if (fname.includes('历史')) cat = '历史类';
    else if (fname.includes('物理')) cat = '物理类';

    let batch = '';
    if (fname.includes('本科批次') && !fname.includes('提前')) batch = '本科批';
    else if (fname.includes('提前批次') || fname.includes('提前批')) batch = '提前批';
    else if (fname.includes('专科')) batch = '专科批';
    else if (fname.includes('艺术')) { cat = '艺术类'; batch = '艺术批'; }
    else if (fname.includes('体育')) { cat = '体育类'; batch = '体育批'; }

    try {
      const rows = readSheet(fp);
      for (let r = 4; r < rows.length; r++) {
        const vals = rows[r].map(v => cleanCell(v));
        const schoolMajor = vals[1] || ''; // combined school + major group
        const scoreStr = vals[2] || '';
        if (!schoolMajor) continue;
        let score;
        try { score = scoreStr ? parseInt(scoreStr) : null; } catch { continue; } // eslint-disable-line no-empty
        if (!score) continue;

        // Parse school and major group from combined field
        let school = schoolMajor;
        let major = '';
        const parenIdx = schoolMajor.indexOf('(');
        if (parenIdx !== -1) {
          school = schoolMajor.slice(0, parenIdx);
          major = schoolMajor.slice(parenIdx);
        }

        results.push({
          province: '江苏', year: 2024, category: cat,
          batch, school_name: school.slice(0, 80), major_name: major.slice(0, 200),
          score, rank: null, quota: null, source_file: fname,
        });
      }
    } catch (e) {
      console.warn(`  [WARN] ${fname}: ${e.message}`);
    }
  }
  return results;
}

function parseHunan(provDir) {
  /** 湖南 — 有科类/专业组/投档线 */
  const results = [];
  if (!fs.existsSync(provDir)) return results;

  for (const fname of fs.readdirSync(provDir)) {
    if (!fname.endsWith('.xls') && !fname.endsWith('.xlsx')) continue;
    if (fname.includes('一分一段') || fname.includes('对口')) continue;
    const fp = path.join(provDir, fname);

    let cat = '';
    if (fname.includes('历史')) cat = '历史类';
    else if (fname.includes('物理')) cat = '物理类';

    let batch = '';
    if (fname.includes('本科批')) batch = '本科批';
    else if (fname.includes('提前批')) batch = '提前批';
    else if (fname.includes('专科')) batch = '专科批';
    else if (fname.includes('艺术')) { cat = '艺术类'; batch = '艺术批'; }

    try {
      const rows = readSheet(fp);
      for (let r = 3; r < rows.length; r++) {
        const vals = rows[r].map(v => cleanCell(v));
        // [科类, 计划类别, 院校代号, 院校名称, 专业组代号, 专业组名称, 投档线]
        const rowCat = vals[0] || cat;
        const school = vals[3] || '';
        const majorGroup = vals[5] || '';
        const scoreStr = vals[6] || '';
        if (!school) continue;
        let score;
        try { score = scoreStr ? parseInt(scoreStr) : null; } catch { continue; } // eslint-disable-line no-empty
        if (!score) continue;

        results.push({
          province: '湖南', year: 2024, category: rowCat || cat,
          batch, school_name: school, major_name: majorGroup,
          score, rank: null, quota: null, source_file: fname,
        });
      }
    } catch (e) {
      console.warn(`  [WARN] ${fname}: ${e.message}`);
    }
  }
  return results;
}

function parseNeimenggu(provDir) {
  /** 内蒙古 — B批次仅有分数无位次无专业 */
  const results = [];
  if (!fs.existsSync(provDir)) return results;

  for (const fname of fs.readdirSync(provDir)) {
    if (!fname.endsWith('.xlsx')) continue;
    const fp = path.join(provDir, fname);

    try {
      const rows = readSheet(fp);
      for (let r = 1; r < rows.length; r++) { // skip 1 header row
        const vals = rows[r].map(v => cleanCell(v));
        // [院校代号, 院校名称, 科类, 投档最低分, 备注]
        const school = vals[1] || '';
        const catRaw = vals[2] || '';
        const scoreStr = vals[3] || '';
        const note = vals[4] || '';

        const cat = catRaw.includes('文') ? '文科' : (catRaw.includes('理') ? '理科' : '');

        if (!school) continue;
        let score;
        try { score = scoreStr ? parseInt(scoreStr) : null; } catch { continue; } // eslint-disable-line no-empty
        if (!score) continue;

        results.push({
          province: '内蒙古', year: 2024, category: cat,
          batch: fname.includes('一批B') ? '本科一批B' : '本科二批B',
          school_name: school, major_name: note,
          score, rank: null, quota: null, source_file: fname,
        });
      }
    } catch (e) {
      console.warn(`  [WARN] ${fname}: ${e.message}`);
    }
  }
  return results;
}

// ============================================================
// 主建库流程
// ============================================================

function buildDatabase() {
  console.log('═══════════════════════════════════');
  console.log('  高考录取数据库 · 完全重建 (Node.js)');
  console.log('═══════════════════════════════════\n');

  if (!DATA_BASE) {
    console.error('请指定 Excel 数据目录: node scripts/rebuildDb.js --dir <path>');
    console.error('  或设置环境变量: GAOKAO_DATA_DIR=<path>');
    console.error('');
    console.error('目录结构示例:');
    console.error('  <dir>/浙江/xxx.xls');
    console.error('  <dir>/山东/xxx.xls');
    console.error('  <dir>/河北/xxx.xlsx');
    process.exit(1);
  }

  console.log(`数据目录: ${DATA_BASE}\n`);

  const parsers = [
    ['浙江', parseZhejiang],
    ['山东', parseShandong],
    ['河北', parseHebei],
    ['重庆', parseChongqing],
    ['湖北', parseHubei],
    ['江苏', parseJiangsu],
    ['湖南', parseHunan],
    ['内蒙古', parseNeimenggu],
  ];

  let allRecords = [];

  for (const [name, parser] of parsers) {
    console.log(`[${name}] 解析中...`);
    const provDir = path.join(DATA_BASE, name);
    const results = parser(provDir);
    if (results.length) {
      allRecords = allRecords.concat(results);
      console.log(`  -> ${results.length} 条记录`);
    } else {
      console.log(`  -> 无数据（目录不存在或无可解析文件）`);
    }
  }

  // 统计
  const provinces = [...new Set(allRecords.map(r => r.province))];
  const schools = [...new Set(allRecords.map(r => r.school_name))];
  const hasRank = allRecords.filter(r => r.rank).length;
  const hasScore = allRecords.filter(r => r.score).length;

  console.log(`\n===== 建库完成 =====`);
  console.log(`省份: ${provinces.length}  学校: ${schools.length}  总行数: ${allRecords.length}`);
  console.log(`有分数: ${hasScore}  有位次: ${hasRank}`);

  // 省份统计
  for (const p of provinces.sort()) {
    const cnt = allRecords.filter(r => r.province === p).length;
    const rnk = allRecords.filter(r => r.province === p && r.rank).length;
    console.log(`  ${p}: ${cnt}条 (有rank: ${rnk})`);
  }

  // 输出 JSON
  fs.writeFileSync(OUT_PATH, JSON.stringify(allRecords), 'utf8');
  const sizeMB = (fs.statSync(OUT_PATH).size / 1024 / 1024).toFixed(1);
  console.log(`\n输出: ${OUT_PATH} (${sizeMB} MB)`);

  return allRecords.length;
}

if (require.main === module) {
  const t0 = Date.now();
  buildDatabase();
  console.log(`\n耗时: ${((Date.now() - t0) / 1000).toFixed(0)}秒`);
}

module.exports = {
  parseZhejiang, parseShandong, parseHebei, parseChongqing,
  parseHubei, parseJiangsu, parseHunan, parseNeimenggu,
  buildDatabase,
};
