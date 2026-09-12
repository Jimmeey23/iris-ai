# Iris AI — Full Application, Agent & Ticketing Audit

**Audit date:** 12 September 2026
**Baseline:** `main` @ `5ceb692` (checked out as `arena/01a09424-iris-ai`)
**Scope:** the whole app — AI intake pipeline (agent, controller, tools, prompt), conversation flow, data capture, ticket assembly, ticketing lifecycle, security/authorization, performance, and code health.
**Method:** full static trace, plus **runtime probes run against the real controller with a mocked model** so that the application's own behaviour is isolated from the model's. Where a probe was used, its output is quoted. Also ran `tsc --noEmit`, `eslint .`, `vitest run`, and cross-checked the three earlier audits (`docs/application-audit-2026-09-04.md`, `ai-behaviour-audit-2026-09-10.md`, `iris-conversation-audit-2026-09-11.md`) to mark what is fixed, what is still open, and what is new.

---

## 0. Verdict in one page

The model is **not** the main reason Iris feels static. Four layers of the application are:

| # | Layer | What it does to the conversation |
|---|---|---|
| 1 | **The controller overrules the model** | The model decides to file; the controller decides to ask instead. There are **nine** places after the model's turn that can replace, invent or delete the question, and only the model's is "intelligent" (`agent-session.ts:1240–1560`). |
| 2 | **The fallback questions and all draft-phase copy are hard-coded** | "What exactly is it doing — is it dead, cutting out, distorted…?" is asked of a stolen bag. The draft review is the *same sentence* for every ticket ever raised. |
| 3 | **Part of the UI's button vocabulary is unreadable by the agent** | "Change something" → *When it happened* → *Just now* is a **silent no-op**, and the edit flow has already deleted the old value. Proven below (§A4). |
| 4 | **The turn's context is lossy, polluted and re-sent up to 18 times** | 24-message / 2,600-token transcript slice, summaries only generated at draft time, a 5.2k-token rulebook attached to every call, and up to 6 sequential model calls per `runAgent`, up to 3 `runAgent`s per turn. |

Symptoms this produces, in the user's words → mechanism:

| What the reporter experiences | What the code does |
|---|---|
| "It ignores the button I pressed" | §A4 — legacy option values fall through `absorbInput` to an empty utterance |
| "It asks me something I just told it" | §A1, §A2 — gate questions check slot *presence*, not what the narrative says; `custom:first_noticed` fires even when "today" is in the text |
| "Every ticket gets the same wording" | §A3 — `reviewMessage`, `editMenu`, greeting, gate asks, `ack`, `progressNote` are all literal strings |
| "It forgets what we discussed" | §A5 — last 24 messages / 2,600 tokens; nothing summarised until the draft |
| "It starts answering, then erases and rewrites itself" | §A7 — `onReplyRestart` fires every time a lookup triggers another model pass |
| "It's slow" | §A7, §D — 5–18 sequential OpenAI round-trips per message, each with a ~5.2k-token prompt |
| "It feels random" | §A8, §A10 — `temperature 0.25`, `strict:false` schema, and injected context (related tickets / memory / tool results) that changes shape between identical turns |
| "I corrected it and it didn't stick" | §B1, §B2, §A11 — swallowed clicks, and post-creation typing is a dead end |

**Top findings, ranked**

| # | Finding | Severity |
|---|---|---|
| A1 | The controller can override a model decision to file, and gates ask canned questions regardless of content | **High (quality)** |
| A2 | "Thin report" ladder asks device-symptom questions about non-device reports | **High (quality)** |
| A3 | Every draft-stage and review-stage sentence is a hard-coded template | **High (quality)** |
| A4 | 8 option values are silently swallowed on the agent path; the edit flow deletes the old value first | **High (functional)** |
| A7 | Up to 18 sequential model calls per user message; streamed reply is discarded mid-turn | **High (cost/latency)** |
| A5/A6 | Lossy transcript window; `rawText` accumulates button chatter into the ticket description | **High (quality)** |
| A11 | After the ticket is raised, every correction or follow-up is refused | **High (functional)** |
| B3 | Ticket description is a transcript paste, including "Skip that one." | **High (data)** |
| B6 | Ticket creation has no server-side idempotency; chat sessions have no versioning or owner | **High (data)** |
| C1 | `PATCH /api/tickets/[id]` still trusts browser-supplied `actor`/`actorRole` | **Critical (security)** |
| C2 | Momence mutations still have no role check | **Critical (security)** |
| D1 | `/tickets` loads 2,000 full rows **including 1536-float embeddings** into the page payload | **High (performance)** |

---

## Part A — Why the AI responses feel static, context-unaware and random

### A1. The controller overrules the model, and the model can tell it was overruled

