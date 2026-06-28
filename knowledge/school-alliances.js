// knowledge/school-alliances.js
// 院校联盟/标签体系 —— 用于AI在分析时引用学校背景

const ALLIANCES = {
  'C9联盟': {
    description: '中国首个顶尖大学联盟，代表中国最高水平研究型大学',
    members: ['北京大学','清华大学','浙江大学','复旦大学','上海交通大学','南京大学','中国科学技术大学','哈尔滨工业大学','西安交通大学'],
    note: 'C9毕业生在高端就业市场有明显溢价，保研率普遍35%+',
  },
  '华东五校': {
    description: '华东地区五所顶尖高校，实力仅次于清北',
    members: ['复旦大学','上海交通大学','浙江大学','南京大学','中国科学技术大学'],
    note: '华五在长三角就业认可度极高，计算机/金融方向薪资全国TOP',
  },
  '中坚九校': {
    description: '工科实力突出的九所985高校',
    members: ['华中科技大学','哈尔滨工业大学','西安交通大学','北京理工大学','天津大学','东南大学','同济大学','北京航空航天大学','华南理工大学'],
    note: '工科强校，毕业生在制造业/IT/航天领域分布广泛',
  },
  '两电一邮': {
    description: 'IT行业黄埔军校',
    members: ['电子科技大学','西安电子科技大学','北京邮电大学'],
    note: '计算机/通信/电子方向，华为中兴年年大量校招，就业率极高',
  },
  '五院四系': {
    description: '法学教育的最高殿堂',
    五院: ['中国政法大学','西南政法大学','华东政法大学','中南财经政法大学','西北政法大学'],
    四系: ['北京大学法学院','中国人民大学法学院','武汉大学法学院','吉林大学法学院'],
    note: '五院四系出来的才叫法律人。非五院四系的法学生，毕业基本等于转行。',
  },
  '建筑老八校': {
    description: '建筑学传统强校',
    members: ['清华大学','东南大学','天津大学','同济大学','华南理工大学','哈尔滨工业大学','重庆大学','西安建筑科技大学'],
    note: '建筑设计院认这八所。但随着基建降温，建筑学热度在下降。',
  },
  '原电力部直属': {
    description: '电气工程的黄金通道，国家电网校招大户',
    members: ['华北电力大学','东北电力大学','上海电力大学','三峡大学','长沙理工大学','南京工程学院','沈阳工程学院'],
    note: '这些学校的电气工程毕业生进国家电网的概率远超同分段其他学校。家里有电网资源的，首选这些。',
  },
  '四大财经': {
    description: '财经类211第一梯队',
    members: ['上海财经大学','中央财经大学','对外经济贸易大学','西南财经大学'],
    note: '金融行业target school。非这四所的财经院校，进券商/基金总部的概率极低。',
  },
  '国防七子': {
    description: '工信部直属七所高校，军工/航天核心校',
    members: ['哈尔滨工业大学','北京航空航天大学','北京理工大学','西北工业大学','南京航空航天大学','南京理工大学','哈尔滨工程大学'],
    note: '国防军工+民用双线就业，航空航天/兵器/船舶方向有独特优势。',
  },
  '四大工学院': {
    description: '1952年院系调整时成立的四大工学院',
    members: ['华中科技大学','东南大学','华南理工大学','大连理工大学'],
    note: '工科底子深厚，机械/土木/电子等传统工科实力强。',
  },
};

function getAllianceForSchool(schoolName) {
  const tags = [];
  for (const [name, info] of Object.entries(ALLIANCES)) {
    const members = info.members || [...(info.五院||[]), ...(info.四系||[])];
    if (members.some(m => schoolName.includes(m) || m.includes(schoolName))) {
      tags.push(name);
    }
  }
  return tags;
}

function getAllianceContext() {
  let ctx = '';
  for (const [name, info] of Object.entries(ALLIANCES)) {
    ctx += `- **${name}**：${info.description}。${info.note}\n`;
  }
  return ctx;
}

module.exports = { ALLIANCES, getAllianceForSchool, getAllianceContext };
