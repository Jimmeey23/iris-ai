# IRIS Ai Application Audit

**Audit date:** 4 September 2026  
**Scope:** Repository architecture, authentication and authorization, ticket lifecycle, AI intake and enrichment, static/fallback behaviour, integrations, data handling, build quality, tests, and operational readiness.  
**Method:** Static code tracing, repository searches, TypeScript validation, ESLint, Vitest, and a production Next.js build executed directly (without the repository's migration wrapper).

## Executive summary

> **Remediation update:** The AI-agent flow was revised after this audit. Silent scripted fallback was removed from normal intake, agent/rules/unavailable mode is now surfaced to the UI, model output uses a schema-guided contract with coherence validation, relative-date context and correction handling were strengthened, confidence is derived from the model classification instead of a fixed value, and the skipped live eval no longer breaks local test collection. The original findings below are retained as the audit baseline.

IRIS Ai has a thoughtful foundation: structured ticket data, deterministic safety guardrails, bounded read-only AI tools, server-side authentication middleware, persistent chat sessions, SLA computation, and a model-driven intake flow with a non-AI fallback. The production application compiles and TypeScript passes.

However, the current implementation should not be treated as fully production-safe. The most serious problems are authorization boundaries: several sensitive mutations rely only on “authenticated” status, and ticket permissions trust actor identity supplied by the browser. Chat sessions also have no owner, allowing a guessed or obtained session ID to expose or mutate another user's transcript. The AI flow silently falls back to a scripted engine, making static behaviour look like successful AI operation. AI calls are fragmented across multiple implementations and model defaults, with little observable evidence of failures, cost, quality, or fallback rate.

### Risk snapshot

| Severity | Count | Theme |
|---|---:|---|
| Critical | 3 | Identity spoofing, privileged Momence mutations, chat-session isolation |
| High | 7 | External-message abuse, webhook trust, duplicate ticket risk, AI degradation, prompt/tool privacy, production seed data, test reliability |
| Medium | 8 | AI consistency, validation, observability, concurrency, lint debt, build/runtime configuration |
| Low | 4 | Dependency/configuration hygiene and maintainability |

## Critical findings

### C1. Ticket authorization trusts browser-supplied identity

**Evidence:** [`src/app/api/tickets/[id]/route.ts`](../src/app/api/tickets/%5Bid%5D/route.ts) accepts `actor` and `actorRole` in the PATCH body, constructs the authorization actor from those fields, and passes it to `assertCanAct`. [`src/lib/permissions.ts`](../src/lib/permissions.ts) grants full access when the actor name equals the assignee or the role matches a leadership override.

**Impact:** Any signed-in user can submit the assignee's name or an override role such as `Ops Manager`, then edit, reassign, comment on, resolve, or close tickets they do not own. Audit events will also record the spoofed name.

**Solution:** Remove `actor` and `actorRole` from the public schema. Call `getSessionUser()` inside the route and construct the actor exclusively from authenticated server-side data (`name`, `jobTitle`, `email`, access role). Return 401 if no session exists. Add negative integration tests proving an executive cannot impersonate an assignee or leadership role.

### C2. Every authenticated user can execute destructive Momence actions

**Evidence:** [`src/app/api/momence/actions/route.ts`](../src/app/api/momence/actions/route.ts) can cancel bookings, check members in/out, add free bookings, waitlist members, freeze/unfreeze memberships, and update credits. It performs input validation but no role or studio-scope authorization.

**Impact:** Any valid account can alter member bookings and paid entitlements across all locations. The default for cancellation also enables refund and member notification, increasing financial and reputational impact.

**Solution:** Introduce an action policy matrix. Require authenticated server-derived identity, least-privilege roles, and location membership. Separate read-only `member-360` from mutations. Require explicit confirmation tokens or idempotency keys for financial/member-state changes, validate allowable credit ranges and freeze dates, and persist an immutable audit log containing authenticated user ID, action, target IDs, before/after state, and provider response.

### C3. Chat sessions have no ownership or access isolation

**Evidence:** [`src/db/schema.ts`](../src/db/schema.ts) stores chat sessions by a client-visible text ID with no `userId`, tenant, or studio owner. [`src/lib/chat-service.ts`](../src/lib/chat-service.ts) loads any row matching the submitted `sessionId`, then updates it and may create a ticket.

**Impact:** An authenticated user who obtains a session ID can read its effective state through subsequent responses, append to the conversation, alter its draft, or approve ticket creation. Stored transcripts can contain member names, contact details, health/safety incidents, and Momence lookup results.

**Solution:** Add `ownerAuthUserId`, optional `studioId`, and version columns. Derive ownership from the authenticated session in the API, query by both session ID and owner ID, and reject mismatches. Use cryptographically random IDs (`crypto.randomUUID()`), add retention/deletion policy, and migrate or expire ownerless sessions.

## High-severity findings

### H1. External messaging and integration actions lack role controls

[`src/app/api/integrations/route.ts`](../src/app/api/integrations/route.ts) permits any authenticated user to send test email/WhatsApp messages, invoke n8n, or dispatch arbitrary ticket events. [`src/app/api/respond/send/route.ts`](../src/app/api/respond/send/route.ts) similarly permits template messages to any submitted recipient. Template synchronization is also unrestricted.

**Impact:** Spam, disclosure of internal template data, unwanted customer contact, workflow triggering, and third-party cost.

**Solution:** Restrict integration configuration/tests and template sync to admins. Restrict real sends to explicit operational roles, validate recipients against an authorized ticket/member context, rate-limit by user and destination, require idempotency keys, and log every outbound attempt.

### H2. Fillout webhook becomes unauthenticated when its secret is missing

[`src/app/api/fillout/route.ts`](../src/app/api/fillout/route.ts) is public in middleware. It validates the secret only when a database setting exists; an unset or temporarily unavailable setting turns the endpoint into an open ingestion API. The generic fallback mapper accepts unknown body shapes and can create trainers/evaluations.

**Impact:** Anonymous database pollution, fraudulent evaluation records, trainer profile manipulation, and notification abuse.

**Solution:** Fail closed in production when the secret is absent. Verify the provider's signed raw-body webhook scheme where available, enforce timestamp/replay protection, apply body-size/rate limits, restrict accepted form IDs, and reject unknown payload shapes instead of using the legacy generic mapper.

### H3. Ticket approval is not idempotent at the server

The UI deliberately avoids streaming approval, but [`src/lib/chat-service.ts`](../src/lib/chat-service.ts) has no atomic “already created” guard before `createTicketBundle()`. Two direct requests, browser retries, or concurrent tabs can both observe review state and create duplicates.

**Solution:** Add a unique idempotency key/session constraint to tickets, then perform approval in a database transaction using a conditional update or row lock. If `createdTicketId` already exists, return the existing result.

### H4. AI failures silently turn the assistant into a scripted questionnaire

[`src/lib/agent-session.ts`](../src/lib/agent-session.ts) falls back to `handleInput()` whenever the model is unavailable or malformed. The response exposes no degradation metadata, and [`src/lib/chat-service.ts`](../src/lib/chat-service.ts) drops the internal `degraded` field. The user therefore sees a valid-looking assistant even when no AI is running.

**Impact:** Operators and administrators cannot distinguish dynamic reasoning from static category/question-bank behaviour. This directly explains reports of repetitive or static responses and masks expired keys, model incompatibility, timeouts, JSON failures, and quota exhaustion.

**Solution:** Return a non-sensitive `mode: "agent" | "rules"` and degradation code in every turn; show a small “Rules fallback” state in the UI and admin telemetry. Define whether fallback is allowed per environment. For production-critical use, consider failing visibly after preserving the draft rather than silently changing capabilities.

### H5. Model instructions and tool results can expose unnecessary member data

The agent tool layer returns member email, phone, visit counts, memberships, bookings, and attendee names into the model context. Tool calls are model-selected and searchable across the Momence account; there is no user/studio authorization filter in [`src/lib/agent-tools.ts`](../src/lib/agent-tools.ts).

**Impact:** Prompt injection or an overly broad model lookup can send unrelated personal data to OpenAI and disclose it in transcripts. Even though tools are read-only, their data scope is excessive.

**Solution:** Enforce server-side tool policy independently of model instructions: require an incident-linked query, scope locations by authenticated user, redact contact fields unless explicitly required, avoid attendee names when counts suffice, cap/validate dates and IDs, and log lookup purpose. Add prompt-injection evals such as requests to enumerate members or ignore tool rules.

### H6. Demo tickets are inserted automatically into an empty production database

[`src/lib/seed.ts`](../src/lib/seed.ts) runs from many pages and API routes. If the studios table is empty, it inserts the full directory and sample tickets without an environment gate.

**Impact:** A fresh or partially restored production database is populated with realistic-looking fictional operational incidents and member names. Reports, AI recurrence context, SLA counts, and management decisions can be contaminated.

**Solution:** Split reference-data bootstrap from demo-data seeding. Run reference migrations explicitly; allow sample tickets only under `NODE_ENV !== "production"` plus an explicit opt-in. Mark fixtures with a `demo` flag and exclude them from analytics.

### H7. The test suite is not hermetic and currently fails

`npm test` produced **70 passing tests, 9 skipped tests, and 1 failed suite**. `src/lib/evals/session-resolution.test.ts` imports `chat-service`, which imports the database eagerly, causing `Error: DATABASE_URL is required` before tests are collected.

**Solution:** Move database access behind injectable repositories or lazy boundaries, mock the session store for evals, and add a test-specific database setup. Make CI require all non-integration tests to collect and pass. Skipped evals should be classified explicitly as credentialed/live tests.

## Medium-severity findings

### M1. AI implementation is fragmented and model defaults disagree

The shared wrapper defaults to `gpt-4.1` / `gpt-4.1-mini`, while several direct-call modules default to `gpt-4o-mini`. Settings UI/page defaults also disagree. Direct fetch implementations exist in enrichment, conversation rewriting, dynamic prompts, signals, ticket enhancement, and trainer analysis.

**Problem:** Retry, timeout, token, parsing, telemetry, and future model compatibility behaviour varies by feature. A setting can appear to select one model while a path uses another fallback.

**Solution:** Route all AI calls through one provider client and one model registry. Store per-capability model selection (`intake`, `enrichment`, `copy`, `analysis`), validate models when settings are saved, and record model/version on every generated artifact.

### M2. Legacy AI enrichment accepts model prose with limited validation

The agent path has normalization and safety rails, but `aiEnrich()` accepts title, summary, root cause, suggested action, emotion, and tags with only light type/value checks. “Probable root cause” invites unsupported diagnosis.

**Solution:** Use Zod schemas for all model outputs, distinguish `observed facts` from `hypothesis`, require evidence references for inferred root cause, sanitize tags, cap every free-text field, and never overwrite the reporter's raw statement.

### M3. No end-to-end AI observability or quality feedback loop

Latency and error codes exist transiently in the wrapper, but there is no durable call log, token/cost accounting, fallback counter, prompt version, tool trace review, or user quality signal.

**Solution:** Add privacy-conscious `ai_runs` telemetry: capability, session/ticket ID, prompt version, model, status/error category, latency, token usage, tool names, fallback mode, and user correction/approval outcome. Do not store API keys or duplicate raw PII.

### M4. Conversation state updates are last-write-wins

Chat state is read, modified in memory, and upserted without version checks. Concurrent turns can overwrite transcript or state. Tool calls and model calls make the race window long.

**Solution:** Add optimistic concurrency (`version` column), reject stale turns with 409, and serialize turns per session. Include a client turn ID for deduplication.

### M5. Request validation permits unbounded text and context

Chat uses unrestricted strings and `z.any()` for composer context; enhancement accepts unbounded text; several endpoints accept broad records.

**Impact:** Excessive model cost, database bloat, slow requests, unexpected serialization, and denial-of-service risk.

**Solution:** Add maximum lengths, bounded arrays/records, strict schemas, request body limits, rate limits, and normalization. Reject unknown keys where practical.

### M6. ESLint quality gate fails

`npm run lint` fails on React purity/static-component/effect rules. Examples include `Date.now()` during render, component definitions created inside render, and synchronous state changes in effects across the dashboard, context bar, Momence picker, providers, reports, signals, templates, and tickets explorer.

**Impact:** Non-deterministic hydration/render output, unnecessary remounts and state loss, cascading renders, and a permanently red CI signal that can hide new defects.

**Solution:** Capture time at a server/request boundary or stable state, move nested components to module scope, derive state during render where possible, and reserve effects for external synchronization. Fix rather than globally disabling the new React rules.

### M7. Production build command performs database migration implicitly

`npm run build` invokes `scripts/migrate-on-deploy.mjs` before `next build`. This couples an otherwise repeatable compile to a live database mutation.

**Impact:** Local/CI builds can unexpectedly change a configured database; parallel deploys may race; build diagnosis becomes dependent on database availability.

**Solution:** Separate `build` and `db:migrate`. Run migrations once in a controlled release step with locking, backups, explicit environment checks, and rollback planning.

### M8. Sensitive application data lacks an explicit retention/redaction policy

Chat transcripts, tickets, ticket details, Momence context, member contact data, trainer reviews, and outbound event content are stored without visible expiry or field-level redaction strategy.

**Solution:** Define data classes and retention windows; minimize copied provider data; redact exports/logs; add deletion workflows; encrypt backups; and verify database/RLS access independently of Next middleware.

## Low-severity and operational findings

### L1. Next.js resolves the wrong workspace root

The build detected multiple lockfiles and selected `/Users/jimmeeygondaa/package-lock.json` rather than this repository's lockfile. Configure `turbopack.root` or remove the unintended parent lockfile if safe.

### L2. Middleware convention is deprecated

Next.js 16 warns that `middleware.ts` should migrate to the `proxy` convention. Plan the migration before a future framework upgrade makes it blocking.

### L3. Runtime is behind Supabase's upcoming support floor

The build reports Node.js 20 deprecation from `@supabase/supabase-js`. Standardize CI/deploy/local development on Node.js 22 LTS and declare it in `package.json`/version tooling.

### L4. Vitest configuration has a forward-compatibility warning

Vite reports ESM syntax loaded as CommonJS under the native config loader. Add `"type": "module"` only after checking script compatibility, or rename/configure the Vitest file as recommended.

## AI flow assessment

### Current flow

1. UI starts a persisted session and sends reporter identity from client context.
2. Server checks only whether an OpenAI-looking key exists (`sk-` prefix).
3. If available, the model classifies, extracts fields, asks one question, may request Momence lookups, and produces ticket insight.
4. Deterministic guardrails normalize taxonomy and enforce priority/SLA floors.
5. If the model fails or returns malformed data, the legacy rule engine continues silently.
6. Approval builds and persists a ticket; secondary issues may produce child tickets.

### What is working well

- Model-selected tools are read-only and capped per round.
- The model is told to minimize questions and preserve the reporter's words.
- Taxonomy normalization, priority floors, and SLA calculation remain deterministic.
- The same saved insight is reused from review to creation, reducing draft drift.
- Streaming approval is intentionally disabled to reduce duplicate side effects.
- Existing tests cover guardrails, validation, session matching, permissions logic, and model helpers.

### Primary AI discrepancies

- “AI available” means only that a stored value starts with `sk-`; it does not verify provider reachability, model access, quota, or JSON compatibility.
- Silent fallback makes rules-based and AI-generated turns indistinguishable.
- The agent output contract says `readyForDraft`, but server readiness ultimately depends mainly on raw text and studio; owner-critical facts stated in the prompt are not enforced deterministically.
- Tool results include more PII than most decisions require.
- Similar-ticket grounding contains only ticket title/status/date, so the agent cannot reliably establish a shared root cause while being encouraged to mention recurrence.
- Fixed confidence values (`92` in agent insight and default `90` in legacy enrichment) are not calibrated probabilities and can falsely imply measurement precision.
- There is no production evaluation set covering Indian names, shorthand, code-switching, negation, corrections, multiple incidents, prompt injection, ambiguous sessions, or privacy boundaries.

## Recommended remediation plan

### Phase 0 — immediate containment (1–2 days)

1. Replace client-supplied ticket actor identity with `getSessionUser()`.
2. Disable or admin-gate Momence mutations and integration sends until the policy matrix is implemented.
3. Fail closed for Fillout webhook authentication in production.
4. Add chat-session ownership and deny ownerless cross-user access.
5. Gate demo ticket seeding outside production.

### Phase 1 — correctness and reliability (3–5 days)

1. Add server idempotency and transactional approval.
2. Add strict size limits and schemas to chat, AI, integration, and mutation inputs.
3. Make fallback mode visible and persist degradation telemetry.
4. Fix the eval database import and make tests/lint required CI checks.
5. Resolve React lint violations and pin Node.js 22.

### Phase 2 — AI consolidation and quality (1–2 weeks)

1. Consolidate all model calls behind `src/lib/llm.ts` or a replacement provider service.
2. Version prompts and validate every response with Zod.
3. Add `ai_runs`, costs/token metrics, fallback dashboards, and correction tracking.
4. Enforce server-side tool authorization, minimization, and redaction.
5. Build a versioned eval corpus and release threshold by category, extraction accuracy, question count, session-match precision, hallucination rate, and safety escalation recall.

### Phase 3 — operations and governance

1. Separate migrations, reference bootstrap, and demo fixtures.
2. Add database-level authorization/RLS or a fully documented service-layer equivalent.
3. Establish PII retention, export, and deletion policies.
4. Add integration audit logs, rate limits, replay protection, and alerting.
5. Run authenticated browser tests for each role and studio scope against a staging database/provider sandbox.

## Success metrics

| Area | Metric | Suggested target |
|---|---|---:|
| Security | Unauthorized mutation tests | 100% denied |
| AI availability | Turns using silent fallback | 0% (all visible/telemetried) |
| AI quality | Correct category/subcategory | ≥95% / ≥90% on approved eval set |
| Extraction | Critical facts captured without invention | ≥95% precision |
| Efficiency | Median follow-up questions | ≤2 |
| Tool accuracy | Momence session attachment precision | ≥99% |
| Reliability | Duplicate tickets per approved session | 0 |
| Quality gates | Typecheck, lint, unit/eval tests | 100% passing |
| Operations | Outbound actions with authenticated audit record | 100% |

## Verification record

- `npm run typecheck`: **passed**.
- `./node_modules/.bin/next build`: **passed**; direct build used to avoid triggering the repository's migration wrapper.
- `npm test`: **failed** with one suite import error (`DATABASE_URL is required`); 70 tests passed and 9 were skipped.
- `npm run lint`: **failed** with React correctness/performance violations and one font-loading warning.
- Secret-pattern scan of tracked/source files: no committed `.env`, private key, or obvious OpenAI key pattern was identified. Secret values were not read or included in this report.
- Browser/deployed-environment behaviour, real provider calls, Supabase RLS, and live role enforcement were **not** proven by this repository-only audit.

## Final assessment

The product is feature-rich and its AI architecture has good safety instincts, but access control must be repaired before expanding usage. The highest-value AI improvement is not a larger prompt: it is making model operation observable, consolidating inconsistent call paths, minimizing tool data, and evaluating the actual intake outcomes. Once the critical authorization and session-isolation issues are closed, the existing deterministic rails provide a strong base for a reliable production assistant.