`runAgent` (`agent.ts:583`) is genuinely well-built: a real tool loop, one terminal tool per turn, coherent-turn validation. The problem is what happens to its answer afterwards.

`runAgentTurn` (`agent-session.ts:1216–1560`) applies, **in order**, after the model has landed its turn:

1. drop the question if its slot is already known (`:1257`)
2. drop it if it looks like a resolution question and `resolvedNow` is set (`:1260`)
3. **studio / resolvedNow / impact gates** — replace a `nextQuestion=null` with a canned question, in that order (`:1334–1351`)
4. **planned-window gate** (`:1352`)
5. **sessions / attendees picker gates** (`:1378–1390`, `:1392–1410`)
6. **impact-confirmation gate** when `impact` was model-inferred as `many|safety` (`:1416–1442`)
7. **thin-report ladder** — four canned questions (`:1463`)
8. questions already asked → deleted (`:1524`)
9. "draft it now" → deleted (`:1532`)

A model that read the whole conversation and concluded "file it" can still be answered with a canned question from a list. **Probe (real controller, mocked model that filled `location`, `systemAffected`, `impact`, `resolvedNow`, `actionTaken`, `frequency`, `occurredAt` and returned `readyForDraft=true`):**

```
report: "The AC in Studio 1 wasn't cooling during the 7am class today."
model:  readyForDraft = true, 9 slots filled
actual: step = agent_q, asked = ["impact"]
question: "I've read this as Several members affected — how many members were actually affected?"
```

The rule that fires here is defensible in isolation (§A2 explains why it exists), but the sequence means **the app, not the model, chooses the last thing the reporter hears** in most conversations — and the app's chooser only reads slot booleans, never the sentence the reporter actually wrote.

### A2. The fallback questions do not read the report — this is the "not listening" feeling

`thinReport` (`agent-session.ts:1461`) is `narrative.length < 180 && detailCarried < 2`. Any report under 180 characters that hasn't accumulated two of `actionTaken / occurredAt / frequency / witnesses / classInfo / notes / affectedMembers` gets the first unasked item from a fixed ladder (`:1465–1530`):

- `custom:symptom` — *"What exactly is it doing — is it dead, cutting out, distorted, or something else?"* with device options
- `custom:first_noticed` — *"When was this first noticed?"*
- `custom:recurring`
- `custom:affected`

The ladder is gated on `DETAIL_CATEGORIES`, which includes **Safety and Security** and **Class Experience**. So:

| Report | What Iris asked (probe output) |
|---|---|
| "The mic in Studio 2 doesn't work." — model filled location, system, impact, resolution, and returned `readyForDraft=true` | `custom:symptom` — *"What exactly is it doing — is it dead, cutting out, distorted, or something else?"* — a device checkbox list for a sentence that already says it's dead |
| "A member's bag was stolen from the locker room around 6pm." (a theft — nothing is broken) | nothing: filed straight to the draft review (`step=review`, `asked=[]`), because the report was long enough to clear the thin gate and the model's own question was accepted |
| "The AC in Studio 1 wasn't cooling during the 7am class **today**." | the studio gate, then `impact`; `occurredAt` is only "known" if the model happened to write the slot, so the same fact can be asked again |
| "The new 6pm Mat 57 with Neha was brilliant, members loved it." | *"How wide is the impact — safety risk, several members, one member, or a suggestion?"* — because `missingRequired` (`guardrails.ts:150`) demands `impact` for **every** report, compliments included |

That last one is the clearest illustration: `missingRequired` treats a compliment, a suggestion and a live power outage as the same shape. The gate ordering then makes the first thing a member-praise report hears a severity question.

### A3. Everything the user reads at the draft stage is a literal string

| Surface | Code | Text |
|---|---|---|
| Session greeting | `chat-engine.ts:759` | *"Good morning, X — Iris here. 👋 Tell me what happened in your own words…"* |
| Draft review | `chat-engine.ts:689` | *"Here's your draft, X — my full read on it. Give it a look, and approve when you're happy and I'll route it straight to the right owner."* |
| Edit menu | `chat-engine.ts:706` | *"What would you like to change?"* + a fixed button list |
| Post-edit | `chat-engine.ts:1362` | *"Updated."* + the same draft review sentence |
| Gate questions | `agent-session.ts:1345` | three fixed strings (`GATE_ASK`) |
| Deterministic acks | `conversation.ts` | `ack`, `WHY`, `coachTip`, `progressNote`, `NUDGES` |

So even in "agent mode", the model's prose is a caption above a template. Every ticket review in the product is the same paragraph — which is exactly what "the AI feels static" means from the inside of the UI. The model has no chance to say *"I've filed this as a maintenance issue at Kemps Corner and flagged the two FIT clients — the one thing I couldn't confirm is whether the power is back."*

