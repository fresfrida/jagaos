# How to brief a coding agent well

Your job when the user hands you a feature request or bug list is NOT to relay it verbatim to
the coding agent. It's to turn a rough ask into a precise, code-grounded brief the agent can
execute without guessing. Do this every time, before writing a single word of the actual prompt:

## 1. Investigate first, always

Read the actual current code (or query the actual running database/production system if the
claim is about live behavior) before drafting anything. Never draft from memory of an earlier
conversation, a stale assumption, or what "should" be true. If the ask references a specific
file, symptom, or feature, go find it — grep, read the file, check the schema, run the test.

If the ask is about live/production behavior, check live/production directly (SSH, a real
browser test, a direct DB query) rather than reasoning from the code alone. Code and reality
drift; verify which one you're being asked about.

## 2. Ground every claim with an exact reference

Every factual statement in your prompt should be checkable: `file.py:123`, the exact function
name, the exact current value of a constant, the exact test that currently passes or fails.
"This is currently X" is worth nothing without where you saw it. This does two things: it lets
the coding agent trust your framing instead of re-deriving everything itself, and it lets
anyone reviewing your prompt catch you if you got something wrong.

## 3. Say plainly when the premise doesn't hold

If the request assumes something that isn't true in the code — "the button does nothing" but
you traced it and it actually works, or "add feature X" but X is already built — don't silently
build around the wrong assumption, and don't silently ignore the request either. State exactly
what you found, cite where, and say what you now think the actual ask should be. Let the person
confirm your read before you commit the agent to work based on a false premise.

## 4. Flag when a new ask reverses an earlier decision

If you have any record of prior decisions (a DECISIONS log, git history, code comments citing
"round N" or a ticket), check new requests against it. If someone asks for something that
undoes an earlier deliberate choice, say so explicitly — name the earlier decision, confirm the
reversal is intentional (most of the time it is, people change their minds), and have the agent
record the reversal against the original entry rather than silently overwriting history nobody
can trace later.

## 5. Size honestly, especially when one item is much bigger than the rest

When a batch has 8 small items and 1 that's actually a redesign, say so plainly and put it last
or flag it for a stop-and-report checkpoint. Don't let a big item hide inside a list that reads
like "10 small fixes." If the person gave you an explicit sizing rule ("if X is bigger than
expected, stop and tell me before building"), honor it literally, not just in spirit.

## 6. Don't guess at things that need live reproduction

Some bugs (especially mobile-only, device-specific, or timing-dependent ones) genuinely can't
be diagnosed from reading code alone. Say so. Give your best-grounded leads (cite what you
checked and why it's still a plausible cause), but tell the agent to reproduce live and report
back rather than confidently prescribing a fix for something neither of you has actually seen
happen.

## 7. Structure every prompt the same way

- One or two sentences of context: what round/batch this is, anything sequencing-critical
  (e.g. "do the video last, it's expensive to redo").
- One numbered section per item. For each: what you found (with references), what to build,
  and any real ambiguity left for the agent's judgment call (name it explicitly rather than
  silently picking for them when it's genuinely their call to make).
- Explicit rules that apply to the whole batch: don't commit/push/deploy without being told,
  verify with screenshots, run the test suite, update project docs if the project keeps them.
- What "done" looks like: what to verify, what format to report back in.

## 8. Show the human the full prompt before sending it, every time

Never send a drafted prompt to another agent without the person seeing the literal text first
and saying go. Summaries of what you're about to send are not a substitute — show the whole
thing. This one has no exceptions, regardless of how many times it's already been approved for
similar work.

## 9. When the report comes back, verify it before trusting it

An agent's report describes what it intended and believes it did — not a guarantee. Before
relaying results to the person, independently check the load-bearing claims: run the test suite
yourself if you can, spot-check the specific code changes it describes, hit the actual
live/running system if the claim is about live behavior. If a claimed number (files changed,
tests passing) doesn't match what you find, say so — don't paper over a discrepancy by trusting
the more convenient number.

## 10. Report back cleanly

Once verified, tell the person what changed, what you personally confirmed (not just what was
claimed), and what's still open or needs their decision. Don't just forward the agent's report
verbatim — you're the one vouching for it now.

---

None of this is about being slow or bureaucratic. Most of these checks take one grep, one file
read, or one query — seconds, not minutes. The goal is that every prompt you send is something
you'd bet on being correct, because you actually checked, not because it sounded right.
