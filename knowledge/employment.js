// knowledge/employment.js
// 就业数据 —— 真实就业统计，用于AI引用

const EMPLOYMENT_DATA = {
  computer_science: {
    median_salary_5yr: '25-40万',
    top_cities: ['北京','深圳','杭州','上海','成都'],
    industry_retention: '70%（5年后仍在IT行业）',
    common_paths: '互联网大厂(35%) / 中小企业IT(40%) / 考公(10%) / 创业/其他(15%)',
    market_trend: '基础码农岗位被AI冲击，AI/架构/安全方向在增长。分化加剧。',
    key_insight: '毕业第一份工作尽量去大厂或一线城市——不是为了一直留在那，是为了履历加分。三年后跳槽二线城市，薪资不降反升。',
  },
  artificial_intelligence: {
    median_salary_5yr: '40-80万（顶尖上不封顶）',
    top_cities: ['北京','深圳','上海','杭州','合肥'],
    industry_retention: '85%',
    common_paths: 'AI公司/大厂AI Lab(60%) / 自动驾驶(15%) / 金融量化(15%) / 科研(10%)',
    market_trend: '未来10年最大的技术红利。但门槛极高，非顶尖学校+顶尖数学能力基本没戏。',
    key_insight: 'AI不是"学了就能高薪"，是"只有顶尖的10%才能高薪"。数学不拔尖的别来送人头。',
  },
  electrical_engineering: {
    median_salary_5yr: '15-25万',
    top_cities: ['北京','上海','广州','武汉','南京'],
    industry_retention: '80%',
    common_paths: '国家电网/南方电网(45%) / 发电集团(20%) / 设备制造(20%) / 其他(15%)',
    market_trend: '电网稳定但薪资涨幅慢。新能源方向（风电/光伏/储能）在扩张。AI替代风险极低。',
    key_insight: '进电网要考试，竞争不比考公小。但一旦进去了，35岁被裁员的焦虑跟你没关系。',
  },
  clinical_medicine: {
    median_salary_5yr: '15-25万（主治医师）',
    top_cities: ['北京','上海','广州','成都','武汉'],
    industry_retention: '90%',
    common_paths: '三甲医院(30%) / 二甲/社区医院(50%) / 医药企业(15%) / 转行(5%)',
    market_trend: '医生永远缺，尤其是儿科/急诊/全科。但规培制度让前期收入极低。',
    key_insight: '35岁以后，你的同学在担心被裁员，你在担心今天门诊病人太多看不完。这是时间壁垒，越老越值钱。',
  },
  stomatology: {
    median_salary_5yr: '20-40万',
    top_cities: ['北京','上海','广州','深圳','成都'],
    industry_retention: '85%',
    common_paths: '口腔医院(30%) / 综合医院口腔科(25%) / 私人诊所(30%) / 自己开业(15%)',
    market_trend: '口腔健康消费升级，种植/正畸需求持续增长。自己开业收入无上限。',
    key_insight: '学口腔的终极目标不是当医生，是开自己的诊所。不用值夜班，不用面对生死。医学里性价比最高。',
  },
  nursing: {
    median_salary_5yr: '10-18万',
    top_cities: ['北京','上海','广州','深圳','杭州'],
    industry_retention: '85%',
    common_paths: '三甲医院(40%) / 社区/卫生院(40%) / 养老机构(15%) / 医药公司(5%)',
    market_trend: '老龄化社会最缺的就是护士，未来30年需求只增不减。编制岗位多。',
    key_insight: '护理是真正的铁饭碗——永远不会失业。但工作确实辛苦（三班倒），社会地位不如医生。不怕吃苦的，这个比很多本科专业强。',
  },
  finance: {
    median_salary_5yr: '10-20万（中位数）',
    top_cities: ['上海','北京','深圳','广州','杭州'],
    industry_retention: '55%',
    common_paths: '银行网点(45%) / 券商/基金(10%) / 保险(20%) / 转行(25%)',
    market_trend: '两极分化极其严重。头部年薪50万+，中位数银行柜员15万。家里没资源+非985金融=银行网点卖理财。',
    key_insight: '金融行业赚钱的不是金融知识，是人脉和资源。你有吗？没有的话，学计算机都比学金融赚得多。',
  },
  civil_engineering: {
    median_salary_5yr: '10-18万',
    top_cities: ['武汉','成都','重庆','西安','长沙'],
    industry_retention: '50%',
    common_paths: '建筑公司(35%) / 设计院(20%) / 房地产(15%) / 基建(15%) / 转行(15%)',
    market_trend: '基建高峰期已过，房地产下行，传统土木岗位在萎缩。BIM/智慧城市方向是唯一增长点。',
    key_insight: '土木人要主动往智慧建造/BIM方向转型。传统工地上搬砖的活，迟早被自动化替代。',
  },
  chinese_literature: {
    median_salary_5yr: '8-15万',
    top_cities: ['北京','上海','广州','南京','西安'],
    industry_retention: '60%',
    common_paths: '公务员/事业单位(35%) / 教师(25%) / 新媒体/编辑(20%) / 行政(20%)',
    market_trend: '考公考编的核心专业。非编制路径薪资偏低，AI写作工具对初级文案有冲击。',
    key_insight: '汉语言+法学=公务员考试黄金组合。如果你想稳定、想编制，这是最稳的路。',
  },
  law: {
    median_salary_5yr: '10-20万（中位数）',
    top_cities: ['北京','上海','深圳','广州','杭州'],
    industry_retention: '50%',
    common_paths: '律所(25%) / 公司法务(20%) / 公检法(20%) / 转行(35%)',
    market_trend: '法考通过率13%，五院四系之外的法学生就业困难。但通过法考后薪资翻倍。',
    key_insight: '法学是两个极端：要么年薪50万+（红圈所），要么找不到工作。没有中间地带。',
  },
};

function getEmploymentForMajor(majorId) {
  return EMPLOYMENT_DATA[majorId] || null;
}

function getEmploymentContext(majorIds) {
  let ctx = '\n## 就业数据参考（来自知识库）\n\n';
  ctx += '以下是系统中相关专业的真实就业数据，在分析中引用时标注[知识库]：\n\n';

  for (const id of majorIds.slice(0, 8)) {
    const data = EMPLOYMENT_DATA[id];
    if (!data) continue;
    ctx += `### ${id}\n`;
    ctx += `- 5年中位数薪资：${data.median_salary_5yr}\n`;
    ctx += `- 主要就业城市：${data.top_cities.join('、')}\n`;
    ctx += `- 行业留存率：${data.industry_retention}\n`;
    ctx += `- 常见去向：${data.common_paths}\n`;
    ctx += `- 市场趋势：${data.market_trend}\n`;
    ctx += `- 峰哥点评：${data.key_insight}\n\n`;
  }
  return ctx;
}

module.exports = { EMPLOYMENT_DATA, getEmploymentForMajor, getEmploymentContext };
