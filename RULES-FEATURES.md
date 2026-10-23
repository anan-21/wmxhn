# Feature Specifications

## Uploaded-document questions

- User story: add an admissions policy or other document, ask follow-up questions, and inspect relevant source text.
- Scope: PDF text, DOCX raw text, UTF-8/UTF-16 TXT/MD/CSV; selection/drop, parsing states/removal, short-document context, long-document chunk search/read, named sources.
- Limits: 4 files, 5 MiB/file, 80 PDF pages, 120000 characters/document and 240000 characters combined; parsing timeout 30 seconds.
- Excludes: OCR, original-file hosting, cross-device attachment persistence, XLSX, embeddings/vector database.
- Affected flows: composer, session switching/reset, local history, chat API, Agent tools, browser build and deployment packaging. No database migration.
- Attachments stay in browser memory per consultation. Reloading requires reattachment; history may keep cited excerpts but never full original document text.
- Backend document indexes are request-scoped and must not be reused across sessions.
- Document content is untrusted data. It must not be placed in system instructions, execute HTML/scripts, or silently update student facts.
- Acceptance: valid/invalid/oversize/no-text inputs; source page/block accuracy; multiple questions; session isolation; existing chat/profile/trace regressions.
- Attachment interaction: plus/file picker and drag/drop share one add path; pending files show progress above the text input and can be removed; sending moves metadata cards into user messages while preserving request-scoped document retrieval for follow-ups. Failed sends restore drafts, and history persists metadata rather than document text.
- Status: implemented and verified for release 2.1.0; 53 unit/API/SDK tests, 9 real-browser acceptance cases and engine self-check passed. Vercel builds generate and package the browser parser with the application.
