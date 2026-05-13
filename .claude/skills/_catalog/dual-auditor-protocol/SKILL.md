---
name: dual-auditor-protocol
description: Run two adversarial AI auditors in parallel (Anthropic + OpenAI) against the same code/spec/deliverable, then synthesize findings into a unified report. Reduces single-model bias and surfaces issues that one model alone misses. Designed for production code audits, architecture reviews, security passes, and any high-stakes deliverable where rigor matters more than speed. Triggers ("audit con doble auditor", "audit con dos modelos", "/dual-audit", "audit de código de producción", "/dual-auditor").
allowed-tools: Read, Glob, Grep, Bash, Write
---

# dual-auditor-protocol — two adversarial AI auditors in parallel

This skill orchestrates a structured audit using **two LLMs in parallel as adversarial auditors**, plus a third call as **synthesizer**. The output is a unified findings report that combines the unique perspectives of both auditors while flagging consensus, divergence, and confidence levels.

The pattern was promoted from `audit-master/.claude/skills/dual-auditor-protocol/` in Sprint v3.1 after proving repeated value on production ERP audits.

## When to use this skill

Activate `dual-auditor-protocol` when:

- The deliverable is **production code** with real consequences (live system, paying customers, financial transactions).
- A **single audit pass feels too risky** — the user asked specifically for "rigorous" or "thorough" review.
- The codebase is **large enough that a single model might miss issues** (typically >500 LOC per module or >10 modules).
- You need to **defend a decision against post-hoc criticism** ("but you missed X") — having two independent auditors makes that case harder.

### When NOT to use

- Quick prototypes, throwaway scripts, MVP code that hasn't shipped.
- Code where a single critic pass + `cold-reader-gate` is enough (the default flow in `pipeline-v2`).
- Time-critical situations where the second model + synthesis adds 3–5 minutes you don't have.
- Cost-sensitive contexts: dual audit costs roughly 2.5× a single audit (two parallel calls + one synthesis call).

If unsure, default to single-auditor flow and ask the user before escalating.

## Core architecture

```
   ┌─────────────────────────┐
   │  TARGET (code / spec)   │
   └───────────┬─────────────┘
               │  same payload
       ┌───────┴────────┐
       ▼                ▼
  ┌────────────┐  ┌────────────┐
  │ AUDITOR A  │  │ AUDITOR B  │
  │ (Claude    │  │ (OpenAI    │
  │  Opus 4.5) │  │  GPT-5)    │
  └─────┬──────┘  └─────┬──────┘
        │                │
        │ findings A     │ findings B
        │ (JSON schema)  │ (JSON schema)
        ▼                ▼
   ┌─────────────────────────┐
   │      SYNTHESIZER        │
   │  (cross-references,     │
   │   ranks, dedups,        │
   │   flags consensus/      │
   │   divergence)           │
   └───────────┬─────────────┘
               │
               ▼
   ┌─────────────────────────┐
   │  audit/findings-A.md    │
   │  audit/findings-B.md    │
   │  audit/synthesis.md     │
   └─────────────────────────┘
```

**Key principles:**

1. **Two auditors see the SAME input.** No leakage between them. They must NOT see each other's output until synthesis.
2. **Different model families.** Use a Claude variant + an OpenAI variant (or any cross-family pair). Avoids the trivial case where both share the same bias.
3. **Adversarial framing.** Each auditor is instructed to be SKEPTICAL, look for problems, not validate. "Find what's wrong" not "review this".
4. **Structured output (JSON schemas).** Both auditors must emit findings that match `contracts/schemas/findings-auditor.schema.json`. The synthesizer consumes them via `consumeInput()`.
5. **Synthesizer dedups + ranks.** Same issue found by both → high confidence. Found by only one → marked single-source.

## Limitation: subagents CANNOT use Write

Per Claude Code's runtime, **subagents launched via the Agent tool cannot write to project files** (decision D6). The wrapper blocks `Write` with "Subagents should return findings as text."

This affects how the protocol runs:

- If the auditors run as **subagents** (typical): they return findings as TEXT in their final response. The orchestrator (main Claude) writes `audit/findings-deep-A.md` and `audit/findings-deep-B.md` from those texts.
- If the auditors run as **scripts via OpenRouter** (`src/openrouter_client.js`): they write directly to files because they're not subagents.

