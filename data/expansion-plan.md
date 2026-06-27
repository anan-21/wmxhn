# 全国高考录取数据扩展方案

## 当前状态 (V2)

```
admission-v2.json: 82 条记录, 26 所学校, 6 省份, 7 专业, 2 年数据
rankEngine:       位次优先查询, 区间匹配 + 趋势修正 + 概率估算
recommender:      专业层 → 学校层 → 风险层 三层输出
```

## 方案 A: 免费方案（爬虫 + 考试院公开数据）

### 数据来源矩阵

| 省份 | 考试院官网 | 数据格式 | 爬取难度 | 优先级 |
|------|----------|---------|---------|--------|
| 河南 | heao.gov.cn | HTML表格 | ⭐ 低 | P0 |
| 山东 | sdzk.cn | HTML/Excel | ⭐ 低 | P0 |
| 四川 | sceea.cn | HTML | ⭐⭐ 中 | P0 |
| 广东 | eea.gd.gov.cn | PDF/Excel | ⭐⭐ 中 | P1 |
| 江苏 | jseea.cn | HTML | ⭐⭐ 中 | P1 |
| 湖北 | hbea.edu.cn | HTML | ⭐⭐ 中 | P1 |
| 浙江 | zjzs.net | HTML表格 | ⭐ 低 | P1 |
| 河北 | hebeea.edu.cn | HTML | ⭐⭐ 中 | P1 |
| 湖南 | hneeb.cn | HTML | ⭐⭐ 中 | P2 |
| 安徽 | ahzsks.cn | HTML | ⭐⭐ 中 | P2 |

### 爬虫架构

```
scripts/
├── scraper/
│   ├── fetcher.js        # 统一请求层（UA轮换、限速、重试）
│   ├── parsers/
│   │   ├── henan.js      # 河南考试院解析器
│   │   ├── shandong.js   # 山东考试院解析器
│   │   └── ...           # 每省一个解析器
│   ├── normalizer.js     # 数据标准化（统一字段名、专业名映射）
│   ├── dedupe.js         # 去重
│   └── validator.js      # 数据校验（分数范围、位次合理性）
├── proxy/
│   └── pool.json         # 代理池（如需）
└── output/
    └── admission-{province}-{year}.json
```

### fetcher.js 核心代码

```javascript
// scripts/scraper/fetcher.js
const fs = require('fs');
const path = require('path');

class AdmissionFetcher {
  constructor() {
    this.rateLimit = 3000; // 3秒/请求
    this.lastRequest = 0;
    this.userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    ];
  }

  async fetch(url, retries = 3) {
    // 限速
    const now = Date.now();
    const wait = this.rateLimit - (now - this.lastRequest);
    if (wait > 0) await sleep(wait);
    this.lastRequest = Date.now();

    for (let i = 0; i < retries; i++) {
      try {
        const res = await fetch(url, {
          headers: {
            'User-Agent': this.userAgents[i % this.userAgents.length],
            'Accept': 'text/html,application/json',
            'Referer': new URL(url).origin
          }
        });
        if (res.ok) return await res.text();
        if (res.status === 404) return null;
      } catch (e) {
        if (i === retries - 1) throw e;
        await sleep(2000 * (i + 1));
      }
    }
  }
}
```

### 自动化采集管线 (GitHub Actions)

```yaml
# .github/workflows/scrape-admission.yml
name: 采集高考录取数据
on:
  schedule:
    - cron: '0 3 * * 0'   # 每周日凌晨3点
  workflow_dispatch:        # 手动触发

jobs:
  scrape:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        province: [henan, shandong, sichuan]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: node scripts/scraper/index.js --province ${{ matrix.province }} --year 2025
      - run: node scripts/scraper/validator.js
      - uses: stefanzweifel/git-auto-commit-action@v5
        with:
          commit_message: "data($matrix.province): 更新录取数据"
          file_pattern: 'data/admission/*.json'
```

### 手动数据采集流程

```
1. 访问目标考试院 → 下载 Excel/PDF
2. 运行转换脚本:
   node scripts/excel_to_json.js --input henan_2025.xlsx --province 河南
3. 运行标准化:
   node scripts/normalizer.js --input raw/henan_2025.json
4. 运行校验:
   node scripts/validator.js --input normalized/henan_2025.json
5. 合并到 admission-v2.json:
   node scripts/merge.js
```

---

## 方案 B: 半自动方案（Excel + JSON 批处理）

### 适用场景
- 已有手工整理的 Excel 数据
- 部分省份数据格式不统一
- 需要人工校对关键字段（学校层级、城市、专业分类）

### 批处理工具链

```
Excel 源文件
  ↓ excel_to_json.js    (XLSX → JSON)
JSON 中间文件
  ↓ normalizer.js       (字段名统一、专业名→ID映射)
标准化 JSON
  ↓ validator.js        (分数范围检查、位次合理性、去重)
校验通过
  ↓ merge.js            (合并到主数据文件)
admission-v2.json
  ↓ 手动抽样审核 (10%)
发布
```

### 专业名→ID 映射表（不断扩展）

