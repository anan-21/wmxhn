# API Rules

- Retain existing Express JSON routes and `{status:"success",data:{...}}` envelopes.
- POST /api/chat accepts optional documents and clientMessages for the conversation path.
- Document: `{id,name,type,size,pages:[{pageNumber,text}]}`. Type is a supported lowercase extension. Server validates all fields and limits independently of browser checks.
- Return `data.documentSources`: documentId, name, pageNumber, chunkId, location and excerpt. Real page numbers apply only to PDF; other formats use text block locations.
- Documents are rebuilt per request; clients send current ready attachments on every question. An empty list removes all current attachment context.
- clientMessages accepts only bounded user/assistant content: <=20 messages, <=16000 characters each, <=60000 combined. No system/tool roles.
- JSON request limit: 2 MiB; malformed input returns 400, request size overflow returns 413, provider failures keep existing handling.
- Document questions require a model with credentials; no-Key mode must not pretend to answer from the document.
- No API logs may contain keys or document contents.
- Contract tests: `npm test`.