### A4. Eight button values are silently swallowed — and one flow deletes data first (proven)

`ChatAssistant` sends only `value` on a click (`ChatAssistant.tsx:812`); the `label` is used only for the optimistic echo. On the agent path, `absorbInput` (`agent-session.ts:183–330`) understands `ans:`, `sessions:`, `members:`, `resolvedNow:`, `studio:`, `member:`, `session:`, `trainer:`, `membership:`/`mem:`, `skip`, `browse`, `cat:`, `sub:` — everything else falls through to `return { utterance: text }` with `text === ""`.

The edit-menu question renderers (`chat-engine.ts:495–560`, `dynamic-chat.ts:71–108`) still emit the **legacy** vocabulary. Probe output, real controller:

| Click sent | `agentUtterance` | Slot stored | `valueToWords` (the *deterministic* path handles it) |
|---|---|---|---|
| `for:On behalf of a member` | `""` | none | "Raised for: On behalf of a member." |
| `class:Barre 57` | `""` | none | "The class was Barre 57." |
| `loc:Locker room` | `""` | none | "It happened in the Locker room." |
| `sys:POS / card machine` | `""` | none | "The system affected is POS / card machine." |
| `when:Just now` | `""` | none | "It happened just now." |
| `impact:safety` | `""` | none | "Impact: safety." |
| `risk:yes` | `""` | none | "Someone is at risk right now." |
| `freq:First time` | `""` | none | "Frequency: First time." |

Worse: `handleInput`'s edit branch **clears the field before asking** (`chat-engine.ts:1275–1302`, `clear[field]()`), then sets `editingField` and re-asks. So *Change something → When it happened → Just now* deletes `occurredAt`, stores nothing, and hands the model an unchanged transcript. The reporter watches the assistant appear to ignore them, and the ticket loses the date.

The contract test that was meant to catch this (`agent-session.test.ts:117–150`) only asserts that `valueToWords` handles the legacy values — that function belongs to the *deterministic* path, which is no longer the path those clicks take.

### A5. The conversation the model reads is lossy, and the summary arrives too late

`renderTranscript` (`agent.ts:294–312`) keeps the last **24 messages**, then trims to ~**2,600 tokens**, with a floor of 6 lines. `contextSummary` is only produced in the draft branch (`agent-session.ts:1636`), by `generateSummary` (`agent.ts:765`), i.e. *after* the conversation needed it. In a long intake — the outage report in the eval suite is ~700 characters with 8+ turns — the model re-derives context from a window that no longer contains the opening report, while `known` shows slots without the quotes they came from. That is the mechanism behind "it forgot what I said."

### A6. `rawText` is a transcript paste, and it drives classification, retrieval *and* the ticket body

`rawText` accumulates **every** user utterance, including button semantics (`agent-session.ts:1097–1099`). It is then used as:

- the classification text (`resolveClassification`),
- the related-ticket query (`agent-session.ts:942`),
- the insight text (`insightFromAgent`),
- the ticket description (`chat-engine.ts:583`).

Probe of the resulting draft description:

```
The AC was out this morning. Skip that one. Let me pick the category myself.
The classes affected were 10am BBB. It is resolved / fixed now.
The studio is Kwality House, Kemps Corner, Mumbai.

Action already taken: Placed a portable cooler
```

An owner reading that ticket sees a chat log. It also degrades everything downstream: embedding the report for related-ticket search embeds "Skip that one."

### A7. One user message can trigger up to 18 sequential model calls, and the reply is thrown away mid-turn

Per turn (`agent-session.ts:1004–1204`):
1. `runAgent` — up to `MAX_AGENT_STEPS = 6` calls (`agent.ts:583`), each re-sending the full ~5.2k-token system prompt, the transcript, tool schemas and every prior tool result;
2. member lookup → `hooks.onReplyRestart()` → **another** `runAgent` (up to 6 more);
3. session lookup → `hooks.onReplyRestart()` → **another** `runAgent` (up to 6 more);
4. `generateSummary` (fast tier) on the draft turn;
5. `embed()` twice in `findRelatedTickets` (`recurrence.ts:66–82`) plus `embed()` again for the new ticket on creation;
6. `aiEnrich` on legacy review paths.

Each restart wipes the reply the reporter is already reading (the client defers the clear, `ChatAssistant.tsx:477`, but the text still visibly changes). Latency budgets confirm the scale of the API calls: `timeoutMs: 60000` per call (`agent.ts:689`), `MAX_TRANSCRIPT_TOKENS = 2600`, `maxTokens: 2200`. There is no `prompt_cache_key`, so nothing is cached between the 1st and 18th call.

### A8. The prompt is a 5,200-token rulebook with no worked examples

