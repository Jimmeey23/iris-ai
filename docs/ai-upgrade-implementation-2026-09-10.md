# AI Response Quality Upgrade — Implementation Notes

**Date:** 10 September 2026
**Implements:** the recommendation roadmap in `ai-behaviour-audit-2026-09-10.md` (R0 + R1 + R3). Goal: responses that are accurate, context-aware and never static — enough owner-critical information before the first draft, Momence fields used wherever they exist, and conversations personalised to the reporter and the situation.

## What changed, end to end

### 1. No more silent, irrelevant or ambiguous questions
- **Every button click now lands.** Agent-path options carry explicit bindings (`ans:<slotId>|<label>`) or bind to the pending question's slot; each tap is written to the slot in code *and* spoken into the transcript as words (`valueToWords`). A contract test enumerates every option value in the app and asserts it produces words.
- **Owner-critical gates.** Before any draft, the engine forces one focused question each (model's own wording preferred, concrete fallback otherwise) for: **which studio** (routing), **resolved or still happening** (`resolvedNow` — new slot on the ticket draft's details), and **impact**. Each fires at most once — no loops — and outranks the question budget.
- **Personalised greeting.** The static six-button category menu is gone; the greeting addresses the reporter by name and asks for the story in their words.
- **Never re-ask what's known.** `ALREADY KNOWN` now includes category, resolved-state, Momence ids and `[human-set]` provenance markers; two separate asked-lists are unified in spirit via gate/dedupe logic; deterministic-path answers re-enter the transcript as utterances so the agent never loses turns.

### 2. Accuracy: the model proposes, rails dispose — consistently
- **Slot provenance** (`user | context | agent | derived`): values a human set (button, picker, context bar) can never be silently overwritten by the model. Revisions flow through an explicit **`corrections[]`** contract output — the regex `isCorrection` gate is gone.
- **Human-locked classification:** a user-chosen category survives unless the reporter corrects it; machine classification needs ≥ 0.5 confidence to take an unset category, and resolver-corrected classifications are capped at 0.5 confidence. Missing model confidence now defaults **0.4** (was 0.6 — false certainty).
- **One priority pipeline:** `aiEnrich` keeps the model's priority (enforced by the deterministic floor, max'ed with SLA) instead of discarding it; urgency is re-banded against the priority that ships. The floor dictionary is on a diet — only unambiguous safety and hard financial events floor the priority; judgement words ("threatened to cancel", "wants a refund") are the model's call.
- **`raisedFor` is enum-normalised** from free-form model wording onto the four canonical values.

### 3. Context-awareness: memory, embeddings, one clock
- **`time.ts`** — one IST calendar for the whole pipeline. Session lookups and match windows no longer disagree with the agent's clock between 00:00–05:30 IST.
- **Date-aware session matching** — a Momence row only binds when its date agrees with the report; cross-day time matches are refused.
- **Semantic related tickets** — tickets are embedded (`text-embedding-3-small`, stored on the row, cached on write and at import); `findRelatedTickets` ranks by cosine similarity with the lexical fallback as safety net. "aircon fault" now matches "AC not cooling".
- **Studio & member memory** — on approval, a one-line fact (`T-142: AC compressor fault — vendor replaced capacitor`) is remembered per studio/member (`context_facts`), injected into future intake as labelled, possibly-stale context.
- **Conversation compression** — at draft time a fast-tier call summarises the narrative; long sessions keep the whole story via `EARLIER CONVERSATION SUMMARY` plus a token-capped transcript instead of a blind 24-message slice.

### 4. Momence fields used wherever possible
- **Member auto-resolution:** when a member is named, the system runs `search_member` once per session even if the model forgot; the model is instructed to copy the real contact, exact spelling and actual membership product from lookups onto the ticket (`memberContact`, `membershipRef`, `momenceMemberId`).
- **Session auto-matching** is now IST-correct and date-aware, and marks results as `derived`.

