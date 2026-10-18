---
name: research
description: Answer a question about this codebase by fanning out parallel read-only subagents and looping until a stated, checkable stop condition passes. Use when the answer needs a sweep across many files (inventories, "where is X used", config or key audits); not for single-file lookups or for making code changes.
---

# Research

A research run ends on evidence, not on a feeling of being done. Before any
subagent starts, write down the stop condition as a command or check that
anyone can rerun.

## 1. Define the condition

State three things in the run's notes (scratchpad, not the repo):

- **Question.** One sentence.
- **Stop condition.** A check with a yes/no result. Prefer a shell command
  (`npm run doctor` exits 0, a grep returns nothing unaccounted for, a test
  passes). If no command fits, use a closed list: "every name returned by
  `<grep>` has a row in the findings table".
- **Ground truth source.** The command that produces the full set the
  findings are checked against. Subagents never decide what "all" means.

If the condition can't be stated as a check, narrow the question until it can.

## 2. Split the sweep

Cut the search space into 3 to 6 slices that don't overlap: by directory
(`server/`, `src/`, `scripts/`), by mechanism (env reads, client injection,
docs), or by provider. Spawn one `Explore` agent per slice in a single message
so they run in parallel.

Each prompt must say:

- the slice it owns and what to ignore;
- the exact output shape (a table or JSON list with `file:line` for every
  row) so results can be merged mechanically;
- that it reports, it doesn't edit.

## 3. Merge and verify

Merge the slices into one table. Run the ground-truth command yourself and
diff it against the table. Never trust a subagent's "that's everything".

- Every gap becomes a new, narrower slice for a follow-up agent.
- Every row a subagent claims, spot-check at least one `file:line`.

## 4. Loop

Repeat step 3 until the stop condition passes. Cap it at 4 rounds. If it
still fails, stop and report what's left open and why, rather than widening
the question.

## 5. Report

Lead with the stop condition and its result, then the findings table, then
anything the condition couldn't cover. Write durable output (docs, manifests)
only when the user asked for it.

## Limits

- Subagents are read-only. Code changes happen after the run, in the main
  session.
- Never put secrets in findings. For credentials, record the variable name,
  where it's read, and how to obtain it. Never search for, copy or guess
  real key values.