`SYSTEM_PROMPT` (`agent.ts:169–290`) is **20,946 characters ≈ 5.2k tokens**, of which the large majority is prohibition and process ("NEVER…", "Do not…", "Always…"). It defines *rules* but almost no **voice** — no few-shot examples of what a good Iris turn looks like, no examples of a good ticket title/summary pair, no example of a graceful refusal. Combined with `temperature: 0.25` (`agent.ts:687`), tool definitions that are not declared `strict` (`llm.ts:457–460`) and a JSON path with `strict:false` (`llm.ts:60`) — plus a contract that must be satisfied in one shot, the model reliably converges on the safest, flattest sentence that satisfies the most constraints. That reads as static.

Also note the **same instruction is repeated in three places** (system prompt, tool descriptions, `user` block), with slight differences — e.g. the model is told "you may add up to two SHORT extras in `alsoAsk`" in the prompt but the schema key is `followUps` in the type (`agent.ts:89`); a mismatch like that costs instruction-following.

### A9. There is no model of "what has been answered"

State tracks `agentAsked: string[]` — a list of *question ids* — and `agentAskLog`. It does **not** track, per information need, whether the answer was answered / partial / unknown / declined / contradictory, nor which message satisfied it. Consequences already visible in code:

- a re-ask of the *same* id is deleted even when the first answer was partial (`agent-session.ts:1524`),
- an unanswered question is flattened into one concatenated `extraDetails["Still to confirm"]` string,
- there is no way for the model to see "you asked about X, they said 'not sure'", so it cannot adapt.

### A10. Several inputs change shape between identical turns

- `findRelatedTickets` searches a 60-day window of up to 150 tickets, filtered at `overlap >= 0.34` — so the "SIMILAR RECENT TICKETS" block silently appears, changes and disappears between turns of the same conversation.
- `historicPatterns` (`issueKnowledgeBlock`) is keyed on the *current* narrative, which is `rawText` — i.e. on button chatter as well.
- `secondaryIssues` is replaced wholesale whenever a turn returns a non-empty list (`agent-session.ts:1213`), so a later single-issue turn erases earlier ones.
- `suggestions` is overwritten with the latest classification each turn, so the "alternates" the reporter was shown can change under them.

### A11. Once the ticket is raised, every further message is a dead end (proven)

`DETERMINISTIC_STEPS = new Set(["review", "edit_menu", "created"])` (`agent-session.ts:48`) means **all** input at step `created` bypasses the model. `handleInput` answers with a canned line (`chat-engine.ts:1321–1327`):

```
input: "Actually the studio was Bandra, not Kemps Corner."   (step = created)
reply: "This ticket is already raised. Start a new one below."
studio in state afterwards: unchanged ("Kemps Corner")
```

So a correction after approval is impossible in chat, and a follow-up fact ("also, the same thing happened at Bandra") has nowhere to go. This is the opposite of good ticketing: the most valuable message a reporter can send — a correction to an already-filed ticket — is the one the app refuses.

### A12. Nothing measures response quality, so nothing improves

`recordAiCall` (`telemetry.ts`) stores feature, model, ok, latency, tokens, session — no prompt version, no turn id, no question text, no user reaction. There is no thumbs-up/down on a reply, no "was this question useful", no CI workflow (`.github/` does not exist), and the 10 live evals are skipped without a key. The pipeline cannot tell that the thin-report ladder is firing 40% of the time.

---

## Part B — Data capture and ticketing defects

### B1. Corrections are structurally weaker than answers
`applySlots` is careful (provenance, human locks, correction overrides — `agent-session.ts:428–550`), but the *only* deterministic way a reporter can change a field is the edit menu, and that path is the broken one (§A4) — while the natural-language path depends entirely on the model emitting `corrections[]`. So the primary correction surface (`edit_menu` → `edit:*`) deletes the field it is editing and then ignores the answer.

### B2. Corrections outside the taxonomy are dropped
`resolveStudio` must match a studio in the list; a model correction to a studio that doesn't exist, or a time correction that `resolveWhenToDate` can't parse, silently does nothing. There is no "applied / could not apply" report back to the model or the user.

### B3. The ticket description is a paste, not an account
See §A6. `buildDraft` (`chat-engine.ts:583–600`) writes `rawText` verbatim as the first paragraph. Button semantics, greetings that slipped through, and skipped-question chatter all land in the ticket an owner reads.

### B4. Filler defaults that look like facts
`"Not studio specific"` is written when studio is unknown (`agent-session.ts:1572–1574`), `affectedMembers: "None specifically identified"` when the reporter says nobody specific (`agent-session.ts:232`). These are strings that read like answers in reports and filters. Unknown should be `null` with the question carried in `extraDetails["Still to confirm"]` (which the code already does elsewhere — the two mechanisms just disagree).