```json
// data/major_mapping.json
{
  "计算机科学与技术": "computer_science",
  "计算机类": "computer_science",
  "软件工程": "computer_science",
  "网络工程": "computer_science",
  "信息安全": "computer_science",
  "人工智能": "data_science",
  "数据科学与大数据技术": "data_science",
  "电气工程及其自动化": "electrical_engineering",
  "电气类": "electrical_engineering",
  "自动化": "automation",
  "机器人工程": "automation",
  "临床医学": "clinical_medicine",
  "医学影像学": "clinical_medicine",
  "麻醉学": "clinical_medicine",
  "金融学": "finance",
  "金融工程": "finance",
  "新闻学": "journalism",
  "传播学": "journalism",
  "网络与新媒体": "journalism"
}
```

### 学校名→ID 映射表

```json
// data/school_mapping.json
{
  "清华大学": "tsinghua",
  "北京大学": "pku",
  "浙江大学": "zju",
  // ... 3000+ 条目
}
```

---

## 方案 C: 商业 API 方案（未来扩展）

### 可接入的商业数据源

| 服务 | 覆盖 | 价格模型 | 接入方式 |
|------|------|---------|---------|
| 掌上高考(夸克) | 全国 | 免费基础/付费API | REST API |
| 百度高考 | 全国 | 免费 | 网页解析 |
| 学信网(chsi) | 全国 | 免费 | 网页/API |
| 中国教育在线(eol.cn) | 全国 | 免费 | 网页 |
| 各省政务服务网 | 单省 | 需申请 | REST API |
| 天眼查教育版 | 院校库 | 付费 | REST API |

### 商业 API 接入层设计

```javascript
// engine/dataProviders/adapter.js
class DataProviderAdapter {
  constructor(source) {
    this.source = source; // 'chsi' | 'eol' | 'kuakao' | 'official'
  }

  async querySchools(params) {
    switch(this.source) {
      case 'chsi':
        return await this._queryChsi(params);
      case 'kuakao':
        return await this._queryKuakao(params);
      case 'official':
        return await this._queryOfficial(params);
      default:
        return this._queryLocal(params);  // 本地数据降级
    }
  }

  // 统一输出格式（屏蔽不同数据源的差异）
  normalize(raw) {
    return {
      school_id:   this.mapSchoolId(raw.school_name),
      major_id:    this.mapMajorId(raw.major_name),
      min_score:   parseInt(raw.min_score),
      min_rank:    parseInt(raw.min_rank),
      province:    raw.province,
      year:        raw.year,
      source:      this.source
    };
  }
}
```

---

## 数据质量控制

### 自动校验规则

```javascript
// scripts/validator.js
const RULES = [
  // 分数范围
  { check: r => r.min_score >= 200 && r.min_score <= 750,
    msg: '分数超出合理范围' },

  // 位次范围（理科约30万考生，文科约20万）
  { check: r => !r.min_rank || (r.min_rank > 0 && r.min_rank < 500000),
    msg: '位次超出合理范围' },

  // 年份
  { check: r => r.year >= 2018 && r.year <= 2026,
    msg: '年份超出范围' },

  // 重复
  { check: (r, i, all) => {
    const dup = all.findIndex((x, j) =>
      j !== i && x.school_id === r.school_id && x.major_id === r.major_id
      && x.province === r.province && x.year === r.year
    );
    return dup === -1;
  }, msg: '数据重复' },

  // 同校层次一致性：一所学校在同一年同省，不同专业的分数差不应超过80分
  { check: (r, i, all) => {
    const sameSchool = all.filter(x =>
      x.school_id === r.school_id && x.province === r.province && x.year === r.year
    );
    if (sameSchool.length <= 1) return true;
    const maxDiff = Math.max(...sameSchool.map(x => x.min_score))
                  - Math.min(...sameSchool.map(x => x.min_score));
    return maxDiff <= 80;
  }, msg: '同校专业分差异常' }
];
```

---

## 从 MVP → 全国系统的升级路径

```
Phase 1 (当前):   82 条 × 6 省 × 手动构造
Phase 2 (本周):   500 条 × 3 省 × 考试院 Excel 导入
Phase 3 (2周内):  3000 条 × 6 省 × 爬虫半自动
Phase 4 (1月内):  10000+ 条 × 15 省 × 爬虫全自动
Phase 5 (季度):   50000+ 条 × 31 省 × CI/CD 自动采集
Phase 6 (年):     商业产品级 × 全国 × 实时更新
```

### 性能升级对照

| 数据量 | 存储 | 加载策略 | 查询引擎 |
|--------|------|---------|---------|
| <1K | JSON | 全量加载 | 内存遍历 |
| 1K-10K | JSON分省 | 按省懒加载 | 内存索引(Map) |
| 10K-100K | SQLite | 按省+年 | B-tree索引查询 |
| 100K-1M | PostgreSQL | 连接池 | 复合索引+缓存 |
| 1M+ | PG + Redis | 多级缓存 | 全文搜索+向量 |

### 下个里程碑

```bash
# 本周可完成：
# 1. 下载河南 2024-2025 本科一批完整投档线 Excel
# 2. 运行 excel_to_json.js 转换 → 约 500+ 条真实数据
# 3. 补充 山东/四川 数据 → 约 1000+ 条
# 4. 重启服务，rankEngine 自动加载
```
