# Measurement sets

Question files for the dev-only measure panel (`/?measure=1`). One question per
line; lines starting with `#` are skipped. Paste a file's contents into the panel.

Fix these files BEFORE running and do not edit them after seeing results.
If a set changes, bump its version in the filename and re-run everything.

| File                                                          | What it measures                                                                                                                                                           | How to run                                                                                                                                                                                 |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pool-general-v1.txt`                                         | Local rate + token totals on everyday questions                                                                                                                            | Fresh thread, memory cleared, direct arm history = full                                                                                                                                    |
| `scenario-roundtrip-v1.a.txt` then `scenario-parity-v1.b.txt` | **Run first.** Same provider, new session. Target is parity with a provider app that has memory — plus what stayed local and what can be exported                          | Fresh thread, memory cleared, `.a`; new thread + reload; parity `.b` on the SAME provider. Score with `scoring-parity-v1.md` (three columns)                                               |
| `scenario-roundtrip-v1.a.txt` → `.b.txt` → `.c.txt`           | **Primary.** Ordinary conversation on provider X, continued on provider Y, then back on X. Tests whether what was said to one AI is known by the other, in both directions | Fresh thread, memory cleared. `.a` on X; new thread + reload; `.b` on Y; new thread + reload; `.c` on X. Score with `scoring-roundtrip-v1.md`, including the by-hand runs in the real apps |
| `scenario-pref-same-thread-v1.txt`                            | Preference kept late in ONE conversation                                                                                                                                   | Fresh thread, memory cleared                                                                                                                                                               |
| `scenario-pref-new-session-v1.a.txt` then `.b.txt`            | Preference kept across sessions                                                                                                                                            | Run `.a`, open a NEW thread (do not clear memory), reload the page, run `.b`                                                                                                               |
| `scenario-pref-switch-v1.a.txt` then `.b.txt`                 | Preference kept across providers                                                                                                                                           | Run `.a` on provider X, new thread + reload, run `.b` on provider Y                                                                                                                        |

Reloading the page before a `.b` file matters: it resets the direct arm's
history, which is what a new session / new provider means for a raw API call.

## Scoring preference scenarios

`scoring-pref-v1.md` lists, per probe question, the rule an answer must satisfy.
Score each arm's answer by hand against the rule: pass / fail / n-a.

## Known limits (state these wherever results are shown)

- `pool-general-v1` is hand-written to follow published usage proportions
  (how-to, information, writing as the bulk; small shares of math, code,
  chit-chat). It is NOT a random sample of real traffic. Replace with a sampled
  public dataset before making public claims about "random questions".
- The direct arm is a raw API call with no cross-session memory. This is not a
  comparison against a provider's consumer app with its memory feature.
- Preference scenarios are designed to expose the memory effect. Report them
  separately from the general pool; never blend the two into one number.