### B5. `missingRequired` is the wrong shape for non-faults
It requires `rawText`, `studio`, `impact`, `resolvedNow` for everything (`guardrails.ts:150`). Compliments, suggestions and questions ("can we add a 7am class?") get severity questions. Requirements should be category-shaped.

### B6. Ticket creation is not idempotent, and session writes are unversioned
`chat-service.ts` does read-modify-write on `chat_sessions` with a single upsert and no revision check and no owner column (`schema.ts:215`). Two tabs, a retried request or a double "approve" can both observe `step=review` and both call `createTicketBundle` (`tickets.ts:502`). There is no unique key tying a ticket to a session/turn. The prior audit flagged this (H3, C3); it is unchanged.

### B7. Secondary issues are lossy
`secondaryIssues` is replaced whenever non-empty (§A10) and capped at 4 children, with no de-duplication against existing tickets — a report that mentions the same AC fault twice creates two children.

### B8. Post-creation lifecycle gaps
Nothing links a *new* report to the ticket it duplicates beyond `linkedTicketIds` written at creation. There is no "merge/duplicate" action, no reopen, no reclassify after creation, and no way to append a correction — so stale or duplicated tickets accumulate. `findSimilarTickets` runs on the detail endpoint, but its output cannot be acted on.

### B9. SLA cron is per-ticket sequential
`cron/sla-check` loops open tickets and issues one `SELECT` per ticket before notifying (`route.ts:26–60`). At a few hundred open tickets this is hundreds of round-trips; it is easy to batch with one left-join query.

### B10. Free-text fields have no length discipline at capture time
`ComposerContext` values are capped (good), but slot values that come from the model are not truncated before hitting `details`. Long `rawText` from a pasted report ends up verbatim in the description.

---

## Part C — Security and authorization (still open from the 4 Sept audit)

| ID | Status | Evidence | Risk |
|---|---|---|---|
| **C1** | **Open** | `api/tickets/[id]/route.ts:25,43,48,64` — `actor`/`actorRole` accepted from the request body and used for `assertCanAct`, audit actor name and comment authorship | Any signed-in user can impersonate an assignee or an override role and edit/resolve/close any ticket; the audit trail records the spoofed name |
| **C2** | **Open** | `api/momence/actions/route.ts` — cancel booking, check-in, add free booking, freeze membership, update credits; **no role or scope check anywhere in the file** | Any valid account can mutate member bookings and paid entitlements across all locations |
| **C3** | **Open** | `chat_sessions` has no `ownerAuthUserId`, no revision (`schema.ts:215`); `chat-service.ts` loads any session id and updates it | A leaked/guessed session id exposes transcripts (member names, contacts, incidents) and lets a third party approve the draft |
| **H2** | **Open** | `api/fillout/route.ts:138` — `if (secret)` | With no DB setting, the public webhook accepts anything (public in `middleware.ts` `PUBLIC_PATHS`) |
| **H5** | **Open** | `agent-tools.ts` returns emails, phones, visit counts, attendee names into the model context; no studio scoping | Prompt injection can enumerate member PII; `evals/cases.ts` has one injection case, which is a good start |
| **H6** | **Open** | `lib/seed.ts:59–75` — no `NODE_ENV`/demo gate; inserts realistic sample tickets into any empty DB | A fresh/restored production DB fills with fictional incidents that pollute reports, SLAs and recurrence context |
| **M (new)** | **Open** | `rate-limit.ts` — in-process `Map`, keyed on `x-forwarded-for` falling back to the literal `"local"` | On multi-instance/serverless it is per-instance; behind a shared proxy every user can share one bucket |

Middle-wave positives worth keeping: `middleware.ts` fails closed for `/api/*`, cron is `CRON_SECRET`-gated, inbound Mailtrap webhooks verify signatures, and session ids are now `crypto.randomUUID()`.

---

## Part D — Performance, cost and data volume

| # | Finding | Evidence | Impact |
|---|---|---|---|
| D1 | `/tickets` loads **2,000 full ticket rows including the `embedding` jsonb column** and serialises them into a client component | `app/tickets/page.tsx:17` + `tickets.ts:251` (`db.select().from(tickets)` — all columns) | ~1,536 floats/ticket ≈ tens of MB of JSON per page load once embeddings are backfilled |
| D2 | `/trainers` loads **every ticket row, unbounded** | `app/trainers/page.tsx:20` | Grows without limit |
| D3 | Dashboard loads 300 full rows | `app/page.tsx:53` | Same shape of problem at smaller scale |
| D4 | Every chat turn embeds the report **and** every un-embedded candidate ticket, then fire-and-forgets the cache write | `recurrence.ts:66–139` | On a cold DB that is up to 150 embeddings per turn, repeated until the async write lands |
| D5 | `listTickets` has no pagination contract | `tickets.ts:214–253` | `limit` is a caller-supplied magic number |
| D6 | Up to 18 model calls/turn with an uncached 5.2k-token prompt, `maxTokens: 2200`, no `prompt_cache_key` | §A7 | Latency and OpenAI spend scale with conversation length, not with need |
| D7 | `getStudios()` hits the DB on every turn | `chat-service.ts:50` | Trivially cacheable (studio list changes ~never) |
| D8 | `generateSummary` is awaited *inside* the draft turn | `agent-session.ts:1620` | Adds a model round-trip to the moment the user is waiting for their draft |

