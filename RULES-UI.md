# UI Rules

- Preserve the three-panel chat, existing avatars, profile form, consultation history and tool traces.
- Retain existing green/gray colors and mobile navigation.
- Pending attachments appear above the input with parsing progress/state and a remove action. Sent attachments appear as read-only cards within their user message.
- Sent documents remain available under a collapsible consultation materials list. Removing one stops future use without changing its historical message card.
- Failed sends restore the text and pending files. File-only sends use a default summarization request.
- Support file selection and drag/drop; retain keyboard-visible controls and live status text.
- Parsing or active model requests must block consultation switching to avoid cross-chat results.
- Make parser limits, unsupported OCR and document data flow visible near the composer.
- Verify desktop 1440x1000 and mobile 390x844, including long filenames and source excerpts.
