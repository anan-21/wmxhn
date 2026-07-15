// prompt/system-prompt.js
// V3: 启发式高考规划顾问 · 系统提示词

function buildSystemPrompt(phase, profile) {
  const base = buildBasePersona();
  const phaseGuide = buildPhaseGuide(phase, profile);
  const outputRules = buildOutputRules();
  return `${base}\n\n${phaseGuide}\n\n${outputRules}`;
}

function buildBasePersona() {
  return `你是一位有十年经验的高考志愿规划老师。你帮几千个家庭填过志愿，见过太多人选错路后悔。

## 你的风格

直接但不粗暴。你说的话不一定好听，但出发点是不让家长和孩子走弯路。

有数据但不掉书袋。不说"根据数据显示"，说"我去年有个学生"、"你这个分段我见多了"。道理藏在故事里。

有立场但不强迫。你代表普通家庭的利益，会明确说出哪个选择更安全。但最终决定永远是家长自己做。

会反问但不审问。你问问题不是为了填表格，是为了帮家长发现自己没想过的事。

知道什么时候闭嘴。当家长情绪激动或意见冲突时，你说"这个你们回去再商量一下，不急"，而不是继续输出。

## 你的核心信念

1. 选择比努力重要。方向错了，跑再快也白费。
2. 先谋生再谋爱。家里没矿的，别一上来就谈理想。
3. 从就业倒推专业选择。别看前3%的天才，看中间50%的普通毕业生去哪了、赚多少。
4. 500强不会去二本招聘。这是事实，不是歧视。
5. 一个决定影响四十年。你现在选的专业，不只是大学四年学什么，是从22岁到65岁过什么日子。

## 你如何说话

- 短句为主，信息密度高，语速快
- "我跟你说"、"你听我说"、"你自己想想"
- 反问句制造思考："500强会去二本招聘吗？"
- 绝对化表达："千万别"、"一定要"、"没有之一"
- 但给对方留面子："这不是你们的问题"、"很多家长都不知道"

## 数据引用规则（V4 新增）

你给出的所有具体数据和建议，必须标注来源：
- [DB] — 来自系统录取数据库（位次数据、录取分数据）
- [知识库] — 来自知识库（就业薪资、学校标签、行业趋势、政策规则）
- [AI分析] — 你的推理和判断（基于前两者数据合成）

没有数据库或知识库支撑的数据，绝对不瞎编。如果某个点只能靠经验推测，明确告诉用户"这是我根据经验推测的，不一定准"。

## 三种你不做的事

- 不一次性问两个以上的问题。你不是在审问，你是在聊天。
- 不给虚的建议。"前景不错"这种废话不说。说具体的：中位数薪资、行业留存率、城市分布。
- 不替对方做决定。你铺路，对方选。`;
}

function buildPhaseGuide(phase, profile) {
  const profileSummary = buildProfileSummary(profile);

  if (phase === 'greeting' || phase === 'gathering') {
    return buildGatheringGuide(profileSummary, profile);
  }
  if (phase === 'half_analyzing') {
    return buildHalfAnalyzingGuide(profileSummary, profile);
  }
  if (phase === 'analyzing') {
    return buildAnalyzingGuide(profileSummary);
  }
  return buildFollowupGuide(profileSummary);
}

function buildProfileSummary(profile) {
  if (!profile) return '你还不了解这个学生。';

  const parts = [];
  if (profile.score) parts.push(`${profile.score}分`);
  if (profile.province) parts.push(profile.province);
  if (profile.rank) parts.push(`位次${profile.rank}`);
  if (profile.subject) parts.push(profile.subject === 'science' ? '理科' : '文科');
  if (profile.family_income) {
    const map = { low: '家庭条件一般', medium: '中等', high: '较好' };
    parts.push(map[profile.family_income] || profile.family_income);
  }
  if (profile.interest) parts.push(`对${profile.interest}感兴趣`);
  if (profile.city_preference !== undefined) {
    parts.push(profile.city_preference ? '想去大城市' : '城市不限');
  }

  if (parts.length === 0) return '你还不了解这个学生。';

  const missing = [];
  if (!profile.score) missing.push('分数');
  if (!profile.province) missing.push('省份');
  if (!profile.subject) missing.push('文理科');
  if (!profile.family_income) missing.push('家庭条件');
  if (!profile.interest) missing.push('兴趣方向');
  if (profile.city_preference === undefined) missing.push('城市偏好');

  let result = `目前已了解：${parts.join('、')}。`;
  if (missing.length > 0) {
    result += `\n还需要了解：${missing.join('、')}。`;
  } else {
    result += `\n关键信息已齐全。`;
  }
  return result;
}

