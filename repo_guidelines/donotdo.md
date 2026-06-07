# Detailed Prompt: Reject Phrase-Matching Fixes for Core Runtime Logic

Use this prompt when reviewing or designing a fix for an agent-runtime bug where the assistant appears to stop early, emit a planning preamble, or otherwise behave as if a turn completed before the real work was done.

---

You are reviewing a proposed fix for a core agent-runtime completion bug.

The suspected anti-pattern is this:

- The runtime currently accepts a non-empty assistant reply as a completed turn.
- A model sometimes emits a planning preamble such as “I’ll look into that” or “Let me get more detail” instead of doing the work.
- The proposed fix attempts to detect that bad outcome by pattern-matching the assistant’s natural-language response.
- The proposal may also inject synthetic follow-up messages into the transcript to push the model to continue.

Your job is to reject that class of fix unless the author can prove it is not using language heuristics as core control flow.

Evaluate the proposal using the following standards.

## What to Look For

Check whether the implementation does any of the following:

- classifies turn completion by inspecting assistant prose,
- uses regex, prefix checks, suffix checks, substring checks, or phrase lists to decide whether a reply is final,
- treats short replies or certain English formulations as a proxy for runtime state,
- adds provider-specific conversational heuristics in a supposedly generic runtime path,
- injects synthetic user or system messages into the transcript to compensate for a missing state-machine invariant,
- adds tests that only prove the heuristic works for one wording pattern rather than proving the runtime contract is correct.

If any of those are true, treat the proposal as a symptom-level patch unless there is a very narrow, explicitly isolated compatibility exception with a strong justification.

## Why This Is a Bad Idea

Explain clearly that this approach is flawed for structural reasons, not style reasons.

Call out the following failure modes:

1. It encodes English phrasing instead of system state.
The real bug is a missing runtime invariant around turn completion, not the presence of phrases like “Let me” or “I’ll”.

2. It generalizes one provider’s failure into global behavior.
A production incident from one model or provider should not become a generic rule for all tool-capable turns.

3. It is brittle by construction.
Phrase lists inevitably miss variants, overmatch valid answers, vary across model families, and degrade further with different tone, wording, or language.

4. It mutates transcript history to hide a runtime design gap.
Synthetic nudges or transcript injections change model behavior, prompt caching, memory interactions, telemetry interpretation, and reproducibility.

5. It blurs the boundary between assistant language and runtime policy.
Core completion policy should be driven by structured state, not text interpretation.

6. It creates false positives.
Short valid answers can be misread as “planning preambles” and force unnecessary extra model calls.

7. It creates false negatives.
Non-substantive replies that do not match the chosen phrases will still slip through.

8. It duplicates heuristics across layers.
Post-hoc diagnostics or receiver-side forensics should not become sender-side runtime policy by copy.

9. It makes recovery look like correctness.
Even if the extra nudge helps sometimes, it does not explain or fix why the runtime believed the turn was complete.

10. It normalizes the wrong engineering habit.
It teaches the codebase that when models misbehave, the answer is to add another phrase-based exception.

## What a Root-Cause Fix Should Target Instead

Require the author to move the fix down to the state-machine or turn-contract layer.

Push them to answer questions like these:

- What does the runtime currently treat as sufficient evidence that a turn is complete?
- Which structured states should count as valid completion for a work-execution turn?
- How does the runtime distinguish between:
	- a real final answer,
	- a concrete blocking clarification,
	- a tool-using execution step,
	- an incomplete intermediate acknowledgement?
- Can completion be expressed through structured response semantics rather than natural-language guessing?
- Is the bug actually that the runtime lacks an explicit notion of turn intent, completion state, or continuation requirements?

Direct the solution toward structured invariants such as:

- whether any tool call occurred,
- whether the assistant asked a concrete blocking clarification,
- whether the turn was classified as execution work versus direct Q&A,
- whether the provider exposed a structured finish condition,
- whether the runtime has an explicit finalization contract stronger than “non-empty text”.

## Required Review Response

If the implementation relies on phrase matching, respond with a review comment substantially similar to this:

"This fix is operating at the wrong layer. It tries to infer runtime completion from assistant prose rather than fixing the completion contract itself. Do not add regex, keyword checks, prefix checks, or synthetic transcript nudges in the main conversation loop to guess whether a reply is really final. Move this fix to structured turn semantics: define what counts as valid completion for the turn type, and drive the behavior from runtime state such as tool usage, clarification state, explicit finalization, or turn intent classification."

## Required Outcome

Do not approve the change unless the author can show that:

- completion is determined by structured runtime state rather than free-text guessing,
- the fix does not inject hidden steering messages into the transcript to compensate for a missing invariant,
- the implementation narrows or clarifies the actual turn contract,
- the tests validate the invariant or state transition, not just one wording pattern,
- the result improves the runtime model rather than adding another heuristic exception.

## Short Version

Do not fix core completion bugs by pattern-matching assistant prose.
Do not add regex or keyword heuristics in the main conversation loop to guess whether a reply is final.
Do not inject synthetic user or system nudges into transcript history to compensate for missing runtime invariants.
Fix completion at the state-machine layer using structured signals such as tool usage, clarification state, explicit finalization semantics, or turn intent classification.