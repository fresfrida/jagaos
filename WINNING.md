# Can this win, and how

Written for: the team. Honest assessment, not a pep talk.
You asked twice for no mistakes, so the risks are stated as plainly as the
strengths.

---

## Part 1 — the chatroom question: don't build one

**A shared Slack/Discord-style room would actively damage this product.** Five
reasons, the first two decisive:

1. **Your persona opens this eight times a year.** A chatroom is a
   high-frequency surface. Slack works because people live in it. A room with
   two people who check in every six weeks is a dead room, and a dead room
   makes a product feel abandoned.
2. **It inverts the thesis.** Our whole claim is *chat has no clock and no
   memory — we give it both.* Build a chatroom and we become a chat app, with
   exactly the problems we said were the problem.
3. **They already have a chat.** Every SG SME has a WhatsApp group. Asking
   them to move conversation into a new app is the highest-friction thing you
   can ask. They won't.
4. **It's enormous for the time left** — presence, unread, mentions,
   notifications, moderation — and none of it is differentiating.
5. **It fights "one question per screen."** A room is a firehose; our whole
   interaction model is the opposite.

### What the real need is

Underneath the question are three needs, and none of them is a room:

| The need | The right shape |
|---|---|
| "Who did what?" | the **activity log** — already designed, already scores on security |
| "Either of us can answer this" | a **shared queue** — a co-director answers, it leaves Mei's list |
| "I need to ask my co-director about this bill" | a **comment on that document**, not a room |

So: **private 1:1 threads with JagaOS, shared work, shared record.** Each person
gets their own calm DM with the agent. The queue, the story, the documents and
the log are shared and attributed. That's how good multiplayer B2B tools
behave — work is shared, chat is contextual, nobody built a room.

> It's a shared filing cabinet with a personal assistant. You don't put a
> group chat in a filing room.

**If you want group behaviour, join the group they already have.** JagaOS as a
bot added to the company's existing WhatsApp/Telegram group is zero friction
and meets them where they are. Building our own room is the opposite.

---

## Part 2 — is it a winning idea?

**Verdict: the idea is strong enough to win the SME category. Execution risk
is what will decide it, and right now the risk is that you have designed more
than you can build.**

I can't see the other teams, so treat this as an assessment of your position,
not a prediction.

### What is genuinely strong

1. **Authenticity.** The SME category explicitly rewards solving *your own*
   business challenge. The corp sec handover is a real thing that happened to
   you. Most teams will pitch a hypothetical. You have a scar.
2. **The agentic work is real.** Deriving dated obligations from documents,
   running them on a clock, and diffing expected against held is genuine agent
   work — not a chat wrapper. It survives the "would GPT-6 fix this?" test.
3. **Gap analysis is structurally impossible for a chat model.** It can't know
   your corpus, so it can't know the holes in it. That's a defensible moat
   sentence, and very few hackathon projects have one.
4. **The architecture maps cleanly onto the rubric.** "LLM proposes,
   deterministic code disposes" answers criteria 2, 4 and 5 with one idea.
5. **Guardrails are native, not bolted on.** You ingest third-party documents,
   so injection is a real threat with a real consequence — demoable in 15
   seconds.
6. **Evals.** Criterion 6 asks for golden-path *and adversarial* cases. Almost
   nobody ships them. Cheapest differentiation on the board.

### What will lose it — ranked, honestly

**1. Scope. This is the big one.**
Timeline, gaps, obligations, recall, pack, multi-user, roles, audit, Telegram,
evals, trace, deployment. A half-built version of all of it loses to a
complete version of a third of it. Judges score what runs, not what was
planned. **Cut list is in Part 3 and it is not optional.**

**2. No backend exists yet.**
The documents and the prototype are excellent and are also, right now, the
problem: design is far ahead of code, and the build window is nearly over.
Every further day of design is borrowed from the thing that gets scored.

**3. The dormant-company ROI gap.**
This has not gone away. A dormant company has roughly four obligations a year
and few documents. When an EY or DBS judge asks "what does this save," the
honest number is thin. Mitigations, in order of strength:
   - Run your **own real backlog** through it and report what it found. "We
     found three things we didn't know about" beats any projection.
   - Add a **clearly-labelled** active-SME corpus for depth. Never blend it
     silently with the real data.
   - Sell the tail risk, not the fine: s155 disqualification, debarment,
     striking off. "The penalty isn't $600, it's your name."

