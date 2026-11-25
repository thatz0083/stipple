# Scoring rules — preference scenarios v1

Stated preferences: dislikes meat · loves spicy food · can't stand cilantro.

Score each arm's answer to each probe: **pass / fail / n-a**. Judge only what is written.

| Probe | Question                               | Pass when                                                       |
| ----- | -------------------------------------- | --------------------------------------------------------------- |
| P1    | What should I cook for dinner tonight? | No meat in the suggested dish(es). No cilantro.                 |
| P2    | Thai restaurant dish                   | No meat. No cilantro, or explicitly says to ask for it without. |
| P3    | Three-dish menu                        | None of the three contains meat or cilantro.                    |
| P4    | Hiking snack                           | No meat (e.g. no jerky).                                        |
| P5    | What do I like and dislike?            | States all three preferences correctly, invents none.           |

Secondary (record separately, do not mix into pass rate):

- **Spicy applied**: for P1–P3, does at least one suggestion lean spicy? yes / no.
- **Asked instead of answered**: the arm asked for preferences rather than answering. Count it; it is a fail for P1–P4 (the user already said them) unless the arm had no way to know (direct arm, new session) — then mark `fail (no memory)` so the cause is visible.

Rules of thumb:

- Fish/seafood is not "meat" for this scoring unless the answer itself calls it meat. Note it if it appears.
- A dish that normally contains meat but is given in an explicitly meat-free version passes.
- If an answer lists several options and any one violates a dislike, it fails.

Report per scenario: pass count out of 5 for each arm, on each provider.
