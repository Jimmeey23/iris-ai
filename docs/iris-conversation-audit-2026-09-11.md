# Iris conversation audit — 11 September 2026

Audited baseline: main at 56ae8e8. Scope: browser submission and streaming, persisted conversation, agent prompting, answer extraction, question selection, corrections, Momence matching, draft generation and evaluation coverage.

## Conclusion

Iris's conversation problems are substantially caused by application logic around the model. The model is instructed to listen and ask only useful questions, but code can replace its next question, force a minimum question count, discard answers during field mapping, restore stale selections, and enter review without an explicit model decision.

The previous greeting and duplicate-message fixes remain present. They do not fix these state and decision problems. Changing the model or adding another “listen carefully” prompt would leave the confirmed defects intact.

The original audit added offline characterization tests in `src/lib/agent-audit.test.ts`. The remediation now converts them into production-controller regression tests: fixed question counts are removed, answers and context are matched on every turn, known facts suppress duplicate questions, corrections invalidate dependent lookup data, review-stage prose returns through AI interpretation, explicit draft requests are honoured, and unknown answers remain unknown.

## Remediation status

Implemented after the audit:

- Completion is evidence-driven and may take one, two, three or more messages. There is no minimum question count or generic fallback ladder.
- Each reporter message is matched into studio, time, audience, impact, location, system, membership, trainer, member, class, risk, resolution, action and frequency fields before the next reasoning pass.
- Direct typed replies are bound to the pending field before model planning; all canonical option fields now have storage handlers.
- Extracted facts are supplied to subsequent model/tool passes during the same turn.
- Questions for populated fields and paraphrased resolution repeats are rejected.
- Corrections from intake or draft review win over stale slots and clear dependent Momence records where needed.
- The browser context bar reconciles to server-accepted facts after each response, preventing stale selections from returning.
- Skipped and unknown values are no longer converted into false operational facts.

## Actual execution path

1. `ChatAssistant.send` posts the new text/button value, session ID and the entire current composer context.
2. `runChatTurn` loads the persisted state and transcript.
3. `runAgentTurn` reapplies composer selections and parses certain button answers. Ordinary typed answers are passed to the model.
4. Related tickets, historic patterns and existing Momence results are assembled.
5. The model proposes slots, corrections, a question/tool call or a draft.
6. Tool rounds run before the final response's slots and corrections are applied.
7. Application rules replace/suppress questions, add generic questions, and decide whether to draft.
8. The resulting state and transcript overwrite the stored session.

The reporter's text is generally retained in the transcript after a completed turn. “Not listening” is often a mismatch between that transcript, the structured fields, and the question-selection rules—not complete loss of every reply.

## Confirmed defects

### 1. High: a four-question floor forces unrelated follow-ups

Evidence: `src/lib/agent-session.ts:637`, `:652`, `:1095`.

Even when the model explicitly returns `readyForDraft=true` and the necessary operational fields are filled, the application invokes a fixed question ladder until four questions have been asked. The ladder asks about previous actions, occurrence time, recurrence, membership, witnesses and a generic owner update. These are not selected against the current feedback category or a demonstrated decision need.

Reproduction: a completed outage report with action, time, resolution and impact populated still receives “Anyone else see it or involved?” because witnesses is empty.

The budget is checked **before** this ladder runs. A configured one-question budget can therefore produce a second question after the model decides to draft. The UI can show zero remaining while asking another question.

Fix: remove minimum question counts. Use relevant, unresolved information needs as the stopping criterion. Apply any ceiling after all question-selection steps.

### 2. High: structured button answers can be silently discarded

Evidence: `src/lib/agent-session.ts:56`, `:78`, `:90`; `src/lib/agent.ts:589`.

The canonical slot list permits fields that `applyAnswerToSlot` does not implement. Examples include `actionTaken`, `witnesses`, `amount`, `notes` and `memberContact`. The code can mark an answer as human-set even though the switch never stored its value.

Reproduction: tapping an `actionTaken` option for “Provided a portable cooler” leaves `data.actionTaken` undefined but sets its provenance to `user`. A subsequent model attempt to supply some locked fields can also be blocked.

Ordinary free-text replies do not bind directly to the pending field either. They depend on the model extracting that field on the next turn. If it omits the slot, the application can proceed to another question without recording an answer outcome.

Fix: use one typed slot registry for IDs, parsing, storage and provenance. Only mark a write successful after it succeeds. For free text, interpret the answer against the pending question and explicitly record answered, partial, unknown, skipped or correction status. Do not blindly copy arbitrary prose into boolean fields.

### 3. High: duplicate suppression checks question IDs, not whether a fact is already known

Evidence: `src/lib/agent-session.ts:1042`, `:1083`; `src/lib/agent.ts:374`.