### 5. Solid plumbing
- **One LLM client** (`llm.ts`): all seven former direct `api.openai.com` call sites (enrich, humanise, enhance, signals, trainer analysis, refinePrompt) now route through it with retries, timeouts and **per-feature telemetry**; `chatText` added for prose; fast tier used for cosmetic work; dead `refinePrompt` deleted.
- **`ai_calls` telemetry** — every model call records feature/model/ok/error/latency/tokens/session; a **Settings → AI engine → AI telemetry** panel shows per-feature volume, failure rate, avg/p95 latency and token spend, plus draft approval stats. Draft feedback (approved / edited-first) is persisted on session state.
- **Input hardening** — chat bodies capped (4,000 chars), composer context strictly schema'd and enum-validated (category/subcategory/priority), session ids are cryptographically random UUIDs, reporter identity derived server-side from the Supabase session, and 30 turns / 5 min per-IP rate limit on both chat endpoints.
- **Migration `0006_ai_context_and_telemetry`** — `tickets.embedding`, `ai_calls`, `context_facts`.

## Verification
- `tsc --noEmit` clean; `next build` succeeds (with `DATABASE_URL`, as the deploy wrapper supplies; the no-env failure at `/api/auth/me` is pre-existing on `main`).
- `npm test`: **93 passed, 11 skipped** (10 live evals + 1 session-resolution; the live suite gained a prompt-injection case).
- New tests: IST calendar (`time.test.ts`), floor diet + `raisedFor` normalisation, option-vocabulary contract, date-aware `matchSession`, slot provenance.
- ESLint clean on every touched file (remaining repo lint debt is in untouched components).

## Follow-up hardening pass (same day)

- **Timetable pre-fetch before first reasoning.** When a studio is known and the report carries a class signal (class words, formats including "powerCycle"/"BBB" shorthand, or a clock time), the engine pulls the Momence schedule *before* the first model call — a precise query when the class is named, otherwise today's + yesterday's studio timetable. Turn 1 can now resolve the real session, teacher and booking count in a single model call instead of a tool round-trip; the deterministic `matchSession` still validates date + time before any id lands on the ticket.
- **`hasClassSignal` gate** keeps non-class reports (billing, lockers, iPads) from ever paying for a timetable lookup.
- **Gate-answer parsing fixed and contract-tested** via exported `applyOptionAnswer`: sentence labels ("Yes — resolved" / "No — still happening") map correctly; skip-style impact labels never invent a value; `raisedFor` taps normalise to the enum; plain answers bind only to a pending canonical question.
- **Skipped gates get honest defaults** at draft time (impact → single; resolved → "not resolved" only when that question went unanswered) instead of blocking the draft.
- **Injection framing**: the conversation block labels REPORTER lines as verbatim data, never instructions — paired with the `injection-hijack-resisted` eval case.
- **`/api/ai/enhance` rate-limited** (20/5 min per IP) like the chat endpoints.

## Local/sandbox preview

The sandbox has no Supabase project, so `src/lib/dev-auth.ts` adds a **dev-only** fallback: when `NODE_ENV !== "production"` AND `NEXT_PUBLIC_SUPABASE_URL` is unset, middleware skips auth and `getSessionUser()` returns a fixed local admin identity. Production deployments always have both conditions false, so the bypass cannot activate there. With it, the full app runs locally against the embedded Postgres (migration `0006` applied) — add an OpenAI key in Settings → AI engine to switch intake from the honest "reasoning unavailable" state into full agent mode.

## Deliberately unchanged
- The deterministic engine still exists for review/edit mechanics (draft preview, edit menu, undo) — but no longer asks intake questions in agent mode.
- Read-only Momence tool surface unchanged (prior audit H5 scoping still recommended).
- Security items from `application-audit-2026-09-04.md` (C1–C3, H1–H3) remain tracked there.

## Preview send fix (commit 3ad4aa7, 2026-09-10)

The reported "unable to send any messages to Iris" was two stacked issues:

1. **First-message swallow (real bug, fixed).** `runChatTurn` greeted a brand-new
   session and returned — silently dropping the words the reporter had already
   typed in the same payload. The greeting now seeds the transcript only; the
   words are processed as the opening turn (honest degradation applies when the
   AI key is absent).
