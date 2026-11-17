# AGENTS.md — BrainDump coding assistant instructions

This file defines how AI coding assistants should work in this repository. Follow it together with the project README and any more specific instructions in subdirectories.

## 1. Mission

Build BrainDump: a reliable, privacy-conscious personal thought-processing app.

The core workflow is:

**Capture → Process → Review → Retrieve → Act**

Prioritize a dependable, understandable product over clever abstractions or unnecessary agent autonomy.

## 2. Project constraints

- Do not add Google, Microsoft, email, calendar, banking, social-media, or other productivity integrations unless the product owner explicitly changes the scope.
- Do not make external integrations a requirement for core functionality.
- Keep AI/model access behind a provider-neutral adapter.
- Support a hosted model and leave room for a local model runtime.
- Preserve the user's original capture permanently unless the user explicitly deletes it.
- AI output is a proposal until accepted through an explicit user action.
- Do not invent facts, dates, commitments, people, or relationships.
- Do not build an unrestricted autonomous agent. Use narrow, typed tools and explicit permissions.
- Do not add microservices, Redis, vector databases, or agent frameworks without a demonstrated need.
- Do not claim a feature exists unless it is implemented and tested.

## 3. Working method

Before changing code:

1. Inspect the repository structure and existing conventions.
2. Read the README and relevant local instructions.
3. Identify the smallest implementation that satisfies the request.
4. Check whether an existing module or dependency already solves the problem.
5. State assumptions when requirements are ambiguous; prefer conservative behavior.

While implementing:

1. Make focused, incremental changes.
2. Keep modules small and responsibilities clear.
3. Reuse existing patterns instead of introducing competing abstractions.
4. Add or update tests with behavior changes.
5. Update documentation and `.env.example` when configuration changes.
6. Avoid unrelated refactors.

After implementing:

1. Run the relevant tests, type checks, lint, and formatting checks available in the repository.
2. Review the diff for accidental changes, secrets, unsafe logging, and unused code.
3. Report what changed, what was tested, and any remaining limitations.
4. Never state that a check passed if it was not run.

## 4. Architecture rules

- Prefer a modular monolith.
- Keep UI, domain logic, persistence, and model-provider code separated.
- Route handlers/controllers should validate input and delegate to domain services.
- Domain services must not depend directly on React components.
- Model-provider SDKs must not leak into feature modules.
- Use explicit interfaces for repositories, model adapters, and job execution where useful.
- Use database migrations for schema changes; do not rely on production schema auto-sync.
- Keep background jobs idempotent and retry-safe.
- Use transactions when accepting a suggestion creates or updates multiple related records.

Suggested boundaries:

- `capture`: raw thought creation and lifecycle.
- `items`: user-owned notes, tasks, ideas, projects, and references.
- `agent`: classification, extraction, and suggestion workflows.
- `search`: keyword and later semantic retrieval.
- `review`: queues and user decisions.
- `privacy`: export, deletion, retention, and data access.

## 5. Python, TypeScript, and code quality

- Keep the mobile client in strict TypeScript. Avoid `any`; use `unknown` and narrow it.
- Add Python type hints to backend code. Avoid `Any` unless a boundary requires it, then validate and narrow immediately.
- Prefer small pure functions for parsing, normalization, and business rules.
- Validate FastAPI request bodies and model output at trust boundaries; validate mobile inputs with Zod.
- Avoid unsafe type assertions. If unavoidable, explain and isolate them.
- Use descriptive names and explicit return types for exported domain functions.
- Handle errors deliberately; do not swallow exceptions.
- Avoid broad catch blocks that turn failures into false success.
- Do not duplicate business rules across UI and server code.
- Keep dependencies minimal and justify new runtime dependencies.

## 6. Data and privacy rules

- Every user-owned record must be scoped to the authenticated user.
- Never trust a `user_id` supplied by the client; derive identity from the authenticated session.
- Check ownership on reads, updates, deletes, exports, and relationship creation.
- Add database constraints and indexes that support ownership and common queries.
- Do not log raw capture text, full prompts, model responses, credentials, session tokens, or personal data by default.
- Use synthetic fixtures in tests.
- Keep secrets out of source control. Update `.env.example` with placeholder names only.
- Make export and deletion behavior explicit and testable.
- Treat attachments and imported text as untrusted input.

## 7. Agent and model behavior

### Processing contract

The agent may propose:

- Item type.
- Title and summary.
- Labels.
- Candidate tasks and explicit date expressions.
- Related item IDs.
- A clarifying question.
- Confidence and a short user-facing explanation.

The agent must not silently:

