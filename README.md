# Stipple
*formerly DOTS · a solo project by Tei · public since June 2026*

**A local-first layer for LLM apps. The easy calls stay on the device — cache, memory, Packs — and the cloud is only called when a question actually needs a frontier model.**

```text
"remember I'm vegetarian"      → LEARNED · local · 0 external calls
"24234 * 23"                   → 557382 · local · 0 external calls
"recipe for doenjang stew"     → Cooking Pack matched · local · 0 external calls
"why is miso aged?"            → CLOUD · 1 external call
```

Every call to a frontier model costs money, adds latency, and sends user data on a round trip. Most questions don't need one. Stipple decides per question — can the cache handle it, a Pack, something it already learned, or does this need the cloud? The expensive path runs only when it has to.

- **Local-first** — the cloud is the last resort, not the default. Enforced in code.
- **Memory** — preferences are learned from conversation, kept on the device, and folded into every decision
- **Packs** — installable capability units (cooking, study…). Handled by a Pack, a question never leaves the device.
- **Any model** — one adapter swaps Gemini / OpenAI / Claude / Grok with a single line of config

## Why I built this

The industry's answer to AI cost is "it'll be fine once models get cheaper." That answer is wrong, and the numbers show it.

Token prices keep falling; inference bills keep climbing. OpenAI's inference spend went from ~$8.4B in 2025 to a projected ~$14.1B in 2026 — even as the per-token price dropped. When calls grow faster than prices fall, cheaper tokens don't save you.

And look at which questions drive the cost. Not the hard ones. The easy ones. "What's 24234 times 23." "I'm vegetarian." "Hi." Asked billions of times, mostly by free users — the 95% who never pay, each question still burning a GPU somewhere. Serving free users alone costs OpenAI an estimated ~$4B a year.

Here's the trap there's no clean way out of: **more users means more loss, in the same motion.** Each new free user is more reach *and* more red ink. Cut them and you choke your own funnel; keep them and you bleed. Providers are stuck inside it — when your metrics are calls and tokens, "fewer calls" looks like failure, even though it's the only thing that fixes the math.

Stipple starts from one idea: **most questions never needed the cloud in the first place.** Handle those on the device — cache, memory, a local model, an installed Pack — and the cloud only sees what genuinely needs a big model. The provider isn't the enemy here. It's the expensive option you reach for *last*, not first.

This isn't a feature. It's a read on where AI is going — away from "one giant model answers everything," toward **a layer that decides what's even worth sending to the model.**

## How it works

**First, honestly: this is a prototype that runs entirely in the browser, with no server.** It simulates a "personal layer" on top of an AI model. It's not a finished library — it's a **proof that the approach actually works.** Two ideas sit at the core.

**① Local-first — the cloud only at the very end**

When a question comes in, every "can the device handle this?" check runs *first*. The cloud is only called after everything ahead of it falls through. The rule is pinned in the code: if anything local matches, the cloud is not called.

In order (each stops right there on a match, zero external calls): commands → calculator (computed on-device) → save/recall preferences → follow-ups like "something else" → Pack match → store search → **learned cache** → cloud. It's not the tidy four-stage "cache → Pack → local → cloud" people picture; it's about ten gates, with the cloud at the very end.

**② Memory — the more you use it, the more it goes local**

Likes and dislikes are picked up during conversation and saved in the browser. On a cloud call they're folded into the prompt; locally, they filter out recommendations with disliked ingredients.

And here's the core of it: once the cloud answers, that answer is saved automatically. **Ask the same thing again and the saved answer matches before the cloud does — the cloud is skipped.** Question → cloud (blue mark) → saved → same question again → saved answer (red mark), no cloud. A three-color mark shows this to the user: the more you use it, red (local) rises and blue (cloud) falls. A panel tracks that ratio live, from real usage.

**The rough edges — not hidden**

This is a prototype, and plenty is open. That's *why* it's open source:

- **The on-device model tier (green mark) is currently off.** A runtime issue in the library I was using (WebLLM) has it disabled, so true on-device inference isn't live yet — the "goes local" story is real for red↑/blue↓, but not the green tier. The last resort is always the cloud. **This is open.**
- **Saved answers only match an exact re-ask by default.** The code to recognize similar questions exists, but its model isn't loaded by default. **This is open too.**
- No server, no database — all of it simulated in the browser.

## A Pack adapts to whoever owns it

Local-first is half of it. Here's the other half, and it's the part I care about more.

A normal app ships as a finished thing. You open it, you use what's there, and if it doesn't fit you, you wait for the developer to change it. The app is a painting in a frame — you can look, but you can't paint on it.

A Pack isn't that. A Pack ships with a base, then **bends toward the person who owns it** — not because the user tunes it by hand, but because the layer watches and tunes it for them. You have an assistant sitting outside the app now. Building one more fixed painting, when you could hand someone a sketchbook, wastes what the assistant is for.

This already runs, three ways, today:

- **Sudoku** remembers your last game — difficulty, mistakes, time — and picks the next board a step up or down. Play a few rounds and the Pack has found your level without you ever setting one.
- **Memory** promotes what you keep coming back to. A preference you hit often, or feel strongly about, hardens; what you stop using decays. The Pack's sense of you sharpens with use.
- **Study** keeps what the model makes. Ask it for a problem and that problem is saved into the Pack, not thrown away — so the longer you own the Pack, the more it's *your* Pack, not the one everyone else downloaded.

That's the bet under all of it: in an AI-OS world, an app you own should get *more yours* the more you use it — and the thing that makes that happen isn't the app, it's the layer beneath it. That layer has to be shared, or nothing lines up on top of it. Which is the real reason this is open: an adaptive base only works if everyone builds on the same one.

## Your turn

I'll be straight: plenty of people out-code me. But writing code isn't the edge anymore — **seeing what's worth building** is. Others write better code than I do; spotting what to build is the part I'm maybe a little better at.

This isn't just talk. It's not "someone should build this." **It runs.** Rough in places — but the routing works, preferences stick, and the cloud only gets what it should. I built it alone to prove one thing: this works for real, not just on paper.

A big lab could rebuild this in a month and put their name on it — *if* they decided the direction mattered. The hard part was never the month of code. **It was seeing that it mattered first.** That part's done.

The OS layer itself is shifting — apps are becoming agents, and the app model is being rebuilt around them. Something has to decide *what runs where*. That's this layer, and it's wide open. I can't build all of it. That's the point of opening it.

So if you saw it the same way — or you think I got the structure wrong — take it, break it, rework it, argue with it. The building is the easy part. The direction was the hard one, and it's on the table now.

— Tei

## The name

This started as **DOTS**, public since June 2026 — the idea that AI needs a local-first layer, not just bigger models.

In September 2026, OpenAI shipped an agent feature also called "dots." Different thing, same instinct about where this is headed. Rather than fight a naming collision with a billion-user product, I just changed it.

**Stipple** keeps the meaning. In art, stippling builds a whole image out of countless small dots — here, small local Packs add up to one intelligent layer. Same idea, fewer lawyers.

— Tei

## License

MIT. Take it, change it, ship it.