---

## Part E — Code health & maintainability

- **Typecheck:** clean (`tsc --noEmit`).
- **Tests:** 246 passing, 11 skipped, 22 files (live evals need a key). No CI workflow exists, so nothing runs on push.
- **Lint:** 19 problems / **17 errors** — `react-hooks/purity` (2), `react-hooks/set-state-in-effect` (6), `react-hooks/static-components` (5), missing `exhaustive-deps` (1), page-custom-font (1). `npx eslint .` exits 1; the failures are concentrated in `TrainerProfile.tsx`, `ReportsWorkbench.tsx`, `ContextBar.tsx`, `TemplateBoard.tsx`.
- **Dead / duplicated brain:** `chat-engine.ts` is 1,441 lines; the overwhelmingly reachable parts are `startSession`, `reviewMessage`, `editMenu`, `buildDraft`, `createdMessage`, `handleInput` at 3 steps, plus `applyAnswer` for the *legacy* vocabulary that the agent path can no longer reach. `dynamic-chat.ts` profiles, `question-bank.ts`, `conversation.ts` voice helpers and ~700 lines of the questionnaire exist to serve a path that almost never runs. The 1,104-line `issue-knowledge.generated.ts` is generated but has no regeneration script in `package.json`.
- **Repo hygiene:** a 1 MB `ChatGPT Image Aug 15, 2026, 09_49_24 PM.png` is committed at the repo root; `supabase/.temp/*` (7 CLI state files, including `project-ref`) is committed; `data/historic-tickets.json` is 20k lines.
- **Naming drift:** the prompt calls the extras `alsoAsk`, the schema key is `alsoAsk`, but the contract field is `followUps` (`agent.ts:89`) — one of several prompt/code divergences.
- **`.env.example`** omits `OPENAI_MODEL_FAST` and `SUPABASE_ANON_KEY`/`NEXT_PUBLIC_SUPABASE_*` that the auth path reads.

---

## Part F — What to change, in the order that buys the most

### P0 — restore trust in the conversation (1–3 days, low risk)

**1. Make the click vocabulary unbreakable.**
- Emit `ans:<label>` (or `ans:<slot>|<label>`) from **every** question renderer, including `chat-engine.ts:495–560` and `dynamic-chat.ts:71–108`.
- Make `absorbInput` total: add cases for `for:`, `class:`, `loc:`, `sys:`, `when:`, `impact:`, `risk:`, `freq:` that map each prefix to `(slot, normalised label)` — `class:X` → `("classInfo", X)`, `when:X` → `("occurredAt", X)`, `impact:safety` → `("impact", "safety")`, `risk:yes` → `("atRisk", "yes")` — call `applyAnswerToSlot`, mark the slot `"user"`, and return the label as the utterance so the model sees the choice too.
- Ban the class of bug with a real contract test: enumerate every `value:` prefix emitted anywhere (a source scan), assert each is either in `isDeterministic` or produces a non-empty `userUtterance` from `runAgentTurn`. Delete the current test that only checks `valueToWords`.

**2. Stop the edit flow from destroying values.**
- In `handleInput`'s `edit:*` branch, don't `clear[field]()` immediately. Keep the old value, mark `editingField`, and only overwrite once the answer lands. Store the pre-edit value so "cancel" restores it.

**3. Let people correct a live ticket.**
- Remove `"created"` from `DETERMINISTIC_STEPS`. At `created`, run the agent with a new terminal intent — `amend_ticket` / `raise_followup` — that either patches the ticket (via a server-side, permission-checked mutation) or raises a linked follow-up with `parentTicketId`. At absolute minimum, answer with something that isn't a refusal when the message contains a correction.

**4. Health pass.** `npm run lint` → 0 errors; delete the root PNG and `supabase/.temp`; fix the `alsoAsk`/`followUps` naming.

### P1 — make the AI sound like it is thinking, not filling a form (1–2 weeks)

