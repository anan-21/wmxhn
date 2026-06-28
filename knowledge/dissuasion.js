// knowledge/dissuasion.js
// 劝退规则 —— 基于真实情况，强烈不建议某些方向

const DISSUASION_RULES = [
  {
    id: 'finance_no_background',
    condition: (profile) => profile.family_income === 'low' || profile.family_income === 'medium',
    majorIds: ['finance'],
    severity: 'high',
    title: '金融学——家里没资源的千万别碰',
    reasoning: `金融是典型的"看起来光鲜，进去才知道是坑"。你看到的是年薪百万的基金经理，看不到的是90%的人在银行网点站着数钱。
金融行业极度看背景：家里没搞金融的+非985金融=银行网点卖理财。
你说你想学金融，那我问你——家里有人在银行、证券、基金公司吗？没有的话，你这560分学金融，毕业出来拿什么跟985的抢岗位？`,
    alternative: '会计学（考CPA比学金融稳）或 计算机（靠技术吃饭不用拼资源）',
  },
  {
    id: 'journalism_no_family',
    condition: () => true,
    majorIds: ['journalism'],
    severity: 'high',
    title: '新闻传播——闭着眼睛摸一个都比新闻好',
    reasoning: `80%的新闻毕业生不从事本行业。AI写稿+自媒体冲击，科班出身优势被抹平，行业严重萎缩。
新闻传播学连续多年被列为"红牌专业"（就业率/薪资/满意度综合最低）。
除非你家是传媒世家，否则别碰。`,
    alternative: '汉语言文学（考公考编路子更宽）或 法学（同样是文科，法考过关后薪资翻倍）',
  },
  {
    id: 'biochemistry_no_phd',
    condition: (profile) => !profile.postgraduate,
    majorIds: ['biochemistry'],
    severity: 'high',
    title: '生化环材——不读博没出路，读了博出路也窄',
    reasoning: `生化环材四天王，没读博士别逞强。
本科毕业：化工厂/环保企业/转行做码农或销售，月薪5-8K。
博士毕业：科研岗15-25万，但岗位少、位置偏（化工厂都在郊区）。
家里等米下锅的千万别碰。如果你确定要读博、能接受10年低收入，那可以考虑。`,
    alternative: '化工转制药（药学）、材料转电子材料（搭半导体风口）',
  },
  {
    id: 'medicine_low_income',
    condition: (profile) => profile.family_income === 'low',
    majorIds: ['clinical_medicine'],
    severity: 'medium',
    title: '临床医学——低收入家庭的长线豪赌',
    reasoning: `学医是条长路：5年本科+3年规培+可能的3年专硕=11年起步。35岁以前基本挣不到什么钱。
规培期月薪5-10K，35岁前你同学在互联网年薪百万时你还在考试。
家里条件一般的话，你父母能不能等你11年？如果家里急需你毕业后赚钱养家，医学不是好选择。`,
    alternative: '护理学（3-4年毕业就能工作，同样稳定有编制）或 口腔医学（周期短一些，收入天花板高）',
  },
  {
    id: 'law_non_elite',
    condition: (profile) => profile.score && profile.score < 580,
    majorIds: ['law'],
    severity: 'medium',
    title: '法学——五院四系之外基本等于转行',
    reasoning: `法考通过率仅13%。五院四系出来的才叫法律人。
普通二本法学毕业=简历石沉大海。红圈所起薪3万+和你没关系，大部分法学生去做了销售/行政/考公。
如果你580分以下，又不在五院四系，法学这条路基本堵死了——除非你铁了心考公（法学考公岗位确实多）。`,
    alternative: '汉语言文学（同样能考公，且没有法考这道鬼门关）',
  },
  {
    id: 'civil_decline',
    condition: () => true,
    majorIds: ['civil_engineering'],
    severity: 'medium',
    title: '土木工程——基建高峰期已过',
    reasoning: `过去三十年土木是造富神话，未来三十年可不好说。
房地产大规模下行，基建投资增速放缓。工地环境苦（日晒雨淋/外派偏远地区），女生更是慎入。
985土木进设计院的还好些，普通一本土木毕业大概率去工地。不是说不体面，但你得想好自己能不能接受那种生活。`,
    alternative: '机械工程（制造业升级方向更广）或 自动化（智能制造风口）',
  },
  {
    id: 'marketing_admin_avoid',
    condition: () => true,
    majorIds: [],
    genericRule: true,
    title: '市场营销/行政管理/电子商务——本科都不好就业',
    reasoning: `这些专业共同的问题：门槛低、谁都能干、AI替代风险高。
你大学四年学的"市场营销"，毕业发现跟高中毕业做销售的同事干一样的活。这不是歧视，是你花的四年时间和学费到底买了什么。`,
  },
];

function getDissuasionForProfile(profile, targetMajorIds) {
  const warnings = [];
  for (const rule of DISSUASION_RULES) {
    if (rule.genericRule) continue;
    const applies = rule.majorIds.some(mid => targetMajorIds.includes(mid));
    if (!applies) continue;
    if (rule.condition(profile)) {
      warnings.push(rule);
    }
  }
  return warnings;
}

function getDissuasionContext(profile, engineResult) {
  if (!engineResult) return '';

  const allMajorIds = [
    ...(engineResult.ranked?.reach || []),
    ...(engineResult.ranked?.match || []),
    ...(engineResult.ranked?.safety || []),
  ].map(m => m.id);

  const warnings = getDissuasionForProfile(profile, allMajorIds);

  if (warnings.length === 0) return '';

  let ctx = '\n## 已知风险提醒（来自知识库）\n\n';
  ctx += '以下专业对你的情况有已知风险，在回复中需要重点提醒：\n\n';
  for (const w of warnings) {
    ctx += `### ${w.title}\n`;
    ctx += `${w.reasoning}\n`;
    ctx += `💡 替代方向：${w.alternative}\n\n`;
  }
  return ctx;
}

module.exports = { DISSUASION_RULES, getDissuasionForProfile, getDissuasionContext };
