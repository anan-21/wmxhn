# Technology Rules

- Runtime: Node.js 22+, CommonJS, Express 5; frontend uses native HTML/CSS/JavaScript.
- Agent: Vercel AI SDK 7 ToolLoopAgent; retain existing provider adapters and five domain tools.
- Browser file parsing: pinned unpdf and Mammoth, bundled by esbuild; no external CDN.
- Build: `npm run build`; unit/API/SDK checks: `npm test`; full engine: `npm run test-engine`; browser acceptance: `npm run test:browser`.
- Local dev: `npm start`; production uses legacy Vercel @vercel/node and `vercel-build`.
- Do not write or print real API credentials. User-supplied keys remain excluded from consultation history and export.
- Use isolated feature branches. This repository currently uses main with no develop branch; use the Codex branch prefix and do not invent a promotion workflow.
