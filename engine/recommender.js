// engine/recommender.js
// 三层推荐系统 V2
// Layer 1: 专业层（兴趣 + 规则引擎）
// Layer 2: 学校层（位次匹配）
// Layer 3: 风险层（就业 + 热度 + 地域 + AI替代）
//
// 输入: user 画像 → 输出: { majors, schools, risks, summary }

const runEngine = require('./engine');
const { rankQuery } = require('./admissionQuery');
const fs = require('fs');
const path = require('path');

const majorsData = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../data/majors.json'), 'utf8')
);

// ---------- 主入口 ----------

/**
 * @param {Object} user
 * @param {number} user.score         - 分数
 * @param {number} user.rank          - 位次（优先）
 * @param {string} user.province      - 省份
 * @param {string} user.subject       - 'science' | 'arts'
 * @param {string} user.family_income - 'low' | 'medium' | 'high'
 * @param {string} [user.interest]    - 兴趣方向
 * @param {boolean} user.city_preference
 * @param {boolean} user.postgraduate
 *
 * @returns {Object} 三层推荐结果
 */
function recommend(user) {
  // ===== Layer 1: 专业层 =====
  const engineInput = mapUserToEngine(user);
  const engineResult = runEngine(engineInput);

  const majorRanking = [
    ...engineResult.ranked.reach.map(m => ({ ...m, engine_tier: 'reach' })),
    ...engineResult.ranked.match.map(m => ({ ...m, engine_tier: 'match' })),
    ...engineResult.ranked.safety.map(m => ({ ...m, engine_tier: 'safety' }))
  ];

  // 前 8 个推荐专业（V4 扩展）
  const topMajors = majorRanking.slice(0, 8);

  // ===== Layer 2: 学校层（位次匹配）=====
  const schoolResults = [];

  for (const major of topMajors) {
    const schools = rankQuery({
      rank: user.rank,
      score: user.score,
      province: user.province,
      subject: user.subject,
      major_id: major.id,
      year: 2025
    });

    schoolResults.push({
      major_id: major.id,
      major_name: major.name,
      major_score: major.score,
      engine_tier: major.engine_tier,
      schools: {
        reach:  schools.reach.slice(0, 3),
        match:  schools.match.slice(0, 3),
        safety: schools.safety.slice(0, 3),
        risky:  schools.risky.slice(0, 2)
      },
      total_schools: schools.meta.total_matched
    });
  }

  // ===== Layer 3: 风险层 =====
  const riskAnalysis = calculateRisks(user, topMajors, schoolResults);

  // ===== 汇总 =====
  return {
    user_profile: {
      score: user.score,
      rank: user.rank,
      province: user.province,
      subject: user.subject,
      family: user.family_income
    },
    // 第一层
    major_layer: {
      top5: topMajors,
      full_ranking: majorRanking
    },
    // 第二层
    school_layer: schoolResults,
    // 第三层
    risk_layer: riskAnalysis,
    // 一句话总结
    summary: generateSummary(user, topMajors, schoolResults, riskAnalysis)
  };
}

// ---------- Layer 3: 风险计算 ----------

function calculateRisks(user, topMajors, schoolResults) {
  const risks = [];

  for (const sm of schoolResults) {
    const majorInfo = majorsData.majors.find(m => m.id === sm.major_id);
    if (!majorInfo) continue;

    // 风险维度
    const dims = {
      // 1. AI 替代风险 (0-10, 越高越危险)
      ai_risk: majorInfo.ai_replace_risk === 'high' ? 8 :
               majorInfo.ai_replace_risk === 'medium' ? 5 : 2,

      // 2. 就业竞争热度 (0-10, 越高越卷)
      competition_heat: sm.total_schools <= 2 ? 9 :
                        sm.total_schools <= 5 ? 7 :
                        sm.total_schools <= 10 ? 5 : 3,

      // 3. 城市风险: 如果用户偏好大城市但学校在偏远城市
      city_mismatch: 0,

      // 4. 行业周期风险 (0-10)
      industry_cycle: majorInfo.tags?.some(t => t.includes('周期') || t.includes('危机')) ? 7 :
                      majorInfo.tags?.some(t => t.includes('新兴') || t.includes('红利')) ? 2 : 4,

      // 5. 学历门槛风险 (是否需要读博/考研)
      education_barrier: majorInfo.tags?.some(t => t.includes('读博') || t.includes('长周期')) ? 8 :
                         majorInfo.tags?.some(t => t.includes('考研')) ? 5 : 2,

      // 6. 家庭匹配风险: 低收入家庭选高风险专业
      family_mismatch: 0
    };

    // 城市不匹配
    if (user.city_preference && sm.schools) {
      const allSchools = [
        ...(sm.schools.reach || []),
        ...(sm.schools.match || []),
        ...(sm.schools.safety || [])
      ];
      const inBigCity = allSchools.filter(s =>
        ['北京','上海','广州','深圳','杭州','南京','成都','武汉','西安'].includes(s.school_city)
      ).length;
      if (allSchools.length > 0 && inBigCity === 0) {
        dims.city_mismatch = 7;
      } else if (allSchools.length > 0 && inBigCity < allSchools.length * 0.3) {
        dims.city_mismatch = 4;
      }
    }

    // 家庭不匹配: 低收入 + 长周期/高风险专业
    if (user.family_income === 'low') {
      if (majorInfo.tags?.some(t => t.includes('长周期') || t.includes('读博'))) {
        dims.family_mismatch = 8;
      }
      if (majorInfo.tags?.some(t => t.includes('高竞争') || t.includes('两极分化'))) {
        dims.family_mismatch = Math.max(dims.family_mismatch, 6);
      }
    }

    // 综合风险分
    const weights = { ai_risk: 0.25, competition_heat: 0.2, city_mismatch: 0.15,
                      industry_cycle: 0.2, education_barrier: 0.15, family_mismatch: 0.15 };

    const riskScore = Math.round(
      dims.ai_risk * weights.ai_risk +
      dims.competition_heat * weights.competition_heat +
      dims.city_mismatch * weights.city_mismatch +
      dims.industry_cycle * weights.industry_cycle +
      dims.education_barrier * weights.education_barrier +
      dims.family_mismatch * weights.family_mismatch
    );

    let riskLevel;
    if (riskScore <= 3)       riskLevel = '🟢 低风险';
    else if (riskScore <= 5)  riskLevel = '🟡 中等风险';
    else if (riskScore <= 7)  riskLevel = '🟠 较高风险';
    else                      riskLevel = '🔴 高风险';

    risks.push({
      major_id: sm.major_id,
      major_name: sm.major_name,
      risk_score: riskScore,
      risk_level: riskLevel,
      dimensions: dims,
      warnings: generateWarnings(dims, user)
    });
  }

  risks.sort((a, b) => a.risk_score - b.risk_score);

  return {
    risks,
    lowest_risk: risks[0],
    highest_risk: risks[risks.length - 1]
  };
}

