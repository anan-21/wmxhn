# RULES-BUGS.md - Project Bug Memory

> Keep this file specific to the current project. Read it before feature work and update it after every confirmed bug fix.

## Known Bugs

### Bug #001: PDF Worker handshake mistaken for completed parsing

- **Symptom**: Valid PDF and empty PDF both showed a generic parsing failure.
- **Reproduction**: Add a valid two-page PDF in the real browser acceptance test.
- **Root cause**: PDF.js posts a worker-ready handshake; the outer message handler treated every message as an application parse result and terminated early.
- **Fix**: Mark application results with `kind: gaokao-document-result`; ignore other worker messages.
- **Regression test**: `tests/browser/documents.spec.js`, real PDF/DOCX and invalid/empty file cases.
- **Prevention rule**: Use a dedicated message protocol when a library shares a Worker message channel.
- **Affected scope**: PDF parsing and attachment error states.

### Bug #002: Browser history quota failure mislabeled as model failure

- **Symptom**: A completed model answer could be followed by an execution failure when local storage was full.
- **Reproduction**: Make history setItem throw QuotaExceededError, then send a successful chat request.
- **Root cause**: History persistence errors propagated into the model request catch handler.
- **Fix**: Catch history storage failures at the persistence boundary and show a storage-specific notice.
- **Regression test**: `tests/browser/documents.spec.js`, injected QuotaExceededError.
- **Prevention rule**: Optional local persistence must not change a successful request into a failed model response.
- **Affected scope**: Browser consultation history and attachment source excerpts.

### Bug #003: Deleted active consultation immediately saved again

- **Symptom**: Deleting the active history item could leave that same record in history.
- **Reproduction**: Complete a conversation, delete its active history row and inspect local history and the visible list.
- **Root cause**: Reset saved the still-active messages after deletion.
- **Fix**: Clear active messages and attachment references before reset, then refresh the history list.
- **Regression test**: `tests/browser/documents.spec.js`, active history deletion.
- **Prevention rule**: Delete and reset paths must coordinate persistence to avoid recreating deleted data.
- **Affected scope**: Consultation deletion and attachment memory cleanup.

### Bug #004: Document text duplicated in model inputs

- **Symptom**: Context and tool payloads sent identical `text` and `excerpt` fields.
- **Reproduction**: Serialize a single-marker document context or read/search result and count occurrences of its body.
- **Root cause**: UI source shape was reused wholesale as the model result shape.
- **Fix**: Retain excerpt in the request-scoped source Map; send one text field to the model.
- **Regression test**: `tests/uploaded-documents.test.js`, single-copy model content.
- **Prevention rule**: Separate presentation metadata from model payloads and verify actual context size.
- **Affected scope**: Uploaded document context and tools.

### Bug #005: Long PDF page continuation repeated earlier blocks

- **Symptom**: Reading a long page with pageNumber plus next startChunk returned its first blocks repeatedly.
- **Reproduction**: Read a PDF page with more than four blocks, then request that page with returned nextChunk as startChunk.
- **Root cause**: Page filtering bypassed the startChunk filter.
- **Fix**: Apply startChunk after page filtering, retaining global chunk numbers for continuation.
- **Regression test**: `tests/uploaded-documents.test.js`, long page continuation.
- **Prevention rule**: Test pagination together with filters, including pages larger than a result window.
- **Affected scope**: Agent document reading.

### Bug #006: Failed attachment send discarded the text draft

- **Symptom**: A rejected chat request left the input empty and a failed turn in the chat, making retries require retyping.
- **Reproduction**: Add a ready document and text, return HTTP 500 for /api/chat, then inspect the composer and user messages.
- **Root cause**: The optimistic send cleared text and appended a message before awaiting the request, without rolling back on failure.
- **Fix**: Treat sending as a draft transaction: on failure remove the temporary message, restore text and pending file states, and show a retry notice.
- **Regression test**: `tests/browser/documents.spec.js`, failed-send draft restoration and no duplicate message assertions.
- **Prevention rule**: Optimistic input clearing must have an explicit rollback that preserves the user's draft.
- **Affected scope**: Text and attachment sending, consultation history.

### Bug #007: Deployment upload excluded the browser build script

- **Symptom**: Vercel remote build could not find scripts/build-documents.js although the local build passed.
- **Reproduction**: Deploy with the legacy .vercelignore rule that excluded the complete scripts directory.
- **Root cause**: Local builds read working-tree files, while the Vercel upload omits ignored files before remote building. The new build entrypoint lived in an excluded directory.
- **Fix**: Exclude individual scripts while explicitly including build-documents.js in the tracked release configuration.
- **Regression test**: Remote Vercel production build and generated Worker endpoint checks.
- **Prevention rule**: When adding a build entrypoint, verify deployment upload filters as well as local build and function output.
- **Affected scope**: Vercel deployment packaging.

### Bug #008: OpenAI quick analysis and follow-ups omitted the versioned API root

- **Symptom**: Normal chat could work while quick profile analysis or follow-up failed with a generic server error.
- **Reproduction**: Run tests/openai-routing.test.js against the 2.1.0 server: quick analysis calls api.openai.com/chat/completions while the Agent calls the required /v1/chat/completions.
- **Root cause**: Legacy single-call code duplicated URL/model handling and did not apply the Agent adapter's version normalization or environment override precedence.
- **Fix**: Reuse createModel and AI SDK generateText for compatible-provider single-call paths.
- **Regression test**: tests/openai-routing.test.js covers ordinary chat, quick profile, automatic analysis, follow-up and environment URL overrides using mock responses.
- **Prevention rule**: All paths to the same provider must share model and endpoint configuration; test each public entrypoint.
- **Affected scope**: OpenAI/compatible-provider quick analysis and follow-up.
- **Fixed in**: 2.1.1.

### Bug #009: Generic sk- prefix shadowed OpenAI project keys

- **Symptom**: A sk-proj- key could be routed to DeepSeek when providerId was omitted, or when the browser's default DeepSeek selection was left unchanged.
- **Reproduction**: Submit a mock sk-proj- key without providerId; the 2.1.0 detector matches DeepSeek's generic sk- prefix first.
- **Root cause**: Prefix matching used registry order rather than specificity, while the browser did not recognize specific key formats.
- **Fix**: Prefer longest prefixes server-side; recognize specific key formats in the browser, preserve explicit custom endpoints, and block known mismatches before sending.
- **Regression test**: tests/openai-routing.test.js and tests/browser/documents.spec.js verify automatic selection and no request on a mismatch.
- **Prevention rule**: Specific credential-format hints must precede generic ones; do not infer ambiguous formats or override custom endpoints.
- **Affected scope**: Provider selection and authentication routing.
- **Fixed in**: 2.1.1.

### Bug #010: Wrapped provider failures lost useful diagnostic categories

- **Symptom**: Quota, network or model errors displayed only a server-internal error; old follow-up responses could echo raw provider text.
- **Reproduction**: Return mock 429 quota/rate, 404 model and nested cause/lastError network failures through the HTTP routes.
- **Root cause**: Route handlers only examined top-level HTTP status and one handler returned raw error.message.
- **Fix**: Classify SDK wrapper/cause chains and provider error codes into safe controlled messages; never expose raw provider messages in response or provider-failure logs.
- **Regression test**: tests/openai-routing.test.js checks categories and ensures a credential placeholder embedded in provider messages never reaches the HTTP JSON.
- **Prevention rule**: Preserve diagnostic categories across SDK wrappers while redacting provider-controlled message text.
- **Affected scope**: Chat, quick analysis and follow-up errors.
- **Fixed in**: 2.1.1.