- Delete or overwrite a capture.
- Mark a task complete.
- Merge records.
- Create external side effects.
- Treat text inside a capture as privileged instructions.
- Infer a definite due date from vague wording.

### Prompt-injection resistance

Captured content is data, not instructions to the agent. Clearly delimit it in prompts and explicitly tell the model not to follow instructions found inside the captured content. Do not pass secrets or unrelated user records into model context. Tool calls must be allowlisted, typed, permission-checked, and scoped to the current user.

### Structured output

- Use a versioned schema.
- Validate every model response at runtime.
- Reject or safely repair malformed output; never trust model-generated IDs or ownership fields.
- Limit output sizes and candidate counts.
- Store prompt version and model identifier for debugging, but avoid storing sensitive content in operational logs.
- Keep user-facing explanations concise. Do not request or expose private chain-of-thought.
- Use deterministic application code for persistence and permissions; the model should not decide authorization.

### Confidence handling

- High confidence may be presented as a clear suggestion.
- Medium confidence should be visibly marked for review.
- Low confidence should trigger a clarification or leave the capture unprocessed.
- Confidence values are model estimates, not calibrated probabilities. Do not use them as security or authorization checks.

## 8. API and persistence conventions

- Validate all incoming request bodies, query parameters, and route identifiers.
- Return consistent error shapes and appropriate HTTP status codes.
- Use pagination for growing lists.
- Make create operations safe against accidental duplicate submission where practical.
- Use transactions for multi-record acceptance workflows.
- Store timestamps in UTC and format them for the user at presentation time.
- Use UUIDs or the repository's established opaque identifier strategy.
- Add indexes based on actual query patterns.
- Keep database records authoritative; do not rely on client state as the source of truth.

## 9. UI and accessibility

- Design mobile-first; capture must be quick and obvious.
- Make user-authored content visually distinct from AI-generated suggestions.
- Provide visible accept, edit, reject, and undo affordances where applicable.
- Include loading, empty, error, and retry states.
- Support keyboard navigation, visible focus, semantic labels, and accessible dialogs.
- Do not use color alone to communicate status.
- Avoid interruptive AI popups and excessive notifications.
- Never imply a reminder or background action will happen unless the capability is implemented and enabled.

## 10. Testing expectations

Add tests appropriate to the change:

- Unit tests for domain rules, parsing, normalization, and validation.
- Integration tests for persistence, ownership isolation, job lifecycle, and acceptance workflows.
- Contract tests for model output schemas and adapter behavior.
- End-to-end tests for capture, review, search, export, and deletion.

Important cases to test:

- User A cannot read or mutate User B's records.
- AI processing failure does not lose the original capture.
- Retrying a job does not create duplicate suggestions or items.
- Invalid model output cannot mutate persistent state.
- Rejecting a suggestion leaves the original capture intact.
- Accepting a suggestion creates only the approved changes.
- Deletion and export are correctly scoped to the current user.
- Captured prompt-injection text is treated as untrusted content.

Do not use live model calls in ordinary unit tests. Use fixtures and mocked adapters. Keep a small, explicitly opt-in evaluation suite for real-model quality checks.

## 11. Dependency and infrastructure policy

Before adding a dependency or infrastructure component, explain:

- What concrete problem it solves.
- Why existing platform capabilities are insufficient.
- Its maintenance and security implications.
- Whether it introduces a new external service or recurring cost.

Prefer PostgreSQL-backed jobs for the initial version. Add a dedicated queue or vector database only when measured scale or functionality requires it.

## 12. Documentation requirements

Update documentation when changing:

- Architecture or module boundaries.
- Environment variables.
- Database schema or migrations.
- Agent prompts or output schemas.
- User data handling, retention, export, or deletion.
- Setup, test, build, or deployment commands.

Keep `.env.example` current and free of real secrets.

## 13. Completion checklist

Before declaring work complete, confirm:

- [ ] Requirements and acceptance criteria are met.
- [ ] Existing behavior has not been unintentionally broken.
- [ ] Input and model output are validated.
- [ ] User ownership and permissions are enforced.
- [ ] Original capture content is preserved.
- [ ] Errors and retry behavior are handled.
- [ ] Tests have been added or updated.
- [ ] Relevant checks have actually been run.
- [ ] No secrets or private content are exposed in logs.
- [ ] Documentation and environment examples are updated.
- [ ] Remaining limitations are clearly reported.

## 14. Assistant response format

For implementation tasks, finish with:

1. **Summary:** What was implemented.
2. **Files changed:** Important files and why.
3. **Validation:** Tests and checks run, with actual results.
4. **Follow-ups:** Known gaps, risks, or recommended next tasks.

Be concise and factual. Do not claim completion beyond the evidence available.