**5. One question authority, and it is the model — validated, not replaced.**
Replace gates §3–§7 with a *validator* that can only **reject** a model question (returning the reason to the model for one retry) and a *plan-completeness check* that runs **before** the model is allowed to file. Concretely:
- Build `InformationNeed[]` (`{ id, reason: routing|urgency|owner-action, satisfiedBy: slot|lookup|unknown }`) from category + report shape.
- If `readyForDraft === true` and an unmet *owner-critical* need remains, re-prompt the model once with the need spelled out — let **it** phrase the question. Only if the retry also fails does a canned question appear, and it should name the need ("the owner can't act until they know X — what is it?").
- Delete `custom:symptom` and `custom:first_noticed` outright; replace with an instruction in the prompt plus, when the model has genuinely nothing, one category-shaped question from `question-bank.ts` (which already has better, per-category questions).

**6. Category-aware requirements.** `missingRequired(data, category)`:
- compliments / suggestions / information requests → `studio` + `raisedFor` only, never `resolvedNow`/`impact`;
- faults → `resolvedNow` always; `impact` only if Momence can't answer it;
- planned work → `plannedWindow` instead of `resolvedNow`.

**7. Move the voice out of the templates and into the model.**
- `reviewMessage`: build the draft, then let the model write the hand-over line from the draft's own facts (2 calls already exist in that path — make the draft turn produce `handoverNote` in the schema). Keep the buttons; replace only the prose.
- `startSession`: keep one warm static line (it is the first impression and must be fast), but make the *placeholder* dynamic and make the second message model-generated.
- `editMenu`: generate the shortlist of fields that actually matter for this ticket from `issueKnowledgeBlock(category, subcategory)` instead of the fixed 4 + `followUps(category, subcategory)` list.
- Add an anti-repetition rule the code can enforce: the last two assistant `reply` strings are passed to the model, and a reply that reuses an opening 3-gram is regenerated once.

**8. Feed the model its own conversation properly.**
- Keep `rawText` **only** for the reporter's narrative sentences. Introduce `narrative` (substantive reporter text, greeting/button chatter stripped — `stripPreamble` already exists in `enrich.ts`) as the input to classification, retrieval, insight and the ticket body; keep the full transcript for the model.
- Raise the window: 40 messages / 5,000 tokens, and run `generateSummary` **during** intake every 6 turns (fast tier, fire-and-forget, stored on state) instead of only at draft time. Never let the summary be newer than the transcript tail.
- Pass each slot's `quote` into `known` so the model can see evidence, not just values.