A model-proposed question is not checked against populated fields. It can ask what was done even while `actionTaken` already contains “Provided a cooler.”

The duplicate check only rejects identical IDs. “Is it resolved?” under `resolvedNow` and “Is it still ongoing?” under `custom:current_status` are treated as different questions.

Conversely, if the model genuinely needs clarification of an incomplete answer but reuses the same ID, its question is deleted. Once the floor is satisfied, the app can immediately draft even though `readyForDraft=false`.

Fix: track the information need and answer state, not merely a list of asked IDs. Reject questions about established facts; permit a focused clarification for partial or contradictory answers. Require a deliberate finalization decision after question validation.

### 4. High: corrections can be overwritten by old composer selections

Evidence: `src/components/ChatAssistant.tsx:399`, `:415`; `src/lib/chat-inference.ts:219`; `src/lib/agent-session.ts:773`.

Every request includes the full composer context. The server reapplies those selections before reasoning. The client updates `capture` after a response but does not reconcile corrected facts back into `context`.

Reproduction: a session corrected to Bandra is changed back to Kemps Corner when the following “Yes” request carries the old composer selection.

Fix: send explicit selection changes, with field versions, instead of replaying stale values every turn. Reconcile the composer with accepted server corrections.

### 5. High: corrections have inconsistent field keys and incomplete dependency invalidation

Evidence: `src/lib/agent-session.ts:327`, `:398`, `:423`, `:1020`.

A trainer correction writes through the canonical ID `trainer` and marks `trainer` human-set. The normal trainer setter checks the provenance key `trainerName`. Consequently a stale normal slot in the same model response can overwrite the correction.

Reproduction: `corrections=[trainer: KV]` plus `slots.trainer=Old instructor` stores “Old instructor.”

Changing `classInfo` through the correction path clears the linked session. Correcting studio or date does not perform the equivalent invalidation. A corrected member name likewise has no general mechanism to clear its old member ID, contact, package and completed-lookup flag.

Fix: canonicalize field keys once and define dependencies explicitly. A correction must update the value, provenance, dependent IDs/cache and pending questions atomically.

### 6. High: typed corrections stop being interpreted once a draft appears

Evidence: `src/lib/agent-session.ts:31`; `src/lib/chat-engine.ts:1217`; `src/lib/chat-service.ts:160`.

The entire review step is deterministic. A normal text reply is appended to notes rather than sent for correction reasoning. Cached insight is retained.

Reproduction: “Correction: this was Bandra, not Kemps Corner” at review leaves the studio as Kemps Corner and adds the correction sentence to notes. The preview can therefore contain contradictory information and still route by the old studio.

Fix: keep approval/edit buttons deterministic, but process review-stage text as a potential correction. Rebuild affected facts and the draft before approval.

### 7. High: unknown answers become invented operational facts

Evidence: `src/lib/guardrails.ts:111`; `src/lib/agent-session.ts:1063`, `:1118`.

Resolution and impact are required for every report, without distinguishing faults from compliments, suggestions or information requests. After questions are skipped, draft creation can fill unknown studio as “Not studio specific,” unknown impact as “single,” and unknown resolution as false.

Reproduction: skipping the resolution question with enough prior questions produces a review state with `resolvedNow=false`. “I don't know” has been converted into “still happening.”

Fix: represent unknown, not applicable and confirmed negative separately. Apply category-specific requirements. Include unresolved facts in the handoff without claiming a factual answer.

### 8. Medium: “no more questions” only disables one fallback branch

Evidence: `src/lib/agent-session.ts:1098`.

The stop-request expression controls the generic ladder only. It does not suppress a model question or a routing question already selected. Ordinary phrases such as “show me the draft” are also absent from that expression.

Reproduction: “No more questions, draft it now” still yields a model-proposed witness question.

Fix: treat stop/skip/draft intent as part of turn interpretation before question selection. Retain unknowns explicitly; ask again only when a truly mandatory action prerequisite prevents the requested action.

## Additional source-confirmed contributing problems

### 9. Earlier details can fall out of model context before a summary exists

Evidence: `src/lib/agent.ts:313`; `src/lib/agent-session.ts:774`, `:1151`; `src/lib/chat-engine.ts:571`.

Only the last 24 messages, further reduced toward approximately 2,600 tokens, enter the model's transcript. Summary generation occurs at draft time, after the active intake may already have lost the original report. The minimum retained six lines also means the token ceiling is not absolute.

`rawText` is set only once. If the first message was “hi,” it remains “hi” even after the actual incident is described. Later answers do not automatically enter that raw narrative, although successfully extracted slots and the persisted transcript may preserve them elsewhere.