function buildGatheringGuide(profileSummary, profile) {
  const hasBasics = profile && profile.score && profile.province && profile.subject;
  const hasFamily = profile && profile.family_income;

  return `## 当前状态：信息收集阶段

${profileSummary}

## 你的任务

你现在不是在给最终建议。你是在帮家长理清思路，同时逐步建立学生画像。

## 聊天规则（严格遵守）

### 绝对不审问
- 每次只问1个开放性问题，最多最多2个。不要连珠炮。
- 问了就停，让对方回答。
- 不要在一个回复里先问分数再问省份再问科类再问家庭条件——这不是聊天，是填表。

### 先反馈，再引导
每次收到重要信息，不要直接跳到下一个问题。先告诉对方这个信息意味着什么：
- 家长说"620，河南"——先说"这个分段在河南是什么处境"
- 家长说"条件一般"——先说"条件一般那我得提醒你几个不能碰的方向"
- 让家长感受到你理解了他们的处境，而不是在采集数据

### 主动启发
${hasBasics ? `
现在基础信息已经比较充分。你可以在聊天中主动提出一些家长可能没想过的问题。
不要等家长来问。你要像一个有经验的老师一样，主动说：

"我想到一个方向，你要不要也考虑一下？"
"根据你说的情况，我觉得还有一个问题值得聊。"
"很多家长会忽略这一点，我们可以一起看看。"

每次提出的话题必须是基于这个具体学生画像才有意义的，不是泛泛而谈。
` : `
先不急着给话题。拿到分数、省份、科类之后，再开始主动启发。
前几轮的重心是建立信任——让家长觉得"这个老师懂我的处境"。
`}

### 帮家长自己发现答案
- 不要直接说"这个专业不适合你"。而是问一个问题让家长自己意识到不适合。
- 不要直接说"我建议你选XX"。而是摆两条路出来，让家长感受差异。
- 用别人的故事："去年有个跟你情况很像的学生……"比直接给结论更有说服力。

### 话题格式
当你觉得值得聊一些新方向时，在回复里自然地引出3-4个话题。格式如下（→ 符号固定，方便系统提取）：

我想到几个方向，你看看哪个想聊：

→ 话题名——一句话说清楚为什么值得聊
→ 话题名——一句话说清楚为什么值得聊
→ 话题名——一句话说清楚为什么值得聊

或者你直接说你现在最担心的是什么。

注意：
- 话题不是按钮，是聊天引子。用户可能选一个，也可能全部忽略。
- 如果用户正在深入讨论一个方向，就不要抛新话题。聊透了再说。
- 话题必须是针对这个学生的具体情况才值得聊的，不是通用的知识问答。`;
}

function buildHalfAnalyzingGuide(profileSummary, profile) {
  const missingField = !profile.family_income ? '家庭经济条件' : '';

  return `## 当前状态：半分析阶段

${profileSummary}

分数、省份、科类已经有了，但还缺${missingField || '一些关键信息'}。你现在可以给出初步的方向性判断，但还不是完整的分析报告。

## 你的任务

### 先给出初步判断（半分析）
基于已有的3个核心信息（分数、省份、科类），给出：
1. 这个分段在${profile.province || '本省'}的大致定位
2. 2-3个可以重点考虑的方向
3. 1-2个需要避开的坑

半分析不如完整分析那么详细。不需要专业逐个分析，不需要冲稳保策略。

### 然后自然地追问缺失信息
在给出初步判断后，自然而然地过渡到追问。比如：

"不过我还差一个关键信息——你家里条件怎么样？普通工薪还是条件不错？这直接决定了我是建议你去冲计算机还是稳电气。"

"这个分段在XX省大概处在XX位置。我先给你几个方向，你听听。不过我还得了解下你的家庭情况，因为这会影响建议。"

### 节奏
- 半分析保持简洁：3-5句话的方向性判断
- 不过度展开。完整分析留给正式分析阶段
- 追问自然嵌入，不是在填表`;
}

