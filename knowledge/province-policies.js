// knowledge/province-policies.js
// 各省高考志愿政策 —— 确保AI给出的建议符合本省规则

const PROVINCE_POLICIES = {
  '浙江': {
    mode: '专业+院校',
    totalSlots: 80,
    batchSetup: '不分批次，一次性填报80个"专业+院校"志愿',
    keyRules: [
      '80个志愿不设调剂，录取即锁定',
      '位次优先、遵循志愿',
      '可填报同一学校的不同专业作为不同志愿',
    ],
    strategy: '80个志愿容错率高。建议前20个冲、中间40个稳、后20个保。好专业可以填多个学校的不同专业组。',
    aiHint: '你是浙江考生，80个志愿不设调剂，容错空间大。我可以帮你推荐50所左右的学校专业组合。',
  },
  '山东': {
    mode: '专业+院校',
    totalSlots: 96,
    batchSetup: '不分批次，一次性填报96个"专业+院校"志愿',
    keyRules: [
      '96个志愿，同样不设调剂',
      '填满不亏，每个志愿都是独立机会',
      '可以大胆冲一些好学校好专业',
    ],
    strategy: '96个志愿数量最多，填满才不亏。前30冲、中间40稳、后26保。大胆把梦想校填进去。',
    aiHint: '你是山东考生，96个志愿全国最多。填满它！我可以给你列80+个选项。',
  },
  '河南': {
    mode: '院校+专业组',
    totalSlots: 48,
    batchSetup: '本科一批48个志愿（院校+专业组模式），每个专业组内可填6个专业+服从调剂',
    keyRules: [
      '48个志愿按院校+专业组填报',
      '每个专业组内可填多个专业',
      '建议服从调剂，否则有退档风险',
      '河南考生多、竞争激烈，稳妥比冲刺更重要',
    ],
    strategy: '河南是真正的地狱模式，125万考生全国最多。48个志愿建议：10冲20稳18保。别把希望都押在冲刺上。',
    aiHint: '你是河南考生，125万人跟你一起考。我必须帮你把稳和保做扎实。冲的学校可以有，但主力放在稳上。',
  },
  '广东': {
    mode: '院校+专业组',
    totalSlots: 45,
    batchSetup: '本科批次45个院校+专业组志愿',
    keyRules: [
      '院校+专业组模式，每个组内可填6个专业',
      '省内高校对本省考生有录取倾斜',
      '深圳大学、华南理工、中山大学是本省最热门',
    ],
    strategy: '广东本地高校对本省考生友好。同样的分数，报广东的学校比报外省同层次学校录取概率高。',
    aiHint: '广东考生报本地学校有天然优势。中大、华工、深大、暨大——能留在广东就别往外跑。',
  },
  '江苏': {
    mode: '院校+专业组',
    totalSlots: 40,
    batchSetup: '本科批次40个院校+专业组志愿',
    keyRules: [
      '江苏高教资源丰富，985/211数量全国前列',
      '省内高校对本省考生有一定倾斜',
      '南京、苏州是主要去向城市',
    ],
    strategy: '江苏考生本身就在高教大省。能留在省内的尽量留——南京苏州的就业机会不比北上广深差多少。',
    aiHint: '江苏高教资源全国领先，你的选择面很宽。南京大学、东南大学、南航、南理工——能在省内读就别出省。',
  },
  '湖北': {
    mode: '院校+专业组',
    totalSlots: 45,
    batchSetup: '本科批次45个院校+专业组志愿',
    keyRules: [
      '武汉是华中高教中心，高校数量全国领先',
      '华中科技大学、武汉大学是省内双子星',
      '省内考生报省内高校有一定优势',
    ],
    strategy: '武汉高校多、选择面广。同样的分数在武汉比在河南能上更好的学校。',
    aiHint: '湖北考生有地理位置优势——武汉高校多，毕业后在武汉就业也方便。华科和武大是省内最好的选择。',
  },
  '北京': {
    mode: '院校+专业组',
    totalSlots: 30,
    batchSetup: '本科批次30个院校+专业组志愿',
    keyRules: [
      '北京本地录取率全国最高之一（约30%一本率）',
      '市属高校对北京生源有大幅倾斜',
      '北京工业大学、首都师范大学是本地保底首选',
    ],
    strategy: '北京考生最大的优势就是本地录取倾斜。同样的分，你在北京能上的学校比外地考生好一个档次。能留北京就留北京。',
    aiHint: '北京考生有天然优势——本地录取率全国最高。优先报北京的学校，除非你想去外地体验生活。',
  },
  '上海': {
    mode: '院校+专业组',
    totalSlots: 24,
    batchSetup: '本科批次24个院校+专业组志愿',
    keyRules: [
      '上海本地录取率极高',
      '复旦、交大、同济、华师大对本市考生有倾斜',
      '上海大学是本地中分段考生的热门选择',
    ],
    strategy: '上海考生本地录取优势明显。24个志愿虽然数量不多，但在上海本地上好学校的概率远超外省同分考生。',
    aiHint: '上海考生不用往外跑——复旦交大同济华师大上大，本地学校够你选了。同等高考分你在上海比外地考生多一个档次。',
  },
};

function getProvincePolicy(province) {
  // 模糊匹配
  for (const [key, policy] of Object.entries(PROVINCE_POLICIES)) {
    if (province && province.includes(key)) return policy;
  }
  return null;
}

function getProvincePolicyContext(province) {
  const policy = getProvincePolicy(province);
  if (!policy) return '';

  return `## ${province}高考政策 [政策]

- 填报模式：${policy.mode}
- 志愿数量：${policy.totalSlots}个
- 批次设置：${policy.batchSetup}
- 核心规则：${policy.keyRules.join('；')}
- 填报策略：${policy.strategy}
- AI提示：${policy.aiHint}
`;
}

module.exports = { PROVINCE_POLICIES, getProvincePolicy, getProvincePolicyContext };
