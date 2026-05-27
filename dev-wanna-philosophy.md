# devwanna* — philosophy

the spirit of every app in the devwanna\* family.
this document is **not** about code or pixels. it is about **why**.

read it before starting a new devwanna\* app.
read it again when you're tempted to add a feature you can't justify.

---

## the user

we build for **one kind of person**: a developer who wants a tool that
respects their attention.

they:

- already have an editor, an IDE, a terminal, a browser, a thousand tabs.
- don't need another tab. they need a small, calm window.
- know what they want. they don't need an onboarding tour.
- can read documentation. they don't need pop-up tips.
- own their data. they don't trust the cloud with notes / files / habits.

we are not building for the median consumer. we are not chasing growth.
the user is one developer at one machine, working alone or with a few peers.
that is the entire market.

---

## what we promise

### 1. it stays local

your data lives on your disk. one file you can copy, back up, or delete.
no account. no sync. no telemetry. no "free tier".
if the company behind the app disappears tomorrow, your data still works.

### 2. it opens fast

under one second to interactive. forever. as the data grows, the open
time stays the same. if it gets slow, that is a bug, not a feature
to optimize "in v2".

### 3. it stays out of the way

the UI does not announce itself. no badges. no notifications.
no "did you mean…?". the cursor is where you left it. the panel sizes
are where you left them. the theme is what you set last week.

### 4. it never asks you to upgrade

there is no Pro tier. no AI add-on. no analytics dashboard.
the free version is the only version. forever.

### 5. it does one thing

devwanna**type** is a notes app. it is not also a calendar.
devwanna**wave** is an audio player. it is not also a tag editor.
when scope creeps, we say no — or we start a new devwanna\* app.

---

## what we refuse

we will not, ever:

- ❌ require an account
- ❌ phone home
- ❌ ship AI features that auto-suggest, auto-summarize, or auto-complete prose
- ❌ recommend things ("you might also like…")
- ❌ gamify usage (streaks, achievements, points)
- ❌ rank, score, or leaderboard the user
- ❌ A/B test silently
- ❌ collect crash data without consent (no Sentry by default)
- ❌ show ads, sponsored content, or affiliate links
- ❌ obscure simple actions behind menus to inflate "engagement"
- ❌ animate things that don't need to move
- ❌ play sounds the user didn't ask for
- ❌ display "tips" or "what's new" modals
- ❌ wrap a web SaaS in a desktop shell and call it a desktop app

if a competitor's app does any of these, that's a feature, not a flaw.
their absence is the product.

---

## what is "developer" about it

developer-ness is a **vibe**, not a feature list.

it shows up as:

- **monospace by default** — for vibes, for alignment, for the discipline of
  fixed widths
- **keyboard-first** — every action has a shortcut. mouse is optional.
- **plain text formats** — markdown, sql, json. nothing locked in proprietary blobs.
- **filesystem-friendly** — the user can find their data with `cd` and `ls`.
- **dark by default** — but light works too, because not everyone codes at night.
- **respects the OS** — drag and drop, file associations, clipboard. no "use our import wizard".
- **no hand-holding** — confirmation dialogs only for destructive things.
  "are you sure?" is patronizing for everything else.

we are not building for "developers" the demographic. we are building for
the **practice** of being a developer: working with text, files, focus.

---

## how we make decisions

when in doubt, prefer:

| this | over this |
|---|---|
| boring | clever |
| static | animated |
| keyboard | mouse |
| local | remote |
| explicit | magical |
| less | more |
| readable | dense |
| flat | layered |
| now | later |
| the user's data | our metrics |
| no answer | a wrong answer |

if you can't choose between two options, **the one with fewer pixels wins**.

---

## scope discipline

every devwanna\* app does **one thing**.
when a feature feels like it doesn't belong, it probably doesn't.

ask:

1. does this serve the **one thing** this app does?
2. could a sibling devwanna\* app do this better?
3. could the OS / a real Unix tool do this?
4. is this a feature, or am I just bored?

**rule of thumb**: if a new feature would need its own settings tab
just to disable, it doesn't belong in the app.

if it's genuinely useful and doesn't fit, **make a new devwanna\* app**.
the family is supposed to grow sideways, not vertically.

---

## the family

every devwanna\* app shares:

- the same **design language** (see DESIGN_SYSTEM.md)
- the same **promises** (above)
- the same **refusals** (above)
- the same **storage model** (single SQLite file per app, in `dev.wanna<name>.app`)
- the same **mental shape**: open in 1s, escape in 1 keystroke, data is yours

a new devwanna\* app is a **new file format** + **new domain logic**, not
a new philosophy. if your idea needs a different philosophy, it is a
different family. fine — start a different one. don't dilute this one.

---

## naming

the prefix `devwanna` is a commitment, not a brand.
it says: this is for developers, this is what they want, this is local.

a verb-ish suffix describes the one thing:

- `type` — write text
- `wave` — listen to audio
- (others to be discovered, not pre-planned)

names are short, lowercase, monosyllabic-ish. no camelCase. no underscores.
the Tauri identifier is always `dev.wanna<name>.app`.

---

## success metrics

we measure success by **none of the usual metrics**.

we don't care about:
- daily active users
- session length
- retention
- viral coefficient
- conversion rate

we care about:
- does it open fast on a 5-year-old laptop?
- did it survive a power-cut without losing data?
- can a user export everything in 30 seconds and walk away?
- did we add fewer features this quarter than last quarter?

if a devwanna\* app has 200 users and they all love it, that's a success.
if it has 200,000 users who use it once and forget, that's a failure.

---

## when in doubt

ask: **would Bear / Linear / Sublime have done this in 2014?**

(2014 because it predates the dark patterns of 2018+. the year is
arbitrary, but the spirit is right: simple, fast, opinionated, no growth-hacking.)

if the answer is "no", don't do it.
if the answer is "maybe, but worse", definitely don't do it.

---

## when this document is wrong

this is a manifesto, not scripture. if you find a real reason to break
one of these principles — write it down. open an issue. argue.
update the document or write `PHILOSOPHY-v2.md`.

but the bar is high. **most "exceptions" are just feature creep
in better packaging.**

---

*built by a developer, for developers. quietly. on purpose.*