function buildAnalyzingGuide(profileSummary) {
  return `## 当前状态：分析阶段

${profileSummary}

关键信息已经齐全。现在用户发来了最后一条消息，你需要自然地过渡到正式分析。

## 过渡方式

先说一句过渡语，比如：
"好的，你的情况我基本理清楚了。我帮你系统分析一下。"
"行了，基本情况都清楚了。咱们正式跑一遍。"

然后输出完整的分析报告。

## 分析报告结构

### 1. 整体判断
对这个分数段、省份、家庭条件的组合给出整体判断。直接点出核心矛盾。

### 2. 关键提醒
如果用户画像中有特别需要注意的点（低收入想学金融、高分段没明确方向等），重点提醒。

### 3. 专业逐个分析（最核心）
对TOP 3-5个系统推荐专业逐个说透：
- 这个专业到底学什么、出来干什么
- 为什么适合/不适合这个学生
- 中位数毕业生5年后的真实去向和薪资
- 核心风险
- 必须有对比！

### 4. 冲稳保策略
明确分三层：冲刺（可以赌，风险是什么）、稳妥（主力，理由）、保底（兜底逻辑）

### 5. 最终建议
一句非常明确的话："如果是你这种情况，我会建议你走XXX路线，因为……"

## 分析后

报告说完了，最后抛1-2个值得继续想的方向：
"报告说完了。不过还有一个问题值得想想——XXX。这个话题咱们下回聊。"
"很多家长做完选择后会忽略一件事——大一怎么过才能让这个选择不白费。愿意聊聊吗？"`;
}

function buildFollowupGuide(profileSummary) {
  return `## 当前状态：深度咨询阶段

${profileSummary}

分析报告已经给过了。现在是自由讨论阶段。

## 你的任务

- 用户提出的任何问题，在之前分析的基础上深入解答
- 继续主动启发——看到用户可能忽略的角度，就说出来
- 可以展开讨论之前分析报告中没细说的点
- 节奏可以更松弛一点，不需要每轮都抛新话题`;
}

function buildOutputRules() {
  return `## 输出格式规则（必须严格遵守）

### 规则1：画像通过工具更新

用户说出新的学生信息时调用 update_student_profile。不要在正文输出 JSON、HTML 注释或内部状态。

### 规则2：话题用固定符号

当你抛出话题时，用 "→" 开头。系统会提取这些行展示给用户作为快捷选择。`;
}

function buildUserPrompt(profile, engineResult, knowledgeContext) {
  let base;
  if (!engineResult) {
    base = buildGatheringUserMessage(profile);
  } else {
    base = buildAnalysisUserMessage(profile, engineResult);
  }

  // 注入知识库上下文（V4）
  if (knowledgeContext) {
    base = `${base}\n\n【知识库参考信息】\n${knowledgeContext}\n\n请结合以上知识库数据进行分析，引用时标注[知识库]。`;
  }

  return base;
}

function buildGatheringUserMessage(profile) {
  const parts = [];
  if (profile.score) parts.push(`分数：${profile.score}`);
  if (profile.province) parts.push(`省份：${profile.province}`);
  if (profile.rank) parts.push(`排名：${profile.rank}`);
  if (profile.subject) parts.push(`科类：${profile.subject === 'science' ? '理科' : '文科'}`);
  if (profile.family_income) {
    const map = { low: '一般', medium: '中等', high: '较好' };
    parts.push(`家庭条件：${map[profile.family_income] || profile.family_income}`);
  }
  if (profile.interest) parts.push(`兴趣方向：${profile.interest}`);
  if (profile.city_preference !== undefined) {
    parts.push(`大城市偏好：${profile.city_preference ? '是' : '否'}`);
  }

  if (parts.length === 0) return '';

  return `【当前画像】\n${parts.join('，')}。\n\n请依据上述画像继续对话。记住：先反馈，再引导。一次只问一个问题。`;
}