2. **Preview proxy vs SSE POST (environment, made resilient).** In the hosted
   preview, `POST /api/chat/stream` with `Accept: text/event-stream` can be
   rejected before reaching the route while the identical JSON POST succeeds.
   The client now detects that (stream 4xx before any server event), remembers
   it for the browser session (`sessionStorage["iris:streamBlocked"]`), and
   sends plain JSON from then on. Error details from failed turns are now
   surfaced in the chat bubble instead of a bare generic message.

Support changes: `parseBody` logs every 400 with issue list + truncated body
(server-side diagnosability), and `allowedDevOrigins: ["*.e2b.app"]` unblocks
HMR through the preview proxy in dev.

## Agent upgrade: pattern memory, coverage floor, personality (2026-09-10)

Trained from the 464-report historic export (`data/historic-tickets.json`) — **read-only**;
nothing was imported (the rows are already in the app's own DB).

- **Pattern memory** (`scripts/build-issue-knowledge.mjs` → `issue-knowledge.generated.ts`,
  runtime in `issue-knowledge.ts`): 29 issue families distilled with keywords, typical root
  causes, what worked before, usual owners, studios and priority. Closest matches are
  injected into every agent prompt as bounded, injection-safe "PATTERN MEMORY" context, so
  Iris answers like an insider ("the fourth AC complaint from that studio").
- **Routing**: `suggestOwner` picks the historic owner per category/subcategory; it shows on
  the draft card ("Suggested owner") and — at approval — outranks queue rules in
  `pickAssignee` when it names a real staff member.
- **Coverage floor**: `MIN_AGENT_QUESTIONS = 4` (ladder cap 5). No draft until at least four
  distinct questions have gone out; when the model runs out early, a high-value ladder
  (action taken → when → frequency → membership → witnesses → note for owner) back-fills.
  The reporter can still say "just raise it" to skip ahead. Draft was previously possible
  after one message.
- **Personality**: the persona now mandates the reporter's FIRST NAME in every reply,
  friend-not-bot tone (contractions, situation-specific reactions, no corporate filler),
  and personalises the deterministic nudges and draft lead-in too.

## Inbound email front door (2026-09-10)

Emails now become Iris-triaged, routed tickets — the highest-impact missing feature,
since the company's issue flow lived in inboxes and a human bridged every email into
the system by hand.

- **Provider-agnostic webhook** `POST /api/inbound/email` — parses Postmark inbound
  JSON, SendGrid inbound-parse form posts and plain generic JSON. Protect with
  `INBOUND_EMAIL_SECRET` (bearer or `?key=`; required in production, 401 otherwise).
- **Manual path** — the Inbox page (`/inbox`, new nav entry) lists every inbound email
  and accepts pasted/forwarded emails via `POST /api/inbound`; same pipeline.
- **Triage on arrival** — classify (LLM when a key is configured, on-device Iris NLU
  otherwise, labelled honestly in `ai_engine`) → studio extraction → priority floor →
  enrichment → ticket via the normal routing chain (historic owner hint → department →
  role → studio → load) → assignee notified → SLA clock starts. Missing facts
  ("Which studio · When exactly · What has been tried · Who is affected") are computed
  and recorded on the ticket.
- **Idempotent** — unique message id: webhook redelivery or a re-paste never raises a
  second ticket (verified: redelivery resolves to the same ticket id).
- **Draft reply held for approval** — Iris drafts the reply to the sender (LLM rewrite
  of a deterministic template; template fallback when no key) and stores it on the
  ticket. The ticket page gains an "Email reply — Iris drafted, you approve" panel;
  nothing is ever auto-sent. Sending uses the existing Mailtrap integration and sets
  `first_response_at`; without mail config the button fails with the exact reason.
- **Raw email audit** — every payload is stored on `inbound_emails` (migration 0007)
  with triage status, so a failed triage is retryable, not lost.
