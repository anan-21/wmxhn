# 数据结构 V2 · JSON Schema

## 顶层结构

```json
{
  "meta": { "version": "2.0.0", ... },
  "schools": [ School ],
  "records": [ AdmissionRecord ]
}
```

## School（学校）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | ✅ | 唯一标识，如 `"tsinghua"` |
| name | string | ✅ | 学校名称 |
| level | string | ✅ | 层级: C9/985 / 985 / 211 / 双一流 / 一本 / 二本 |
| city | string | ✅ | 所在城市 |
| type | string | ✅ | 类型: 综合/理工/医药/师范/财经/农林 |
| employment_score | number | 否 | 就业综合评分 0-100 |
| 保研率 | string | 否 | 保研比例，如 `"35%"` |

## AdmissionRecord（录取记录）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| year | number | ✅ | 录取年份 |
| province | string | ✅ | 省份 |
| school_id | string | ✅ | 关联 School.id |
| major_id | string | ✅ | 专业ID |
| major_name | string | ✅ | 专业名称（可读） |
| subject | string | ✅ | `"science"` / `"arts"` |
| min_score | number | ✅ | 最低录取分 |
| min_rank | number | **✅核心** | 最低录取位次（位次模型主键） |
| avg_score | number | 否 | 平均录取分 |
| plan_count | number | 否 | 招生计划人数 |
| batch | string | ✅ | 批次（本科一批/二批/提前批） |
| rank_trend | object | 否 | 近3年位次 `{"2023":90,"2024":88,"2025":85}` |

## rank_trend（位次趋势）

```json
{
  "2023": 90,   // 位次数字越小 = 越难考
  "2024": 88,
  "2025": 85
}
// → 趋势: 越来越难考（位次从90降到85）
```

## 查询索引设计

```
查询模式: province + subject + major_id + year
查询优先级: min_rank > min_score（位次优先）
降级策略: 无位次数据时使用分数差
性能: 全量遍历 O(n)，10万级数据需升级为 B-tree 索引
```

## 扩展字段（未来）

```json
{
  "admission_rate": 0.15,         // 录取率
  "enrollment_quota": 120,        // 该省总招生名额
  "applicant_count": 800,         // 该省报考人数
  "hot_score": 85,                // 热度评分 0-100
  "salary_after_5y": 250000,     // 该专业5年后中位数薪资
  "city_tier": "一线",             // 城市等级
  "has_dormitory": true,         // 是否有宿舍
  "tuition": 5000,               // 学费/年
  "international_coop": false,   // 是否有中外合作
  "subject_requirements": {      // 选科要求（新高考）
    "required": ["物理"],
    "optional": ["化学", "生物"]
  }
}
```
