# Ralph Wiggum Loops

Context isolation protocol for RepoPrompt (`rp-cli`) when you want intentionally dumb, short, low-memory loops instead of long evolving chats.

## Purpose

Use this when you want:
- Fresh reasoning per question
- Minimal carryover from old conclusions
- Deterministic, repeatable `rp-cli` runs

Use this phrase to invoke the protocol in future agent runs:

`Follow docs/reference/ralph-wiggum-loops.md in RW-STRICT mode.`

---

## Core Rules (RW-STRICT)

1. Always pass `-w <window_id>` and `-t <tab_id>` on every `rp-cli` call.
2. Never start a new sub-question with continued chat history.
3. Start each sub-question with a new chat:
- `plan "..."` or
- `chat "..." --mode plan --new`
4. Keep each chat to max 2 user turns (question + one follow-up).
5. Replace selection for each loop scope (`select set ...`) instead of only appending (`select add ...`).
6. If token footprint grows or topic shifts, rebuild context (`builder ...`) before asking the next question.
7. Do not reuse old `chat_id` unless the task is truly the same micro-problem.

---

## Why This Works

`rp-cli chat` continues recent chat by default. That pulls in previous conversation state and can bias output. Fresh chat creation (`plan` or `--new`) keeps scope narrow.

Tab state also persists (prompt + selected files). If you do not replace selection and prompt, context still rots even with fresh chats.

---

## Quick Start

```bash
# 0) Discover routing
rp-cli -e 'windows'
rp-cli -w <W> -e 'workspace tabs'

# 1) Sanitize tab context for this loop
rp-cli -w <W> -t <T> -e 'prompt clear'
rp-cli -w <W> -t <T> -e 'select set <path-or-dir-for-this-loop>'
rp-cli -w <W> -t <T> -e 'select get'

# 2) (Optional but recommended) rebuild context
rp-cli -w <W> -t <T> -e 'builder "<task>...</task><context>...</context>" --response-type plan'

# 3) Ask in a fresh chat
rp-cli -w <W> -t <T> -e 'plan "Answer only for current selection; list constraints first."'

# 4) Optional single follow-up
rp-cli -w <W> -t <T> -e 'chat "One clarification: include edge cases only." --mode chat'

# 5) Next sub-question => NEW chat again
rp-cli -w <W> -t <T> -e 'plan "Now evaluate alternative B only."'
```

---

## Loop Types

## RW-1: Isolated Question Loop

Use for architecture questions and scoped analysis.

```bash
rp-cli -w <W> -t <T> -e 'prompt clear'
rp-cli -w <W> -t <T> -e 'select set <target-scope>'
rp-cli -w <W> -t <T> -e 'plan "<single focused question>"'
```

## RW-2: Isolated Investigate Loop

Use for root-cause hunts.

```bash
rp-cli -w <W> -t <T> -e 'prompt clear'
rp-cli -w <W> -t <T> -e 'select set <suspected-area>'
rp-cli -w <W> -t <T> -e 'builder "<task>Investigate <symptom>.</task><context><facts></context>" --response-type question'
rp-cli -w <W> -t <T> -e 'plan "Based on selected files only, rank top 3 causes with evidence."'
```

## RW-3: Isolated Implement Loop

Use when implementing one bounded patch.

```bash
rp-cli -w <W> -t <T> -e 'prompt clear'
rp-cli -w <W> -t <T> -e 'select set <exact-files-or-dir>'
rp-cli -w <W> -t <T> -e 'builder "<task>Implement <change>.</task><context><constraints></context>" --response-type plan'
rp-cli -w <W> -t <T> -e 'plan "Give minimal patch plan with file list and risk checks."'
# then edit directly with apply_edits/file_actions
```

---

## Hard Anti-Patterns

- Repeating `chat "..." --mode plan` without `--new` for unrelated questions.
- Keeping one chat alive for the whole day.
- Growing selection forever with `select add` only.
- Skipping `select get` visibility checks.
- Reusing stale prompt text across different problems.

---

## Health Checks

Run these before each new loop:

```bash
rp-cli -w <W> -t <T> -e 'select get'
rp-cli -w <W> -e 'chats'
rp-cli -w <W> -t <T> -e 'prompt get'
```

Reset if any of these is true:
- Selection is clearly broader than current task.
- Prompt still describes a previous task.
- Last chat already contains multiple unrelated turns.

---

## Minimal Invocation Snippets

For strict isolation:

`Use docs/reference/ralph-wiggum-loops.md. Run RW-STRICT with RW-1 for this task.`

For isolation with implementation:

`Use docs/reference/ralph-wiggum-loops.md. Run RW-STRICT with RW-3 and keep max 2 turns per chat.`

---

## Notes

- `builder` can take several minutes; this is normal.
- Fresh chat isolation is cheap and high-value.
- Full tab isolation is stronger than chat isolation; if needed, start from a new tab and apply the same rules.
