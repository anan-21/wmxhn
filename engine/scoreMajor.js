// engine/scoreMajor.js
// 专业评分函数 —— 综合基础分 + 用户权重 + 专业级规则惩罚

function scoreMajor(major, weights, user) {
  const b = major.base_scores;

  // 核心加权公式：每个维度 = 基础分 × (1 + 权重 × 0.2)
  let score =
    (b.salary  || 0) * (1 + weights.salary   * 0.25) +
    (b.stability || 0) * (1 + weights.stability * 0.25) +
    (10 - (b.risk || 0)) * (1 + weights.risk * 0.2) +
    (b.city_opportunity || 0) * (1 + weights.city * 0.2) +
    (b.interest_appeal || 0) * (1 + weights.interest * 0.2);

  // 理科生 → 理工科专业加分（专业壁垒红利）
  if (user.subject === 'science' && major.category && major.category.includes('理工')) {
    score += 5;
  }

  // 文科生 → 文科/商科专业轻微加分（平台效应）
  if (user.subject === 'arts' && major.category &&
      (major.category.includes('文科') || major.category.includes('商科'))) {
    score += 3;
  }

  // 家庭富裕 + 兴趣明确 → 兴趣专业加分
  if (user.family_wealth >= 8 && user.interest_clarity === true) {
    score += (b.interest_appeal || 0) * 0.5;
  }

  return Math.round(score * 10) / 10;
}

module.exports = scoreMajor;
