**Collaboration: solo**

# JagaOS — Claude Code instructions

## Start here
Read `docs/HANDOFF.md` (purpose, architecture, data flow, commands, deployment, known risks), `docs/KANBAN.md` (Backlog/Doing/Done/Blocked), and `docs/DECISIONS.md` (decisions log) before making changes. These are the source of truth for project state — trust them over memory of a prior session, but verify any specific claim against the actual code before relying on it.

## Before editing
State: the current data flow for the area you're touching, the smallest practical change that solves the task, and any assumption that could change the implementation if it turns out wrong.

## Docs must stay accurate
After any change, update `docs/HANDOFF.md`, `docs/KANBAN.md`, and `docs/DECISIONS.md` (decision, date, reason, tradeoff, final/tentative) in the same turn. Re-verify each claim against the current code or command output before writing it — never write from memory or intent. If you find an existing doc claim that no longer matches the code, fix it even if it's unrelated to the task at hand.

## Verification
Run the safest available checks (lint, typecheck, tests, build). Screenshot any UI change. If a deploy is requested, verify the live URL and screenshot the deployed result.

## Reporting
After editing, report: files changed, the exact matching/business rule used (if relevant), check results, screenshots if UI changed, and any follow-up risks or decisions needed.

## Git & deployment
Commit and push freely after each completed task — don't wait to be asked. This is a solo project on a single machine with no backup beyond git history; uncommitted work is data-loss risk, not a safety net. Run ./scripts/prepush-check.sh before every push. Use a clear commit message. Note: pushing to main auto-triggers a Vercel UAT deploy (git integration) — that's expected, not a separate action to gate. Redeploying the Lightsail backend (which is not git-triggered) still needs an explicit ask.

## Coding practice
- Build the smallest practical solution that stays clean enough to extend. Use SOLID where it clarifies, not as ceremony.
- Keep components small and focused; separate UI, data access, business logic, validation, and configuration.
- Don't duplicate matching/filtering logic between list and detail views — put shared rules in one helper/service.
- Prefer typed interfaces/schemas for API payloads, DB records, form values, and AI responses.
- Keep side effects (API calls, storage, auth, calendar sync, AI calls) out of presentational components.
- Design for safe failure: loading, empty, error, unauthorized, and offline states should be visible.
- Put business rules, constants, enums, and role/permission logic in shared modules, not inline in components.
- Preserve existing conventions unless clearly harmful — explain why if changing one.

### React/Vite (web/)
- Feature-based folders (`features/calendar`, `features/tags`, etc.), shared UI in `components/ui`, shared hooks in `hooks`, API clients in `lib`/`services`.
- Route components stay thin — compose features, don't hold logic.
- TypeScript strict; avoid `any` without a comment explaining why.
- Accessible HTML first: labels, buttons, landmarks, keyboard/focus states, sufficient contrast.

## Architectural invariants — do not break silently
- **LLM proposes, deterministic code disposes.** No LLM node writes `obligation` / `expectation` / `document` status directly — only `app/graph/verify.py`, `app/rules/transitions.py`, and `app/graph/human_review.py` (on resume) do. A change that lets an LLM node write state directly is a guardrail break, not a minor refactor — flag it explicitly rather than making it.
- GST arithmetic and statutory dates are deterministic and cited (`app/rules/statutory.py`) — never delegate to the LLM. Don't add a statutory rule without a citation.
- Only the `sonnet4.5` model alias is callable on this gateway key — there is no haiku/cost-routing split.
- Tool calls need an explicit `max_tokens` (the gateway silently truncates otherwise).
- Every data endpoint derives `company_id` from the session/membership — never accept it as a client-supplied parameter.