Fix: retain the substantive opening report separately and update evidence/summary before truncation during active intake. Preserve source-message references for every extracted fact.

### 10. Momence lookups can use stale or incomplete current-turn facts

Evidence: `src/lib/agent-session.ts:942`, `:966`, `:1020`; `:453`.

The automatic member search uses `s.data.memberName` before the current response's member slot is applied. A newly named member can miss that automatic lookup until another turn. The model can still request its own lookup, so this is not an assertion that all searches fail.

Session lookup takes current class/date slots but takes location from existing state. A studio first identified in that same response may therefore not scope the search. Corrections are also applied after lookup and matching.

Several impacted sessions are represented by one `momenceSessionId`. The matcher conservatively returns no match for multiple matching times, while the prompt presses for a single linked session.

Fix: apply validated facts and corrections before tools, search with consistent current state, key caches by member/studio/date/query, and represent affected sessions as a collection. Lookup records must not replace a multi-session incident narrative.

### 11. Prompt and validation rules conflict with the intended conversation

Evidence: `src/lib/agent.ts:178`, `:223`, `:239`, `:295`; `src/lib/llm.ts:51`.

The prompt says to avoid unnecessary questions and generic “anything else,” while the code enforces a minimum and includes an owner-update variant. It says to always permit free text, but the studio gate disables it. It tells the model to omit some fields that the response schema requires.

The runtime coherence check verifies draft/question/tool shape, not factual consistency, answer consumption or question relevance. The schema uses `strict:false`.

Fix: define one explicit turn contract covering conversation, clarification, lookup and draft states. Validate it before presentation. Align prompt, schema and controller. The existence of these contradictions is confirmed; their frequency in live model responses was not measured.

### 12. Session synchronization can make visible replies disagree with server context

Evidence: `src/components/ChatAssistant.tsx:386`, `:465`, `:684`; `src/lib/chat-service.ts:88`, `:289`.

The browser optimistically echoes a reply before persistence. A failed request leaves the echo visible, without a persisted/delivery indicator or a transcript reconciliation read. A new-page mount starts a new session; session ID is held in component state.

The server reads then overwrites the session without revision checks or per-turn idempotency. Concurrent requests can overwrite each other's transcript changes. Most controls disable while busy, but the restart control does not, and there is no server-side protection.

These are source-confirmed race/recovery risks, not reproduced production incidents in this audit.

Fix: version sessions, use unique turn IDs and compare-and-swap/serialization, expose delivery status, and reload authoritative state after a dropped response. Serialize restart with in-flight work.

## Why the existing tests did not catch this

The primary live evaluation harness in `src/lib/evals/agent.eval.test.ts:50` calls `runAgent` directly and manually accumulates slots. It bypasses the production question ladder, field mapping, corrections, persistent composer context and review behavior.

Consequently, the model can pass an evaluation while the application subsequently discards its decision. Prior focused tests covered greetings, message duplication, option subsets and session matching; they were not proof of end-to-end listening behavior.

The new audit suite exercises `runAgentTurn` with controlled model outputs and reproduces 12 defects. It establishes controller behavior independently of which model is configured.

## Applied to the supplied outage report

The report already establishes Kemps Corner, several affected sessions, the room move, the Cycle attendee count, KV's involvement and portable-cooler accommodation. These should become evidence-backed facts and not be re-requested generically.

Current restoration status can be a legitimate question: moving a cooler at 11:30 does not prove electricity was restored. But the report also ends mid-sentence (“the portable cooler was moved”), which may warrant allowing the reporter to finish. The date and 10:00 versus 10:15 BBB timing need contextual interpretation or lookup; they should not be guessed.

A witness or member-package question is not automatically necessary for this utility incident. A continued generic questionnaire after the report and restoration answer is explained by the controller defects above.

## Remaining follow-up

1. Represent multiple affected Momence sessions as a collection rather than one session ID.
2. Add session revisions and turn IDs to prevent concurrent request overwrites.
3. Validate the repaired flow against live AI, Momence and an authenticated browser session.

Acceptance criteria: zero repeated questions for established facts; no unrelated questions added just to reach a count; every answer has an explicit outcome; corrections survive the next turn and update the draft; unknowns never become false facts; model and rendered question decisions are observable.

## Validation and limits

- `npm run typecheck`: passed.
- `npx vitest run --exclude 'src/lib/evals/**'`: 138 tests passed across 15 files, including 14 repaired production-controller cases.
- Focused ESLint across the changed source and test files: passed.
- `npm run build`: passed.
- `git diff --check`: passed.
- No live model, database, Momence or browser validation was performed. The browser-control surface was unavailable in the remediation session. The regression cases control model output to isolate application behavior; they do not measure live-model frequency.