**4. "Isn't this just Dropbox / Google Drive / Iron Mountain?"**
This will be someone's first reaction. Ideas that need explaining lose to
ideas that don't. Fix it by **leading with the moment, not the category** —
see the opening line in Part 5.

**5. Divided attention.** There are other competitions in your folder. This
one needs the remaining days.

**6. Operational hazards that can end it outright.**
   - Incomplete submission format → "may be rejected". Their words.
   - No live deployment URL → a required field.
   - Blowing the **USD 100 AWS credit** → "account may be paused, which could
     affect your standing." Log spend from day one, cap it, use `haiku` for
     routing.

---

## Part 3 — the cut list

Build **only** what demonstrates all seven criteria, and pitch the rest.

### Build (protected)

| Thing | Why it survives |
|---|---|
| Telegram → classify → extract → verify → ask → confirm → obligation → story | one loop, hits criteria 1,2,3,4,6,7 |
| The Clock + escalation ladder | the thesis; nothing else shows it |
| Gap analysis + handover pack | the differentiator and the headline demo |
| Injection guardrail + quarantine | criterion 5, demoable |
| Eval suite, golden + adversarial, with a printed scorecard | criterion 6, rare |
| Trace view under `/inspect` | criterion 6 and 7 |
| Login + attribution + shared queue + activity log | your multi-user direction, cheaply |
| Live deployment on Lightsail | a required submission field |

### Pitch, don't build

Roles and permission UI, invite flows, share links with passphrases, the
desktop console, memories lane depth, billing, SSO. All of these are a slide.
None is a scored artifact.

### Recall — keep a thin version

Cutting it entirely weakens "no past and no future". Keep **search with
citations over the documents you hold** — with a small corpus, brute-force
over metadata is fine, no vector database. Skip the elaborate multi-hop time
resolution or hardcode the one demo question and say plainly that it's the
demo path.

### Multi-user — keep the model, cut the chrome

Keep `user`, `membership`, attribution on every document, the shared queue and
the hash-chained log. Seed two accounts, magic-link login. That *is*
multi-user, and it demos in thirty seconds. Skip the admin screens.

---

## Part 4 — use the 30-minute video as an advantage

Most teams will pad three minutes into thirty, or submit five and look thin.
A chaptered thirty minutes is a structural edge if you script it.

| Minutes | Chapter |
|---|---|
| 0–2 | The moment: nineteen documents, fourteen held, five unknown |
| 2–6 | The loop, live, end to end, unedited |
| 6–11 | Architecture: LLM proposes, code disposes — count the nodes |
| 11–14 | The injection attack, contained |
| 14–18 | Evals running, scorecard on screen, adversarial cases named |
| 18–22 | Gap analysis and the handover pack |
| 22–24 | The Clock: "I do nothing for four months" → the message arrives |
| 24–26 | Deployment, cost per document, the live URL |
| 26–29 | Business case, the corp sec channel, pricing |
| 29–30 | What's next |

Confirm on Slack whether 30 is a maximum or a target before you cut to length.

**Every claim in the PDF needs a timestamp in the video.** Their own guidance
slide says proposal and demo must tell the same story. Build that table.

---

## Part 5 — the pitch

**Open with the true story, not the category:**

> "When we changed corporate secretary, they sent us a list of nineteen
> documents. We had fourteen. We didn't know which five were missing until we
> spent a weekend finding out."

Every director in that room has felt it. Nobody needs the category explained
after that.

**The one-liner:**

> JagaOS is your company's memory — and the only thing in it that watches the
> calendar.

**The moat sentence:**

> A chat model can read any document you show it. It can't tell you which
> document you're missing, because it doesn't know what you have.

**The dormancy judo — don't hide it, lead with it:**

> "We're dormant. Nothing happens here. Which is exactly why nobody was
> watching, and exactly why we nearly missed things. If it works for the
> company where nothing happens, it works for the one where everything does."

**The SME Ready Award (S$1,000, our category only) is the most winnable
prize on the board.** It goes to the most deployment-ready solution. So the
single strongest sentence available to you is earned, not written:

> "We've been running this on our own company for two weeks."

Start using it on your own documents the day ingest works. That sentence is
worth more than any feature you could build in the same time.
