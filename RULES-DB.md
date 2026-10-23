# Storage Rules

- Historical admissions data remains in existing repository data files; no migration is needed for document questions.
- Existing server messages/profile use transient memory. Bounded client history supports stateless chat reconstruction.
- Original attachments are neither written to disk nor put in a server document cache. Parsing occurs in browser Workers.
- Ready documents reside only in browser memory scoped by consultation ID. Local consultation history stores messages and source excerpts, not attachment originals or full parsed documents.
- Vercel function memory/filesystem is not durable storage. A future persistence feature needs an explicit storage design.
