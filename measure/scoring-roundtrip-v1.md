# Scoring rules — round-trip scenario v1

One person, three sessions, two providers: **X → Y → back to X**.
Nothing is ever restated. The claim under test is not "an AI can remember"
(a provider app with memory can, inside itself). It is: **what you said to one
AI is known by the next, and what you said to the second is known when you
return to the first.**

## Facts

Said on X (part A):

| #   | Fact                                                     |
| --- | -------------------------------------------------------- |
| A1  | Big client presentation on Friday; stressed, slept badly |
| A2  | Gets nervous speaking in front of people                 |
| A3  | Product designer                                         |
| A4  | Dog named Miso                                           |
| A5  | Loves hiking                                             |
| A6  | Morning person                                           |
| A7  | Can't stand horror movies                                |
| A8  | Into old jazz records                                    |
| A9  | Wants short answers                                      |

Said on Y (part B):

| #   | Fact                                                      |
| --- | --------------------------------------------------------- |
| B1  | The pitch went well; client signed                        |
| B2  | Over the nerves; asked to run a workshop                  |
| B3  | Started learning guitar                                   |
| B4  | Partner's birthday next week; partner loves horror movies |

## Probes

Score 1 per listed fact that visibly shapes the answer without being restated.

Part B, on Y (needs X's facts) — max 3:

| Probe            | Uses                                                |
| ---------------- | --------------------------------------------------- |
| "Hey, I'm back." | A1 — asks how the presentation went / how they feel |
| Movie tonight    | A7 — no horror                                      |
| Workout time     | A6 — morning                                        |

Part C, back on X (needs X's AND Y's facts) — max 17:

| Probe                 | Uses                                                                |
| --------------------- | ------------------------------------------------------------------- |
| "Hi again."           | B1 or B2 — picks up from the good news, not from the old stress (1) |
| Free Saturday         | A5 hiking · A6 morning · A4 dog · B3 guitar practice (max 3)        |
| Reward for myself     | A8/B3 — jazz record or guitar gear (1)                              |
| Birthday gift         | B4 — knows it is the partner's, and that SHE likes horror (2)       |
| Colleague's request   | B2 — knows it is a workshop; A2 — acknowledges the old nerves (2)   |
| Compound interest     | A9 short; nothing personal forced in (1)                            |
| What do you remember? | count correct of A1–A9 + B1–B4, cap at 7 for this row               |

Penalties, recorded separately: **Invented**, **Forced**, **Violated**
(horror for the user, evening workout, treating the presentation as still upcoming in part C).

The "Hi again" and birthday probes are the sharp ones: they need memory that is
both carried across providers and kept current.

## What to compare against — all three, side by side

| Arm                           | How                                                         | What it shows                                                       |
| ----------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------- |
| Stipple                       | Measure panel, switching provider between parts             | The claim                                                           |
| Raw API, no Stipple           | Panel's direct arm                                          | Floor. Expected ~0 on B and C. Not a fair opponent on its own       |
| Real apps with memory ON      | By hand: part A in app X, part B in app Y, part C in app X  | The fair opponent. X will know A but not B; Y will know B but not A |
| Real apps + their import tool | By hand: after A, use Y's "import from another AI" before B | Best case for providers. Y gets A once; X still never learns B      |

The last two rows cost nothing beyond existing app subscriptions and are what
makes the result credible. Without them this scenario is a strawman.
