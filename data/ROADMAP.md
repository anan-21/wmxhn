# 高考录取数据层扩展方案

## 当前状态（MVP）

```
data/admission.json   49 条记录
覆盖: 6 专业 × 河南/山东/四川 × 4 学校层级
字段: year, province, school, major, min_score, min_rank, subject, batch
查询: querySchools({ major, score, province }) → 冲/稳/保
```

## Phase 1: 半自动数据采集（1-2天可完成）

### 数据来源

| 来源 | 数据类型 | 获取方式 | 难度 |
|------|---------|---------|------|
| 各省教育考试院官网 | 历年投档线 | 手动下载 Excel/PDF | 低 |
| 中国教育在线 (eol.cn) | 录取分数线 | 网页爬虫 | 中 |
| 阳光高考网 (gaokao.chsi.com.cn) | 院校库、专业库 | 网页爬虫 | 中 |
| 百度高考/夸克高考 | 分数线汇总 | API 逆向 | 高 |

### 爬虫脚本示例（Python）

```python
# scripts/scrape_eol.py
# 中国教育在线录取分数线爬虫
import requests
from bs4 import BeautifulSoup
import json
import time

BASE = "https://gkcx.eol.cn"

def scrape_province_scores(province, year, batch="1"):
    """爬取某省某年本科一批投档线"""
    url = f"{BASE}/school/search"
    params = {
        "province": province,   # 如 "河南"
        "year": year,
        "batch": batch,
        "page": 1
    }
    # 注意：eol.cn 有反爬，需要加 headers + 限速
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
    resp = requests.get(url, params=params, headers=headers, timeout=30)
    # 解析 HTML → 提取 school, major, min_score, rank
    # → 转成 admission.json 格式
    return parse_response(resp.text)

def parse_response(html):
    soup = BeautifulSoup(html, 'html.parser')
    records = []
    for row in soup.select('.school-list tr'):
        # 按实际页面结构调整选择器
        cells = row.find_all('td')
        if len(cells) >= 5:
            records.append({
                "school_name": cells[0].text.strip(),
                "major_name": cells[1].text.strip(),
                "min_score": int(cells[2].text.strip()),
                "min_rank": int(cells[3].text.strip()) if cells[3].text.strip().isdigit() else None
            })
    return records
```

### 半自动采集流程

```
1. 人工访问各省考试院 → 下载 2024/2025 年投档线 Excel
2. 运行转换脚本: excel_to_json.js → 生成 admission.json 增量数据
3. 运行去重脚本: dedupe.js → 合并 + 去重
4. 人工抽样校验 10% 数据
5. 发布到 data/admission.json
```

### Excel 转 JSON 转换器（Node.js）

```js
// scripts/excel_to_json.js
const XLSX = require('xlsx');
const fs = require('fs');

function convertExcel(filePath, province, year) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws);

  return rows.map(row => ({
    year,
    province,
    school_name: row['院校名称'] || row['学校'],
    major_name: row['专业名称'] || row['专业'],
    min_score: parseInt(row['最低分'] || row['投档分']),
    min_rank: parseInt(row['最低位次']) || null,
    subject: row['科类']?.includes('理') ? 'science' : 'arts',
    batch: row['批次'] || '本科一批',
    school_level: '', // 需从院校库补全
    school_city: '',   // 需从院校库补全
    major_id: '',      // 需做专业名→ID映射
    school_id: ''      // 需做校名→ID映射
  }));
}
```

---

## Phase 2: 自动化采集管线（1-2周）

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  爬虫调度器   │ →  │  数据清洗     │ →  │  admission   │
│  (cron)      │    │  (validator)  │    │  .json       │
└──────────────┘    └──────────────┘    └──────────────┘
        │                                    │
   · 每年 6-8 月高频                  · 引擎 reloadData()
   · 其他月份每周一次                  · 自动热更新
```

### 爬虫调度

```yaml
# .github/workflows/scrape.yml (GitHub Actions 免费额度)
name: Scrape Admission Data
on:
  schedule:
    - cron: '0 2 * * 1'  # 每周一凌晨2点
  workflow_dispatch:      # 手动触发

jobs:
  scrape:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pip install requests beautifulsoup4
      - run: python scripts/scrape_eol.py --year 2025
      - run: node scripts/dedupe.js
      - run: node scripts/validate.js
      - uses: stefanzweifel/git-auto-commit-action@v5
        with:
          commit_message: "data: auto-update admission records"
