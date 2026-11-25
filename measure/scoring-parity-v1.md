# Scoring rules — parity scenario v1

Part A = `scenario-roundtrip-v1.a.txt`. Part B = `scenario-parity-v1.b.txt`. Same provider, new session.

**The claim is parity, not superiority.** A provider app with memory already
does "it knows me" inside itself. If Stipple reaches the same answers, three
things are true that are not true of the provider app:

1. part of the conversation never went to the cloud,
2. the memory behind those answers sits with the user, visible,
3. it exists as a file that can go to another provider.

So report three columns, not one.

## Column 1 — Does it know me? (same scale for every arm, max 20)

Facts from part A: A1 presentation Friday + stressed · A2 nervous speaker ·
A3 product designer · A4 dog Miso · A5 hiking · A6 morning person ·
A7 no horror · A8 old jazz · A9 short answers.

| Probe                 | Uses                                             | Max |
| --------------------- | ------------------------------------------------ | --- |
| "Hey, I'm back."      | A1 — asks about the presentation / how they feel | 1   |
| Free Saturday         | A5 · A6 · A4                                     | 3   |
| Movie tonight         | A7                                               | 1   |
| Reward                | A8 or A5                                         | 1   |
| Workout time          | A6                                               | 1   |
| Another talk          | A2 · A1                                          | 2   |
| Compound interest     | A9 short, nothing personal forced in             | 1   |
| What do you remember? | correct of A1–A9, +1 if none invented            | 10  |

Penalties recorded separately: Invented · Forced · Violated.

Arms: Stipple · raw API (floor) · the provider's real app with memory ON (by hand).
**Target: Stipple within a point or two of the real app.** Equal is a pass.

## Column 2 — What stayed local? (Stipple only)

From the run file, over parts A + B (20 turns):

- turns finished with zero cloud calls, and which ones
- total tokens vs the raw-API arm
- tokens Stipple added per cloud call (system prompt size)

Turns expected to be local once capture works: plain statements that need only
an acknowledgement, "Hey, I'm back.", "What do you remember about me?".

## Column 3 — What can leave with me? (Stipple only)

After part B, open the memory screen / export and record:

- how many of A1–A9 are present as stored items
- whether each shows the sentence it came from
- whether the export file exists and re-imports cleanly

This file is the input to `scenario-roundtrip-v1` — parity produces the thing
that the round trip then uses.

## How to read the result

| Outcome                                               | Meaning                                                      |
| ----------------------------------------------------- | ------------------------------------------------------------ |
| Column 1 equal to the real app, columns 2–3 non-empty | The claim holds: same experience, less sent, and it is yours |
| Column 1 clearly below the real app                   | Capture is the gap — fix before anything public              |
| Column 1 above the real app                           | Report it, but do not lead with it; one script proves little |
