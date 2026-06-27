// engine/engine.js
// 高考志愿决策引擎 —— 总调度

const fs = require('fs');
const path = require('path');
const baseWeights = require('./weights');
const { applyUserRules, applyMajorPenalty } = require('./applyRules');
const scoreMajor = require('./scoreMajor');
const categorize = require('./categorize');

const majorsData = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../data/majors.json'), 'utf8')
);

function runEngine(user) {
  // 1. 复制基础权重
  let weights = { ...baseWeights };

  // 2. 应用用户级规则 → 调整全局权重
  weights = applyUserRules(user, weights);

  // 3. 逐专业评分
  const results = majorsData.majors.map(major => {
    const baseScore = scoreMajor(major, weights, user);
    const penalty = applyMajorPenalty(major, user);
    const finalScore = Math.round((baseScore + penalty) * 10) / 10;

    return {
      id: major.id,
      name: major.name,
      category: major.category,
      score: finalScore,
      tags: major.tags,
      quote: major.zxf_quote,
      risk: major.ai_replace_risk,
      career_path: major.career_path || '',
      salary_range: major.salary_range || '',
      key_risk: major.key_risk || ''
    };
  });

  // 4. 按分数降序排序
  results.sort((a, b) => b.score - a.score);

  // 5. 冲/稳/保/避 分级
  const ranked = categorize(results);

  return { weights, ranked, full_list: results };
}

// 直接运行 node engine/engine.js 时做自检
if (require.main === module) {
  const testUser = {
    family_wealth: 3,
    subject: 'science',
    interest_clarity: false,
    prefers_big_city: true,
    family_finance_bg: false,
    postgraduate: false
  };

  const result = runEngine(testUser);
  console.log('\n📊 引擎自检结果');
  console.log('权重:', JSON.stringify(result.weights, null, 2));
  console.log('🔥 冲刺:', result.ranked.reach.map(i => `${i.name}(${i.score})`).join(', '));
  console.log('⚖️  稳妥:', result.ranked.match.map(i => `${i.name}(${i.score})`).join(', '));
  console.log('🛡️  保底:', result.ranked.safety.map(i => `${i.name}(${i.score})`).join(', '));
  console.log('⚠️  避开:', result.ranked.avoid.map(i => `${i.name}(${i.score})`).join(', '));
  console.log();
}

module.exports = runEngine;