**9. Cut the call fan-out.** (Biggest latency/cost win, and it also fixes the "reply rewrites itself" flicker.)
- Merge the member-lookup and session-lookup re-runs into the *same* `runAgent` invocation: run the deterministic lookups *before* the first model call (using the current turn's extracted slots), not after. The controller already knows the member name and class signal — it doesn't need to wait for the model to ask.
- Keep `onReplyRestart` only for genuine tool-loop continuations; a pre-fetched lookup needs no restart at all.
- Add `prompt_cache_key` (stable system prompt + stable tool schemas first) — OpenAI automatically discounts the cached prefix, which is ~5k tokens × every call.
- Cache the studio list per process, and cap `MAX_AGENT_STEPS` at 4 with a hard 45 s turn budget that degrades visibly.

**10. Tighten the prompt.** Goal: ≤ 2,500 tokens.
- Move taxonomy, studios and calendar into the `user` block (they already are); keep only behaviour in the system prompt.
- Replace a dozen prohibitions with **three worked examples**: (a) a thin fault report → the one question worth asking, (b) a detailed report → a two-sentence hand-over, (c) a correction → the corrected answer, no argument. Examples teach voice in a way rules cannot.
- Explicit voice contract with 4 constraints (open with something you took from their words; never repeat the previous opening; one question maximum; no restatement of the whole report) and let the telemetry (§11) measure compliance.
- Raise temperature for the *reply* while keeping it low for extraction — or better, split "write the reply" from "decide the slots": extraction at `temperature 0.1`, voice at `0.6`.

**11. Turn on the feedback loop.**
- Extend `ai_calls` with `turn_id`, `prompt_version`, `question_id`, `answered` (bool), `latency_ms`, `restarts`.
- Log every time a controller gate overrides a model question, with the reason — that number is the direct measure of "the app is making it feel robotic".
- Add 👍/👎 on a reply + "this question didn't make sense" in the UI, recorded against the session.
- Make the eval suite a **required check**: add `.github/workflows/ci.yml` running `typecheck`, `lint`, `test`, and nightly `evals` with the key; keep a `pass-rate` history file.

### P2 — data capture, retrieval and ticketing depth (2–6 weeks)

**12. Structured, answer-aware state.** Replace `agentAsked: string[]` with `needs: Record<id, { askedAt, answerState: "unknown"|"answered"|"partial"|"declined"|"contradicted", evidence }>`. Feed it to the model. This is what enables "you told me it was still down — has the vendor arrived?" instead of a generic ladder.

**13. Semantic memory with the right scope.**
- `findRelatedTickets`: filter by studio **and** category first, embed only the candidates lacking a vector, and write the cache synchronously in one statement (`UPDATE … WHERE id = ANY(...)`). Stop re-embedding every turn.
- Add a `context_facts` decay/`verifiedAt` so stale facts aren't injected as hints forever.
- Index `embedding` with pgvector + HNSW instead of a `jsonb` column scanned in Node — the current design cannot scale past a few hundred tickets, which is also why D1 leaks vectors to the browser. Store the vector in a **separate table or a `select`-projected column set**, never in the page payload.

**14. Ticket quality guardrails.**
- Validate the draft against the taxonomy before presentation (category ∈ taxonomy, subcategory ∈ category, title ≤ 12 words, not a greeting, summary mentions the studio, `rootCause` ≠ a category restatement).
- Require every slot on the ticket to have a `detailSources` entry (quote + who said it) so the owner can trust it and the audit trail is real.
- Make the description a **rendered account**: narrative → what was already done → what has been offered to members → what is still unknown (from `needs`), not a transcript paste.

**15. Ticketing plumbing.**
- Idempotency: `UNIQUE (session_id, turn_id)` on tickets (or an `idempotency_key` column), plus a conditional `UPDATE … WHERE step <> 'created' RETURNING` guard before `createTicketBundle`; sessions get a `revision` column and compare-and-swap, plus an `owner_auth_user_id` (closes C3).
- Merge/duplicate action in the ticket workspace using the existing `findSimilarTickets`, raising it from an informational panel to an action.
- Batch the SLA cron into one query; notify on assignment *and* on assignment change, not only on SLA breach.
- Add `reopen`, `reclassify` and `append correction` events so post-creation changes are first-class.

**16. Authorization (P0 if this is going anywhere near production).** Do C1, C2, C3, H2, H6 from Part C exactly as the 4 Sept audit prescribes — the fixes are small and self-contained.

---

## Part G — How to know it worked

| Metric | Target | Source |
|---|---|---|
| Controller overrides of a model question | < 10 % of turns, and 0 for compliments/suggestions | new telemetry (§11) |
| Turns with a swallowed click | 0 | contract test (§1) |
| Repeated questions for a fact already stated | 0 | eval suite + `needs` state |
| Questions to draft, detailed report | ≤ 2 median, no fixed count | `ai_calls` |
| Model calls per user turn | ≤ 2 (currently up to 18) | `ai_calls` |
| p95 turn latency | < 12 s (currently up to 60 s/hop) | `ai_calls` |
| Agent-mode share (vs. deterministic/degraded) | ≥ 98 % | `mode` in the turn response |
| Draft approved without an edit | ≥ 70 % | approval telemetry |
| Description contains non-narrative text ("Skip that one") | 0 | description validator (P2-14) |
| Correction after creation | supported, and applied to the ticket | new amend flow |

---

## Appendix — Evidence and reproduction

**Verified in this audit**

| Claim | How verified |
|---|---|
| 8 legacy option values produce an empty utterance on the agent path | runtime probe of `runAgentTurn` with a mocked `runAgent`; table of results in §A4 |
| The controller replaces a `readyForDraft` model decision with a canned question | runtime probe; output quoted in §A1 and §A2 |
| Compliments get asked for impact | runtime probe (`missingRequired` demands `impact` for every report) |
| Typing after creation is refused and the value is not applied | runtime probe; output quoted in §A11 |
| Ticket description contains button chatter | `buildDraft` probe; description quoted in §A6/B3 |
| ~5.2k-token system prompt | measured: 20,946 chars (`agent.ts:169–290`) |
| Up to 18 model calls per turn | `MAX_AGENT_STEPS = 6` (`agent.ts:583`) × 3 `runAgent` invocations in `runAgentTurn` |
| `/tickets` ships all rows with embeddings | `app/tickets/page.tsx:17`, `tickets.ts:251` |
| Lint errors | `npx eslint .` → 19 problems (17 errors); rule tally in Part E |
| Tests | `npx vitest run` → 246 passed, 11 skipped, 0 failed; `tsc --noEmit` clean |

**Fixed since the 10–11 Sept audits (do not re-report):** duplicate-message and greeting handling; the minimum-question floor is gone; slot provenance and human locks exist; corrections override model slots; the composer context is reconciled from the capture after each turn; unknowns are no longer converted into `resolvedNow=false`; multiple Momence sessions are a collection (`momenceSessionIds`); the tool loop is a real decision loop rather than a pre-declared lookup list; streams no longer fall back to a scripted questionnaire disguised as AI.

**Still open from earlier audits:** C1, C2, C3, H2, H5, H6 (§C); session concurrency/revisions (§B6); the two-brains duplication and dead questionnaire code (§E).
