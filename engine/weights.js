// engine/weights.js
// 基础权重定义 —— 所有初始值为 0，由规则引擎动态增减

const baseWeights = {
  stability: 0,   // 稳定性权重
  salary: 0,      // 薪资权重
  risk: 0,        // 风险承受权重（越高越能接受风险）
  interest: 0,    // 兴趣权重
  city: 0,        // 城市发展权重
};

module.exports = baseWeights;