**The brief to each auditor MUST include this instruction literally**:

> "Return your findings as TEXT in your final response, wrapped in a single fenced code block tagged `json`. Do NOT use the Write tool — the wrapper blocks it. The orchestrator will persist the file. If your findings exceed 50k tokens, split into N parts and indicate `part 1/N, continued in next turn` at the end."

## Recommended models

| Auditor slot | Model | Why |
|---|---|---|
| Auditor A | `anthropic/claude-opus-4.5` | Best long-context reasoning, strong at architectural concerns. |
| Auditor B | `openai/gpt-5` | Different training distribution, strong at security + edge cases. |
| Synthesizer | `anthropic/claude-opus-4.5` (or `claude-sonnet-4.5` for cheaper) | Excellent at structured summarization + cross-referencing. |

Alternative pairing: `google/gemini-2.5-pro` + `anthropic/claude-opus-4.5` if cost or rate-limits push you off OpenAI.

## Timeout policy

Production code audits often hit 50k+ tokens of context. The default `timeout_ms` of 120s in `src/openrouter_client.js` is NOT enough for reasoning models with that context.

**Use `timeout_ms: 300_000` minimum** (5 minutes). For 100k+ token contexts, push to `600_000` (10 minutes). The README of `openrouter_client` documents this in detail.

Sprint v3.1 added `timeout_ms` as a per-call parameter precisely to fix this — Sprint v3.0's hardcoded 120s caused `dual_auditor_b.js` to fail 5/17 modules in audit-master.

```javascript
import { chat, MODELS } from '../src/openrouter_client.js';

const response = await chat({
  model: MODELS.openai.gpt5,
  messages: [{ role: 'user', content: prompt }],
  timeout_ms: 300_000,  // 5 min para reasoning + context grande
});
```

## Output schemas

The skill ships with two JSON schemas under `contracts/schemas/`:

- **`findings-auditor.schema.json`** — shape of each auditor's output. Required fields:
  - `auditor`: string (e.g., `"claude-opus-4.5"` or `"gpt-5"`).
  - `target`: string (what was audited — file path, module name, spec name).
  - `audited_at`: ISO timestamp.
  - `findings`: array of `{ id, severity: "critical"|"high"|"medium"|"low"|"info", category, title, description, evidence?, suggested_fix? }`.
  - `overall_verdict`: enum `"pass" | "pass_with_fixes" | "fail"`.
  - `summary`: 1–3 paragraph executive summary.

- **`dual-audit-synthesis.schema.json`** — shape of the synthesizer's output. Required fields:
  - `synthesized_at`: ISO timestamp.
  - `target`: string.
  - `auditor_a_summary`: string (1 line).
  - `auditor_b_summary`: string (1 line).
  - `consensus_findings`: array (both auditors flagged the same issue).
  - `divergent_findings`: array (only one auditor flagged it; includes which one + their reasoning).
  - `consolidated_verdict`: enum `"pass" | "pass_with_fixes" | "fail"` + `verdict_reasoning`.
  - `recommended_next_steps`: array of strings.

## End-to-end example flow

```bash
# 1. Orchestrator reads the target.
TARGET=src/billing/invoice-pipeline.js

# 2. Launches two auditor subagents in parallel (single Agent tool batch call).
#    Each subagent gets:
#      - The full target file contents.
#      - Identical instructions ("be adversarial, return JSON matching schema").
#      - Different model (Claude A / GPT B).

# 3. Each subagent returns findings as text. Orchestrator writes:
#    - audit/findings-deep-A.md  (Claude's findings, wrapped + parsed)
#    - audit/findings-deep-B.md  (GPT's findings, wrapped + parsed)

# 4. Orchestrator launches synthesizer (third call) with BOTH JSON outputs
#    + the original target. The synthesizer:
#      - Cross-references findings by category + line ranges.
#      - Marks "consensus" when both A and B flagged the same area.
#      - Marks "divergent_A" / "divergent_B" for solo findings.
#      - Emits consolidated verdict.

# 5. Orchestrator writes audit/synthesis.md and prints summary to user.

# 6. (Optional) Pass synthesis through cold-reader-gate as a 4th independent layer.
```

