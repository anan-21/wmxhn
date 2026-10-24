# 高考志愿 Agent 运行层

采用 Vercel AI SDK 7 `ToolLoopAgent`。用户的模型 Key 通过现有请求传入，直接连接选定供应商，不要求 AI Gateway 账户或额外模型服务。

## 分工

- `runtime.js`：模型适配、工具参数校验、循环上限、超时、工具执行轨迹。
- `../engine/tools.js`：五个领域工具与两个附件工具及其 JSON Schema，继续使用原有录取库、RAG 和推荐引擎。
- `../engine/uploadedDocuments.js`：附件字段与大小校验、请求内分块、中文/英文关键词检索和带位置的来源。所有文件索引只属于当前请求。
- `../browser/document-parser.js`：浏览器 Worker 内解析原文件；esbuild 生成 `public/document-parser.js`。
- `../server.js`：HTTP API、当前会话画像、业务提示词；通过 `callAIWithTools` 调用新运行层。

## 执行约束

- 六轮工具调用后进入一次禁止工具的总结步骤，最多七次模型生成。
- 同一步工具顺序执行，避免更新画像与读取画像发生竞争。
- 单轮模型请求最多 45 秒，总生成预算 120 秒，一次模型请求重试。
- 工具参数由 Ajv 校验；执行异常作为工具结果交回模型，并生成失败轨迹。
- 无 Key 时保留原离线模式。模型需要支持 tool/function calling。
- OpenAI 兼容供应商使用 Chat Completions；Claude 使用原生 Anthropic 适配器。
- 供应商 API 地址的环境变量优先于内置地址；OpenAI 和 DeepSeek 的内置根地址自动补 `/v1`。
- 快速画像分析和旧追问路径也复用同一个模型适配器，避免普通聊天与单次分析使用不同 API 地址。
- 供应商错误按鉴权、额度、限流、模型权限和网络连接分类提示，不向用户返回可能包含凭据的原始报错。

## 运行与验证

要求 Node.js 22 及以上（现有 Vercel 项目配置为 24）。

```bash
npm install
npm test
npm start
```

`tests/agent-runtime.test.js` 使用模拟供应商 HTTP 响应验证真实 SDK 路径，无需 Key、无模型费用。覆盖 OpenAI 兼容接口、Claude 原生接口、循环终止、参数校验、错误状态和会话工具上下文。

服务端仍使用临时内存会话，浏览器发送受限历史帮助恢复；没有增加跨设备持久化数据库。快速填表路径继续使用原有规则引擎和单次解释流程，附件可在随后聊天时提问。真实供应商的网络、配额和具体模型兼容性仍需有效 Key 验证。

附件每轮由浏览器重发解析正文，不放入共享会话缓存。浏览器携带最近的受限 user/assistant 历史以适应 serverless 实例切换，服务端拒绝 system/tool 角色。附件正文作为单独的资料消息和工具结果进入模型，系统提示明确其不可信、不能覆盖指令，文档中的学生信息需要用户确认后才能更新画像。来源列表表示实际提供给模型的参考片段，不保证模型的每一句话都已被这些片段支持。

参考：
- https://ai-sdk.dev/docs/agents/building-agents
- https://ai-sdk.dev/providers/openai-compatible-providers
- https://github.com/vercel/ai
