// engine/applyRules.js
// 动态规则引擎 —— 从 rules.json 加载规则并执行
// 分离用户级规则（全局权重调整）和专业级规则（逐专业评分惩罚）

const fs = require('fs');
const path = require('path');

const rulesData = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../data/rules.json'), 'utf8')
);

function evaluateCondition(conditionStr, context) {
  try {
    const fn = new Function('user', 'major', `return !!(${conditionStr})`);
    return fn(context.user, context.major);
  } catch (e) {
    console.error(`[applyRules] 条件执行失败: "${conditionStr}"`, e.message);
    return false;
  }
}

function applyUserRules(user, weights) {
  const userRules = rulesData.rules.filter(r => r.level === 'user');

  for (const rule of userRules) {
    if (evaluateCondition(rule.condition, { user, major: null })) {
      for (const [key, value] of Object.entries(rule.effects)) {
        if (weights.hasOwnProperty(key)) {
          weights[key] += value;
        }
      }
    }
  }

  return weights;
}

function applyMajorPenalty(major, user) {
  let penalty = 0;
  const majorRules = rulesData.rules.filter(r => r.level === 'major');

  for (const rule of majorRules) {
    if (evaluateCondition(rule.condition, { user, major })) {
      const b = major.base_scores;

      if (rule.effects.stability) {
        penalty += (b.stability || 5) * rule.effects.stability * 0.4;
      }
      if (rule.effects.salary) {
        penalty += (b.salary || 5) * rule.effects.salary * 0.4;
      }
    }
  }

  return penalty;
}

module.exports = { applyUserRules, applyMajorPenalty };