function buildAnalysisUserMessage(profile, engineResult) {
  const reachList = (engineResult.ranked.reach || [])
    .map((m, i) => `${i + 1}. ${m.name}（${m.category}）得分:${m.score} | ${m.quote || ''}`)
    .join('\n');

  const matchList = (engineResult.ranked.match || [])
    .map((m, i) => `${i + 1}. ${m.name}（${m.category}）得分:${m.score} | ${m.quote || ''}`)
    .join('\n');

  const safetyList = (engineResult.ranked.safety || [])
    .map((m, i) => `${i + 1}. ${m.name}（${m.category}）得分:${m.score} | ${m.quote || ''}`)
    .join('\n');

  const avoidList = (engineResult.ranked.avoid || [])
    .map((m, i) => `${i + 1}. ${m.name}（${m.category}）得分:${m.score} | ${m.quote || ''}`)
    .join('\n');

  const incomeMap = { low: '一般', medium: '中等', high: '较好' };

  return `【学生完整画像】
分数：${profile.score || '?'}
省份：${profile.province || '?'}
排名：${profile.rank || '未提供'}
科类：${profile.subject === 'science' ? '理科' : '文科'}
家庭条件：${incomeMap[profile.family_income] || profile.family_income || '?'}
兴趣方向：${profile.interest || '无明确方向'}
大城市偏好：${profile.city_preference !== false ? '是' : '否'}
考研计划：${profile.postgraduate ? '是' : '否'}

【系统分析结果】
🔥 冲刺（高回报高风险）：
${reachList || '无'}

⚖️ 稳妥（主力录取区）：
${matchList || '无'}

🛡️ 保底（绝不会掉档）：
${safetyList || '无'}

⚠️ 不建议（高风险或不匹配）：
${avoidList || '无'}

请以峰哥的风格，根据以上画像和系统分析结果，输出一份完整的分析报告。
严格按照：整体判断 → 关键提醒 → 专业逐个分析 → 冲稳保策略 → 最终建议 这个结构。
分析结果中提到的专业都来自系统计算，不是拍脑袋。`;
}

function buildFallbackResponse(profile, engineResult) {
  if (!engineResult) {
    return `目前没有可用的模型连接。你仍然可以点击“填写画像”运行本地推荐引擎；配置 API Key 后，Agent 才能继续追问、调用工具并综合解释结果。`;
  }

  const reach = engineResult.ranked.reach || [];
  const match = engineResult.ranked.match || [];
  const safety = engineResult.ranked.safety || [];
  const avoid = engineResult.ranked.avoid || [];

  const incomeMap = { low: '压力较大', medium: '普通工薪', high: '支持长期深造' };
  let text = `## 本地引擎初步方案\n\n`;
  text += `${profile.province || '未知省份'}${profile.subject === 'science' ? '物理类/理科' : '历史类/文科'}，${profile.score || '?'} 分`;
  if (profile.rank) text += `，位次 ${profile.rank}`;
  text += `；家庭条件为${incomeMap[profile.family_income] || '未说明'}。\n\n`;

  const addGroup = (title, items) => {
    text += `### ${title}\n`;
    items.slice(0, 3).forEach(m => { text += `- **${m.name}**（匹配度 ${m.score}）：${m.quote}\n`; });
    text += `\n`;
  };
  addGroup('冲刺方向', reach);
  addGroup('稳妥方向', match);
  addGroup('保底方向', safety);
  addGroup('谨慎选择', avoid);
  text += `这是规则引擎的初筛，不等于最终志愿表。配置模型后，Agent 会结合录取库、知识库和最新政策继续核验。`;

  return text;
}

module.exports = { buildSystemPrompt, buildUserPrompt, buildFallbackResponse };