## Brief template for each auditor (literal)

When invoking each auditor subagent, the orchestrator passes EXACTLY this brief (substituting `{AUDITOR_ID}`, `{MODEL_NAME}`, and `{TARGET_PATH}`):

```
You are AUDITOR {AUDITOR_ID}, a senior security and architecture reviewer.
Model: {MODEL_NAME}.

Your job is to find what's WRONG with the code/spec below. Be skeptical. Look for:
- Logic bugs (off-by-one, race conditions, missing null checks).
- Security holes (injection, auth bypass, secrets in code, CSRF).
- Performance traps (O(N²) loops, missing indices, blocking I/O on hot paths).
- Architectural concerns (tight coupling, layer violations, untested critical paths).
- Edge cases not handled (empty inputs, max values, concurrent users).
- Maintainability red flags (magic numbers, unclear names, missing docs on tricky parts).

Do NOT validate the code as "looks fine". Assume the code has problems. Find them.

Target: {TARGET_PATH}
Content below the dotted line.

Return your findings as TEXT in your final response, wrapped in ONE fenced code block tagged `json`. Match the schema `contracts/schemas/findings-auditor.schema.json`. Do NOT use the Write tool — the wrapper blocks it. The orchestrator will persist the file.

If your findings exceed 50k tokens, split into N parts and indicate `part 1/N, continued in next turn` at the end of each part.

........................................

<contents of {TARGET_PATH}>
```

## Brief template for the synthesizer (literal)

```
You are the SYNTHESIZER of a dual-auditor protocol.

Two adversarial auditors (A=Claude, B=GPT) reviewed the same target independently.
Their findings are below as JSON. The original target is also below for reference.

Your job:
1. Cross-reference findings by category, severity, and location.
2. Mark each finding as:
   - `consensus`: both A and B flagged the same or substantially overlapping issue.
   - `divergent_A`: only A flagged it. Include A's reasoning verbatim.
   - `divergent_B`: only B flagged it. Include B's reasoning verbatim.
3. Issue a `consolidated_verdict` ("pass" | "pass_with_fixes" | "fail") with reasoning.
4. List `recommended_next_steps` in priority order.

Be specific. Do NOT just list findings — explain why consensus vs divergence matters for confidence.

Return as TEXT in a single fenced code block tagged `json`, matching `contracts/schemas/dual-audit-synthesis.schema.json`. NO Write tool.

........................................

TARGET: {TARGET_PATH}

........................................

AUDITOR A (Claude) findings:
{JSON from findings-deep-A.md}

........................................

AUDITOR B (GPT) findings:
{JSON from findings-deep-B.md}
```

## Anti-patterns

- ❌ Letting one auditor see the other's output before the synthesizer step. Defeats the diversity.
- ❌ Using two variants of the same model family (e.g., Claude Opus + Claude Sonnet). Same training bias.
- ❌ Using a `timeout_ms` below 300s for reasoning models on large contexts. Returns empty/partial JSON → synthesizer crashes.
- ❌ Telling the auditors "validate this code is good." They will rubber-stamp. The adversarial framing is what makes it work.
- ❌ Skipping the JSON schema validation. The synthesizer needs structured input; free-form prose makes cross-referencing impossible.
- ❌ Asking the subagents to use Write directly. They CAN'T. The orchestrator writes.
- ❌ Running dual-audit on trivial code (< 100 LOC, throwaway). Overkill; just use single critic.

## Next steps after the synthesis

If the consolidated verdict is `pass`, you're done.

If `pass_with_fixes`, the orchestrator addresses each finding by priority (critical → high → medium → low) and either fixes in code or files an issue in the project backlog.

If `fail`, escalate to the human. The dual-auditor said the deliverable has fundamental problems — don't just bypass and ship. Pass through `cold-reader-gate` if you want a third independent layer, but the right move is usually to redesign rather than patch.

## Versión

v0.1 — 2026-05-13 — Sprint v3.1 promotion from audit-master local skill. Schemas in `contracts/schemas/`, brief templates literal in this file, end-to-end flow documented. To reach v1.0: add a reference reusable script (`scripts/dual_auditor.js`) that orchestrates the 3 calls programmatically with `src/openrouter_client.js` and `timeout_ms: 300_000`.
