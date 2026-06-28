// knowledge/family-matching.js
// 家庭背景匹配 —— 爸妈干什么决定了很多隐藏的好路

const FAMILY_MATCHING = {
  '电力系统': {
    keywords: ['电力','电网','电厂','国家电网','南方电网','供电','电气'],
    recommendedMajors: ['electrical_engineering','automation','electronic_engineering'],
    description: '家里有电力系统资源的，学电气就是最优解。别人挤破头进不去的国家电网，你里面有熟人，只要专业对口、考试过关，基本稳。',
    note: '但要记住：资源是敲门砖，本事才是铁饭碗。进了大学好好学，别因为有关系就混日子。电网招人也要考试的。',
  },
  '铁路系统': {
    keywords: ['铁路','铁道','火车','铁路上','铁路局'],
    recommendedMajors: ['communication_engineering','mechanical_engineering','civil_engineering','automation'],
    description: '铁路系统是正儿八经的国企，福利待遇不差，工作稳定。家里有铁路上的，学通信/机械/自动化，专业对口直接招进去。',
    note: '铁道类专科（如各省铁道职业技术学院）也是好出路，专科也能进铁路局。',
  },
  '医疗系统': {
    keywords: ['医生','医院','护士','卫生','医疗'],
    recommendedMajors: ['clinical_medicine','stomatology','nursing','pharmacy'],
    description: '父母在医院工作，意味着你从大一就知道怎么规划职业路径。临床医学和口腔医学是首选。',
    note: '即使家里有资源，医学这条路也长。5年本科+3年规培跑不掉。但有人铺路，少走的就是弯路。',
  },
  '教育系统': {
    keywords: ['老师','教师','学校','教育','教授'],
    recommendedMajors: ['education_normal','chinese_literature','mathematics'],
    description: '父母在学校的，对教育行业有天然认知优势。师范类、汉语言文学是考编大户。',
    note: '但要关注人口下降趋势——未来教师编制会越来越卷，别去人口流出的城市。',
  },
  '经商/做生意': {
    keywords: ['做生意','经商','开公司','开厂','老板','个体'],
    recommendedMajors: ['accounting','finance','law','software_engineering'],
    description: '家里做生意的，孩子学会计/法律/计算机最实用——既能帮家里管账务，又能独立就业。',
    note: '不建议完全接班——先出去工作几年，学到东西再回去，比直接回去更值钱。',
  },
  '普通工薪': {
    keywords: ['打工','工薪','普通','工人','上班'],
    recommendedMajors: ['computer_science','electrical_engineering','accounting','nursing','software_engineering'],
    description: '普通家庭没资源，就两条路最稳：第一，计算机/软件工程（靠技术吃饭，不用拼爹）。第二，电气工程/护理（进国企/医院，稳定体面）。',
    note: '普通家庭的关键策略：选专业壁垒高的方向。学了别人干不了的事，你就不用跟别人卷。',
  },
  '公务员/体制内': {
    keywords: ['公务员','体制内','机关','政府','局','委'],
    recommendedMajors: ['law','chinese_literature','accounting','finance'],
    description: '父母在体制内的，最清楚什么专业考公岗位多。法学+汉语言是考公黄金组合。',
    note: '考公这件事，专业比学校重要。选对专业，大一开始看行测和申论，别等到大四才慌。',
  },
};

function detectFamilyBackground(userMessage, profile) {
  if (!userMessage) return null;
  const msg = userMessage.toLowerCase();

  for (const [label, info] of Object.entries(FAMILY_MATCHING)) {
    for (const kw of info.keywords) {
      if (msg.includes(kw)) {
        return { label, ...info };
      }
    }
  }
  return null;
}

function getFamilyMatchingContext(profile) {
  // 基于已知画像推断家庭背景匹配
  if (!profile || !profile.family_income) return '';

  const matched = [];
  if (profile.family_income === 'low') {
    matched.push(FAMILY_MATCHING['普通工薪']);
  } else if (profile.family_income === 'high') {
    matched.push({
      ...FAMILY_MATCHING['经商/做生意'],
      description: '家庭条件好，有试错成本。可以优先考虑兴趣和梦想，不必被就业绑架。但也别挥霍父母的资源。',
    });
  }

  if (matched.length === 0) return '';

  let ctx = '\n## 家庭背景匹配建议\n\n';
  for (const m of matched) {
    ctx += `${m.description}\n`;
    ctx += `推荐方向：${m.recommendedMajors.join('、')}\n`;
  }
  return ctx;
}

module.exports = { FAMILY_MATCHING, detectFamilyBackground, getFamilyMatchingContext };