```

### 数据校验器

```js
// scripts/validate.js
function validate(records) {
  const errors = [];

  for (const r of records) {
    if (!r.school_name) errors.push(`缺少 school_name`);
    if (!r.major_name)  errors.push(`缺少 major_name`);
    if (!r.min_score || r.min_score < 200 || r.min_score > 750)
      errors.push(`${r.school_name} 分数异常: ${r.min_score}`);
    if (r.min_rank && (r.min_rank < 1 || r.min_rank > 1000000))
      errors.push(`${r.school_name} 位次异常: ${r.min_rank}`);
    // 同校同专业同省同年去重
    const dup = records.filter(x =>
      x.school_name === r.school_name &&
      x.major_name === r.major_name &&
      x.province === r.province &&
      x.year === r.year
    );
    if (dup.length > 1) errors.push(`${r.school_name} ${r.major_name} 数据重复`);
  }

  if (errors.length > 0) {
    console.error(`❌ 数据校验失败 (${errors.length} errors):`);
    errors.slice(0, 10).forEach(e => console.error('  -', e));
    process.exit(1);
  }
  console.log(`✅ 校验通过: ${records.length} 条记录`);
}
```

---

## Phase 3: 全国规模化（1个月+）

### 数据结构升级

```json
// 从单文件 → 分省分年存储
data/
  admission/
    2024/
      henan.json       // 河南 2024 全部数据
      shandong.json    // 山东 2024
      ...
    2025/
      henan.json
      ...

// 加载策略: 按需加载（前端请求哪个省就加载哪个）
function loadProvinceData(province, year) {
  const file = `data/admission/${year}/${province}.json`;
  return JSON.parse(fs.readFileSync(file));
}
```

### 院校库补全（关键）

```json
// data/schools.json —— 全国院校基础信息库
{
  "schools": [
    {
      "id": "tsinghua",
      "name": "清华大学",
      "level": "C9/985",
      "type": "综合",
      "city": "北京",
      "province": "北京",
      "is_211": true,
      "is_985": true,
      "is_double_first_class": true,
      "保研率": "58%",
      "官网": "https://www.tsinghua.edu.cn"
    }
    // ... 全国 3000+ 所高校
  ]
}
```

### 专业名→ID 映射表

```js
// data/major_mapping.json
// 解决不同数据源专业名不统一的问题
{
  "计算机科学与技术": "computer_science",
  "计算机类": "computer_science",
  "计算机科学与技术(人工智能方向)": "computer_science",
  "软件工程": "computer_science",  // 大类归并
  "电气工程及其自动化": "electrical_engineering",
  "电气类": "electrical_engineering",
  // ... 覆盖所有常见的专业名变体
}
```

### 性能优化

| 数据量 | 当前方案 | 升级方案 |
|--------|---------|---------|
| < 1000 条 | JSON 文件，全量加载 | ✅ 当前够用 |
| 1K-10K | JSON 文件，全量加载 | 按省份懒加载 |
| 10K-100K | 文件太多 | SQLite (better-sqlite3) |
| 100K+ | - | PostgreSQL + 索引 |

---

## 接入真实考试院数据

### 优先级

1. **手动下载 Excel**（最快，1天内可用）
   - 河南招生考试院: http://www.heao.gov.cn
   - 山东教育招生考试院: http://www.sdzk.cn
   - 四川教育考试院: http://www.sceea.cn

2. **API 接入**（如果存在）
   - 学信网 API（受限）
   - 各省政务服务 API（需要申请）

3. **第三方聚合**
   - 夸克高考（阿里系，数据全）
   - 百度高考
   - 掌上高考（中国教育在线 App）

### 法律与合规

- 录取分数线为公开政府数据，爬取不违法
- 控制爬取频率（1 req/3s），不影响目标服务器
- 明确数据来源标注
- 不爬取用户隐私数据

---

## 集成到规则引擎

```js
// engine/engine.js 升级版
function runEngine(user) {
  // ... 现有专业评分逻辑 ...

  // 新增: 为每个推荐专业查询可报考学校
  for (const major of topResults) {
    major.schools = querySchools({
      major: major.id,
      score: user.score,
      province: user.province,
      subject: user.subject
    });
  }

  // 在 Claude prompt 中注入学校数据
  // 使 AI 能说: "你620分河南理科计算机，可以冲西电(633)，稳郑大(608)，保河南大学(583)"
}
```

---

## 快速启动（今天就能做）

```bash
# 1. 下载河南 2025 本科一批投档线 Excel
#    访问 http://www.heao.gov.cn → 普通高招 → 投档线

# 2. 安装依赖
npm install xlsx

# 3. 转换
node scripts/excel_to_json.js --input henan_2025.xlsx --province 河南 --year 2025

# 4. 校验 + 去重
node scripts/validate.js
node scripts/dedupe.js

# 5. 发布
cp output/henan_2025.json data/admission/2025/henan.json

# 6. 重启服务，引擎自动加载
npm start
```