function generateWarnings(dims, user) {
  const warnings = [];
  if (dims.ai_risk >= 7)        warnings.push('AI 替代风险高，5年后职业可能发生重大变化');
  if (dims.competition_heat >= 7) warnings.push('该专业开设学校少，竞争极度激烈');
  if (dims.city_mismatch >= 6)   warnings.push('目标学校多在非核心城市，与你大城市偏好冲突');
  if (dims.industry_cycle >= 6)  warnings.push('该行业处于下行/动荡周期，需关注4年后的就业市场');
  if (dims.education_barrier >= 7) warnings.push('学历门槛极高，需做好读博准备，投入产出比需谨慎评估');
  if (dims.family_mismatch >= 6) warnings.push('家庭经济压力大，长周期/高风险专业可能导致家庭负担过重');
  return warnings;
}

// ---------- 汇总 ----------

function generateSummary(user, topMajors, schoolResults, riskAnalysis) {
  const top = topMajors[0];
  const bestSchool = schoolResults.find(s => s.major_id === top?.id);
  const topRisk = riskAnalysis.lowest_risk;
  const bestMatchSchool = bestSchool?.schools?.match?.[0] || bestSchool?.schools?.safety?.[0];

  let summary = `你的位次${user.rank}在${user.province}${user.subject === 'science' ? '理科' : '文科'}。`;

  if (top) {
    summary += `系统推荐首选专业"${top.name}"（专业匹配度${top.score}分）`;
  }
  if (bestMatchSchool) {
    summary += `，最匹配的学校是${bestMatchSchool.school_name}`;
  }
  if (topRisk) {
    summary += `。综合风险评估: ${topRisk.risk_level}`;
  }

  return summary;
}

// ---------- 映射 ----------

function mapIncomeToWealth(income) {
  const map = { low: 2, '低': 2, medium: 5, '中': 5, high: 9, '高': 9 };
  return map[income] || 5;
}

function mapUserToEngine(user) {
  return {
    family_wealth: mapIncomeToWealth(user.family_income),
    subject: user.subject,
    interest_clarity: !!(user.interest && user.interest.trim()),
    prefers_big_city: user.city_preference !== false,
    family_finance_bg: user.family_income === 'high',
    postgraduate: !!user.postgraduate,
    score: user.score,
    rank: user.rank,
    province: user.province
  };
}

// ---------- 自检 ----------
if (require.main === module) {
  console.log('═══════════════════════════════════');
  console.log('  三层推荐系统 · 自检');
  console.log('═══════════════════════════════════\n');

  const user = {
    score: 620,
    rank: 8000,
    province: '河南',
    subject: 'science',
    family_income: 'medium',
    interest: '',
    city_preference: true,
    postgraduate: false
  };

  const result = recommend(user);

  console.log('【用户】', `${user.score}分, 位次${user.rank}, ${user.province}${user.subject === 'science' ? '理科' : '文科'}\n`);

  console.log('▸ Layer 1: 专业层');
  console.log('  TOP 5:', result.major_layer.top5.map(m => `${m.name}(${m.score})`).join(' → '));

  console.log('\n▸ Layer 2: 学校层');
  for (const sm of result.school_layer.slice(0, 3)) {
    console.log(`  ${sm.major_name}:`);
    const r = sm.schools.reach.map(s => `${s.school_name}(位${s.min_rank},${s.admission_probability}%)`).join(', ');
    const m = sm.schools.match.map(s => `${s.school_name}(位${s.min_rank},${s.admission_probability}%)`).join(', ');
    const sf = sm.schools.safety.map(s => `${s.school_name}(位${s.min_rank},${s.admission_probability}%)`).join(', ');
    if (r) console.log(`    冲: ${r}`);
    if (m) console.log(`    稳: ${m}`);
    if (sf) console.log(`    保: ${sf}`);
  }

  console.log('\n▸ Layer 3: 风险层');
  for (const r of result.risk_layer.risks.slice(0, 3)) {
    console.log(`  ${r.major_name}: ${r.risk_level} (${r.risk_score}/10)`);
    if (r.warnings.length) console.log(`    ⚠️  ${r.warnings[0]}`);
  }

  console.log('\n▸ 汇总:', result.summary);
  console.log('\n✅ 三层推荐系统自检通过\n');
}

module.exports = { recommend };
