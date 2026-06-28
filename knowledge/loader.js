// knowledge/loader.js
// 知识库聚合加载器
// 将所有知识模块聚合成一个上下文字符串，注入到 system prompt 中

const { getAllianceForSchool, getAllianceContext } = require('./school-alliances');
const { getDissuasionContext } = require('./dissuasion');
const { getFamilyMatchingContext } = require('./family-matching');
const { getEmploymentContext } = require('./employment');
const { getProvincePolicyContext } = require('./province-policies');

/**
 * 根据用户画像和引擎结果，生成知识库上下文
 * @param {Object} profile - 学生画像
 * @param {Object} engineResult - 引擎运行结果
 * @returns {string} 注入到 system prompt 的知识上下文
 */
function getKnowledgeContext(profile, engineResult) {
  const sections = [];

  // 1. 省份政策（必加）
  if (profile.province) {
    const policyCtx = getProvincePolicyContext(profile.province);
    if (policyCtx) sections.push(policyCtx);
  }

  // 2. 就业数据（有引擎结果时）
  if (engineResult && engineResult.ranked) {
    const allMajors = [
      ...(engineResult.ranked.reach || []),
      ...(engineResult.ranked.match || []),
      ...(engineResult.ranked.safety || []),
    ].map(m => m.id);
    if (allMajors.length > 0) {
      const empCtx = getEmploymentContext(allMajors);
      if (empCtx) sections.push(empCtx);
    }
  }

  // 3. 劝退规则（有引擎结果时）
  if (profile && engineResult) {
    const dissuasionCtx = getDissuasionContext(profile, engineResult);
    if (dissuasionCtx) sections.push(dissuasionCtx);
  }

  // 4. 家庭匹配
  if (profile) {
    const familyCtx = getFamilyMatchingContext(profile);
    if (familyCtx) sections.push(familyCtx);
  }

  // 5. 院校联盟（精简版，只在分析阶段提供）
  if (engineResult) {
    const allianceCtx = getAllianceContext();
    sections.push(`\n## 院校标签体系\n\n${allianceCtx}`);
  }

  return sections.join('\n---\n');
}

module.exports = { getKnowledgeContext };
