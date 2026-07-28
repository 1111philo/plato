# Model selection: choosing an open source model for plato

**Status:** decided — `qwen.qwen3-vl-235b-a22b`, the only candidate satisfying all four constraints
**Date:** 2026-07-28
**Supersedes:** Claude Haiku 4.5 (`us.anthropic.claude-haiku-4-5-20251001-v1:0`)
**Implementation:** [PR #332](https://github.com/1111philo/plato/pull/332)

## The goal

Run plato on an **open source model** — weights publicly downloadable *under an
OSI-approved license*. This was the stated objective, not a cost-reduction
exercise. Everything below follows from it.

The distinction between *open weight* and *open source* is the crux of this
decision, and getting it wrong is easy. "Open weight" only means you can download
the parameters. Several widely-described-as-open models ship under bespoke
community licenses that are **not** open source: the Llama 4 Community License
imposes a 700M-MAU threshold, an acceptable-use policy, and a "Built with Llama"
naming requirement; Gemma's Terms of Use carry their own use restrictions. Those
fail the Open Source Definition on field-of-use and
non-discrimination grounds (OSD #5, #6) and are not OSI-approved.

plato itself is **AGPL-3.0**. Running an AGPL project on a model that isn't open
source is an inconsistency, not a technicality — so the license bar is a
constraint, not a tiebreaker. See [constraint 4](#4-must-carry-an-osi-approved-license).

The corollary matters as much as the goal: **a proprietary API model was not an
acceptable outcome, even if it benchmarked better.** Haiku 4.5 appears in the
comparisons as the incumbent baseline — the bar to clear — not as a candidate.

plato runs **one model for all nine agents**. No per-agent routing: the model is
declared once as `LLM` in `server/src/lib/ai-provider.js`, mirrored in
`client/js/api.js`, and injected into plugins as `ctx.LLM`. Nine models to reason
about is nine ways for prompt behavior to drift, and plato's agents share one
output contract, so one model is the simpler and more testable choice.

## Hard constraints

These were non-negotiable and did most of the filtering.

### 1. Must be served on Amazon Bedrock

UIC requires it. Data stays inside the institution's AWS account and existing
agreements; there is no approval path for sending learner conversations to
Moonshot, Together, Groq, Fireworks, or any other third-party inference host.

This is the single most consequential constraint, and it is easy to
under-appreciate: **a model being open-weight does not mean it is available to
us.** DeepSeek, Kimi, GLM, and Qwen all publish weights, but plato can only use
the specific SKUs AWS has chosen to host in our region. The catalog, not the
open-weight ecosystem, defines the candidate pool.

It also means published third-party benchmarks are not transferable. Latency in
particular is a property of *the host*, not the model. Every latency number in
this document was measured against Bedrock `us-east-2` from this repo.

### 2. Must accept image input

Learners paste screenshots into the coach. That is a real, shipped feature —
images are compressed client-side (`client/src/lib/imageCompression.js`, JPEG
output), stored as individual `screenshot:*` records, and referenced from
`metadata.imageKeys`. A text-only model cannot serve plato's coach at all.

This is a **hard filter applied before quality is considered**. It eliminates
otherwise-strong open-weight models outright:

| Model | Open weight | On Bedrock us-east-2 | Image input | Eligible |
|---|---|---|---|---|
| GLM 5 (`zai.glm-5`) | yes | yes | **no** | ✗ |
| DeepSeek V3.2 (`deepseek.v3.2`) | yes | yes | **no** | ✗ |
| MiniMax M2.5 (`minimax.minimax-m2.5`) | yes | yes | **no** | ✗ |
| gpt-oss-120b (`openai.gpt-oss-120b-1:0`) | yes | yes | **no** | ✗ |
| Qwen3 235B (`qwen.qwen3-235b-a22b-2507-v1:0`) | yes | yes | **no** | ✗ |
| Nemotron Super 3 120B | yes | yes | **no** | ✗ |
| Llama 3.3 70B | yes | yes | **no** | ✗ |
| Kimi K2 Thinking (`moonshotai.kimi-k2-thinking`) | yes | yes | **no** | ✗ |
| **Qwen3-VL 235B A22B** | yes | yes | yes | ✓ |
| Llama 4 Maverick 17B | yes | yes (inference profile) | yes | ✗ (license, constraint 4) |
| Gemma 3 27B IT | yes | yes | yes | ✗ (license, constraint 4) |
| Mistral Large 3 675B | yes | yes | yes | ✓ (failed later) |
| Kimi K2.5 (`moonshotai.kimi-k2.5`) | yes | yes | yes | ✓ (failed later) |
| Pixtral Large | yes | yes (inference profile) | yes | ✓ (failed later) |

Of the 43 open-weight model IDs in `us-east-2`, only 12 accept `IMAGE`, and most
of those are small (Ministral 3B/8B/14B, Nemotron Nano 12B, Palmyra Vision 7B,
Gemma 3 4B/12B) — below the capability needed for open-ended coaching.

### 3. Must reliably emit plato's literal output tags

plato's agents do **not** use tool calling. There is no `tools` array anywhere in
the codebase. The coach ends every response with literal text markers that a
regex plus a brace-walk extract (`parseCoachResponse` in
`client/src/lib/lessonEngine.js`):

```
[PROGRESS: 8]
[KB_UPDATE: {"insights": ["..."], "learnerPosition": "..."}]
[PROFILE_UPDATE: {"observation": "..."}]
```

If a model doesn't emit these, plato doesn't merely degrade — progress never
advances, lessons never complete, and the learner profile never updates. This is
the functional bar, and it's why tag compliance was measured directly rather than
inferred from general benchmark scores.

A consequence: **reasoning models are structurally disadvantaged.** Their
`reasoningContent` output is dropped at the Converse boundary because plato's
parser only reads visible text. Verified concretely: `gpt-oss-120b` at
`maxTokens=16` returned *zero* visible characters (all reasoning), and spent 50
output tokens to say "OK" where Haiku spent 4.

### 4. Must carry an OSI-approved license

This is a constraint, not a preference, and it is what ultimately decides the
choice. plato ships under **AGPL-3.0**; the point of this migration is that the
stack is open source. A model under a bespoke community license doesn't satisfy
that, however freely its weights download.

| License | OSI-approved | Why / why not |
|---|---|---|
| **Apache-2.0** (Qwen3-VL) | **yes** | No field-of-use restriction, no user threshold, no naming requirement |
| Llama 4 Community License | no | 700M-MAU threshold discriminates against a class of user (OSD #5/#6); bundled acceptable-use policy restricts fields of endeavor; "Built with Llama" attribution required |
| Gemma Terms of Use | no | Use restrictions via a prohibited-use policy; not a recognized open source license |
| Proprietary (Haiku 4.5) | no | Weights not available at all |

A tempting counter-argument, worth rejecting explicitly: plato reaches the model
over Bedrock and never redistributes weights, so *as a matter of legal exposure*
the Llama clauses are close to inert — the MAU threshold and naming requirement
don't bind an API consumer. That reasoning is what nearly selected Llama 4 on
earlier drafts of this document. It answers the wrong question. The bar here is
definitional (**is this model open source?**), not a liability assessment, and
Llama 4 and Gemma both fail it.

The consequence is that **the eligible set has exactly one member**: Qwen3-VL 235B
A22B is the only OSI-licensed model on Bedrock `us-east-2` that also accepts
images. Everything measured below is therefore verification that the one eligible
candidate is *good enough to ship* — not a competition it won.

## Method

Every candidate was tested from this repo against Bedrock `us-east-2` using
**plato's actual `coach.md`** (15,727 chars ≈ 3,685 tokens) plus a realistic
runtime context block — not a synthetic prompt. Five scenarios exercised the
judgments plato depends on:

| Scenario | What it tests |
|---|---|
| `early` | Does it score conservatively at lesson start? |
| `gaming` | Learner demands "just give me a 10" — does it refuse? |
| `struggling` | Learner is lost — does it respond sanely without inflating progress? |
| `strong` | Exemplar clearly achieved — **does it award 10 so the lesson can complete?** |
| `regression` | Learner retracts earlier good work — does progress drop? |

3 trials per scenario per model (5 for the completion check, 15 for latency).
Repeat trials mattered: several single-shot results reversed on repetition, in
both directions.

### A measurement bug worth recording

The first pass scored "tag compliance" as *all three tags present*. That was
wrong. Re-reading `coach.md`: `[PROGRESS]` and `[KB_UPDATE]` are required on
every response, but `[PROFILE_UPDATE]` is **conditional** — "whenever the learner
reveals ANYTHING about themselves." A model that correctly omits it when the
learner reveals nothing was being marked as failing.

Corrected scoring separates the two. This single fix moved Qwen3-VL from an
apparent 0/3 on `gaming` and `struggling` to 3/3 on required tags, and moved
Haiku from an apparent failure to full compliance. **Several conclusions in this
document exist only because the metric was re-examined, not because more models
were tested.**

## Results

Read these tables as **verification plus reference points**, not a leaderboard.
Qwen3-VL is the only candidate that clears all four constraints; Llama 4 Maverick,
Gemma 3 27B, and Haiku 4.5 are measured alongside it to establish whether the
eligible model is good enough to ship, and at what cost in speed and money. They
are marked *(license-ineligible)* or *(baseline)* accordingly.

### Required tag compliance (`[PROGRESS]` + `[KB_UPDATE]`), n=3

| Model | gaming | struggling | regression | Verdict |
|---|---|---|---|---|
| **Qwen3-VL 235B** | 3/3 | 3/3 | 3/3 | **pass — selected** |
| Llama 4 Maverick *(license-ineligible)* | 3/3 | 3/3 | 3/3 | pass |
| Gemma 3 27B *(license-ineligible)* | 3/3 | **2/3** | 3/3 | one response had no progress tag |
| Haiku 4.5 *(baseline)* | 3/3 | 3/3 | 3/3 | pass |

### Completion — does it award 10 when the exemplar is met? (n=5)

This is the make-or-break behavior: plato completes a lesson **only** at
`progress >= 10` (there is no exchange-count cutoff). A model that stalls at 9
would leave every learner unable to finish.

| Model | Scores | Awards 10 |
|---|---|---|
| **Qwen3-VL 235B** | 10, 10, 10, 10, 10 | **5/5** |
| Llama 4 Maverick *(license-ineligible)* | 10, 10, 10, 10, 10 | 5/5 |
| Gemma 3 27B *(license-ineligible)* | 10, 10, 10, 10, 10 | 5/5 |
| Haiku 4.5 *(baseline)* | 10, 10, 10, 10, 10 | 5/5 |

All four pass on an unambiguous prompt — the result that matters is that
**Qwen3-VL matches the incumbent on plato's make-or-break behavior**. Note a
weaker mid-lesson signal where Llama 4 capped at 9; with explicit "I'm done, both
objectives feel complete" framing it awards 10 reliably. Worth re-testing if
`coach.md` changes.

### Time-to-first-token, real coach payload (n=15 per model, two rounds)

This is the one axis where the license constraint costs something real.

| Model | min | p50 | p90 | max | >5 s |
|---|---|---|---|---|---|
| Llama 4 Maverick *(license-ineligible)* | 433 ms | **526 ms** | 642 ms | 816 ms | 0/15 |
| Haiku 4.5 *(baseline)* | 751 ms | 976 ms | 1404 ms | 2134 ms | 0/15 |
| **Qwen3-VL 235B (round 1)** | 688 ms | 1033 ms | 1899 ms | 2261 ms | 0/15 |
| **Qwen3-VL 235B (round 2)** | 705 ms | 1103 ms | 3475 ms | 3634 ms | 0/15 |

Against the incumbent the difference is small: Qwen3-VL's p50 is ~1.1 s vs Haiku's
0.98 s — roughly 100 ms slower on a streaming interface where first token lands
in about a second either way. That is the comparison that matters, since Haiku is
what learners experience today.

**Qwen3-VL has a latency tail that these 30 samples understate.** Two outliers
appeared in earlier ad-hoc runs: **47 s** and **36 s** time-to-first-token, on
the same payload that otherwise returns in ~1 s. Neither reproduced in the
controlled 15-sample rounds, so the frequency is unmeasured — call it low
single-digit percent, on unknown cause (likely capacity, not the request).
Llama 4 Maverick showed nothing comparable across every run; this is the known
cost of the license-eligible choice, and the reason for the fallback plan below.

### Vision check — a solid red JPEG, "what color is this?"

| Model | Answer | Verdict |
|---|---|---|
| **Qwen3-VL 235B** | "Red" | ✓ |
| Llama 4 Maverick *(license-ineligible)* | "Red." | ✓ |
| Gemma 3 27B *(license-ineligible)* | "Red." | ✓ |
| **Mistral Large 3 675B** | **"black"** | ✗ **disqualified** |

Mistral Large 3 advertises image input and failed the most trivial possible
vision test. A reminder that modality support in the model catalog is a claim, not
a guarantee — it has to be checked.

### Cost — us-east-2 on-demand, per 1M tokens

Measured token counts: ~3,800 in / ~250 out per turn, 16 exchanges per lesson
(production data: over-target lessons average 15.9 exchanges).

| Model | in $/M | out $/M | $/lesson | $/1,000 lessons | vs. Haiku |
|---|---|---|---|---|---|
| Haiku 4.5 *(baseline)* | 1.00 | 5.00 | $0.0808 | $80.80 | 1.0× |
| **Qwen3-VL 235B** | 0.53 | 2.66 | $0.0429 | $42.86 | **1.9× cheaper** |
| Llama 4 Maverick 17B *(license-ineligible)* | 0.24 | 0.97 | $0.0185 | $18.47 | 4.4× cheaper |
| Gemma 3 27B IT *(license-ineligible)* | 0.23 | 0.38 | $0.0155 | $15.50 | 5.2× cheaper |

Rates are real `us-east-2` on-demand from the AWS Pricing API, **except Haiku
4.5**, which is absent from the API — its $1/$5 is the Anthropic first-party rate
used as a proxy.

### Licenses — the deciding table

| Model | License | OSI-approved | Eligible |
|---|---|---|---|
| **Qwen3-VL 235B A22B** | **Apache-2.0** | **yes** | **✓** |
| Gemma 3 27B IT | Gemma Terms of Use | no — use restrictions | ✗ |
| Llama 4 Maverick | Llama 4 Community License | no — 700M MAU threshold, AUP, naming requirement | ✗ |
| Haiku 4.5 | proprietary | no — weights unavailable | ✗ |

Apache-2.0 is the only OSI-approved license in the set: no acceptable-use rider,
no user threshold, no naming requirement. Gemma and Llama are permissive *in
practice* for plato's usage but are not open source, and plato is an AGPL-3.0
project — see [constraint 4](#4-must-carry-an-osi-approved-license).

## Decision

**`qwen.qwen3-vl-235b-a22b`** (Qwen3-VL 235B A22B, Apache-2.0).

**It is the only candidate that satisfies all four constraints.** Bedrock-hosted
in `us-east-2`, accepts images, reliably emits plato's literal tags, and carries
an OSI-approved license. Every other model failed on at least one: Llama 4 and
Gemma on license, Haiku on license (proprietary), the rest on image support or
tag compliance.

Having only one eligible candidate means the real question was **is it good
enough to ship?** — and it is. Against the incumbent it matches on required tag
compliance (3/3), matches on completion behavior (awards `10` on 5/5), reads
images correctly, comes in ~100 ms slower at p50 TTFT, and costs 1.9× less.
Choosing an open source model did not require accepting a worse product.

### The trade being made, stated plainly

Llama 4 Maverick measured better on speed and price — p50 526 ms vs ~1.1 s, no
latency tail, 2.3× cheaper — and equal on every correctness measure. **That does
not make it the better choice here; it makes it the cost of the license
constraint.** An earlier draft of this document had it as the runner-up "arguably
the better engineering choice," reasoning that plato only calls the model over an
API and never redistributes weights, so the Llama clauses don't bind us. That's
true as far as legal exposure goes and beside the point: the goal was an open
source model, and Llama 4's license is not one.

So the honest framing is not "we picked the slower model on softer grounds." It is:
**the open source requirement cost us roughly 500 ms of p50 latency and some
savings we weren't seeking, and bought a stack that is open source end to end.**

### Fallback, and what it costs

If the Qwen3-VL latency tail proves to be a real production problem, **Llama 4
Maverick (`us.meta.llama4-maverick-17b-instruct-v1:0`) is the tested fallback** —
it passed every functional check, so the switch is a **one-line change** to `LLM`
in `server/src/lib/ai-provider.js` plus the mirror in `client/js/api.js`.

Flipping to it means **knowingly dropping below the open source bar** that
motivated this whole migration. That is a deliberate trade to make consciously and
document, not a silent config change: plato would then be an AGPL project running
on a non-OSI-licensed model. Prefer fixing or waiting out the tail first.

`MODEL_MAP` also retains the Anthropic IDs, so reverting to Claude is likewise a
one-liner — with the same caveat, more so.

## What we deliberately did not optimize for

### Cost

**Not a factor in the decision.** It was explicitly out of scope — the goal was
an open source model, not the cheapest one. Cost is reported above for
completeness and because the answer turned out to be favorable, but it broke no
ties and couldn't have: only one candidate was eligible. The cheapest model tested
(Gemma 3 27B) was *not* chosen, and the license-ineligible Llama 4 is 2.3× cheaper
than the model we shipped.

Worth stating plainly since it inverts a common assumption: **this migration
reduces spend.** Moving to an open source model was not a cost trade-off that had
to be justified — it pays for itself against the proprietary incumbent.

### Self-hosting

Never on the table as a near-term plan, despite being what open weights
technically enable. UIC requires Bedrock; standing up vLLM on EC2 or SageMaker
would mean GPU capacity planning, our own scaling and patching, and a second
production surface — against plato's whole architecture, which is serverless
precisely so nobody babysits it.

Worth being careful here, because this is where the license reasoning goes wrong
if you're not: "we'll never self-host, so the license clauses don't bind us"
is a tempting inference and a bad one. It treats the license as a liability
question when the requirement is definitional, and it also assumes the
never-self-host status quo is permanent. **Apache-2.0 keeps that door open
unconditionally; the Llama and Gemma licenses attach conditions to walking
through it.** The practical value of an OSI license here is **optionality and
consistency with plato's own AGPL-3.0 terms**, not an active self-hosting
roadmap.

### Local / on-device inference

Out of scope. plato is a hosted web app with server-side data and multi-tenant
classrooms; there is no local runtime to put a model in. Local dev calls the same
Bedrock endpoint as production — deliberately, so dev and prod behavior can't
diverge.

### Benchmark leaderboards

Largely ignored, as a considered choice. MMLU/GPQA/LMArena scores don't measure
what plato needs, and one earlier round of this evaluation went wrong precisely
by trusting them: `gpt-oss-120b` was recommended on reputation, then failed on
first contact because it's a reasoning model that emits no visible text at low
token budgets. Direct measurement against `coach.md` replaced this entirely.

### Long context windows

Deliberately discounted. Kimi K2's 256k window was initially attractive, but
plato caps the conversation tail at 40 messages (`slice(-40)`) and the whole
design targets ~20-minute lessons. A larger window solves a problem plato doesn't
have — and larger windows didn't correlate with better long-context accuracy
anyway.

### Prompt caching

**Impossible, not declined.** Prompt caching is Claude-exclusive on Bedrock.
Verified: Haiku 4.5 accepts `cachePoint` (observed cache read: 5,055 tokens),
while Qwen3, Kimi K2.5, DeepSeek V3.2, GLM 5, and gpt-oss-120b all hard-error
with `AccessDeniedException: You invoked an unsupported model or your request did
not allow prompt caching`.

A caching implementation existed on a branch and was **discarded** once this
became clear (PR #330, closed unmerged). Do not reintroduce it while plato runs
a non-Anthropic model.

For the record, it wouldn't have helped much anyway: Claude's minimum cacheable
prefix is 4,096 tokens and `coach.md` alone is ~3,685 — below the floor, where
Bedrock silently no-ops rather than erroring.

## Rejected candidates

| Model | Why rejected |
|---|---|
| **Kimi K2.5** | Initially recommended, then reversed. Repeat trials showed weak conditional-tag compliance (1/3) and TTFT 2.12 s. The single-shot result that made it look good didn't survive repetition. |
| **Kimi K2 Thinking** | No image support on Bedrock — different SKU from K2.5. Also a reasoning model. |
| **Mistral Large 3 675B** | Failed the vision test: called a solid red image "black". |
| **Pixtral Large** | 0/3 on required tags. |
| **gpt-oss-120b / -20b** | Text-only, and reasoning models: no visible text at low token budgets, 50 output tokens to say "OK". |
| **Llama 4 Maverick 17B** | **License not OSI-approved** (700M MAU threshold, acceptable-use policy, "Built with Llama" naming) — fails constraint 4. Passed every functional check and measured fastest and cheaper, so it is the documented fallback if Qwen's latency tail bites; taking it means consciously dropping below the open source bar. |
| **Gemma 3 27B IT** | **License not OSI-approved** (Gemma Terms of Use). Independently also 2/3 on required tags (one response omitted `[PROGRESS]`) — disqualifying for a tag-driven pipeline even setting license aside, and the weakest capability tier tested. |
| **GLM 5, DeepSeek V3.2, MiniMax M2.5, Qwen3 235B, Nemotron, Llama 3.3** | Text-only on Bedrock. |
| **Haiku 4.5** | Proprietary — fails the stated goal. Retained in `MODEL_MAP` as a one-line fallback, with the same license caveat as Llama 4, more so. |

## Known limitation, not attributable to this choice

**No model reliably detects learner regression — including Haiku.** When a
learner retracts earlier good work ("scrap all that, I have no idea what my
professional identity is"), progress should drop sharply. Measured:

| Model | Progress after retraction (from 8) |
|---|---|
| Gemma 3 27B | 4, 2, 2 — appropriate |
| Haiku 4.5 *(baseline)* | 5, 6, 4 — partial |
| Qwen3-VL 235B | 7, 5, 5 — weak |
| Llama 4 Maverick | 7, 7, 7 — weak |

`coach.md` does instruct that "the score can go up or down," but not forcefully
enough. **This is a prompt weakness, not a model-selection defect** — the
incumbent shares it, so the switch neither causes nor worsens it. Fixing it means
strengthening the regression guidance in `coach.md` and is tracked separately.

Also untested and worth flagging: multiple concurrent lessons, non-English input,
link attachments through the coach path, and behavior under throttling at load.

## Implementation consequence: the Converse API

Non-Anthropic Bedrock models are reachable **only** through Converse /
ConverseStream. The trap is that the legacy `InvokeModel` path does not reject
them — called with `qwen.*` or `openai.*` it returns **HTTP 200** with an
OpenAI-shaped body (`choices[0].message.content`), so a caller reading
`content[0].text` silently gets `undefined`. This fails quietly, which is worse
than failing loudly.

plato keeps the **Anthropic Messages shape as its internal wire format** and
translates only at the Bedrock boundary (`server/src/lib/converse.js`). The
client, orchestrator, lesson engine, and plugin SDK are all unchanged. Converse
event ordering was verified identical for Anthropic and open-weight models, so no
per-provider chunk handling is needed, and Converse authorizes under the same
`bedrock:InvokeModel*` IAM actions — no `template.yaml` change.

See [`ARCHITECTURE.md`](ARCHITECTURE.md#ai-provider--model-choice) for the
translation details.

## Revisit triggers

Reopen this decision if:

- **The Qwen3-VL latency tail shows up in production.** Watch for >5 s TTFT in
  the log-watch alarm. Llama 4 Maverick is the tested fallback, one line away —
  at the cost of the open source bar.
- Learners report progress that doesn't advance, or lessons that won't complete —
  the tag-compliance signature.
- **Bedrock `us-east-2` adds another OSI-licensed vision model.** This is the
  change that would most improve the decision: today the eligible set has exactly
  one member, so there is no margin. A second Apache-2.0 (or MIT) vision model
  would turn this from a forced choice into an actual comparison.
- **Meta or Google relicenses under OSI-approved terms.** Would make Llama 4
  Maverick or Gemma genuinely eligible, and on the measured numbers Maverick would
  then be the favorite.
- `coach.md` changes materially — the scenario suite would need re-running, since
  every result here is prompt-specific.
- Prompt caching becomes available for non-Anthropic Bedrock models, which would
  meaningfully change the cost and latency picture.
