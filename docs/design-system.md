# Nymbus Design System (old material)

> **Superseded for look and feel (2026-11).** The app now follows
> [nymbus-styling.md](nymbus-styling.md): soft neumorphism, `k-*` tokens, light and dark
> themes. Every class string in Part I below (orange `primary`, zinc borders, `rounded-btn`,
> the outlined buttons) is **out of date** — don't copy them. Part II is still the record of
> *why* each screen is laid out the way it is; read its structure, not its classes.

> **Local version.** Part I (the material) applies unchanged. Part II describes the hosted
> version's screens, some of which are gone here: the login screen, the visitor screen,
> impersonation, the mails and performance pages, demo bookings, the tutorial, the module
> files panel and the workflow buttons. New here: *Nieuw project* (sidebar), and the
> *Modules* and *Connectoren* tabs of the project settings.

> Detail for [CLAUDE.md](../CLAUDE.md). **Source of truth for look and feel — follow it for
> all new UI.** One file, two parts, because the same design answers two different questions:
>
> - **Part I — the material** (§1–§21): the full CSS, the tokens, and the exact class strings
>   of every UI element in the app. Self-contained on purpose — copy the CSS block in §2 into
>   a new project and every recipe below works, with no import from this repo. This half
>   travels to another app.
> - **Part II — this app** (§22–§26): why Nymbus Conversies' sidebar, pickers, toolbar and
>   reports are shaped the way they are — screen by screen, with what was tried before and
>   what it cost. This half doesn't travel; it is the record of the decisions.
>
> **Part II points back at Part I rather than restating it**: a class string, a token value or
> an overlay's mechanics appear once, in Part I. Where the two seem to disagree about this
> app, Part II wins — it is about this app, and Part I is the generalisation of it.

---

**Part I — the material.** Colour, type, radius, shadow, spacing, states, and the class
strings that carry them. Nothing below this line knows what this app is for, which is what
makes it portable.

---

## 1. Install

Stack the recipes assume: **Tailwind v4** (CSS-first config, no `tailwind.config.js`),
**lucide-react** for icons, **Inter** as the only typeface.

```bash
npm i tailwindcss @tailwindcss/postcss lucide-react
```

```js
// postcss.config.mjs
const config = { plugins: { "@tailwindcss/postcss": {} } };
export default config;
```

Font — Inter, self-hosted through `next/font` so there's no external request:

```tsx
// app/layout.tsx (Next.js). Outside Next: link Inter from Google Fonts and set
// --font-inter yourself.
import type { Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

// Phones: reach under the notch (globals.css pads it back with the safe-area
// insets) and let Android shrink the layout for the keyboard.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl" className={`${inter.variable} h-full antialiased`}>
      <body className="h-dvh overflow-hidden flex bg-background text-navy">
        {children}
      </body>
    </html>
  );
}
```

Two things in that snippet are load-bearing and easy to lose:

- **`antialiased`** on `<html>`. Without it Inter renders heavier and the whole palette
  looks a shade darker than it was picked to be.
- **`h-dvh overflow-hidden flex`** on `<body>`. This design is an *app shell*: the page
  never scrolls, panes inside it do (§5). Drop it and every `min-h-0 flex-1 overflow-auto`
  in the recipes below silently stops working. `dvh`, not `h-screen`: on a phone `100vh`
  is the height with the browser's toolbars hidden, which puts the shell's bottom edge
  under them. And because the page never scrolls, **a full-screen view that can outgrow a
  phone (a login, a notice) scrolls itself**: `min-h-0 flex-1 overflow-y-auto` with
  `justify-center-safe` — plain `justify-center` would push its top out of reach.

---

## 2. The CSS — copy this whole block

This is the entire stylesheet. There is no other CSS file in the app; everything else is
Tailwind utilities.

```css
@import "tailwindcss";

:root {
  --background: #fafafa;
  --foreground: #1a1f36;
}

/* `@theme inline` so these resolve to the var() rather than to its value — that's
   what lets you re-point --background at runtime and have bg-background follow. */
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --font-sans: var(--font-inter), sans-serif;
}

@theme {
  /* ---- colours ---- */
  --color-primary: #f1941f;       /* the one accent */
  --color-primary-dark: #d97e0c;  /* its hover/pressed */
  --color-navy: #1a1f36;          /* headings, primary text, system chrome */
  --color-body: #5b6478;          /* body / secondary text */
  --color-surface: #f4f5f7;       /* subtle fills: inputs, chips, bands */

  /* Status badge family — three INKS, not fills. A badge is one hue at three
     strengths: /10 fill, /30 border, full-strength letters. Deliberately one
     luminance (~0.145) across all three, so green, red and grey carry the same
     weight in a row and differ in hue and in nothing else. That figure is the
     darkest the family can be while still reading as colour, and the lightest it
     can be while the letters clear AA on their own tint (4.6:1), on
     --color-surface where a hovered row puts them (4.9:1) and on white (5.4:1). */
  --color-status-good: #147b3a;
  --color-status-bad: #ce2323;
  --color-status-none: #6a6a72;

  /* ---- radii ---- */
  --radius-btn: 10px;    /* buttons, inputs, list rows, tinted strips */
  --radius-card: 16px;   /* cards, panels, dialogs */
  --radius-badge: 6px;   /* every badge, tag and chip — one silhouette for the family */
}

body {
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-sans);
}

/* Phones: keep the shell out of the notch and off the home indicator. The insets
   are only non-zero with `viewport-fit=cover` (layout.tsx) on a device that has
   them, so a desktop gets 0 on every side. */
body {
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom)
    env(safe-area-inset-left);
}

/* Touch devices: iOS zooms into any field under 16px when it takes focus. Unlayered,
   so it outranks the `text-sm`/`text-xs` utilities on the fields themselves. A
   single-line input keeps `text-sm`'s 1.25rem line, so its height doesn't change. */
@media (pointer: coarse) {
  input:not([type="checkbox"], [type="radio"], [type="range"]),
  select,
  textarea {
    font-size: 16px;
  }
  input {
    line-height: 1.25rem;
  }
}

/* Highlighted word band for hero headings. box-decoration-break so a band that
   wraps gets rounded corners on both fragments instead of one long ribbon. */
.highlight-band {
  display: inline-block;
  background: var(--color-primary);
  color: #ffffff;
  padding: 0 0.18em;
  border-radius: 8px;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}

/* The one attention animation in the app: a button whose result is now stale.
   color-mix rather than fixed hex, so re-pointing --color-primary re-tints it. */
@keyframes primary-pulse {
  0%,
  100% {
    border-color: color-mix(in srgb, var(--color-primary) 45%, #e4e4e7);
    background-color: color-mix(in srgb, var(--color-primary) 6%, white);
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-primary) 20%, transparent);
  }
  50% {
    border-color: var(--color-primary);
    background-color: color-mix(in srgb, var(--color-primary) 14%, white);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 22%, transparent);
  }
}

.toolbar-btn-pulse {
  animation: primary-pulse 1.5s ease-in-out infinite;
  border-color: var(--color-primary);
  color: var(--color-primary);
}
```

### Tokens → utilities

Tailwind v4 derives the utility names from the token names, so `--color-navy` gives you
`text-navy`, `bg-navy`, `border-navy` **and** every opacity step (`bg-navy/20`,
`text-body/70`). Same for `--radius-btn` → `rounded-btn`. Rename a token and you rename
its utilities.

| Token                  | Value     | Utilities            | Use                                                 |
| ---------------------- | --------- | -------------------- | --------------------------------------------------- |
| `--color-primary`      | `#f1941f` | `bg-primary`, …      | The single accent: primary buttons, active state, focus ring, icon chips, highlight band |
| `--color-primary-dark` | `#d97e0c` | `bg-primary-dark`    | Hover/pressed of a filled primary — nothing else    |
| `--color-navy`         | `#1a1f36` | `text-navy`, …       | Headings, primary text, tooltips, system chrome bars |
| `--color-body`         | `#5b6478` | `text-body`, …       | Body copy, secondary text, quiet icons              |
| `--color-surface`      | `#f4f5f7` | `bg-surface`         | Subtle fills: input rest state, chips, column bands, hover rows |
| `--background`         | `#fafafa` | `bg-background`      | Page ground. Off-white, so white cards read as raised |
| `--color-status-good`  | `#147b3a` | `text-status-good`, … | Badge ink: reads as *good*                          |
| `--color-status-bad`   | `#ce2323` | `text-status-bad`, … | Badge ink: reads as *not good*                       |
| `--color-status-none`  | `#6a6a72` | `text-status-none`, … | Badge ink: a value whose meaning you don't know      |
| `--radius-btn`         | `10px`    | `rounded-btn`        | Buttons, inputs, list rows, tinted strips            |
| `--radius-card`        | `16px`    | `rounded-card`       | Cards, panels, dialogs, dropzones                    |
| `--radius-badge`       | `6px`     | `rounded-badge`      | Every badge, tag and chip — see §8                   |

### Greys: use `zinc`, not `slate` or `gray`

The tokens cover text and accent; structure comes from Tailwind's **zinc** ramp, and only
these five rungs are in use. Reaching for a sixth is the usual way this palette starts to
look muddy.

| Class            | Where                                                       |
| ---------------- | ----------------------------------------------------------- |
| `border-zinc-100` | Hairline *inside* a card — divides its sections             |
| `border-zinc-200` | The default border: cards, inputs, buttons, dialog dividers |
| `border-zinc-300` | Dashed dropzone at rest (needs to read heavier than a card edge) |
| `bg-zinc-100`     | Hover ground of a bare icon button; neutral count-badge fill |
| `text-zinc-300`   | A badge drawn as an empty outline — "no" as a visible answer |
| `text-zinc-400`   | Icons inside inputs, placeholders, section eyebrow labels   |
| `text-zinc-500`   | Text on a `bg-zinc-100` count badge                         |

### Semantic colours beyond the status inks

The status inks are for badges *in a list*, where one luminance keeps a column even. Full
notices and one-off marks use Tailwind's own ramps, at `-50` fill / `-200` border /
`-600`–`-800` text:

| Meaning         | Palette   | Notice                                                | Notes |
| --------------- | --------- | ----------------------------------------------------- | ----- |
| Error / blocked | `red`     | `border-red-200 bg-red-50 text-red-600`               | Also flagged table cells (`bg-red-50`) and the destructive button |
| Warning / risk  | `amber`   | `border-amber-200 bg-amber-50 text-amber-800`         | The "you might regret this" chip and stale-data strips |
| Success         | `emerald` | `border-emerald-200 bg-emerald-50 text-emerald-800`   | Confirmations. `green` appears in a couple of older spots — prefer `emerald` in new work |
| Informational   | `sky`     | `bg-sky-50 text-sky-700`                              | The one "neither good nor bad" state, e.g. *live environment* |

---

## 3. Typography

One family (Inter), four weights, and a scale that only ever moves in the steps below.

| Role                    | Classes                                                                     |
| ----------------------- | --------------------------------------------------------------------------- |
| Hero heading            | `text-3xl font-extrabold leading-[1.1] tracking-tight text-navy lg:text-4xl` |
| Hero, full-page (login) | `text-4xl font-extrabold leading-[1.1] tracking-tight text-navy sm:text-5xl` |
| Card / dialog title     | `text-lg font-semibold text-navy`                                           |
| Section title in a card | `text-base font-semibold text-navy`                                         |
| Headline figure         | `text-4xl font-extrabold leading-none tracking-tight text-navy` (drawer) · `text-3xl …` (page) · `text-2xl …` (inline) |
| Body                    | `text-sm text-body` · `text-base leading-snug text-body` for intro copy     |
| Quiet detail            | `text-xs text-body` — one step further down: `text-body/80`, `text-body/70`  |
| Eyebrow / section label | `text-xs font-semibold uppercase tracking-wide text-zinc-400`               |
| Column band label       | `text-[11px] font-semibold uppercase tracking-wide text-body`               |
| Badge text              | `text-[11px] font-semibold` · `text-[10px] font-semibold leading-none` for counts |
| Button label            | `text-sm font-semibold` (primary/secondary) · `text-sm font-medium` (quiet rows) |
| Code / field name       | `font-mono text-xs font-semibold text-body`                                 |

Two rules that do more work than they look like they do:

- **`tabular-nums` on any number that sits in a column or updates in place** — table row
  numbers, percentages in a list, counts in a footer, timestamps. Without it the digits
  shift width as the value changes and the column visibly jitters.
- **Proportional (i.e. *no* `tabular-nums`) on a standalone headline figure.** At
  `text-2xl` and up, tabular figures look loose and badly spaced.

`leading-none` on big figures, `leading-snug` on stacked small text, default elsewhere.

---

## 4. Depth, borders, motion

**Elevation** — four steps, and they mean things:

| Class        | Where                                                     |
| ------------ | --------------------------------------------------------- |
| `shadow-sm`  | Cards, filled primary buttons, quiet outlined buttons     |
| `shadow-md`  | A dropzone under the cursor; tooltips                     |
| `shadow-lg`  | Popover panel; the cursor-following table tooltip         |
| `shadow-xl`  | Centred modal card                                        |
| `shadow-2xl` | Drawer panel (it has to lift off a full-height page edge)  |

A **card is a border plus `shadow-sm`**, never one or the other:
`rounded-card border border-zinc-200 bg-white shadow-sm`. Inside it, sections are divided
by `border-t border-zinc-100` — a full-strength `zinc-200` line inside a `zinc-200` box
reads as two boxes.

**Motion** is `transition-colors` almost everywhere, and nothing is slower than 200ms:

- `transition-colors` — every interactive element. The default duration is right.
- `transition-all` — only the dropzone, which changes border *and* shadow together.
- `transition-opacity duration-150` — tooltip fade-in.
- `transition-opacity duration-200` / `transition-transform duration-200 ease-out` — drawer
  backdrop and panel.
- `.view-enter` (globals.css) — 200ms fade with a 4px rise, on the module page's two views
  (Data / Payloads) as each mounts. Off under `prefers-reduced-motion`.
- `animate-spin` on `Loader2` — the only spinner.
- `animate-pulse` on the brand mark — the only full-screen loading state.
- `.toolbar-btn-pulse` — the only attention-seeking animation, and it is reserved for two
  things: *your last action's result is now out of date*, and *this is your next step* — the
  hand-in chip (*Data versturen naar Nymbus*) once a clean sheet may be sent. Don't spend it
  on anything else.

**Focus.** One ring in the whole app:
`focus:border-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20`
on inputs, and `focus:ring-1 focus:ring-inset focus:ring-primary/50` on a cell editor
inside a table. Never `focus:outline-none` on its own.

---

## 5. App shell

Fixed viewport, no page scroll; every pane scrolls itself. Three nested rules make it work:

1. `<body>` is `h-dvh overflow-hidden flex`.
2. Each level down is a flex container with `min-h-0` (or `min-w-0`) on the child that
   should be allowed to shrink. **`min-h-0` is the one that everybody forgets** — a flex
   child defaults to `min-height: auto`, so without it an inner `overflow-auto` grows the
   page instead of scrolling.
3. The scrolling pane is `min-h-0 flex-1 overflow-y-auto`.

```tsx
// Shell: system banner on top (spans everything), sidebar left, content right.
<div className="flex h-full min-h-0 w-full flex-col">
  <SystemBanner />                                {/* shrink-0 */}
  <div className="flex min-h-0 flex-1">
    <aside className="flex h-full w-68 shrink-0 flex-col border-r border-zinc-200 bg-white">
      <div className="px-3 py-5">{/* brand — shrink-0 */}</div>
      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">{/* nav */}</div>
      <div className="border-t border-zinc-200 p-3">{/* footer */}</div>
    </aside>
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {children}
    </main>
  </div>
</div>
```

**Sidebar widths:** `w-68` expanded, `w-16` collapsed to an icon rail. Nothing on the rail
may *require* expanding the sidebar to be usable — which is why the pickers in this app are
centred dialogs rather than popovers hanging off a `w-68` rail.

**Content widths:** `max-w-3xl` for prose and forms, `max-w-5xl` for a wide table card,
`max-w-md` for a centred single-purpose card (login, error notice), `max-w-6xl` for a
two-grid dialog. Blocks on the same screen share an edge *unless* one of them is a table —
a readable column beats a shared margin.

**Vertical rhythm:** `px-6 py-5` inside a dialog or card header, `px-5 py-4` in a denser
card, `px-3 py-2` for a list row, `gap-2`/`gap-3` between controls, `mb-8` under a hero.

---

## 6. Buttons

Five tones. Every one of them carries `cursor-pointer`, a hover state and
`transition-colors` — an interactive element without all three reads as text.

```tsx
const BASE =
  "inline-flex cursor-pointer items-center justify-center gap-2 rounded-btn px-4 py-2 " +
  "text-sm font-semibold transition-colors " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const PRIMARY   = "bg-primary text-white shadow-sm hover:bg-primary-dark";
const SECONDARY = "border border-zinc-200 bg-white text-navy hover:bg-surface";
const DANGER    = "border border-red-200 bg-white text-red-600 hover:bg-red-50";
const SUCCESS   = "border border-emerald-200 bg-white text-emerald-600 hover:bg-emerald-50";
```

`SUCCESS` is `DANGER`'s pair, not a second primary — same outlined weight, emerald instead
of red, for the positive half of a two-way decision (approve/reject, akkoord/niet akkoord)
where one button outranking the other visually would misstate the choice.

**Quiet outlined** — the workhorse for a secondary action beside a primary one. Same
outline as `SECONDARY`, but it tints *orange* on hover instead of grey, which is what marks
it as an action rather than a dismissal:

```
inline-flex cursor-pointer items-center gap-2 rounded-btn border border-zinc-200 bg-white
px-4 py-2 text-sm font-semibold text-navy shadow-sm transition-colors
hover:border-primary/70 hover:bg-primary/5 hover:text-primary
```

**Full-width primary** (login, stacked dialog actions) — a touch taller:

```
flex w-full items-center justify-center gap-2 rounded-btn bg-primary px-4 py-2.5
text-sm font-semibold text-white transition-colors hover:bg-primary-dark
```

**Compact header button**, `h-9`, sized to sit in a row of `h-9` controls:

```
inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-btn border
border-zinc-200 px-3 text-sm font-medium text-navy transition-colors
hover:border-primary/70 hover:bg-primary/5 hover:text-primary
disabled:cursor-wait disabled:border-zinc-200 disabled:text-navy/40
disabled:hover:bg-transparent
```

Note `disabled:cursor-wait` there rather than `not-allowed`: that button disables *while its
work runs*, and the cursor should say "wait", not "never".

**Bare icon button** — a close `×`, a clear `×` in a field. No border; the hover ground is
the affordance:

```
inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full
text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-navy
pointer-coarse:-m-1.5 pointer-coarse:h-11 pointer-coarse:w-11
```

**Touch targets are 44px — to a finger, not to a mouse.** `pointer-coarse:` (a touch screen,
whatever its width) grows a small button to `h-11 w-11`, and a negative margin of half the
difference hands the extra back so the row around it keeps its layout. A desktop never
matches it, so nothing there moves. Text buttons and list rows get the padding instead
(`pointer-coarse:py-3`).

**Outlined icon button** — a drawer's close, at `h-9 w-9`:

```
inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-btn
border border-zinc-200 text-body transition-colors
hover:border-primary/70 hover:bg-primary/5 hover:text-primary
pointer-coarse:-m-1 pointer-coarse:h-11 pointer-coarse:w-11
```

**Link-style button** inside body text: `cursor-pointer font-medium text-primary
underline-offset-2 hover:underline`.

### Toolbar button (icon-only, with tooltip)

The densest control in the app: a square button in a row of them, its label carried by a
tooltip on hover and by `aria-label` always. Split into state constants so a hand-rolled
trigger (a menu's, say) can't style its states differently.

```tsx
export const TOOLBAR_BTN =
  "group relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-btn " +
  "border text-sm font-semibold shadow-sm transition-colors " +
  "pointer-coarse:h-11 pointer-coarse:w-11"; // 44px to a finger; the row wraps

export const TOOLBAR_BTN_IDLE =
  "cursor-pointer border-zinc-200 bg-white text-navy " +
  "hover:border-primary/70 hover:bg-primary/5 hover:text-primary";

// "On" state of a toggle — filled, so an active filter is obvious next to the
// outlined one-shot actions around it.
export const TOOLBAR_BTN_ACTIVE =
  "cursor-pointer border-primary bg-primary text-white hover:bg-primary-dark";

// Note shadow-none: a disabled button shouldn't sit proud of the surface.
export const TOOLBAR_BTN_DISABLED =
  "cursor-not-allowed border-zinc-200 bg-white text-navy/25 shadow-none";

export const TOOLBAR_BTN_TOOLTIP =
  "pointer-events-none absolute bottom-[calc(100%+6px)] z-50 whitespace-nowrap " +
  "rounded-btn bg-navy px-2.5 py-1 text-xs font-medium text-white opacity-0 " +
  "shadow-md transition-opacity duration-150 group-hover:opacity-100 " +
  // Touch has no hover (Tailwind's `hover:` needs a device that can): there the
  // label shows while the button is held, after 300ms so a tap doesn't flash it.
  "pointer-coarse:group-active:opacity-100 pointer-coarse:group-active:delay-300";
```

```tsx
export default function ToolbarButton({
  label, onClick, active, disabled, trailing, children,
}: {
  label: string; onClick?: () => void; active?: boolean;
  disabled?: boolean; trailing?: boolean; children: React.ReactNode;
}) {
  const state = disabled ? TOOLBAR_BTN_DISABLED
              : active   ? TOOLBAR_BTN_ACTIVE
              :            TOOLBAR_BTN_IDLE;
  return (
    <button
      type="button" onClick={onClick} disabled={disabled}
      aria-label={label} aria-pressed={active}
      className={`${TOOLBAR_BTN} ${state}`}
    >
      {children}
      {/* `trailing` anchors the tooltip to the button's right edge — for the
          buttons at a card's right edge, where a centred one would hang out. */}
      <span
        role="tooltip"
        className={`${TOOLBAR_BTN_TOOLTIP} ${
          trailing ? "right-0" : "left-1/2 -translate-x-1/2"
        }`}
      >
        {label}
      </span>
    </button>
  );
}
```

Icons inside buttons: `h-4 w-4 shrink-0` with `strokeWidth={1.8}`.

---

## 7. Inputs

Rest state is `bg-surface`, focus lifts it to white with the orange ring. That inversion —
grey at rest, white when active — is what makes a form of eight fields readable at a glance.

```
w-full rounded-btn border border-zinc-200 bg-surface px-3 py-2.5 text-sm text-navy
placeholder:text-zinc-400 transition-colors
focus:border-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20
```

Label above it: `block text-sm font-medium text-navy`, then `mt-2` to the field.
Hint under it: `mt-1.5 text-xs text-body`.

**With a leading icon** — `pl-9` on the input, the icon absolutely positioned and
`pointer-events-none` so a click on it still focuses the field:

```tsx
<div className="relative mt-2">
  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400">
    <Mail className="h-4 w-4" strokeWidth={2} />
  </span>
  <input className="w-full rounded-btn border border-zinc-200 bg-surface py-2.5 pl-9 pr-3 text-sm text-navy placeholder:text-zinc-400 transition-colors focus:border-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20" />
</div>
```

**Search field** — leading magnifier, and a clear button that appears once something is
typed (`pr-10` reserves its room from the start, so the text doesn't reflow when it
appears). Autofocus is right here: opening the dialog is how you got here, and typing is
the next thing you do.

```tsx
<label className="relative block">
  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400">
    <Search className="h-4 w-4" strokeWidth={2} />
  </span>
  <input
    type="text" autoFocus value={value} onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder} aria-label={label}
    className="w-full rounded-btn border border-zinc-200 bg-surface py-2 pl-9 pr-10 text-sm text-navy placeholder:text-zinc-400 transition-colors focus:border-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20"
  />
  {value.length > 0 && (
    <button
      type="button" onClick={() => onChange("")} aria-label="Zoekopdracht wissen"
      className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-navy"
    >
      <X className="h-3.5 w-3.5" strokeWidth={2} />
    </button>
  )}
</label>
```

A search field brings **no spacing of its own** — the caller places it (`px-6 pb-4`, with
or without a divider under it). Same rule for notices (§9): styling here, margin at the
call site.

### Checkbox — drawn, not `accent-color`

A 16px square that fills brand orange with a **white** check. The obvious version —
`accent-primary` on a native checkbox — is wrong here, and the reason is the glyph rather
than the box: `accent-color` hands the browser the fill and lets it pick the mark's colour
for contrast, and against `--color-primary` (`#f1941f`, a light orange) every engine picks
**black**. That reads as a different control from every other orange-on-white element in
the app, where the mark on a filled primary surface is always white — a filled toolbar
toggle, an active segmented option, a primary button.

So the input **stays** and is made invisible (`appearance-none`), with the box drawn over
it: it remains the thing that is focusable, keyboard-operable, labelable and reachable by
a screen reader, and none of that is worth re-implementing. Every visual state below is
the input's own, read through `peer-*` — there is no React state in the component at all,
so the mark and the control can't disagree.

```tsx
<span className="relative inline-flex h-4 w-4 shrink-0">
  <input
    type="checkbox" checked={checked} onChange={…}
    // `indeterminate` is a DOM *property*, not an attribute — it cannot be set in JSX.
    // A callback ref runs at commit, which keeps it clear of the React Compiler's
    // ref rules (those reject ref access during *render*; this is not that).
    ref={(node) => { if (node) node.indeterminate = indeterminate && !checked; }}
    className="peer h-4 w-4 shrink-0 appearance-none rounded-[5px] border transition-colors
      cursor-pointer border-zinc-300 bg-white hover:border-primary/70
      checked:border-primary checked:bg-primary
      indeterminate:border-primary indeterminate:bg-primary"
  />
  <Check aria-hidden strokeWidth={3.5}
    className="pointer-events-none absolute inset-0 m-auto h-3 w-3 text-white opacity-0 peer-checked:opacity-100" />
  <Minus aria-hidden strokeWidth={3.5}
    className="pointer-events-none absolute inset-0 m-auto h-3 w-3 text-white opacity-0 peer-indeterminate:peer-not-checked:opacity-100" />
  {/* The focus ring belongs to the drawn box, not to an invisible input. */}
  <span aria-hidden
    className="pointer-events-none absolute -inset-0.5 rounded-[7px] opacity-0 ring-2 ring-primary/40 peer-focus-visible:opacity-100" />
</span>
```

`rounded-[5px]` inside the `-inset-0.5` ring's `rounded-[7px]` is the concentric pair the
segmented switch uses at its own scale (§12). **Indeterminate** — a dash, not a tick — is
the honest third state of a select-all: some but not all, which neither on nor off can say
without lying about what the next press does. Disabled swaps the ground to `zinc` and the
cursor to `not-allowed`, keeping the white mark so a ticked-but-locked box still reads as
ticked.

One component, [`Checkbox`](../frontend/src/components/Checkbox.tsx), used everywhere —
there is no second tick box in this app.

---

## 8. Badges

### The soft-tinted badge — the whole family

**Every badge in the app is drawn this one way, and each status colour is an *ink*, not a
fill.** One hue makes the whole badge at three strengths: `/10` for the ground, `/30` for
the hairline, full strength for the letters.

```
inline-flex max-w-full items-center rounded-badge border px-2 py-0.5
text-[11px] font-semibold
   border-status-good/30 bg-status-good/10 text-status-good   /* good    */
   border-status-bad/30  bg-status-bad/10  text-status-bad    /* not good */
   border-status-none/30 bg-status-none/10 text-status-none   /* unknown  */
   border-primary/30     bg-primary/10     text-primary       /* "this one" / yes */
```

Why it's built this way, and what breaks if you change it:

- **Letters are the hue, never white.** A badge whose fill is dark enough to carry white
  text is a badge that shouts, and a list where twenty of them shout is a list nobody
  reads. Tinted, it reads as one material rather than as a coloured box with something
  written in it.
- **One luminance across the family.** Picking each colour on its own is what once gave a
  neon green, a mid red and a brand-orange amber in the same column: three badges shouting
  at three volumes, one close enough to the accent to read as a highlight rather than a
  warning.
- **One radius** (`rounded-badge`) for all of them, including verdicts — and, per the
  subsection below, for every pill in the app rather than only the ones in a row. What tells
  a verdict at the end of a row from a fact in the middle of it is its ink, its size and its
  place — not a second silhouette. Status pills used to be `rounded-full` capsules beside
  rounded-slot tags, and the split read as two components that happened to share a colour
  scheme.
- **Reach for `--color-status-none` whenever the value came out of a free-text field.** Grey
  is how this design prints a status *without claiming to know what it means*.
- **Solid orange stays reserved** for "this is the one you have open". Spend it on a
  routine yes/no in every row and it stops meaning anything.

Two more shapes in the same family:

```tsx
// Category tag: the accent tint for yes, an empty outline for no. Draw BOTH states —
// "no" is worth as much as "yes" here, and a gap reads as a cell that failed to load.
<span role="img" aria-label={`${name}: ${on ? "ja" : "nee"}`}
  className={`inline-flex flex-1 items-center justify-center rounded-badge border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
    on ? "border-primary/30 bg-primary/10 text-primary" : "border-zinc-200 text-zinc-300"
  }`}>
  {name}
</span>
```

Note `role="img"` rather than a disabled checkbox: it reports a fact, it isn't a control,
and a greyed-out checkbox reads as a switch someone turned off.

```tsx
// Warning flag inside a row's quiet metadata line — a size down from a verdict pill.
<span className="inline-flex items-center gap-1 rounded-badge border border-status-bad/30 bg-status-bad/10 px-1.5 py-0.5 text-[10px] font-semibold text-status-bad">
  <AlertTriangle className="h-3 w-3 shrink-0" strokeWidth={2} />
  Geen dossieritem
</span>
```

### Counts, measures and headings — the same family

**Every pill in the app is that badge, not only the ones in a row.** Counts, measures,
verdicts, category tags, stale flags, a connector's field chips, the environment headings in
a settings dialog — they were a mix of capsules and rounded slots, and that split is the same
mistake one level up: a reader meets two silhouettes and has to work out whether they mean
two kinds of thing. They don't.

`rounded-full` is left to the three things that are **not** pills:

- a **status dot** (`h-1.5 w-1.5` — below),
- a **meter** and its segments (§16),
- a **circular icon slot** — an avatar, a modal's icon chip, a close button (§14, §6, §11).

Those are round because of what they *are*, not because of a family they belong to. And a
chip the user can **click** is still a badge: `rounded-btn` belongs to buttons with a real
hit area — `h-8`, `h-9`, a form control — not to a `py-0.5` label with an `onClick`.

What varies inside the family is the **ink**, never the shape. The status inks above are for
a *verdict* about a row; a **measure** keeps its own green and amber, because it reports a
quantity rather than a judgement, and amber left the ink family on purpose.

```tsx
// Neutral count beside a group label
<span className="shrink-0 rounded-badge border border-zinc-200 bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-zinc-500">{n}</span>

// Accent count (on a tab; inverts when the tab is active)
<span className={`rounded-badge border px-1.5 py-0.5 text-[10px] font-bold leading-none tabular-nums ${
  active ? "border-white/30 bg-white/20 text-white" : "border-primary/30 bg-primary/10 text-primary"
}`}>{n}</span>

// Measured value: green at target, amber below. Its own green and amber rather than the
// status inks — a measure, not a verdict — but built like every other badge. The NUMBER
// carries the meaning, the colour only echoes it; and there is no badge at all before a
// first measurement, because a rail of 0% pills reads as failure rather than as "not
// started".
<span className={`shrink-0 rounded-badge border px-1.5 py-0.5 text-[10px] font-semibold leading-none tabular-nums ${
  complete ? "border-green-200 bg-green-50 text-green-700" : "border-amber-200 bg-amber-50 text-amber-700"
}`}>
  {pct}%
  <span className="sr-only"> van de rijen zonder fouten bij de laatste controle</span>
</span>

// A count that is a verdict — an error total at the end of a row — is the status ink,
// not a red of its own.
<span className="shrink-0 rounded-badge border border-status-bad/30 bg-status-bad/10 px-2 py-0.5 text-[11px] font-semibold text-status-bad">{n}</span>

// Loud section heading badge — for the one distinction a form must not get wrong.
// Bigger padding and uppercase, same silhouette as every badge above it.
<h3 className="inline-flex items-center rounded-badge border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-emerald-700">Testomgeving</h3>
<h3 className="inline-flex items-center rounded-badge border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-sky-700">Live-omgeving</h3>
```

### Status dot

A dot, not a second pill, when the row is primarily navigation and a badge would push the
label out of a narrow rail. One of the three things that stay `rounded-full`, because it is a
dot rather than a label. `h-1.5 w-1.5` in a list, `h-2 w-2` in a legend.

```tsx
const TONE_FILL = {
  unchecked: "bg-zinc-300",
  poor:      "bg-red-500",
  partial:   "bg-amber-500",
  clean:     "bg-emerald-500",
};

<span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE_FILL[tone]}`} />
```

**Keep one tone→fill map in one module and import it everywhere.** The moment two surfaces
each hold their own copy, the same record shows green in one place and amber in the other.
And a dot never says it alone: the wording leads the row's `title`, with an `sr-only` tail
spelling it out.

---

## 9. Notices

One shape, four tones. Styling lives in the component; **the margin belongs to the caller**
(`mb-3` above a table, `mt-4` after tiles) — otherwise you end up with a `noMargin` prop.

```tsx
const NOTICE = "flex items-start gap-2 rounded-btn border px-3 py-2 text-sm";

// Warning — AlertTriangle
<div className={`${NOTICE} border-amber-200 bg-amber-50 text-amber-800 ${className}`}>
  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />
  <span>{children}</span>
</div>

// Success — CheckCircle2
<div className={`${NOTICE} border-emerald-200 bg-emerald-50 text-emerald-800 ${className}`}>
  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />
  <span>{children}</span>
</div>

// Error — AlertCircle. Borderless variant, for a strip inside a form.
<p role="alert" className="flex items-start gap-2 rounded-btn bg-red-50 px-3 py-2 text-sm text-red-600">
  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
  <span>{children}</span>
</p>
```

`mt-0.5` on the icon and `shrink-0` matter: it optically aligns the glyph with the first
line of wrapped text instead of centring it against the whole block.

`role="alert"` for errors, `role="status"` for confirmations — so a screen reader announces
the thing that just went wrong without the user having to go looking for it.

**System banner** — full-width chrome above *everything*, sidebar included, for a mode the
user must not overlook. Navy, so it reads as chrome and doesn't compete with the accent:

```tsx
<div className="flex shrink-0 items-center gap-3 bg-navy px-4 py-2 text-xs text-white">
  <Eye className="h-4 w-4 shrink-0" strokeWidth={2} />
  <p className="min-w-0 flex-1 truncate">
    Je bekijkt de app als <span className="font-semibold">{name}</span>{" "}
    <span className="text-white/60">({email})</span>
  </p>
  <button className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-btn border border-white/25 px-2.5 py-1 font-medium transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50">
    <Undo2 className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
    Terug
  </button>
</div>
```

On a dark bar, `border-white/25` + `hover:bg-white/10` is the button — not a second colour.

---

## 10. Cards and panels

```tsx
// Card
<section className="rounded-card border border-zinc-200 bg-white shadow-sm">
  <div className="flex items-center justify-between gap-3 px-5 py-4">
    <h2 className="text-base font-semibold text-navy">Title</h2>
    {/* one control, right */}
  </div>
  <div className="border-t border-zinc-100 px-5 py-4">{/* section */}</div>
</section>

// Card with more air (a page's main block)
<section className="rounded-card border border-zinc-200 bg-white px-6 py-5 shadow-sm">…</section>

// Recessed panel inside a card — for tiles or a figure block
<section className="rounded-card border border-zinc-200 bg-surface/60 px-4 py-4">…</section>
```

**Centred single-purpose card** — an error, an empty state, a not-found. Always give it a
heading, a sentence and one way onward; never an empty shell, which reads as a broken app:

```tsx
<div className="flex min-h-0 flex-1 items-center justify-center px-4 py-10">
  <div className="w-full max-w-md rounded-card border border-zinc-200 bg-white px-6 py-6 text-center shadow-sm">
    <h1 className="text-lg font-semibold text-navy">{title}</h1>
    <p className="mt-2 text-sm text-body">{description}</p>
    <a className="mt-5 inline-flex cursor-pointer items-center justify-center rounded-btn bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-dark">
      {label}
    </a>
  </div>
</div>
```

---

## 11. Overlays

Four of these recur, and each should be **one component, not a block you copy** — every one
of them had drifted into two near-identical copies before it was extracted.

### Modal — centred dialog

Backdrop `bg-black/40`. Dismisses on Escape and on a backdrop click; the card stops
propagation so a click inside it doesn't close it. Width comes in through `className`
(`max-w-sm` … `max-w-6xl`); the card already owns rounding, ground and shadow.

**Below `sm` it is a bottom sheet** — full width whatever `max-w-*` came in, square at the
bottom edge, capped short of the screen's height and scrolling itself, padded off the home
indicator. The `max-sm:` classes follow the caller's in the cascade, so they win without a
dialog knowing. And at any width a card taller than the screen scrolls the backdrop
(`items-center-safe` + `overflow-y-auto`) instead of losing its top.

```tsx
export default function Modal({ onDismiss, className = "max-w-sm", children }: {
  onDismiss: () => void; className?: string; children: React.ReactNode;
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) { if (e.key === "Escape") onDismiss(); }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onDismiss]);

  return (
    <div className="fixed inset-0 z-50 flex items-center-safe justify-center overflow-y-auto bg-black/40 p-4
                    max-sm:items-end max-sm:px-0 max-sm:pb-0 max-sm:pt-[calc(1rem+env(safe-area-inset-top))]"
         onClick={onDismiss}>
      <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}
           className={`w-full rounded-card bg-white shadow-xl ${className}
                       max-sm:max-h-[calc(100dvh-1rem-env(safe-area-inset-top))] max-sm:max-w-none
                       max-sm:overflow-y-auto max-sm:rounded-b-none max-sm:pb-[env(safe-area-inset-bottom)]`}>
        {children}
      </div>
    </div>
  );
}
```

**Where the two exits live.** Every dialog puts **closing in the top-right corner, as a
round `X`**, and **saving bottom-right, as the footer's one primary button**. The two acts
are different in kind — one leaves, one commits — so they never sit side by side competing
for the same press, and a user looking for either always looks in the same place.

```tsx
export function ModalCloseButton({ onClose, label = "Sluiten" }: {
  onClose: () => void; label?: string;
}) {
  return (
    <button type="button" onClick={onClose} aria-label={label} title={label}
      className="inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center
                 rounded-full text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-navy">
      <X className="h-4 w-4" strokeWidth={2} />
    </button>
  );
}
```

The caller places it, rather than `Modal` floating one over the card: a dialog's header is
its own layout — a title with a subtitle, a search field, an icon chip — and the button has
to sit *in* that flex row (`flex items-start justify-between gap-4`, the button after the
`min-w-0` text block) or it lands on top of a long title. It is deliberately **not** a
`ModalButton`: closing isn't one of the choices a dialog offers, it is the way out of the
whole thing. Escape and a backdrop click still work — this makes that exit *visible*,
which neither of those is, and gives a pointer-only user the one-press exit a keyboard user
already had.

Consequences worth stating, because each was a real edit:

- **A dialog with a save has no *Sluiten* in its footer.** The `X` is the close, so the
  footer carries the save alone. A dialog with *nothing* to save (a list to pick from)
  keeps `PickerFooter`'s quiet *Sluiten* — dropping it would leave an empty bar and one
  small glyph as the only way out.
- ***Annuleren* is not *Sluiten*** and stays. Where the secondary button means *don't
  perform this action* — a send in flight, a decision being recorded — it is a real answer,
  not a synonym for leaving, and it keeps its place beside the primary.
- **While an action is running, the `X` goes away**, exactly as that dialog's *Annuleren*
  disables: the work is already on its way and there is no longer a clean way out.
- **A component that is both a page and a dialog doesn't share the slot.** The page's
  leading corner holds a back arrow (there is somewhere to go back to); the dialog's
  trailing corner holds the `X` (there isn't — it just shuts). See `UpdateConnectorExplorer`.

**Confirm prompts are the exception, and the reason is what they are.** A prompt built on
the icon-chip header below asks an either/or — *Blijf op Medewerkers* / *Wissel naar
Debiteuren*, *Opslaan* / *Verwerpen* — where **both buttons are the answer**. It has no
close, because there is no neutral way out: an `X` would be a third, silent answer to a
question deliberately given two, and on `LeaveModulePrompt` it would be the "leave it
unsaved" outcome the prompt exists to prevent. These keep Escape and the backdrop as
*cancel*, and no `X`.

**Prompt header** — a round icon chip beside a heading and one paragraph. The two variants
differ in *nothing but the chip*, so a question lays out the same way whether or not there
is anything at stake in it:

```tsx
<div className="flex items-start gap-3 px-6 py-5">
  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${chip}`}>
    <Icon className="h-5 w-5" strokeWidth={1.8} />
  </span>
  <div className="min-w-0">
    <h2 className="text-lg font-semibold text-navy">{title}</h2>
    <p className="mt-1 text-sm text-body">{children}</p>
  </div>
</div>
```

- Risk of regret — `AlertTriangle`, `bg-amber-100 text-amber-600`
- Nothing at stake — `Check`, `bg-green-100 text-green-700`

Use the green one rather than dropping the chip entirely: the amber triangle would claim a
risk that isn't there, and no chip at all leaves the reassurance to be read out of a
sentence.

**Footer** — `flex items-center justify-between gap-4 border-t border-zinc-200 px-6 py-4`,
with the primary action last. A dialog that's only a list to close gets a quieter button
than a real secondary — it isn't the alternative to anything:

```
cursor-pointer rounded-btn border border-zinc-200 bg-white px-4 py-2 text-sm
font-semibold text-navy transition-colors hover:border-primary hover:text-primary
```

**Undismissable variant:** make `onClose` optional and pass nothing. No close button, no
footer button, Escape ignored — for a dialog that *is* the page, with nothing behind it to
dismiss to.

### Drawer — right slide-over

Backdrop `bg-navy/20` (softer than the modal's — the page behind stays legible, which is
the point of a side panel). **Mount it only while open:** the slide-in is driven by a flag
flipped one frame after mount, so a drawer left mounted while closed animates once and
never again.

```tsx
export default function Drawer({ onClose, onEscape, label, width = "max-w-md", children }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  useEffect(() => {
    const dismiss = onEscape ?? onClose;
    function onKeyDown(e: KeyboardEvent) { if (e.key === "Escape") dismiss(); }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, onEscape]);

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={label}>
      <div onClick={onClose}
           className={`absolute inset-0 bg-navy/20 transition-opacity duration-200 ${shown ? "opacity-100" : "opacity-0"}`} />
      <div className={`absolute right-0 top-0 flex h-full w-full ${width} flex-col bg-white shadow-2xl transition-transform duration-200 ease-out ${shown ? "translate-x-0" : "translate-x-full"}`}>
        {children}
      </div>
    </div>
  );
}
```

`max-w-md` for reference content, `max-w-lg` where grouped lists need the room. Pass
`onEscape` when the drawer should peel off a layer of its own state (an active search)
before it closes. Inside: a `shrink-0` header with `border-b border-zinc-200`, then
`min-h-0 flex-1 overflow-y-auto px-6 py-5`.

### Popover — dropdown beside its trigger

`pointerdown` rather than `click` for the outside-dismiss: it fires before focus moves, so
the panel is already closing when the next control takes over. Listeners attach only while
open, so a closed popover costs nothing.

```tsx
export function useDismissOnOutside(open, containerRef, onDismiss) {
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!containerRef.current?.contains(e.target as Node)) onDismiss();
    }
    function onKeyDown(e: KeyboardEvent) { if (e.key === "Escape") onDismiss(); }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, containerRef, onDismiss]);
}

export function PopoverPanel({ placement, align = "left", children }) {
  return (
    <div className={`absolute z-50 w-72 rounded-card border border-zinc-200 bg-white shadow-lg ${
      align === "right" ? "right-0" : "left-0"
    } ${placement === "above" ? "bottom-full mb-2" : "mt-2"}`}>
      {children}
    </div>
  );
}
```

`w-72` is the ceiling. **Once the content needs more than that, make it a centred modal** —
which also frees a collapsed sidebar to open it without expanding first.

### Z-index ladder

`z-10` sticky table first column · `z-20` sticky table header · `z-30` a toolbar that a
dropdown hangs off · `z-50` overlays, popovers, tooltips. Four values; don't invent a fifth.

---

## 12. Tabs and segmented switches

**Segmented switch** — 2–4 mutually exclusive options. A `p-0.5` track holding `h-8`
buttons, the active one filled orange. `rounded-[7px]` inside `rounded-btn` (10px) is
deliberate: it's the inner radius that keeps a 2px track looking concentric.

```tsx
// Full width (dialog tabs): track bg-white, buttons flex-1
<div className="mt-4 flex h-9 w-full items-center rounded-btn border border-zinc-200 bg-white p-0.5">
  {TABS.map((o) => (
    <button key={o.id} type="button" onClick={() => setTab(o.id)} aria-pressed={tab === o.id}
      className={`flex h-8 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-[7px] px-3 text-sm font-medium transition-colors ${
        tab === o.id ? "bg-primary text-white" : "text-body hover:text-navy"
      }`}>
      {o.label}
    </button>
  ))}
</div>

// Inline (a filter beside a search field): track bg-surface, buttons sized to content
<div className="flex h-9.5 shrink-0 items-center rounded-btn border border-zinc-200 bg-surface p-0.5">
  {FILTERS.map((f) => (
    <button key={f.id} type="button" onClick={() => set(f.id)} aria-pressed={active}
      className={`flex h-8 cursor-pointer items-center justify-center rounded-[7px] px-3.5 text-xs font-semibold transition-colors ${
        active ? "bg-primary text-white shadow-sm" : "text-body hover:text-navy"
      }`}>
      {f.label}
    </button>
  ))}
</div>
```

`type="button"` on every one of these. Inside a form, a switch without it submits.

**Chip tabs** — for jumping between sections of a scrolling panel, where a filled track
would be too loud. `rounded-badge`, not a capsule: a chip you can click is still a badge
(§8), and `rounded-btn` is for controls with a real hit area:

```tsx
<div className="flex shrink-0 gap-2 border-b border-zinc-200 px-6 py-3">
  {tabs.map((t) => (
    <button key={t.id} type="button" onClick={() => scrollTo(t.id)}
      className={`cursor-pointer rounded-badge border px-3 py-1 text-xs font-medium transition-colors ${
        current === t.id
          ? "border-primary bg-primary/10 text-primary"
          : "border-zinc-200 text-body hover:border-primary/70 hover:bg-primary/5 hover:text-primary"
      }`}>
      {t.label}
    </button>
  ))}
</div>
```

---

## 13. Navigation rows

The sidebar's list row — active is `bg-primary/10 text-primary`, and it follows the **URL**
rather than a fetch, so the highlight lands with the click instead of a moment later.

```tsx
// Collapsible group header
<button type="button" onClick={toggle}
  className="flex w-full cursor-pointer items-center gap-3 rounded-btn px-3 py-2 text-left text-sm font-medium text-body transition-colors hover:bg-surface hover:text-navy">
  <span className="shrink-0 text-body">{icon}</span>
  <span className="flex-1 truncate">{label}</span>
  <span className="shrink-0 rounded-badge border border-zinc-200 bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-zinc-500">{n}</span>
  <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={2} />
</button>

// Item row — a real <a>, so it middle-clicks into a tab and its address copies
<a href={href} aria-current={active ? "page" : undefined} title={tooltip}
  className={`flex w-full cursor-pointer items-center gap-2 rounded-btn px-3 py-1.5 text-left text-sm transition-colors ${
    active ? "bg-primary/10 text-primary" : "text-body hover:bg-surface hover:text-navy"
  }`}>
  <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE_FILL[tone]}`} />
  <span className="min-w-0 flex-1 truncate">{label}</span>
  {badge}
</a>
```

`min-w-0 flex-1 truncate` on the label and `shrink-0` on everything else is what stops a
long name pushing the badge out of the rail. Nested lists get `pl-4`, rows `space-y-0.5`.

**Footer rows** (settings, sign-out) are quieter — no dot, no badge, and destructive ones
tint red on hover only:

```
flex w-full cursor-pointer items-center gap-2 rounded-btn px-3 py-2 text-sm font-medium
text-body transition-colors hover:bg-surface hover:text-navy
/* destructive: */ hover:bg-red-50 hover:text-red-600
```

**Brand mark** — an icon chip plus a wordmark, both tinting on hover via `group`:

```tsx
<a href="/" className="group flex min-w-0 flex-1 cursor-pointer items-center gap-2">
  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-white shadow-sm transition-colors group-hover:bg-primary-dark">
    <FileSpreadsheet className="h-5 w-5" strokeWidth={2} />
  </span>
  <span className="min-w-0 flex-1 truncate text-lg font-bold tracking-tight text-navy transition-colors group-hover:text-primary">
    App name
  </span>
</a>
```

---

## 14. Avatars and entity tiles

**A circle is a person; a rounded square is a thing.** Hold that distinction and a mixed
list reads without labels.

```tsx
// Person
<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy text-white">
  <User className="h-4 w-4" strokeWidth={2} />
</span>

// Entity (project, org, file)
<span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary text-white">
  <Building2 className="h-4 w-4" strokeWidth={2} />
</span>
```

**Entity tile** — an identifier eyebrow over the name, the name being the line that
truncates. The code goes *beside* the word, `tabular-nums`, because it's what someone pastes
into chat:

```tsx
<button className="flex items-center gap-2.5 rounded-btn border border-zinc-200 bg-white px-3 py-1.5 text-left transition-colors hover:border-primary cursor-pointer">
  {avatar}
  <span className="min-w-0">
    <span className="block text-[10px] font-semibold uppercase tracking-wide text-zinc-400 leading-none">
      Project <span className="tabular-nums">{id}</span>
    </span>
    <span className="block max-w-[12rem] truncate text-sm font-medium text-navy">{name}</span>
  </span>
  <ChevronsUpDown className="ml-auto h-4 w-4 shrink-0 text-zinc-400" />
</button>
```

With only one option to pick from, render the same tile **inert, without the chevron** —
rather than a disabled button or a dropdown that opens onto a list of one.

---

## 15. Data table

Orange sticky header, sticky first column, hairline rows, and a `p-0` cell wrapping a
borderless input for inline editing.

**A cell's messages on touch.** The flag's explanation is a hover tooltip, and a touch screen
has no hover — so there it shows while the cell has **focus** (tapping a cell is what
focuses its input), kept inside the screen and moved along when the table scrolls, gone on
blur. Gated on `matchMedia("(pointer: coarse)")`, so a mouse keeps exactly the hover. The
codetabel corner button grows to 26px on touch; 44px would bury the cell under it.

```tsx
<div className="min-h-0 flex-1 overflow-auto rounded-card border border-zinc-200">
  <table className="min-w-full border-collapse text-sm">
    <thead className="sticky top-0 z-20 bg-primary">
      <tr>
        {/* Row-number column: sticky on both axes, so it needs its own bg */}
        <th className="relative sticky left-0 z-10 bg-primary px-3 py-2.5 text-left font-semibold text-white">
          #
          <span aria-hidden className="pointer-events-none absolute right-0 top-1/2 h-1/2 w-px -translate-y-1/2 bg-white/30" />
        </th>
        {cols.map((c) => (
          <th key={c} className="relative whitespace-nowrap px-3 py-2.5 text-left font-semibold text-white">
            {c}
            <span aria-hidden className="pointer-events-none absolute right-0 top-1/2 h-1/2 w-px -translate-y-1/2 bg-white/30" />
            {/* Resize handle */}
            <span className="absolute -right-px top-0 z-30 h-full w-2 cursor-col-resize select-none hover:bg-white/25 active:bg-white/40" />
          </th>
        ))}
      </tr>
    </thead>
    <tbody>
      <tr className="border-t border-zinc-100">
        <td className="sticky left-0 z-10 bg-white px-3 py-2 text-body tabular-nums">{i + 1}</td>
        <td className={`relative overflow-hidden p-0 ${flagged ? "bg-red-50" : ""}`}>
          <input className="h-full w-full min-w-[6rem] bg-transparent py-2 text-navy caret-primary outline-none transition-colors focus:bg-primary/5 focus:ring-1 focus:ring-inset focus:ring-primary/50" />
        </td>
      </tr>
    </tbody>
  </table>
</div>
```

Details that carry the whole thing:

- **Column dividers are a `w-px bg-white/30` pseudo-element at half height**, not a border.
  A border on an orange header reads as a grid; a short hairline reads as a separator.
- **The first data column is frozen too** (`DataTable`), beside `#`, so a row keeps its key in sight while the sheet scrolls sideways: `sticky z-10` at `left` = the `#` column's measured width (a `ResizeObserver`, floored so no seam opens), in the label row, the search band and every body row, each repeating its ground (`bg-white` unless the cell is tinted) and carrying the freeze line, an inset `-1px` `zinc-200` shadow on its right edge.
- **The row-number column repeats its own background.** `position: sticky` doesn't inherit a
  ground — without `bg-white` on the cell (and `bg-primary` on the header cell), rows scroll
  visibly underneath it.
- **`border-t border-zinc-100` on rows**, never `divide-y` — the top row keeps its edge
  against the sticky header.
- **`overflow-hidden p-0` on an editable cell**, with the padding on the input inside. That
  way the focus ring hugs the cell instead of floating inside it.
- **`caret-primary`** on the editor. Small, and the only place the accent appears in the
  grid.

**Corner marks** — a 7px triangle in a cell corner, for state that mustn't cost a whole
column. Built from borders, so it needs no SVG:

```tsx
{/* top-left: edited */}
<span aria-hidden className="pointer-events-none absolute left-0 top-0 h-0 w-0 border-r-[7px] border-t-[7px] border-r-transparent border-t-primary" />
{/* bottom-right: invalid */}
<span aria-hidden className="pointer-events-none absolute bottom-0 right-0 h-0 w-0 border-l-[7px] border-b-[7px] border-l-transparent border-b-red-500" />
```

**Cursor-following tooltip** — `fixed`, positioned in JS:

```
pointer-events-none fixed z-50 max-w-xs rounded-md bg-navy px-2.5 py-1.5 text-xs
font-medium leading-snug text-white shadow-lg
```

**Column band** (a header row for a non-`<table>` list). Band and rows must share **one grid
template**, and the right-hand columns must be **fixed widths, not `auto`** — each row is
its own grid container, so an `auto` column sizes to that row's content and the columns
stagger down the list. If the template is computed, pass it as an inline `style`: Tailwind
reads class names out of source text and won't generate `grid-cols-[…]` you build at
runtime.

```tsx
const PICKER_ROW_GRID = "grid items-center gap-3";

<div className={`${PICKER_ROW_GRID} bg-surface px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-body`}
     style={{ gridTemplateColumns: template }}>…</div>
```

Long scroll lists get a **fade at the bottom edge** — a list whose last visible row is
sliced through the middle reads as a layout that ran out of room rather than as one there
is more of. And take the height off the **viewport** (`max-h-[min(24rem,42vh)]`), not a
fixed `rem`, or the footer below it goes under the fold on a laptop.

---

## 16. Figures, meters, dropzones

**Two metrics side by side** — the standard "here's where things stand" block. `grid-cols-2
divide-x` with `pl-4` on all but the first:

```tsx
<div className="grid grid-cols-2 gap-x-4 divide-x divide-zinc-200">
  {metrics.map((m, i) => (
    <div key={m.caption} className={i === 0 ? undefined : "pl-4"}>
      <div className="text-3xl font-extrabold leading-none tracking-tight text-navy">{m.figure}</div>
      <p className="mt-1.5 text-sm leading-snug text-body">{m.caption}</p>
      {m.detail && <p className="mt-1 text-xs tabular-nums text-body/80">{m.detail}</p>}
    </div>
  ))}
</div>
```

`text-4xl` in a drawer (the figure is the whole point), `text-3xl` at the top of a page.

**Inline metric** — the same three strings laid out sideways, where there's no room to
stack:

```tsx
<div className="flex min-w-0 items-center gap-2.5">
  <span className="shrink-0 text-2xl font-extrabold leading-none tracking-tight text-navy">{figure}</span>
  <span className="min-w-0">
    <span className="block text-sm leading-snug text-body">{caption}</span>
    <span className="block truncate text-xs leading-snug tabular-nums text-body/80">{detail}</span>
  </span>
</div>
```

Render both from **one component**. Two surfaces printing the same figure their own way is
how a percentage ends up rounded differently in two places.

**Segmented meter + legend.** `gap-[2px]` between segments over a `bg-surface` track, each
segment `rounded-full` so a single-segment bar still reads as a rounded track. Widths are inline
percentages; the fills come from the same tone map as the dots (§8) — status colours, not
series colours.

```tsx
<div className="mt-4 flex h-2.5 gap-[2px] overflow-hidden rounded-full bg-surface">
  {segments.map((s) => (
    <div key={s.id} style={{ width: `${s.pct}%` }}
         className={`h-full rounded-full ${TONE_FILL[s.id]}`} />
  ))}
</div>
<ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-body">
  {segments.map((s) => (
    <li key={s.id} className="flex items-center gap-1.5">
      <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${TONE_FILL[s.id]}`} />
      {s.label} <span className="font-semibold tabular-nums text-navy">{s.value}</span>
    </li>
  ))}
</ul>
```

**Dropzone.** `flex-1` with a `min-h-72` floor, so it takes every pixel the page leaves
rather than sitting as a fixed strip with dead space under it. A big drop target is worth
more than a row of buttons that can't act yet.

```tsx
<div role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onOpen(); }}
  className={`group flex h-full min-h-72 w-full flex-1 cursor-pointer flex-col items-center justify-center gap-3 rounded-card border-2 border-dashed px-8 py-12 text-center shadow-sm transition-all ${
    dragging ? "border-primary bg-primary/5" : "border-zinc-300 bg-white hover:border-primary/70 hover:shadow-md"
  }`}>
  <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
    <Upload className="h-8 w-8" strokeWidth={1.5} />
  </span>
  <p className="text-xl font-semibold text-navy">Kies een bestand</p>
  <p className="text-sm text-body">.xlsx, .xls of .csv</p>
  <span className="mt-3 inline-flex items-center gap-2 rounded-btn bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors group-hover:bg-primary-dark">
    Bestand kiezen
  </span>
  <p className="mt-2 text-xs text-body/70">of sleep een bestand hierheen</p>
</div>
```

The inner "button" is a `<span>`, not a nested `<button>` — the whole card is already the
control, and a real button inside it is invalid and unreachable by keyboard in the way you'd
expect.

---

## 17. Hero

Heading and copy **side by side, not stacked**. Stacked, they cost the better part of a
screen and push the thing the page is actually for under the fold.

```tsx
<section className="mx-auto mb-8 grid w-full max-w-3xl shrink-0 items-center gap-x-8 gap-y-4 lg:grid-cols-2">
  <h1 className="text-3xl font-extrabold leading-[1.1] tracking-tight text-navy lg:text-4xl">
    Van Excel naar
    <br />
    <span className="highlight-band">AFAS</span> zonder gedoe
  </h1>
  <div className="min-w-0">{intro}</div>
</section>
```

- **One word in the band, never a phrase.** The band is the accent's loudest use in the app.
- **The width belongs to the component**, not the call site: the line break is hand-placed,
  so the column has to hold the line placed for it.
- **Two columns from `lg`, not `sm`.** A sidebar takes its width out of the viewport first,
  and half of a tablet's remainder won't hold a `text-4xl` phrase. Under `lg` they stack,
  heading first.

---

## 18. Loading and empty states

```tsx
// Inline: Loader2, the only spinner
<Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />

// Whole screen: the brand mark, pulsing
<main className="flex min-h-0 flex-1 items-center justify-center px-4 py-10">
  <span className="flex h-12 w-12 animate-pulse items-center justify-center rounded-xl bg-primary text-white shadow-sm">
    <FileSpreadsheet className="h-6 w-6" strokeWidth={2} />
  </span>
</main>

// A list that has nothing in it, is loading, or failed — one line, in place
<p className="px-3 py-2 text-xs text-body">
  {status === "loading" ? "Laden…" : status === "error" ? "Kon niet worden geladen." : "Niets gevonden."}
</p>
```

Three rules worth stating outright:

- **An empty slot says so in place**, rather than collapsing. A section that comes and goes
  makes the layout jump and reads as a bug.
- **Loading, empty and failed are three different sentences.** One shared "Geen resultaten"
  for all three hides an outage.
- **A failure gets a retry** where the content would be (`RotateCw` + *Opnieuw proberen*).
  Closing and reopening should never be the only way.

---

## 19. Icons

**[lucide-react](https://lucide.dev), always.** Import the named component and size with
Tailwind. No raw inline `<svg>` — a hand-pasted path is how the same upload arrow ends up in
a codebase three times over. Where lucide has one direction, **rotate rather than
duplicate** (`ChevronLeft` + `rotate-180`).

| Size          | Where                                    |
| ------------- | ---------------------------------------- |
| `h-3 w-3`     | Inside a small badge                     |
| `h-3.5 w-3.5` | Chevrons, a clear `×`                    |
| `h-4 w-4`     | The default: buttons, rows, notices      |
| `h-5 w-5`     | Brand mark, modal header chip            |
| `h-6 w-6`     | Full-screen loading mark                 |
| `h-8 w-8`     | Dropzone                                 |

`strokeWidth`: **1.8** default (it matches Inter's weight better than lucide's 2), **2**
where the glyph is small or must read crisply, **1.5** at `h-8` and up. Always `shrink-0` in
a flex row. `aria-hidden` when the label beside it already says the same thing.

Icons this design has settled meanings for: `AlertTriangle` warning · `AlertCircle` error ·
`CheckCircle2` success · `Check` confirmed · `X` close · `Search` search · `Loader2` busy ·
`RotateCw` retry · `ChevronDown` collapse · `ChevronsUpDown` picker · `Download` /
`Upload` · `Save` save a sheet · `FileUp` replace it with another file · `Eye` / `EyeOff` reveal · `LogOut` · `Settings` · `HelpCircle`.

---

## 20. Accessibility rules this design depends on

Not a checklist bolted on afterwards — several recipes above are only correct with these.

- **Colour never says it alone.** Every dot, tint and meter has the same fact in words
  nearby — in the visible label, the `title`, or an `sr-only` tail.
  ```tsx
  <span className="sr-only">status in AFAS: </span>
  <span className="sr-only"> van de rijen zonder fouten bij de laatste controle</span>
  ```
- **`aria-pressed`** on toggles and segmented-switch buttons; **`aria-current="page"`** on
  the active nav row.
- **`aria-label`** on every icon-only button — the tooltip is a hover affordance, not an
  accessible name.
- **`role="img"` + `aria-label`** for a badge that reports a fact. Not a disabled checkbox:
  that reads as a control someone switched off.
- **`role="alert"`** on errors, **`role="status"`** on confirmations.
- **`role="dialog" aria-modal="true"`** on modal and drawer, with `aria-label` on the drawer
  (the modal names itself through its heading).
- **`role="tooltip"`** on the tooltip span.
- **Escape closes every overlay**, and a backdrop click does too — except where the dialog
  *is* the page.
- **A clickable div needs `role="button"`, `tabIndex={0}` and an Enter/Space handler.** The
  dropzone is the only one in this app, and it has all three.
- **Real `<a>` for navigation**, so it middle-clicks into a tab and its address copies. A
  `<button>` that calls a router does neither.
- Contrast: the status inks clear AA on their own tint, on `--color-surface` and on white.
  `text-body` on white is 5.9:1. `text-body/70` is for supporting detail only — don't put a
  fact there.

---

## 21. Porting checklist

1. Copy §2 into `app/globals.css`. That's the whole design system's CSS.
2. Wire Inter + the `<html>`/`<body>` classes from §1.
3. Re-point `--color-primary` and `--color-primary-dark` for a different brand. Everything
   that uses the accent — buttons, focus rings, active rows, tints, the highlight band, the
   pulse animation — follows, because they all reference the token.
4. **Recompute the status inks if you change them** — don't eyeball them. The family's rule
   is one luminance (~0.145) across all three, with letters clearing 4.5:1 on their own
   `/10` tint, on `bg-surface` and on white. Break that and the badges start shouting at
   different volumes.
5. Copy the four overlay components (§11) first. Everything else is class strings; these are
   behaviour, and they're what gets re-rolled inconsistently.
6. Keep each tone→fill map in exactly one module and import it. Same for pluralised or
   otherwise inflected count strings — the number of surfaces that print a count is always
   larger than it looks.

### Conventions to keep

- **One accent, spent sparingly.** Primary buttons, active state, focus, the band, small
  icon chips. Everything else is navy/grey on white. A second accent colour is how this
  design starts to look like a different design.
- **Light theme only.** No `dark:` variants. Add one and you're maintaining two palettes
  where the status inks were tuned for exactly three grounds.
- **Cards, not dividers.** White `rounded-card` + `border-zinc-200` + `shadow-sm`, with
  `border-zinc-100` hairlines *inside*.
- **Three radii, and one of them is not a shape you pick.** `rounded-card` for cards,
  `rounded-btn` for controls with a real hit area, `rounded-badge` for every badge, tag and
  chip. `rounded-full` is reserved for dots, meters and circular icon slots — mixing capsules
  into the badge family is how a reader ends up with two silhouettes meaning nothing.
- **`cursor-pointer` + hover + `transition-colors`** on everything interactive.
- **Styling in the component, margin at the call site.** Notices, search fields and metrics
  bring no outer spacing of their own.
- **Shared scaffolding, not copied blocks.** Every overlay in this app had drifted into two
  near-identical copies before it was extracted into a component.
- **Truncate with `min-w-0 flex-1 truncate` on the label and `shrink-0` on its neighbours.**
  This one line is what keeps a narrow row from breaking under a long name.
- **A number in a column gets `tabular-nums`; a headline figure doesn't.**

---

**Part II — this app.** Everything from here on is Nymbus Conversies specifically: its
screens, its components, and the reasoning behind each one. The material above travels to
another app; this doesn't.

---

## 22. Principles

- **One screen, clear steps.** Upload → recognize → review/validate → upload; the user always knows the current step and what blocks the next.
- **Errors are visible and local** — flagged inline on the exact cell/row, always. The
  **validatierapport** is a summary *of those same flags* (grouped per column, on demand from
  the toolbar) for when the user needs the overview a 60-column sheet can't give; it never
  replaces the inline flags and never carries an issue the table doesn't also show.
- **No upload until clean**; the upload action is last and disabled while blocking errors remain. The **explicit override is admin rights**: *Aanleveren bij Nymbus* needs a checked, clean, unedited-since sheet for a client and only a loaded file for us — the rule is there to stop a client sending a sheet nobody looked at, not to lock us out of our own environment while debugging. See **Sheet toolbar**.

## 23. Look and feel, in this app

Light, clean, modern, with a single warm **orange accent** (Nymbus). Calm and uncluttered: white space, soft borders, subtle shadows, rounded corners.

- **Light theme only.** Near-white background, navy text. Do **not** add `dark:` variants — dark styling was removed on purpose.
- **Orange used sparingly** — primary buttons, active sidebar state, icons, the hero highlight band. Everything else navy/grey on white.
- **Bold hero headings** with one word in the orange `.highlight-band` (globals.css), e.g. "Van Excel naar `AFAS` zonder gedoe".
- **Cards over dividers** — white `rounded-card` with `border-zinc-200` + `shadow-sm`.

**Where the tokens live** — [`globals.css`](../frontend/src/app/globals.css) is §2 of this
document verbatim, and Inter is loaded in `layout.tsx` (§1). Prefer the semantic classes
(`text-navy`, `text-body`, `bg-primary`, `bg-surface`, `rounded-btn`, `rounded-card`,
`rounded-badge`) over hard-coded hex. The token table is §2, the status-ink family and its
one-luminance rule §8, the elevation and motion steps §4.

**Icons** — §19 carries the rule and the sizes. One thing to add for this repo: there are
**no raw inline `<svg>`s left in `frontend/src/`**, so any that appears is new, and a
hand-pasted path is how the same upload arrow ended up in the codebase three times over.

## 24. Screens and app shell

Two layers. [`AuthGate`](../frontend/src/components/AuthGate.tsx), mounted by [`layout.tsx`](../frontend/src/app/layout.tsx), is the login screen until there is a session — no sidebar, no project context, no route below it rendered. The shell itself is [`app/[project]/layout.tsx`](../frontend/src/app/[project]/layout.tsx): sidebar left, the module's page flush right of it, no top header. It belongs to a project, which is why it lives on that route and not above it — see [architecture.md](architecture.md#routing).

**Every screen has an address**: `/{project}` for the project, `/{project}/{module}` for a module. So a module is linkable, survives a refresh, and opens in its own tab — and a URL can now name something the session doesn't have, which [`RouteNotice`](../frontend/src/components/RouteNotice.tsx) answers: one centred `rounded-card` saying which address was asked for, why it isn't there (*Project niet gevonden* / *Module niet beschikbaar* / *Geen projecten*), and one orange button onward. Never an empty shell — that reads as a broken app rather than a wrong link.

**[`LoginScreen`](../frontend/src/components/LoginScreen.tsx)** — centred, `max-w-3xl`: the heading over **two cards side by side**, one per way in, their contents decided by `GET /api/auth/config` (`ssoEnabled`, `codeLoginEnabled`, see [architecture.md](architecture.md#data-flow)) rather than fixed markup — so the screen never offers a way to log in the backend won't accept. **A card each, not one card with a divider.** Stacked behind an *of*, the screen asked the reader to try the top way first and read on only if it failed; but which path is right isn't a preference, it follows from who you are, and that is knowable before the first click. So each card names its audience in its own words — *Nymbus consultant* over *Ben je een Nymbus consultant? Log dan hier in met SSO.* and a full-width orange **Inloggen met AFAS SSO** (`ShieldCheck`, a plain `<a>` out to the backend rather than a `GuardedLink`: no in-app navigation to guard on the way out, nothing yet open to protect); *Klant bij Nymbus* over *Ben je klant bij Nymbus? Log dan hier in met het emailadres dat bij ons bekend is* and the address field. `md:grid-cols-2`, stacked below it with SSO first, so a narrow screen still meets the one-click path first. `items-start`, so each card keeps its own height — the code step makes the second card taller and stretching the first to match leaves a block of white under its one button; `mt-auto` on each card's action instead. The heading carries the grid's own `max-w-3xl` rather than shrinking to its text, so the two blocks share one pair of edges instead of merely being concentric. With one method configured the lone card keeps a column's width (`md:max-w-[calc(50%-0.75rem)]`) rather than spanning the grid, and with neither it says *Inloggen is momenteel niet beschikbaar*. Errors render **once above both cards**, in a red-tinted `rounded-btn` strip with an `AlertCircle` — an SSO failure arrives on a redirect with neither card focused, and the same message in both would read as two problems. Landing back here mid-AFAS-login (`?sso_code=…` / `?sso_error=…`, stripped from the URL on read) replaces both cards with one `max-w-md` card saying *Bezig met inloggen via AFAS…* while the one-time handoff code is traded for a session — there is nothing left to choose between at that point.

**[`Sidebar`](../frontend/src/components/Sidebar.tsx)** — full-height, left. Top to bottom: brand mark + collapse toggle; `ProjectSelector` (full-width); module groups (HRM/ERP, collapsible, with count badges, active item `bg-primary/10 text-primary`, a status dot, a sky `Hourglass` when the deeltaak's current task sits with Nymbus (`withNymbus`), and a progress badge per module); signed-in user + **Uitloggen** (pinned bottom, `LogOut` icon, red hover), preceded for admins by **Projectinstellingen**, **Gebruikers** and **Updateconnectors**. Collapsible to a `w-16` icon rail (from `w-68`): the project selector becomes its initials badge, group labels/lists hide, icons remain. Nothing on the rail has to expand the sidebar to be used — the project selector and the admin rows open dialogs, which don't care how wide the sidebar is.

It is real navigation: the module rows and the **brand mark** are [`GuardedLink`](../frontend/src/components/NavigationGuard.tsx)s — `<a>`s, so a module middle-clicks into its own tab and its address copies, but guarded, so the uploader's leave prompt gets in front of a click that would close an open sheet. The brand leads to the project's own page (the mark tints to `primary-dark`, the wordmark to `primary`, on hover); without it that page would only be reachable with the back button. Active rows carry `aria-current="page"` and follow the **URL**, not the module fetch, so the highlight lands with the click instead of a moment later.

The module groups are the **active project's** (`useModule()`, fetched per project — see [file-types.md](file-types.md#which-modules-a-project-has)), so switching projects changes the list. While it loads, and when there's nothing to show, a small `text-xs text-body` line takes its place: *Modules laden… / Dit project heeft geen modules. / Modules konden niet worden geladen.* Groups are open unless the user closes one, so a project switch never collapses them.

**Status dot per module** — the small dot at the head of a module row is **where AFAS says that module stands**: the workflow status of its deeltaak (`useModule().statuses`, arriving with the module list itself — the deeltaak row *is* both "this project has this module" and "and it stands here"). Four tones, because eighteen AFAS status codes need four answers in a sidebar: emerald *afgerond* (`A`), red *niet akkoord* (`NA`, `IA`, `LN`), the brand orange for **the client's turn** and sky for **Nymbus's** — decided by the deeltaak's current task, not its status code (`withNymbus`, from `CLIENT_TASKS` in the hosted version's backend: *Template vullen*, *Vullen import template*, *Controle testimport*, *Controle live import* and the *Import niet akkoord* after the test import are the client's, every other task Nymbus's; the same flag draws the hourglass after the label) (`moduleStatusTone()` in [`lib/modules.tsx`](../frontend/src/lib/modules.tsx), which also holds the one `STATUS_TONE_FILL` map both this dot and the **projectrapport**'s meter paint from, and `MODULE_STATUS_SEGMENTS` — the tones in reading order with the word each is named by, for the surfaces that have to bucket eighteen codes into four and count them). A dot rather than a second pill: the status is the leading fact — it is what Nymbus works from — but the row is a navigation menu first, and a badge beside the percentage would push the label out of a `w-68` rail. **Colour never says it alone**: the wording leads the row's tooltip (*Klant — Template vullen · 87% van de rijen zonder fouten · …*) and an `sr-only` tail spells it out for screen readers. Without a status the dot falls back to the plain active/inactive marker it has always been.

**Progress badge per module** — a small pill at the right edge of a module row carrying the **completeness of that module's last check** (`useProgress()`, per project — see [architecture.md](architecture.md#api-surface)): the share of **rows without a blocking error** — what AFAS could take as it is — the same figure the validatierapport leads with (`sheetMetrics()` in [`validation/metrics.ts`](../frontend/src/lib/validation/metrics.ts)). Rows rather than fields on purpose: the upload goes record by record, so one bad field takes its whole row with it, and a badge scored per field would call a sheet nearly finished while nothing in it could actually be sent. How much of the *data* is right is the report's second metric and stays there. `text-[10px]` + `tabular-nums` on `rounded-badge`, `border-green-200 bg-green-50 text-green-700` at 100% (the sheet could go to AFAS as it is) and `border-amber-200 bg-amber-50 text-amber-700` below that — its own green and amber rather than the status inks, because it reports a **measure** and not a verdict, and amber left that family on purpose — the number carries the meaning, the colour only echoes it, and an `sr-only` tail spells the figure out (*…% van de rijen zonder fouten bij de laatste controle*). A module **nobody has checked yet has no badge**: the list is a navigation menu first, and a rail of `0%` pills would read as failure rather than as "not started". The module label truncates so a long name can never push the badge out. Hovering the row shows the moment of that check and the file it came from (*87% van de rijen zonder fouten · laatste controle 30-07-2026 15:41 · Medewerkers.xlsx*, `formatCheckedAt()` in [`lib/project-progress.ts`](../frontend/src/lib/project-progress.ts) — local time, because the client checked their sheet at a wall-clock moment). The badge shows only what the deeltaak holds in AFAS: a validation run in the browser doesn't move it, an action that stamps new figures (a hand-off, an admin's workflow action or push, the end of a send) does, after which it is read back. **After a send to AFAS** the same field holds that send's outcome — the share of the sheet's rows now *in* AFAS — and the pill leads with a `CloudUpload` (`h-2.5 w-2.5`, `strokeWidth` 2.5) to say which question the number answers; same bands, same colours, and the tooltip spells it out (*94% van de rijen staat in AFAS (Live) · 188 van 200 rijen · 12 rijen geweigerd · verstuurd …*, `progressSummary()`). The badge column is `w-12` for every row so the badges stack as one column with or without the icon. The projectrapport puts the same cloud before its **Rijen OK** figure and folds AFAS's refusal messages per module open under its header (*Geweigerd door AFAS*, [`SendRefusals`](../frontend/src/components/SendRefusals.tsx), behind the header's *Geweigerd* button); the managementrapport carries the section per client. A project-wide *rijen in AFAS* tile used to sit on both cards and was dropped (20-10-2026): its denominator could only be the sent modules, so beside a module count it kept reading as the project's figure. Not on the icon rail — the module list is hidden there. The **module start card** shows the same stored figure, spelled out, on the module's own page while no file is loaded (see **Upload landing** below) — the badge is the glance across every module, the card is the detail for the one being opened.

**Below `lg`: a top bar and the sidebar as a drawer.** A phone or a portrait tablet can't spare `w-68` beside the page, so [`MobileTopBar`](../frontend/src/components/MobileTopBar.tsx) takes the sidebar's place — one `h-14` white row with a `border-b`: a `Menu` button, where you are (the `PROJECT 501243` label over the module's name, or the project's on the project page), and a `Home` link to the project page, both buttons 44px. The menu opens **the same `Sidebar`**, not a mobile copy: `ProjectShell`'s wrapper turns into a fixed left panel (`max-lg:` classes, `max-w-[85vw]`, `shadow-2xl`, padded by the safe-area insets) that slides in over a `bg-navy/20` backdrop and closes on the backdrop, on Escape (unless a dialog it opened is up), and on any change of path. It slides on `translate` and rests at `translate-none`, never `translate-x-0`, because a transform would trap the dialogs the sidebar opens inside the panel. No bottom tab bar: the sidebar is a module list plus admin rows, not three to five fixed destinations. Focus mode is desktop-only — its toolbar button is `hidden lg:contents`.

**Each screen below `lg`** — the rule is that the page scrolls, once, and that a phone gets the facts it is opened for rather than a squeezed copy of the desktop. What a phone is opened for is a developer's round: sign in, pick a project with work waiting on Nymbus, open its module, send the handed-in sheet to AFAS, press the workflow action. Layout is `max-lg:` CSS; where a phone gets different *behaviour* (an order, a view chosen for you, a panel that starts open) it reads [`lib/narrow-screen.ts`](../frontend/src/lib/narrow-screen.ts) — `useNarrowScreen()` to render, `isNarrowScreen()` for a one-off decision:
  - **Project page** — the report card is as tall as its modules (`max-lg:shrink-0`) and the page scrolls instead of a window inside the card; the header wraps its buttons under the heading; the three figures stack below `sm`, each figure beside its caption; the modules are cards (see *Lijst* below). The hero's heading scales with `clamp()` on a phone.
  - **Module page** — *Aangeleverde bestanden* is a band **above** the sheet instead of a panel beside it, collapsed on a phone to one tappable row with its file count, capped at `max-h-60` when open. It starts **open** when the module's task is Nymbus's (the file the client handed in is what you came for), and folds away again once a sheet from it is opened, bringing the toolbar and its workflow actions to the top. **An admin who opens a sheet on a phone lands on Payloads**, not the grid, for a module that has them — on a phone you open a sheet to send it; the grid is a tap away on the view switch. `#upload` is the scroll pane; with a sheet open the table card is a screen tall (`h-[calc(100dvh-6rem)]`), so the toolbar scrolls away and the table fills the phone with its own scroll. The toolbar's grid goes to one column: title, icon row, error stepping, workflow buttons at full width, figures one per line.
  - **Managementrapport** — its two grids get a real `grid-cols-1` track (an implicit `auto` column grew to the widest table and pushed the page sideways); *Overzicht per klant* keeps every column, scrolls sideways inside its card, its project column `w-40` and sticky.
  - **Project picker** — the two grids stack, the lists stop scrolling themselves (the sheet does), the search takes its own row, and a row is name + status: *Connection* and *Type* are left out there. Each grid leads with the projects that have work waiting on Nymbus, most first — sorted, not filtered (*Bij Nymbus* still filters).
  - **Payloads** — for sending, not reading: the body pane's header leads (step, Test/Live, the send button full width, Stop and the run's progress in the same place), the records follow at full width with their tick boxes, and **the JSON is left out**, with its *Kopieer JSON* and *Koppeling* buttons. A tap on a record row ticks it rather than opening a body there is no room to show. The confirm dialog is the bottom sheet every `Modal` becomes.
  - **Modules waiting on Nymbus first** — in the drawer and on the project page's cards, within each group. The desk keeps AFAS's order.
  - **Admin tools** (updateconnectors, e-mails, a dossierconversie) — no mobile layout; [`DesktopOnlyNotice`](../frontend/src/components/DesktopOnlyNotice.tsx) says so over them below `lg`.

**[`ProjectSelector`](../frontend/src/components/ProjectSelector.tsx)** — initials avatar + a `PROJECT 501243` label (the code beside the word, `tabular-nums` — it is what a colleague pastes into chat and what the URL carries) over the project name, which is the line that truncates; `fullWidth` stretches it for the sidebar, `collapsed` reduces it to the initials badge for the icon rail. With **more than one project** it is a button (`ChevronsUpDown` at the right edge, `aria-haspopup="dialog"`) that opens `ProjectPickerModal`; with a **single project** it's the same tile, inert, without chevron or dialog. It also **opens that dialog by itself once, right after an admin signs in** — the sign-in happens wherever the address bar stands, so without it an admin who arrives on a linked module lands in a project nobody chose (`projectChoicePending` in [architecture.md](architecture.md#routing)). Dismissable, unlike the copy `/` shows: behind this one there is a project to work in, and closing it is a decision to stay there. Admins carry every project, other users their own, so in practice admins nearly always get the button — but the rule is *more than one project*, so a non-admin in two gets it too; this is not an `AdminOnly` gate. The list comes from the session (`AuthProvider`), not a separate fetch.

**[`ProjectPickerModal`](../frontend/src/components/ProjectPickerModal.tsx)** — a centred `Modal` (`max-w-6xl`), not the `PopoverPanel` this used to be. What you need to know before opening a project no longer fits on a `w-72` panel hanging off a `w-68` rail: whether AFAS holds a **dossieritem** for it at all, its status, how many modules it has, what kind of conversion it is, and which of its two AFAS environments are set up. The dialog also frees the collapsed rail to open the picker without expanding the sidebar first — the same reason `ProjectSettings` and `UsersRow` open dialogs.
  - Header (*Kies een project*, `20 projecten in AFAS, waarvan 10 actief in realisatie`) over **one row holding both controls**: a `ModalSearch` taking the width — it searches **name and project code**, since the code is what a colleague pastes into chat — and beside it a **status filter** at the width its three words need (the same segmented switch as `ProjectSettingsDialog`'s tabs: *Realisatie / Afgemeld / TEST*, with *Alle* being none of them on). *TEST* is the test projects — the *Testproject* box on the settings' *Conversie* tab — and they appear under that segment **only**: every other setting, *Alle* included, leaves them out (`matchesPickerFilter` in `lib/project-filters.ts`), so a sandbox never sits among the clients unless it is asked for. Then the two grids side by side, and a footer with the count and **Sluiten**. The filter used to sit **under** the field at full width, and that put a block of brand orange the size of a hero button above the list — the loudest thing in a dialog whose whole job is to be read — while spending a row of height on the word *Alle*. The filter narrows the searched list before it splits into the two grids, so picking *Afgemeld* can correctly leave *Actief in realisatie* empty — a deregistered project was never workable to begin with.
  - **Two grids side by side** (`GridColumn`, `divide-x`), wide rather than tall so both fit without hiding either behind a scroll: *Actief in realisatie* on the left — a **dossieritem** and AFAS status **Realisatie** — *Overige projecten* on the right for everything else: no dossieritem, or any other status. `Realisatie` is the only project status this tool has ever needed to recognise by name (compared case-insensitively, since it's free text out of AFAS, not a code); nothing else is read for meaning. Each grid is a **fixed slot, not a section that comes and goes** — an empty one says so in place (*Geen projecten in deze groep.*) rather than collapsing and leaving the other to fill the width alone, and each scrolls independently so a long list on one side never fights the other's scroll position.
  - **Each grid carries its own column band** (`bg-surface`, the quiet one `AfasListPicker` uses) above its own scroll area, so the headings stay put while that grid's rows move — **four labels**: *Project*, *Connection*, *Type*, *Status*, a size down from the group heading over it so the two read as a heading and then its labels rather than as two headings. The categories used to have a column each with their name in the band, which spent four of the dialog's six headings on two words; the tags in the fixed columns now say their own name (see below). The three fixed columns **centre their heading**, `Project` alone stays left — each of those cells holds its content centred, and a heading pinned to the cell's left edge floated away from the thing it named; `Project` is the one column whose content genuinely starts at the left edge, a name that truncates. Each grid's list also **fades out at its bottom edge**: a scroll area whose last visible row is sliced through the middle reads as a layout that ran out of room rather than as one there is more of. Its height comes off the **viewport** (`max-h-[min(24rem,42vh)]`), not a fixed `rem` — with a header, a search row, two group headings and a footer around them, two fixed 24rem lists put the footer under the fold of a laptop screen. Band and rows share one grid template, and the right-hand columns are **fixed widths rather than `auto`** — each row is its own grid container, so an `auto` column would size to that row's content and the columns would stagger down the list. The template is an inline style, not a `grid-cols-[…]` class: the connection cell is sized from `AFAS_STAGES.length`, and Tailwind reads class names out of source text rather than building them.
  - Per row: the name over `501243 · 10 modules` — or, for an unlinked one, an `AlertTriangle` chip **Geen dossieritem** in place of the module count, in the **same red as Afgemeld** (`--color-status-bad`) — no dossieritem and a deregistered status are the same kind of fact about a row, a reason there is nothing to do in this project, and a warm second hue beside the red only asked the reader to rank two warnings. It was the family's amber (`#ab5106`) until that swap left the amber with no user at all. The project's AFAS status closes the row as a pill in AFAS's own words (*Realisatie*), with an `sr-only` "status in AFAS:" in front: **green for Realisatie, red for Afgemeld**, grey for everything else, drawn as the soft-tinted badge above — the ink at `/10`, `/30` and full strength ([`ProjectStatusPill`](../frontend/src/components/ProjectStatusPill.tsx) — one component, not a `statusToneClass` in each picker, because a project has to read the same in both). Those are the only two statuses this tool recognises by name; the module dot above can afford four hues because its eighteen codes are documented, but a hue on any other project status would be guesswork, which is what the grey is for. **Every badge in the row is that same soft chip** — stage tag, type tag, dossieritem flag and status alike — so nothing in it shouts and what tells them apart is size, shape and place rather than volume. An unlinked, deregistered project used to carry a solid orange chip in its second line *and* a solid red one at its end, which made the noisiest rows in the dialog the ones with the least to offer. The flag is also a size down from the status pill and sits inside the row's quiet metadata line, so the two read as a detail and a verdict. The **open project** is the row on `bg-primary/10` with an inset `ring-primary/25` and its name in orange — no trailing checkmark, which beside two literal stage tags would only ask what it means.
  - **No AFAS-koppeling chip in the row.** The metadata line carried a `PlugZap` **Geen AFAS-koppeling** / **AFAS-koppeling incompleet** chip until the *Connection* column arrived, and the two then said the same thing twice — the column per environment, the chip rolled into one word. The chip lost: it was the wider of the two, and on most rows it wrapped `501243 · 11 modules` onto a second line, so the least connected projects were also the tallest. The line is back to `501243 · 11 modules`, and the same fact still gets a band with a button on the project's own page (`AfasConnectionNotice` in [`AfasConnection.tsx`](../frontend/src/components/AfasConnection.tsx)) — which is where somebody can act on it, and which stays **admins only**: a client contact can't open `ProjectSettingsDialog` (nor the route behind it), so naming a problem they have no way to fix would only read as *this tool is broken*. The component gates itself on `useIsAdmin()` rather than leaving it to the caller, since the rule is about the message, not its location.
  - **Bij Nymbus, counted.** After the module count the metadata line adds `· ⧗ 3 bij Nymbus` (an `Hourglass` and the count, `text-sky-400`, the *Bij Nymbus* fill (`STATUS_TONE_FILL.nymbus`)) when that many of the project's deeltaken have a current task that is Nymbus's (`nymbusTaskCount`, the per-module `withNymbus` summed in `projects()` (the hosted version)). It is the sidebar's hourglass in the same sky, added up over the project, so an admin can see where Nymbus's own work is waiting before opening anything. It is plain text and not a chip, because it is a count in the metadata line rather than a verdict, and it doesn't show at 0, so it appears only on rows that have something waiting on Nymbus. The tooltip spells it out (*3 taken liggen bij Nymbus*).
  - **The Connection column — a tag per AFAS environment, LIVE then TEST** — carrying that environment's own name, tinted in the brand orange (`border-primary/30 bg-primary/10 text-primary`) when that stage's credentials are stored, an empty outline in `text-zinc-300` when they aren't (`StageTag`, off `project.afasStages`). Both states are always drawn, for **every** project including one with no dossieritem: *no* is worth as much here as *yes*, a gap would read as a column that failed to load, and a connection is not downstream of AFAS having scoped the project — an admin can fill in credentials before AFAS sets it up, and the two gaps are worth seeing apart. **Live first**: it is the environment the conversion lands in, so it is what an admin scanning the column is looking for; test is the precondition, live is the point.
    - **What the chip promises is *ingesteld*, not *werkt*.** It reports whether an omgevingsnummer and that stage's client id + secret are stored — never whether AFAS accepts them, which takes a real `get_metainfo` call per stage that the login path can't make twice for every project an admin carries. The tooltip says so in as many words, and *Verbinding testen* in `ProjectSettingsDialog` is what answers the other question, one stage at a time and on request. It is also the finer reading of the same store behind `AfasConnectionNotice` on the project page: that one says whether there is any AFAS behind the project at all, this one which halves. A live-only project is `complete` there and `LIVE`-lit-`TEST`-dark here, and both are true.
    - **This column used to be *Modules*** — an `HRM`/`ERP` tag pair off `moduleCategories`. That fact is met again in the sidebar the moment the project opens, and it never told an admin whether the project could be worked in *now*; whether its environments are set up does. The module **count** was never in this column and is untouched: it stays in the row's metadata line beside the project code. `moduleCategories` is still in the session payload, now read by nobody.
    - **A tag and not a tick box**, and not a solid orange pill either: a box next to a project's name reads as a checkbox someone could switch, and two filled orange pills in every row would spend the app's one accent colour on a fact that is true of most rows. The tint says *yes* quietly and leaves the solid orange to mean "this is the project you have open".
  - **The Type column — the conversion type** (`ConversionTypeTag`, off `project.conversionType`): **FACILITAIR**, **DOSSIER** or **NORMAAL**, in the same soft chip as the stage tags. All three are drawn, `"standard"` included — it used to sit inline in the metadata line and render nothing for the common case, which held while it was a chip floating beside the project code and stopped holding the moment the fact got a column: a heading over a cell empty in most rows reads as data that failed to load. So *Normaal* draws too, in the quiet grey outline rather than the brand tint, leaving the orange to the two types that mean the project converts a different way — a `"dossier"` project doesn't get the module list at all (see [dossier-migration.md](dossier-migration.md)).
    - Still **not an `<input type="checkbox">`**, for the reason it is no longer a box: there is nothing to toggle — it reports what AFAS holds — and a disabled checkbox inside a link reads as a control that is switched off rather than as a fact. `role="img"` with the category in the label, so a screen reader hears *HRM: ja* / *ERP: nee* rather than a bare "HRM" it would have to interpret.
    - **The tags share one grid column** rather than having one each, which is what lets the band drop to three labels. They still line up down the list — the cell is a fixed width (`MODULE_CATEGORIES.length * 3.25rem`) and the tags in it are `flex-1`, so tag *n* of every row starts at the same x. A project **without a dossieritem gets a single dash** instead: it has no categories to report — the field is empty for all of them by definition — and ghosting every tag of every unlinked project filled the right-hand grid with twenty boxes saying nothing the flag beside the name hadn't already said.
  - Each entry is a `GuardedLink` to that project's own page rather than a setter — the open project is the URL (`useProject()` reads it back) — and it lands on the project page, not on the same module under the new project: whether that project even has the module takes a fetch to know. `onClick` closes the dialog rather than `onNavigate`, so it also gets out of the way when the guard stops the navigation and puts the leave prompt on screen.
  - **Without `onClose` it is undismissable** — no close button, no *Sluiten*, Escape ignored. That is how `/` opens it for an admin (see [architecture.md](architecture.md#routing)): there is nothing behind that page to dismiss to, so picking a project is the way on, and a quiet brand mark sits under the dimmed backdrop rather than a blank screen. The same dialog **with** `onClose` is what an admin who signed in on a project URL gets over the shell: the open project shows its tint and ring in the list, and *Sluiten* means "stay in this one".

**[`UsersRow`](../frontend/src/components/UsersRow.tsx)** — admin-only quiet row in the sidebar footer (`Users` icon, *Gebruikers*), between *Projectinstellingen* and *Updateconnectors*, styled exactly like them. One row for both questions about people, opening [`UsersDialog`](../frontend/src/components/UsersDialog.tsx): the app's **segmented switch** (as in `ProjectSettingsDialog`) under each tab's header, *Bekijk als gebruiker* (the default, `UserPickerModal`) | *Nymbus-gebruikers* (`NymbusLoginsDialog`). **The switch is for developers only** (`useIsDeveloper`): an admin gets the first tab alone, with no switch over it. Each tab is its own dialog swapped whole, taking the switch as a `switcher` prop — both are the same picker card, **one fixed height** (`FIXED_PICKER_CARD` in `Modal.tsx`: `max-w-3xl`, `h-[min(46rem,calc(100dvh-2rem))]`, the list filling what is left and scrolling itself), so neither a search that narrows the list nor the swap to the other tab moves the dialog; each tab fetches its list fresh when opened. On the icon rail it is the `Users` icon alone and still opens the dialog.

**[`UserPickerModal`](../frontend/src/components/UserPickerModal.tsx)** — the same dialog as `ProjectPickerModal` over a different list, and deliberately so: the sidebar's two *"take me somewhere else"* controls should read as one control, not two designs. Same centred `Modal` (`max-w-3xl`), same header + `ModalSearch` + column band + scrolling list + count-and-**Sluiten** footer. Header *Bekijk als gebruiker* over the one line that matters before the click — *Je ziet de app daarna precies zoals deze gebruiker die ziet — dezelfde projecten, dezelfde modules. De balk bovenaan brengt je terug.* Search matches **name, e-mail and project name**: an admin looking into a conversion knows the project long before they know who is on it.
  - **Columns**: avatar, *Gebruiker* (name over e-mail), *Projecten*, *Status in AFAS*. Band and rows share one grid, fractions rather than `auto`, for the reason spelled out above. The avatar is **round** — in this app a circle is a person (sidebar user block, impersonation banner) and a rounded square is a project (`ProjectSelector`'s tile); the project picker's rows carry no avatar at all, the project code under the name being the identifier anyone actually reads.
  - **Projects as chips** (`ProjectChips`) — the first three by name, the rest as a single `+N`, the whole list in the cell's `title`. Names rather than a count, because the name is what an admin recognises; capped because a teamlid on eight projects would stretch the row over three lines. No projects at all shows a grey *Geen projecten*: AFAS has that person on a project whose name it didn't hand over, and a session with no project is one the backend refuses — so the empty cell is a hint about the switch that may fail. Beside them, one **status pill per chip** in the same order (`StatusChips`) — the project picker's own [`ProjectStatusPill`](../frontend/src/components/ProjectStatusPill.tsx), not a second copy of its tones, so a project reads the same in whichever of the two dialogs an admin meets it. A project AFAS gave no status word for still gets a pill, the grey one carrying a dash, since a blank would read as a column that failed to load.
  - **Two states the project picker never needs.** The list is a **fetch**, not the session (`/api/auth/users`, admin-only), so the dialog opens on a spinner + *Gebruikers laden…* and a failure gets its own **Opnieuw proberen** (`RotateCw`) in the list area — closing and reopening is no longer the only retry. Beside the search field sits the project picker's icon-only refresh button (`RotateCw`, `Loader2` while out, red border when it failed), calling `/api/auth/users?reload=1` past the backend's connector cache; unlike the retry it keeps the current list on screen throughout. And picking is an **action, not a link**: the row is a button, not a `GuardedLink`. Its switch shows in place — orange tint, `Loader2` in the avatar, *Bezig met wisselen…* under the name — while every other row greys out; a failed switch lands in the red `AlertCircle` strip under the search field, where it stays in sight as the list scrolls. Dismissal stays live throughout: closing doesn't cancel the switch (the session lands and the app goes home either way) and a dialog that can't be closed on a hung request is worse than one that gets out of the way.
  - **No row is ever the current one**, so there is no selected state: impersonation hands over that user's own (non-admin) session, which takes the whole admin sidebar — this dialog included — away with it. `ImpersonationBanner` is the way back.

**[`NymbusLoginsDialog`](../frontend/src/components/NymbusLoginsDialog.tsx)** — the *Nymbus-gebruikers* tab of `UsersDialog`: a `Modal` (`max-w-3xl`) built from the picker parts (`PickerHeader`, `ModalSearch`, the `bg-surface` column band, `PickerFooter`) over the Nymbus logins (`GET/PUT/DELETE /api/nymbus-logins`). Above the search sits a bordered **add form** — e-mail, naam, rol and a primary *Toevoegen* — that refuses an address already listed rather than overwriting it. **Every row is edited in place**: the name is a borderless input that shows its border on hover and §7's ring on focus, the role a §7 select; once either differs from what is stored a round primary `Check` appears beside the row's `Trash2`, saving that row alone — each row is its own record, so one *Opslaan* for the list would be the trap §26's one-form rule warns about in reverse. Delete asks inline (the row tints `bg-red-50`, *Wissen* / *Nee*) instead of a second modal over the first. The developer's own row is marked *(jij)* and has its role select and delete disabled — the backend refuses both too, which is what keeps the list from ever losing its last developer. Errors from a row land in the red strip under the search, where they stay in sight.

**[`ProjectSettings`](../frontend/src/components/ProjectSettings.tsx)** — admin-only sidebar-footer row (`Settings` icon, *Projectinstellingen*), directly above *Bekijk als gebruiker*, styled the same. It configures the **active** project — the project selector above it is how you get to another one — and opens [`ProjectSettingsDialog`](../frontend/src/components/ProjectSettingsDialog.tsx), a centred `Modal` (`max-w-lg`) rather than a panel, so it works on the icon rail too without expanding the sidebar. The dialog is mounted only while open, so it loads the stored settings every time. Top to bottom: a header naming the project (`{name} · project {id}`) with the `ModalCloseButton` in its corner, a **three-tab segmented switch** (the connector page's own, full width), the tab's body, and a footer carrying **one** button: *Opslaan*. Closing is the `X`, per §11. Long forms scroll inside the body (`max-h-[65vh]`), never the page. **One form, one Opslaan for the first two tabs** — *AFAS-omgeving* and *Koppelingen* are the same stored object, and a dialog where one half saves and the other doesn't is a trap; every edit in either clears the *Opgeslagen* confirmation. **Conversie is the exception, and shows why the rule is about the store rather than the dialog**: its periodetabel and livegangdatum are not ours — they live on the project's hoofdproces dossieritem in AFAS, and saving them is an AFAS write. One button spanning two systems could only ever half-succeed, so on that tab the footer's button becomes *Opslaan in AFAS* (primary, `Save` icon, disabled until something changes) — the same button in the same corner, differing only in where the write lands, which is the tab's business and not something the footer should look like it is choosing between. The tab publishes its save upward for the footer to draw (`ConversionTabState`) and reports *Opgeslagen in AFAS* in its own body; the form's `onSubmit` returns early while it is open, so Enter in a field can't save the credentials instead of what the button says. Each of its two fields states underneath what the tool will do with the value — *De tool vult 'Herhalen na' met 13* — recomputed as it is typed, so the consequence is visible before the save rather than in a payload afterwards.
  - **AFAS-omgeving** — the **Omgevingsnummer** (`w-40`, digits only) with no heading over it, then the two environments divided by `border-zinc-100`, **Testomgeving** and **Live-omgeving** (each a Client id + a Client secret).
  - **Afwijkende koppelingen** — which of *this project's* modules are mapped differently from every other project's, with a count badge on the tab once there is one. One checkbox row per module under its HRM / ERP heading, in the sidebar's own order and from the same `ModuleProvider` fetch (so the dialog adds no call), a ticked row on `bg-primary/5` with an **Afwijkend** pill. Above them, in plain words, what ticking one means: the mapping is normally made once on the schema of the template environment every customer environment copies, and a ticked module has its schema read from *this* project's AFAS instead, with a copy of the mapping of its own. The copy names no environment on purpose — which one is the template is a backend decision that has already changed once ([afas-integration.md](afas-integration.md)), and an admin ticking a box doesn't need to track it. A flag for a module the project no longer has is listed apart under *Niet (meer) in dit project* rather than hidden: something you can't see is something you can't switch off.
  - **The two environment headings are badges**, not the quiet `text-[10px] text-zinc-400` a section label usually gets: a `rounded-badge` pill in `text-xs font-bold uppercase tracking-wide`, tinted-and-outlined like every other badge, **green for test** (`border-emerald-200 bg-emerald-50 text-emerald-700`) and **blue for live** (`border-sky-200 bg-sky-50 text-sky-700`). They are the only thing telling an admin which of two *identical* credential pairs they are typing into, and mistaking one for the other means a live environment configured as a test one — a form where nothing else differs should carry that difference as loudly as it can. The app's own emerald and sky rather than a third blue beside `navy` and the module status dot's. The colour is a second signal only: each badge says *Testomgeving* / *Live-omgeving* in words.
  - **Verbinding testen**, per environment — a quiet outlined button (`PlugZap`) beside the heading that asks AFAS itself whether these credentials work: the backend calls `metainfo`, which needs no connector and touches no data (see [architecture.md](architecture.md#api-surface)). It tests **what the form shows**, not only what is stored, so a client id can be checked before it is saved; the secret is the exception — an untouched field tests with the stored one, since the browser never has it. Left of the button a **checkbox-shaped mark** carries the state: empty until it is tried, `Loader2` while it runs, a white `Check` on emerald when AFAS answered, a white `X` on red when it refused. It is a status, not a control (`role="img"` + `aria-label`), and it never says it alone — the outcome lands in the section's own familiar strip underneath, green with the host that answered and what it exposes (*Verbinding met 12345.rest.afas.online gelukt — 7 GetConnectors, 3 UpdateConnectors beschikbaar.*) or red with AFAS's own reason (*AFAS heeft het token … geweigerd (401)…*). A result is about the values it was run with, so editing a field clears its environment's mark again — and editing the omgevingsnummer clears both, since both are reached through it.
  - **A stored secret is never shown**, because it never leaves the backend (see [architecture.md](architecture.md#api-surface)). Its field is empty on open with the placeholder *Laat leeg om te bewaren*, an `Eye`/`EyeOff` toggle for what you type, and a hint line carrying the state: *Er is een secret opgeslagen…* / *Wordt bij opslaan vervangen.* / *Wordt bij opslaan gewist.* (red) / *Er is nog geen secret opgeslagen.* A **Wissen** link next to the label is the only way to remove one — leaving the field empty deliberately keeps what's there, so saving an omgevingsnummer can't wipe the credentials.
  - Failures and the confirmation use the familiar strips: red `bg-red-50` + `AlertCircle`, green `bg-emerald-50` + `CheckCircle2` (*Instellingen opgeslagen.*). Saving keeps the dialog open — there is no toast — and the confirmation clears again on the next edit.
  - A grey footnote closes the form: the values are for this project only and are stored **encrypted** on the server. Say it here rather than nowhere — an admin typing a live client secret into a browser deserves to read what happens to it.

**[`ImpersonationBanner`](../frontend/src/components/ImpersonationBanner.tsx)** — while an admin views the app as someone else: a full-width `bg-navy` strip **above the sidebar and content both**, with an `Eye` icon, *Je bekijkt de app als …* (their name + e-mail, and which admin is signed in), and a **Terug naar mijn account** button on the right (`Undo2`, `border-white/25`). Navy on purpose — it must read as system chrome and not compete with the orange accent, and it must be impossible to overlook, since everything below it is another user's view.

New top-level screens render inside this shell — add a page under `app/[project]/`, not another sidebar. Link to them with [`GuardedLink`](../frontend/src/components/NavigationGuard.tsx) and build the href with [`lib/routes.ts`](../frontend/src/lib/routes.ts); a bare `<Link>` or a hand-written path walks past the leave prompt.

## 25. Core UI elements

- **Hero** — [`Hero`](../frontend/src/components/Hero.tsx): the bold heading with the orange highlight band ("Van Excel naar `AFAS` zonder gedoe") plus whatever copy belongs beside it. Both top-level screens open with it and they have nothing else in common any more, so it is its own component: the heading is the same on both and only `intro` differs — the project's word about the conversion, a module's word about itself (`ModuleIntroCopy`). **Both put it in the same place**: the top of the page, above everything the page does — on the project page over the projectrapport, on a module page over the **module start card** and its dropzone.
  - **Side by side, not stacked.** It was a centred `max-w-2xl` column at `text-5xl` with the copy underneath, and that cost the better part of a screen: on the project page it pushed the report under the fold, on a module page the dropzone. So the copy moved into the second column of a `max-w-3xl` `lg:grid-cols-2` and the heading dropped a size. The width lives in the component because it is about the *heading* — the line break is hand-placed, and `max-w-3xl` halves into columns too narrow for "Van Excel naar AFAS", hence the break after *naar*. It stayed `max-w-3xl` when the projectrapport under it went wider: two paragraphs and a seven-column table want different widths, and a shared edge is worth less to the hero than a module name is to the table. Two columns from `lg` and not `sm`: the sidebar takes `w-68` out of the viewport first, and half of a tablet's remainder doesn't hold "AFAS zonder gedoe" at `text-4xl`; under `lg` the cells stack, heading first, left-aligned. `intro` starts level with the heading and so brings no top margin.
  - **On a module page it goes when a sheet arrives** (`!workbook` in `ExcelUploader`), and the **sheet toolbar** arrives in its place. From then on the page *is* the table, the bar belongs to it, and the heading would only be holding the grid down. Before a sheet it is the reverse: hero and start card, no bar — see **Upload landing**.
  - **The project page** (`/{project}`, [`ProjectLanding`](../frontend/src/components/ProjectLanding.tsx)) — hero, a paragraph pointing at the sidebar (*Kies links een conversieonderdeel om daar een Excel-bestand te uploaden…*), then the **projectrapport**. That is the whole page. **It takes no file**: it used to, with a dropzone of its own that recognised the file and sent it on to the module it turned out to be for, and that was one way in too many — a page with a dropzone but no module has to guess where the file belongs, and guessing wrong put a modal in front of a question the sidebar answers in one click. So every upload now starts on the page of the module it is for, where the rules, the help and the template already are. No `useFileIntake`, no dropzone, no hidden file input.
    - **The AFAS-koppeling band** (`AfasConnectionNotice`) opens the page for an admin whose project has no working AFAS credentials — above the projectrapport, because it outranks it: without an omgevingsnummer and an OAuth pair nothing in the project can reach AFAS at all, so how far its modules got is the second question. It is the app's **amber notice** (§9) grown a heading and an action: `PlugZap`, a bold line naming the state, a sentence saying what is missing, and a **Projectinstellingen** button that opens `ProjectSettingsDialog` on the spot — the answer in the same place as the problem, rather than a warning that sends the reader to hunt for the sidebar row. The button is **white on the amber**, not the app's orange fill: the band is already the loud thing on the page, and a filled accent button inside a tinted band reads as a second alarm rather than the way out of the first. Closing the dialog **re-reads the session** (`fetchMe`), since `afasConnection` rides along with the project list and nothing else would tell the band the gap has just been filled — without it an admin would save their credentials, watch the connection test go green, and still be told the project has no koppeling until they reloaded. Renders nothing once the project is connected, and nothing for a non-admin, so a normal project pays no height for it.

      One state of it is **red, not amber**, and deliberately so: when `afasConnection` is `"unavailable"` the settings store itself could not be read, so the tool does not know whether the project is connected. Amber across this app means *read this before you go on* — a gap the person on this screen closes — and this is the opposite: there is nothing to fill in, the credentials are probably fine, and the fix is elsewhere. So the band swaps `PlugZap` for `DatabaseZap`, the amber tokens for `border-red-200 bg-red-50 text-red-700`, and the **Projectinstellingen** button for **Opnieuw proberen** with a `RotateCw`, which **actually retries**: it calls `reloadMe()` (`/api/auth/me?reload=1`, the deep read that re-queries the settings database) and writes the session back, showing a spinner and *Bezig…* while it is out. It does not open the settings dialog — a button labelled *Opnieuw proberen* that opened a form would promise one thing and do another, and that form could only re-run the same failed read and show it back as an error. There is no success state: when the read lands, `afasConnection` stops being `"unavailable"` and the notice unmounts itself, so a confirmation would be drawn by a component that no longer exists; a failure simply leaves the band up, which is already the message. The same split runs through `AfasStageNotice` (one line, same two tints) and the picker's Connection column, where an unknown stage is a dashed `—` rather than the grey `LIVE`/`TEST` husk that means *not set up*.

      The picker also says it **once, above the list** (`ProjectPickerModal`): a red strip between the search row and the two grids, `DatabaseZap` plus one sentence, shown when any project reads `"unavailable"`. The column alone was not enough — with the store down every row shows the dash at the same time, which reads as a column that failed to load or as two dozen projects nobody ever configured, and the only correction was a tooltip per row. The cause is one fact about one database, so it is stated once where the reader is already looking. It carries no button: the dialog's refresh control is an arm's length away and already re-reads exactly this. All of these bodies are deliberately **two lines at most** — a notice nobody finishes reading is a notice that failed, and the sentence that stops the wrong action (*er is waarschijnlijk niets mis met dit project*) has to survive the skim.
- **Upload landing** — [`uploader/UploadLanding`](../frontend/src/components/uploader/UploadLanding.tsx), what a **module** page shows below the hero before a sheet is on screen. Three blocks, and that is the whole page: **what this module is** (the start card), **anything that just happened** (the notice), and **the dropzone**, which takes every pixel the card leaves (`flex-1`, floor `min-h-72`). A `min-h-full` column inside an `overflow-y-auto` container, so a short viewport scrolls instead of clipping it. `max-w-3xl` — the hero's width, so every block on this screen shares its edges. (The projectrapport, on the *project* page, is the one block that doesn't: it is a table and went wider.)
  - **The sheet toolbar is not part of it.** It used to stand between the hero and the card with four of its six buttons greyed out, and that was a row of things you can't do over a page whose only move is *upload a file*; it now comes with the sheet it describes (see **Sheet toolbar**). What it carried before a file moved into the card below, except the dropzone's own job, and the height it took went to the dropzone.
  - **A module page** (`/{project}/{module}`) — [`ModuleStartCard`](../frontend/src/components/uploader/ModuleStartCard.tsx): one white card with everything about the module that isn't the upload. Left, the module **name** over its **status in AFAS** — the sidebar's own status dot (`STATUS_TONE_FILL`, `moduleStatusTone()`) with the status and its task spelled out beside it (*Klant — Template vullen*), which is the client's answer to "why am I on this page"; absent while the module fetch has no status for it, and never carried by the colour alone. Right, the two things you do before filling a sheet in, as a pair of buttons: a quiet outlined **"Hoe vul ik dit in?"** that opens the **module help drawer** (short, because the module's name is beside it; the full question is its `aria-label`) and the orange **"Sjabloon downloaden"** that downloads the module's `templateUrl` (an `<a download>`, served from `frontend/public/templates/`; hidden when the module has no template). It saves as `<projectnummer>_<sjabloonnaam>.xlsx` — see **Naming a file the tool didn't write** below. Under a `border-zinc-100` hairline, the module's **last recorded check** — one sideways [`Metric`](../frontend/src/components/uploader/Metric.tsx), the same figure and wording the sidebar badge carries (`progressMetricText()`, past tense: *van de rijen kon zo naar AFAS*, with the moment and the file beneath). A module nobody has checked yet gets **no figure at all** rather than a `0%`, the same rule as that badge. The help **drawer is the page's**, not the card's: the toolbar opens the same one, and two components each mounting their own for one module is two drawers that can drift apart.
  - The module's **description** (custom text per module in `MODULE_INTRO`, otherwise a generic fallback) is not on this card: it is the copy the hero carries at the top of the page, exported from the same file as `ModuleIntroCopy`, and printing it in both places a screenful apart read as the tool saying it twice.
  - **Nothing under the dropzone.** A line there used to name the startrij (*Gegevens worden gelezen vanaf rij 3 · Aanpassen*) and open the setting for it. The setting is gone — `parseExcelFile()` finds where the data starts itself (see [file-types.md](file-types.md#where-the-data-starts)) — and the line went with it.
  - **The notice sits above the dropzone**, not under it. It was underneath while the zone was a fixed strip; with the zone filling the page, a failed read would answer below the fold, which is the same as not answering.
- **Module files panel** — [`uploader/ModuleFilesPanel`](../frontend/src/components/uploader/ModuleFilesPanel.tsx): a `w-80` column to the **left** of everything else `ExcelUploader` renders — the hero, the landing card and the table alike — and, with a sheet open, the card that carries the **sheet toolbar on top** (its `header` prop) and the files under it. Merged like that, its collapse folds only the list up under its heading (the bar sets the width, so there is no rail), focus mode hides the files but keeps the bar (it holds the way out of focus mode), and it drops `overflow-hidden` so the bar's tooltips can leave the card. From `lg` it is **a second sidebar rather than a card** — with a sheet open and on the landing alike, at `w-80` in both so opening a file doesn't shift the page: square, no shadow, only a `border-r`, and bled out of the page's padding (`-mt-4 -mb-6 -ml-4`, `-ml-2` in focus mode, none while focus mode has closed it; set by `ExcelUploader`) so it runs from top to bottom against the app sidebar. The collapsed `w-12` rail is flush the same way. It sits inside the same `flex gap-6` row, so it stands beside the module's page rather than inside either of its two states. What's already at Nymbus is a question about the *module*, not about whether a sheet happens to be open on screen right now, so it doesn't come and go with the dropzone the way the toolbar does.
  - **Two zones when a sheet is open.** The bar on top stays white, the files under it sit on `bg-surface`, set off by a `border-zinc-200` line. The tinted zone runs to the bottom of the column like the app sidebar, with its heading and tiles inside it and no hairline between them. The bar is where you act; the tinted zone holds what is already at Nymbus. A hairline alone wasn't enough: the bar already has two of its own, so a third read as one more section of the toolbar. Without a sheet there is no action zone, so the panel stays white.
  - One white `rounded-card`, a `Paperclip` + *Aangeleverde bestanden* header over a hairline (on the tint, without the hairline, when a sheet is open), then a tile per file already posted to the module's deeltaak-dossieritem in AFAS (`GET /api/projects/{id}/modules/{moduleId}/files`, reading `Nymbus_Bestanden_bij_reactie` — see [architecture.md](architecture.md#api-surface)), newest `Instuurdatum` first, sorted by AFAS itself rather than in the browser. Each tile is the **entity tile** of §14 turned sideways — icon chip, name, two lines of metadata instead of one — with the sender's e-mail over the moment (`formatDateTime()`), and the filename truncated with the full name in `title`.
  - **The icon chip's colour names the file type**, not a status: `emerald-500` (the sidebar's own *afgerond* tone) for a spreadsheet (`xlsx`/`xls`/`csv`, `FileSpreadsheet`), the entity tile's default `bg-primary` for a PDF (`FileText`) and for anything else (`File`) — the two file types this connector actually carries told apart at a glance, without reaching into the app's red/amber vocabulary for a fact that isn't a verdict.
  - **Four weeks back, unless asked.** The list holds what came in over the last four weeks — or, for a module with nothing that recent, its newest reply, so a module with files never reads as empty — and ends in a text link (the module help drawer's), *Oudere bestanden laden (n)* (`ChevronDown`, `text-xs font-medium text-primary`, the count being the files left out), only when something *was* left out. It fetches the module's whole history once, with a spinner in place of the chevron and *Oudere bestanden laden…* meanwhile; the same link then reads *Oudere bestanden verbergen* and folds it away without a refetch. A failed fetch leaves a red line under the link and the recent list in place.
  - **Loading, empty and failed are the three sentences §18 asks for** — *Laden…* / *Nog geen bestanden aangeleverd.* / *Kon niet worden geladen.* — in place of the list, never a collapsed panel: the column's width is reserved whether or not it has anything to show.
  - **Refetches on a module switch** (the caller keys `ExcelUploader` on the module id, so the panel mounts fresh) and once more right after **Aanleveren bij Nymbus** succeeds, via a `refreshToken` bumped in `performSend()` — that action posts exactly the attachment this panel exists to show, and a remount doesn't cover sending twice against the same module.
  - **A tile opens on click.** A spreadsheet is fetched and handed to the uploader's own intake (`onOpenSheet`) exactly like a dropped file, guard included; anything else — a PDF validatierapport today — opens in a new tab. Either way the bytes come from an authenticated fetch (a bearer token, not a cookie, so a plain `<a target="_blank">` can't carry it): the tab is opened blank and *synchronously*, before the fetch, and only pointed at the result once it lands, or most browsers read the later navigation as an unrelated popup and block it. A tile mid-fetch shows a spinner in its icon chip in place of the icon and disables itself; a failed fetch leaves a red line under that tile rather than disabling it for good.
- **Projectrapport** — [`ProjectReport`](../frontend/src/components/ProjectReport.tsx): the whole conversion on one screen, and the body of the project's own page (`/{project}`) under the hero. One white `rounded-card` at `max-w-6xl` — **wider than the hero above it**, which is the one place on either top-level screen where two blocks don't share their edges. It used to match at `max-w-3xl`, and at that width the module column truncated *Uitzendkrachten* to *Uitzendkrach…* while the status beside it sat in whitespace: the hero is two paragraphs, the report is a seven-column table, and a shared edge is worth less than a readable module name. It went from `5xl` to `6xl` for the same reason: at `5xl` the table's last column, *Laatste controle*, sat behind a sideways scroll. Purely presentational; the shape and every figure come from `buildProjectReport()` in [`lib/project-report.ts`](../frontend/src/lib/project-report.ts), which **sums what `sheetMetrics()` already counted** and counts nothing itself.
  - **Not admin-only**, unlike the validatierapport. It carries no more than the sidebar's dots and badges already do, gathered into one place, and "how far is my conversie" is the client's own question. The drawer stays ours because it is about a sheet the client has their own copy of (as a PDF).
  - **Header** — *Projectrapport* left; right the **Lijst / Bord** switch, the **PDF** button and — only when the last send of some module left rows out — a **Geweigerd** button (`AlertCircle` in `text-status-bad`, a `ChevronDown` that turns, `aria-expanded`) that folds *Geweigerd door AFAS* open straight under the header, in either view, capped at `max-h-64` and scrolling on its own. It used to sit under the table, where it took height from the modules for detail only whoever fixes the sheet needs. The project's name is deliberately not on it: the sidebar names it two centimetres to the left, and the width that would have gone to repeating it goes to the one control the card has. (The name belongs on the **PDF**, which is read away from all of this.)
  - **Three metrics**, a `grid-cols-3` `divide-x` card like the one the validatierapport opens with, one level up and one size down (`text-3xl`, not `text-4xl` — it is the top of a page, not the whole of a drawer), all three read off AFAS's workflow. First: the **share of modules that have started** (*van de modules is opgestart*, `5 van 12 modules` beneath) — the deeltaak has left its first task, *Template vullen*, so the client has uploaded and handed in a sheet at least once (`started` per module, `START_TASK` in the hosted version's backend; *Afgerond* counts as started too, via `moduleStarted()`). It leads because it moves first: weeks can pass before anything is *Afgerond*. Second: the **share of modules AFAS calls *Afgerond*** (*van de modules is afgerond*). Third: the **modules nearing their deadline** (*modules naderen hun deadline*) — not *Afgerond*, with an opleverdatum at most seven days away (`DEADLINE_WINDOW_DAYS`); the ones already past it are counted in, and the detail says how many (*waarvan 2 over de opleverdatum*), since a figure that drops the day a date is missed hides the worst case. A `—` (*geen opleverdatum in AFAS*) when no open module carries a date — a zero would read as "nothing is due". How clean each sheet is stays on its row (**Fouten**, **Rijen OK**); the card no longer sums it. The managementrapport's summary card carries the same three, summed over the selection (*opgestart*, *afgerond*, *naderen deadline* with *bij 3 projecten · 1 te laat*), beside its status counts.
  - **Fase meter** (22-10-2026; it was a status meter) — the same thin (`h-2.5`) stacked meter with 2px surface gaps as the drawer's, breaking the modules down over the conversion's **phases** in `CONVERSION_PHASE_SEGMENTS` order (*Validatie*, *Test*, *Live*, *Afgerond* — the order a module goes through them, so the meter and legend read left to right like each row's stepper, and the green grows towards the right as a project progresses), read off each module's `stage` (`conversionPhase()` in [`lib/modules.tsx`](../frontend/src/lib/modules.tsx)). It used to count the four status tones, and beside *0% afgerond* a bar of whose-turn colours over a project full of 100% sheets read as "nearly through" while nothing was live; whose turn it is stays on each row (*Status in AFAS*), in the board's lanes and in the managementrapport's status counts. `PHASE_FILL` (chosen with Nymbus, 23-10-2026): `zinc-300` for *Validatie*, where nothing has been imported yet; `green-700` for *Test*; `slate-900` for *Live*; `violet-500` for *Afgerond*. A legend headed *Fase* names every segment with its count in **both** views, including the empty ones, and beside it, after a hairline, **Aan zet** counts the open modules *bij Nymbus* and *bij de klant* (`PhaseTurnLegend`, shared with the managementrapport's client cards; `turnSegments` in the report). No *niet akkoord* there: a rejected module is still with one of the two and is counted under whoever has to act, its red cross on the row saying the rest. An `aria-label` says the meter in one sentence — the meter is never read by colour alone. The managementrapport's summary card, client cards and overview column use the same meter (`PhaseMeter`); its three status counts wear their tone's dot beside the caption, which is the legend the status dots elsewhere on that page lost.
  - **Lijst — one row per module**, in the sidebar's own order and grouped by HRM/ERP under the same quiet uppercase labels. It is **the managementrapport's project-card table**, one shared component — [`ModuleReportTable`](../frontend/src/components/ModuleReportTable.tsx) — so a module reads the same on the client's page as on the manager's. Seven columns: the completeness dot + **module** (a `GuardedLink` into it), **Fase**, **status in AFAS** with its status-tone dot (the same colour as the board's lanes), **Fouten**, **Rijen OK**, **Opleverdatum** and **Laatste controle**; the row's `title` is the shared `rowTooltip()`. **Fase** is a three-step stepper — *Validatie*, *Test*, *Live* (`conversionSteps()`) — each step named, its mark a `h-3.5` circle: emerald with a check when done, with a white dot (bold label) when open, in the colour of **whose turn it is** — the status dot's sky for Nymbus, its orange for the client (`rowTurn()`, off `withNymbus`), red with a cross when turned down (the status's *niet akkoord*, the same tone the status dot is in), **ringed** in the colour of whose turn it is — a rejection is a verdict, not a party, and without the ring a rejected row said nothing about who has to act, an empty `zinc-300` ring when still ahead; the cell's title and an `sr-only` tail say it in a sentence (`stageText()`). **Rijen OK** never prints a bare figure: a muted word after it says what it measures — *gevalideerd* for a check, *in Test* / *in Live* for a send (`progressFigureLabel()`), which replaced the cloud icon here. The two together are the point: *100%* used to read as "finished" for a sheet that was only clean, and a module is through only once its Live step is. The board's cards carry the open step as one uppercase word at the end of their check line (`phaseTag()`); the PDF table carries it compact — three marks and the step's name, since the named steps take 84pt of a page with ~90 to spare. A real `<table>` rather than the flex rows it used to be: seven columns of figures only line up reliably in one. It **takes the width it is given** — no fixed minimum, so the name, the status and the error badge wrap before anything scrolls sideways — and it never drops columns: the old version hid four of them by breakpoint, which made the client's page and the manager's disagree about what a module looked like. On the projectrapport it **scrolls downward too**: the table takes the height the hero and the metrics leave — `ProjectLanding`, the report card and its module area are a `min-h-0` flex column down to an `overflow-y-auto overscroll-contain` box (§5), so the page itself never scrolls; the card's `min-h-80` floor is where a too-short screen hands the scroll back to the page — with the header row pinned (`stickyHeader` — `sticky top-0 z-20 bg-white` on each `th`, since a sticky cell doesn't carry a ground of its own) and the §15 fade along its bottom edge, so the hero, the metrics and the meter stay in view however many modules a project has. The board view scrolls in the same slot. The managementrapport's project cards leave it unpinned and full height. All header labels share one type (`text-[11px] font-semibold uppercase tracking-wide text-body`), so no label reads as outranking another.
  - **Below `lg` the rows are cards** (`ModuleReportCards`, in the same file, so the managementrapport gets them too): seven columns don't fit a phone, and on a phone the question is *where does my module stand*, which seven columns scrolled sideways answer worse than one card. Each card is the whole link — a `rounded-btn` white tile, `border-zinc-200`: the dot, the name and the **Rijen OK** figure on top, the **Fase** stepper under it, then status and **Fouten** side by side, and the two dates as a quiet `text-[11px]` last line, each date unbreakable so the line wraps at the dot. One column on a phone, two from `sm`. Both are rendered and CSS shows one (`lg:hidden` / `hidden lg:table`), so nothing is measured and nothing flashes on load.
  - **Opleverdatum** — when the module is due, `dd-mm-yyyy` ([`formatIsoDate()`](../frontend/src/lib/datetime.ts), which reads the ISO date off AFAS's string rather than through `new Date()`: a bare `yyyy-mm-dd` parses as UTC midnight and an opleverdatum a day out is worse than none). It is the **first** column to go as the viewport narrows, at `lg` — not a judgement about the date but arithmetic: the five columns beside a `w-68` rail already leave the module and the status about 18px each at `md`, so a sixth fits nowhere below `lg`, and a row overflowing its card is worse than one column fewer. The row's **tooltip** names it underneath that (*Klant — Template vullen · opleverdatum 09-08-2026 · …*), the way it names the check. AFAS has no field for it yet, so today every row shows a dash and the footnote says why — see [architecture.md](architecture.md#api-surface) and [todo.md](todo.md).
  - **Two units and two silences, all worded apart.** The **Fouten** cell prints whichever count of that check survives: the **fields** that were wrong while this session still holds them (*7 fouten*, the validatierapport's own figure), and after a reload AFAS's stored `Fouten`, which counts **rows** — then the badge says so in words, *10 rijen met fouten*, with a hover explaining where it came from. The two are never dressed alike: a row with three bad cells is one row and three fields, and a reader who can't tell which is on screen can't act on either. Both go through `storedErrorCount()` / `storedErrorText()` in [project-progress.ts](../frontend/src/lib/project-progress.ts), so the list, the board and the PDF can't drift. The badge is `whitespace-nowrap` and the column `w-36`: a verdict split over two lines grows the row and collides with its neighbours (*10 rijen met fouten* measures 121px, which the old `w-28` overlapped the **Rijen OK** column by). Then the silences: a module nobody has checked reads *Niet gecontroleerd* and shows a `—` for the rest, and a check recorded before AFAS kept any count at all reads *Niet geteld* (with the reason on hover) and still shows its percentage. A `0 fouten` for either would claim a clean sheet for a sheet that was never read — the same rule as the sidebar badge, which a module with no check simply doesn't get. A module that *was* checked and is clean gets the green **Geen fouten** pill.
  - The header **Rijen OK**, not *Rijen*: a percentage under a noun-shaped header, sitting next to a count of errors, gets read as a count of rows. There is no footnote under the table: the header cells' own `title`s (*Fase*, *Rijen OK*, *Opleverdatum*) say what each measures on hover.
  - **Two views of the same modules — `Lijst` / `Bord`** — a two-option segmented switch at the card's top right (`ViewToggle` in [`ProjectReport`](../frontend/src/components/ProjectReport.tsx)): the same outlined track with a filled-primary active option the AFAS explorer switches its three views with, so a view switch looks the same wherever the app offers one. Both options keep their **word beside the icon** (`List`, `Columns3`) — this card is the client's page as much as ours, and a pair of bare icons asks them to work out which of two pictures they are looking at. It is **not** shown on a project with no modules: the empty-state line reads the same in either view. The choice is component state, not the URL — the URL says *where you are* ([architecture.md](architecture.md#routing)), and how you happen to be looking at it is worth nothing to whoever the link is sent to. **Everything above the module list is shared**: the two metrics and the meter are about the project, not about how its modules are arranged.
  - **Bord** — [`ProjectReportBoard`](../frontend/src/components/ProjectReportBoard.tsx): the same modules laid out by **where they stand** instead of by category — one lane per status tone, one card per module, the lane's count in its head. The table answers *how is this module doing*, column by column; the board answers *who has to act next, and on how many* without the reader tallying twelve status words. A re-grouping and nothing more: `buildProjectBoard()` in [`lib/project-report.ts`](../frontend/src/lib/project-report.ts) takes the same `ProjectReport` the table renders, so the two views cannot disagree about a module, and the row tooltip is one shared `rowTooltip()` for the same reason.
    - **Lane order is the flow, not the meter's order** — *Niet akkoord*, *Bij de klant*, *Bij Nymbus*, *Afgerond*, left to right. Deliberately **reversed** from `MODULE_STATUS_SEGMENTS`, which the meter a centimetre above uses, because the two orders answer different questions: a meter is a quantity bar and fills from the left as a project progresses, so *Afgerond* leads it; a board is read as movement towards done, and one with *Afgerond* in the first column reads as though the work runs backwards. *Niet akkoord* goes **first** rather than last — it is where an import came back from, so in the loop it sits before the client's lane, and the two leftmost lanes are then both the client's own work, which is what they open this page to find.
    - **All four lanes always, empty ones included** — exactly as the meter's legend names every segment whether or not it has modules: *nothing is Niet akkoord* is worth showing, and a board whose shape changes per project can't be compared with the last time it was looked at. An empty lane says *Geen modules*. The **fifth** lane is the exception and appears only when it has cards: a module AFAS holds no status for is not a stage of the conversion, so it gets no standing column — but it may not be dropped either, for the reason the table keeps such a row.
    - **The card** — the category as a quiet uppercase kicker (the board is grouped by something else, so the HRM/ERP heading the table has moves onto the card), the module name, then **AFAS's own status or the task it waits on** — the sharper answer beats the lane it sits in, *Sjabloon gevuld* inside *Bij Nymbus*, and the line is **dropped when it would be the lane's own word** (a card reading *Afgerond* under a column headed **Afgerond** spends a line on what the reader can already see; it only bites at the ends of the workflow, where AFAS holds no task any more, and the tooltip still carries the status) — and the last check on one line, the sidebar's completeness dot with `87% rijen OK · 12 fouten` (`boardCheckText()`, the table's **Rijen OK** and **Fouten** in that order and the same words — so a card falls back to *3 rijen met fouten* after a reload exactly as the row does, and keeps the silences apart the same way). The completeness dot, not the lane's colour: how clean the sheet was is a different question from where the module stands, and the board already says the second one by placement. The **opleverdatum** stays in the tooltip, as it does in the table under `lg`. Every card is a `GuardedLink` into its module, like every row of the table.
    - **Lanes share the width and stop at `min-w-52`**, below which a module name is no longer readable on a card; from there the row scrolls sideways rather than squeezing four columns onto a phone. In board mode the **legend under the meter is dropped** — the lane heads *are* that legend one level down, same dot, same word, same count, and drawing it twice within a centimetre reads as two different breakdowns. The meter itself stays either way (it is the one thing showing the *proportion*) and its `aria-label` still names every segment in words, so nothing is left to colour.
- **Module help drawer** — [`ModuleHelpDrawer`](../frontend/src/components/uploader/ModuleHelpDrawer.tsx): a [`Drawer`](../frontend/src/components/Drawer.tsx) at `max-w-md`, opened from the intro link. Its callers hold the open flag, so it renders nothing until set and its body mounts fresh each time — which is what resets the search term and the active tab, with no effect to clear them. Escape clears an active search first and only closes the drawer when there is nothing left to clear (`onEscape`). Renders up to three sections — **Algemeen**, **Kolommen**, **Veelgestelde vragen** — from the module's help file, each hidden when empty. The Kolommen list is derived from the rule set (name, `verplicht` badge, type, allowed values, AFAS-list hint) with prose/examples from the help file. Content model in [file-types.md](file-types.md#module-help).
- **Upload zone** — [`uploader/Dropzone`](../frontend/src/components/uploader/Dropzone.tsx): drag-and-drop + file picker (`.xlsx`/`.xls`/`.csv`); white dashed card, orange icon chip, orange **"Bestand kiezen"** button; highlights on drag-over. **It fills the height its landing leaves** (`h-full` in a `flex-1` cell, floor `min-h-72`) rather than being a fixed strip with dead space under it — that height is what the sheet toolbar gave up by only appearing with a sheet, and a drop target you can't miss is worth more than a row of buttons that can't act yet. Once data shows, dropping a new file onto the table replaces it — that target is deliberately *not* this component: it's an overlay on the table card with its own ring and wording (*Bestand loslaten om te vervangen*), and lives with the table it covers.
- **Teruggevonden werk** — [`DraftRestoreNotice`](../frontend/src/components/uploader/DraftRestoreNotice.tsx): when the browser turns out to be holding an edited sheet from a session that ended without a save (a crash, a closed laptop, a dropped tab — see [architecture.md](architecture.md#data-flow) step 3a), the module's landing opens with a white `rounded-card` **above the dropzone**, in `UploadLanding`'s notice slot: a primary-tinted `History` chip, *Verder waar je gebleven was?*, and one line naming what is being held — the file, how many aanpassingen, and when it was last bewaard. Two buttons on the right, the pair `ModuleStartCard` uses: a quiet outlined **Weggooien** (`Trash2`, red on hover — it deletes something) and the orange **Werk herstellen** (`RotateCcw`). **A card, not an `AmberNotice`**: nothing has gone wrong and nothing needs attention. Amber would claim a problem where this is an offer, and the thing it competes with is directly underneath — uploading the file again — which is why it names the file and the moment instead of just announcing that something was found. It appears **only on the landing**, never over an open sheet: while a table is on screen that same storage is being written, and a restore there would be the tool discarding the file the user is looking at. Restoring re-runs validation rather than restoring a stored one, so a restored table carries this rule set's flags, not the ones loaded when the tab died.
- **Recognition modals** — up to four steps in order: confirm project → pick module → confirm switch → pick sheet (see [file-types.md](file-types.md)). No inline type-selector. All four come out of [`uploader/useFileIntake`](../frontend/src/components/uploader/useFileIntake.tsx), so a file gets the same questions wherever it was dropped.
  - **[`SwitchProjectPrompt`](../frontend/src/components/uploader/SwitchProjectPrompt.tsx)** — *Bestand van een ander project?*, the `ModalWarningHeader` amber block: the uploaded file's name carries a project number (`projectNumberIn()`, see **Download naming**) other than the open project's. It is **first** because it is the only question that can make the rest pointless — a file from another conversion shouldn't be routed to a module page, it should be stopped — and it only fires for a file this tool named itself, so the ordinary first upload of a client's own export never sees it. Unlike the module prompt it **does not offer to move the file**: a module is a page in this project, a project is a different conversion with its own rules, configuration and AFAS environment, and the number may be stale (a sheet copied from last year and refilled) exactly as easily as the page may be wrong. So the two buttons are *Annuleren* and *Toch inlezen*, and reading it anyway is a real answer — the sheet is validated against the project the user is looking at, and the old number doesn't follow it: the next download is renamed for **this** project.
- **Leaving a module with a sheet open** — [`LeaveModulePrompt`](../frontend/src/components/uploader/LeaveModulePrompt.tsx): following any link while a file is on screen doesn't navigate, it asks — another module, the project, the brand mark. The page it opens arrives with an empty table, so the sheet can't come along, and the prompt offers exactly two ways out — **Blijf op {huidige}**, or **Opslaan en naar {bestemming}**, which hands over the annotated sheet *and* the PDF report (the same pair as the toolbar's save, same code path) before following the link. There is no third "leave it unsaved" button; that outcome is what the prompt exists to prevent. Escape and the backdrop mean *stay*. **Once those two files are out and the table hasn't moved since**, the same prompt drops the saving: a green `ModalConfirmHeader` instead of the amber triangle, *{bestand} is opgeslagen — het bestand en het validatierapport zijn gedownload*, and a plain **Naar {bestemming}**. The question is still asked — closing a table is worth a yes — but asking someone to save a second time would hand them two duplicate downloads and teach them to click past the prompt without reading it, which is what would make the unsaved case above useless. The uploader decides it with `isSaved`: the identities of the grid and the validation run the last save wrote out, so an edit *or* a Hercontroleren (which moves the flags in the workbook and the stale stamp on the PDF) puts the amber version back. The sidebar itself knows none of this: its links are `GuardedLink`s, and the uploader — the only component that knows a sheet is open — installs the guard they consult, for as long as there is a workbook. Clicking the module you are already on is not leaving, so it raises nothing. **The browser's back button is the one exit this cannot cover** — see [architecture.md](architecture.md#routing) and [todo.md](todo.md).
- **Aanleverbevestiging** — [`SubmitCommentDialog`](../frontend/src/components/uploader/SubmitCommentDialog.tsx): what **Aanleveren bij Nymbus** opens, for admin and client alike, the instant either presses it — a centred `Modal` (`max-w-lg`) with one **Reactie** textarea and nothing else: no envelope, no JSON, because the question here isn't "what does the reaction look like" but "has someone said why". **Mandatory** — the primary **Aanleveren** (`Send` icon) button stays disabled until the textarea holds more than whitespace, *Bezig met aanleveren…* while it runs, both buttons disabled meanwhile. `UploadPayloadDialog` used to open here instead, showing the AFAS envelope before an admin's press; removed once the hand-off had been exercised enough to trust without reading it first, and replaced by this once a mandatory reactie became the actual requirement. The outcome comes back as an emerald `GreenNotice` above the grid naming the deeltaak's new status, or an `AmberNotice` with the backend's own refusal — the dialog itself closes either way, same as **Controlebevestiging** below.
- **Actiebevestiging** — [`WorkflowActionDialog`](../frontend/src/components/uploader/WorkflowActionDialog.tsx): what every workflow button except *Aanleveren* opens — the same shape as **Aanleverbevestiging** above (a centred `Modal` (`max-w-lg`), one **Reactie** textarea, no envelope, no JSON), **Annuleren**, and a confirm button that performs it — *Bezig met vastleggen…* while it runs, both buttons disabled. One dialog for every action, worded from the action's label (`ACTION_LABELS` in the hosted version's backend, keyed by task and action number, falling back to the AFAS caption): the header is the label, the confirm **Vastleggen: {label}**, its tone from `actionTone()` — **success** with `CheckCircle2` for *akkoord* / *afgerond*, **danger** with `ThumbsDown` for *niet akkoord*, **primary** with `ArrowRight` for anything else. Unlike **Aanleverbevestiging** its **Reactie** stays optional (`_default_action_comment()` fills it in when left blank). The attachment checkboxes, dropped files and screenshot pasting show **for everyone**, as on a hand-in.
- **Data table** (`DataTable` in `ExcelUploader`) — fills its white card **edge to edge**: no padding around it and no border of its own (the card's border is the table's, its `rounded-card` kept only to clip the sticky header's corners), so the grid is the card rather than a box inside one; and with a sheet open, from `lg`, the card itself sits **8px** from the screen's top, right and bottom and from the files column (`sheetOpen` in `ExcelUploader`, pulling back half the shell's padding) — reduced rather than removed, so it still reads as a card; only the missing-columns notice above it brings a margin (`m-5 mb-3`). Sticky orange header (`bg-primary`, white text). Every cell is an inline-editable `<input>` (orange ring/tint on focus). **Virtualised** (`@tanstack/react-virtual`). Edited cells get a small **orange corner triangle** (CSS border trick). Invalid cells are outlined in red; hover shows an issue tooltip. `cellData` is owned by `ExcelUploader` (seeded on each `commit()`), passed with `onCellChange` so the parent tracks `dirtyKeys`. A cell rejected by a **codetabel** carries one more mark: a small `TextSearch` button in its **top-right corner** that opens the value picker below. So does an **empty** cell in a codetabel column — whether it is flagged (`required`) or not — since there is a value to choose there too and the user shouldn't need to know the codes to fill it. The button is red (`bg-red-100 text-red-700`) on a flagged cell and neutral (`bg-zinc-100 text-zinc-500`, `hover:bg-primary`) on an unflagged empty one: a fix in the first case, an offer in the second. It only appears once that column's table has loaded (`pickerColumns`, rebuilt on `loadedAt`) — a picker over a table that hasn't arrived would open empty. Three corners, three meanings — top-left *edited*, bottom-right *fout*, top-right *here are the valid values* — and the input gains `pr-6` so a long value never runs under the button.
  - **A search field per column**, in a second header row on a **pale orange band** (`color-mix(primary 14%, white)` — solid, since the header is sticky and a translucent `bg-primary/15` would let rows show through; quieter than the labels above it), white fields with a `border-primary/25` hairline and the usual primary focus ring (`h-7 text-xs`, leading `Search`, a clear `X` once filled; `size={1}` so its default width never widens a column, but a `minWidth` that keeps *Zoeken* whole — and `MIN_COL_WIDTH` follows from it, so a dragged column can't cut it off either). Case-insensitive *contains*, every filled field at once, on top of the toolbar's *alleen rijen met fouten*. The `#` cell of that row holds a clear-all `X` while any search is active, and an empty result reads *Geen rijen gevonden.* The matched rows are taken **when a term changes, not on every edit** — the same reason the errors-only filter waits for Hercontroleren: a row whose searched value is being typed over must not vanish mid-keystroke. A *vorige/volgende fout* jump to a row the search hides drops the search, since the user asked to go there. State lives in `DataTable` (it is a way of looking at the grid, not a fact about the sheet) and resets when the sheet changes.
  - **The template's instruction above each search field**, in the same band — the row 2 the client read in Excel (*Medewerkernummer in AFAS*, *J/N*), which the uploader drops as data, so without this it would be gone the moment the sheet opens. `text-[11px] leading-4 text-body`, **two lines at most** (`line-clamp-2`, the whole text in the `title`) and **the same `h-8` in every column**, empty where a column has none, so the search fields below still form one line; `w-0 min-w-full` keeps it out of the table's width sums — it wraps to the column and never widens one. In the band rather than under the labels in the orange: `text-body` on the pale band reads at 11px, white-on-orange at that size doesn't. A template whose row 2 is an example record rather than instructions (Wagenpark) shows each value as *Bijv. …*. The texts come from [`columnInstructions`](../frontend/src/lib/column-instructions.ts) off the module's `templateUrl`, so they follow the NL/EN switch; a module without a template gets the band as before.
- **Codetabelkiezer** — [`CodetabelPicker`](../frontend/src/components/uploader/CodetabelPicker.tsx): a centred `Modal` (`max-w-lg`) holding the entire codetabel the cell was judged against, so a wrong code is fixed by picking the right one instead of by looking it up in AFAS. It is offered for `codetabel` errors and for empty cells in a codetabel column **only**, because those are the cells the tool knows the answer to — every other message can just describe what is wrong. `DataTable` owns the open flag (the button is inside a cell) but renders the modal **outside the scroll container**, next to the issue tooltip, so its overlay isn't trapped under the sticky header.
  - **Two searchable columns**, named and ordered by the table's own `picker` declaration in [`codetabellen/sources.ts`](../frontend/src/lib/validation/codetabellen/sources.ts) — the AFAS table's field names (`Code` + `Naam` for nationaliteiten and landen, `Land` + `Woonplaats` for woonplaatsen). One search field matches **either** column: a client who typed the wrong nationality code knows the country's name, not the code they should have used. Picking a row writes the entry's **`code`** into the cell — the field the check compares, so nothing else could clear the error (for woonplaatsen that `code` *is* the place name).
  - **Scoped tables are narrowed to the row's scope** (the issue's `tableScope` — Woonplaats within its Land), so the picker can't offer a value that is in the table yet still wrong for this row. That column then drops out of the table, since every row would repeat the same `NL`, and the heading carries it instead: *Kies een geldige waarde uit de codetabel binnen Land NL.*
  - Header names the sheet column, with the rejected value beneath it in a red `rounded-btn` chip (*Huidige waarde: NLD*). **Virtualised** — the woonplaatsen list is 3260 entries and all of them stay reachable, so nothing is capped behind a "top 50". Footer counts what is on offer (`3260 waarden`, `12 van 3260 waarden` while searching) beside a quiet **Sluiten**.
  - **Keyboard-complete**: the search field autofocuses, ↑/↓ move the highlighted row and Enter picks it (`role="combobox"` + `aria-activedescendant` over a `role="listbox"`, so focus never leaves the input). Escape closes via `Modal`.
  - A pick is an ordinary cell edit — it marks the cell dirty and leaves the results stale, so the red tint and the button stay until **Hercontroleren**, exactly like typing the value by hand.
- **Sheet toolbar** — [`SheetToolbar`](../frontend/src/components/uploader/SheetToolbar.tsx): **the top of the left column** — `ModuleFilesPanel`'s `header`, in that card above *Aangeleverde bestanden* — never the table's header, and since 28-10-2026 no longer a card of its own over the table either. Over the grid it took ~240px of height from every sheet; in the column it costs only the width the files panel already took, and the grid runs the page's full height. It describes the sheet rather than being part of the grid, and it stays put while the table beside it is replaced. **One stacked column** (`px-4 py-4`, at all widths — the same stack is the phone's band): filename (two lines, `line-clamp-2`, `overflow-wrap:anywhere`), the *Data / Payloads* switch at full width under it, the icon row (`gap-1.5`, so six fit `w-80`), then behind a hairline **two** figures one per line with the error stepping (‹ › filter, `gap-1`) right-aligned on the second — then their *Verouderd* / *lijsten niet gecontroleerd* badges, and behind another hairline the workflow buttons at full width (`empty:hidden`). **Switching Data ↔ Payloads moves nothing in it**: the payload view also hands over exactly two figures (*staat al in AFAS* — a dash until the existence read lands — and *geselecteerd*, with what a filter, repair mode or errors keep out folded into that one's detail line), the error stepping stays (a jump lands in the Data view), and the background read (*Bestaande records … opzoeken…*) takes the lead's detail line with a spinner (`Metric`'s `busy`) instead of a line of its own. Every tooltip in it is `leading` (`left-0`): from the page's left edge a centred one hangs off the screen, a leading one runs out over the table. *The sub-points below describe the older two-column card where they talk about left and right; what each control does is unchanged.* Purely presentational; `ExcelUploader` owns the state and hands the figures over already counted. `relative z-30` keeps the button tooltips above the table card that follows. Two columns on top (`flex items-start justify-between`), a figures row underneath:
  - **It comes with the sheet and goes with it.** Selecting a module used to be enough to show it, with the four data actions greyed out and the module's stored check standing in for live figures — a bar of things you can't do over a page whose only move is *upload a file*. It is now mounted only once there is a workbook, and everything it carried before one has a better home on the page that has no file: the **module start card** holds the name, the help and the last check, the **dropzone** is the upload action (and takes the height the bar gave up), and the startrij is named under it in words. So there is one shape here now instead of two — `fileName` is always a file's, `metrics` always the sheet on screen's, and no button is disabled for want of data.
  - **The action row** — everything that isn't a workflow action, free to wrap onto a second line on a narrow card since the column beside it doesn't — left to right:
    - **Title** — the filename (truncates when long)
    - **No count pills.** There were two — the sheet's size (`163 rijen · 68 kolommen`) and its issue total (`237 fouten`) — and they are deliberately gone: with the figures row directly underneath saying more about both, one card was reporting the same sheet three times over. The size is the report's `Omvang`, and how much of the sheet is actually usable is the figures row's job
    - **Six icon buttons** — labels appear only as **tooltips above the icon** on hover (navy pill, `z-50`). All use the same outlined style (`border-zinc-200 bg-white`, orange tint on hover), and all come from [`ToolbarButton`](../frontend/src/components/uploader/ToolbarButton.tsx). There is a sheet whenever the bar is on screen, so the only `disabled` states left are about the *sheet*, not about its absence — the filter with nothing to filter:
      1. **Data hercontroleren** — re-runs validation
      2. **Opslaan en downloaden** (`Save`) — writes the edited grid to a new file (name + timestamp, see **Download naming** below), with the validation flags carried into it (see **Annotated export** below)
      3. **Upload nieuw bestand** (`FileUp`) — opens the file picker, replacing the sheet on screen (through the unsaved-changes prompt when there are edits)
      4. **Alleen rijen met fouten** — *toggle*; filters the grid down to rows holding at least one issue. Disabled when there are none; its tooltip carries the count (`Alleen rijen met fouten (12)`) and flips to **Alle rijen tonen** while on. Being a toggle it also renders `aria-pressed` and, when on, the filled active style (`border-primary bg-primary text-white`) — the one deviation from the outlined style, so an active filter is unmistakable
      5. **Instellingen** — opens [`SheetSettings`](../frontend/src/components/uploader/SheetSettings.tsx), a centred `Modal`: a title over a hairline, then the tool rows, first the **validatierapport** row (it used to open on a *Start vanaf rij* field; the parser now finds the first data row itself, see [file-types.md](file-types.md#where-the-data-starts)). That row is an icon tile, the name and a line of explanation under it (*Alle fouten gegroepeerd per kolom*, or *Nog geen controle uitgevoerd* disabled), same shape as the tool rows the old admin menu used. Pressing it closes this modal and opens the report drawer below. **Open to admin and client alike** — a client gets the same report as the **PDF that rides along with Opslaan en downloaden**, which is the copy they mail on and correct against, while the drawer is just that same report read on screen instead
      - *(Until 20-10-2026 a second row sat here, **Voortgang naar AFAS sturen**, sending the check's figures. It moved to the **Payloads** view's header, next to **Koppeling openen** — see below — and now sends how much of the sheet AFAS holds.)*
      - A third tool row, **admin-only** (`RefreshCw`): **Codetabellen verversen** — this module's codetabellen again from AFAS, past the backend's one-hour cache, for a table the customer changed during the day. Same row shape and in-place reporting as the validatierapport row above it (*Bezig met ophalen uit AFAS…*, then a green strip naming how many tables came back, or red with the refusal). **Never disabled**: it needs no check on screen, since it replaces what the check compares against; the sheet re-validates on its own once the tables land (`loadedAt`).
      6. **Uitleg {module}** — opens the module help drawer; the same drawer the start card's **Hoe vul ik dit in?** opens, mounted once by `ExcelUploader` so the two can't drift apart. Sits right after **Instellingen**, not at the row's far edge — there used to be a second, admin-only button out there (the tools menu); once its one remaining row (the validatierapport) moved into **Instellingen** above, nothing was left to anchor to that edge
    - **Admin-only buttons** — pass `adminOnly` to a `ToolbarButton` and it is there for admins and absent for everyone else (it wraps itself in [`AdminOnly`](../frontend/src/components/AdminOnly.tsx) — see **Component conventions**). Hidden rather than disabled: greyed-out means *not yet*, where a non-admin is never going to press it. None of the six are admin-only today
  - **The workflow column** — a `flex flex-col items-end gap-1.5`, `shrink-0`, at the bar's true right edge (the action row beside it is `flex-1`, so this is the one thing that never wraps under it). Every button in it actually moves the deeltaak on in AFAS — nothing here just opens a dialog — so each gets an icon **and** a visible label rather than a tooltip-only icon: [`WorkflowActionButton`](../frontend/src/components/uploader/ToolbarButton.tsx), sized like the row's own buttons (`h-9`) but as wide as its label needs. The label is **ours, keyed by code** — `ACTION_LABELS` in the hosted version's backend maps each action's `(TaskId, ActieId)` to its text, for every button alike, off the module's `actions` (`project_modules()` (the hosted version), one `Nymbus_WorkflowTakenActies` read) — so rewording an action in AFAS leaves its button alone; an action without an entry shows its AFAS caption. **A chip, not a filled button**: the same idle treatment as the row's own `ToolbarButton`s — white, thin `border-zinc-200`, `text-navy`, and the same `rounded-btn` radius as those buttons and the view switch, not a capsule — with an `h-4 w-4` lucide icon beside the label (`STATUS_CHIP_BASE`/`STATUS_CHIP_ENABLED` in [`ToolbarButton.tsx`](../frontend/src/components/uploader/ToolbarButton.tsx)). The hand-in carries `Send`; every other action the icon `actionIcon()` reads off its label — `ThumbsDown` for *niet akkoord*, `CheckCircle2` for *akkoord* / *afgerond*, `ArrowRight` for a plain step — the same icon its confirm in **Actiebevestiging** carries. `tone` colours it (`STATUS_CHIP_ICON_TONE`) — `good`/`bad` off the same `--color-status-good`/`--color-status-bad` ink the status badges use for an action's verdict, `neutral` (brand orange, the default) for the hand-in and any action that isn't one:
    1. **{submitActionLabel || "Aanleveren"}** (`Send`, neutral) — hands the checked sheet to Nymbus's AFAS environment: the last step of the tool, and the only button that sends a customer's data out of the browser. Rendered only while `canSubmitStep` (a `submit` entry in the module's `actions`) is true — the deeltaak is at a task that takes a hand-in at all — **for admin and client alike**: a sheet can be spotless and there can still be no action to fire once the deeltaak has moved to *Controle ingevulde template* or past, and that isn't something an admin can override, unlike the check below. **Hidden rather than disabled** off that task, same reasoning as the actions beneath it: a permanently greyed Aanleveren on every page past the hand-in step would be noise with nothing behind it. Once it renders, the remaining gate is **for a client only**: the sheet must **have been checked, be clean, and be unedited since** (`hasResult && !stale && errorRowCount === 0`; a stale pass is not a pass, since the cells moved after it). **Admins aren't held by this one** — for us a loaded file is enough, checked or not, clean or not (`useIsAdmin()`, not `AdminOnly`: this decides the button's *state*, not whether it's there — the button is the client's too). The gate exists to stop a client sending a sheet nobody looked at, where we upload deliberately: a half-finished sheet to see what AFAS says about it, a known-bad row to reproduce an error. Disabled dims the chip to `bg-zinc-50`/`text-navy/40` and the icon to `text-navy/25`, no colour left to read. **It pulses** (`.toolbar-btn-pulse`) once the sheet is clean for upload (`cleanForUpload`, and not while sending) — for a client that is exactly the moment it becomes pressable, so the chip itself says "this is your next step". Not on an admin's unchecked sheet: the button is enabled there too, but nothing about that sheet says "go". Three tooltips accordingly — *…— pas mogelijk na een controle zonder fouten* when the check is missing, the plain label when the sheet really is clean, and *…— let op: deze sheet is niet foutloos gecontroleerd* when an admin is about to send one that isn't. **The one thing that gates admin and client alike** is the press itself: it always opens **Aanleverbevestiging** below rather than firing straight away — `SubmitCommentDialog`'s mandatory **Reactie**, since neither may send without saying why. Only its confirm button actually calls `performSend()` in [`ExcelUploader`](../frontend/src/components/ExcelUploader.tsx), which posts to `/api/upload`. The outcome comes back as a `GreenNotice`/`AmberNotice` under the bar either way
    2. **Every other action at the current task** — one chip per action AFAS has there (`actions` off the module's status, minus the hand-in above and *Verwijderen*), labelled by `ACTION_LABELS` and in AFAS's order, the icon picked by `actionIcon()` and toned by `actionTone()`: `bad` for *niet akkoord*, `good` for *akkoord* / *afgerond*, `neutral` otherwise. **Who sees them is the task's**: admins and developers see every task's; anyone else sees none on a task whose AFAS `Gebruikersgroepen` name the Datateam (`adminOnly`) — `ExcelUploader` narrows the list before it reaches the bar. **Hidden rather than disabled** off their task, like *Aanleveren*. Each opens [`WorkflowActionDialog`](../frontend/src/components/uploader/WorkflowActionDialog.tsx) rather than firing straight away — see **Actiebevestiging** below
  - **The figures row** — under a `border-zinc-100` hairline: the sheet on screen in the two metrics of `sheetMetrics()`, side by side in a `grid-cols-2` `divide-x` split, exactly the pair (and the wording) the validatierapport leads with — the **percentage of rows AFAS would take as they are** (*van de rijen kan zo naar AFAS*, `148 van 163 rijen` beneath) and the **checked fields carrying an error** (*velden met fouten*, `van 1.200 totaal` beneath). An amber **Verouderd** pill joins them once cells were edited after the run they describe (tooltip points at *Hercontroleren*) — a percentage that has silently stopped being true is worse than no percentage.
    - Each figure is one `MetricText` laid **sideways** — the number at `text-2xl font-extrabold`, its caption beside it, the quiet denominator under that — where the report drawer stacks the same three strings at `text-4xl`. A bar has no room for the report's card, and it must not compete with it. The renderer is [`uploader/Metric`](../frontend/src/components/uploader/Metric.tsx), its own file because the **module start card** prints the module's stored check with it: one layout for a figure, whether it is live or remembered
    - **Stored figures are not shown here.** The bar only exists with a sheet, so its figures are always the sheet's; the module's last recorded check (`progressMetricText()` in [`lib/project-progress.ts`](../frontend/src/lib/project-progress.ts), past tense, with the moment and the file under it) belongs to the page that has no sheet — see **Upload landing**
- **Download naming** — every generated file is `<projectnummer>_<basisnaam>_<timestamp>.<ext>` (the PDF report prefixed `Validatierapport_` after the number, the projectrapport `Projectrapport_`), built by `downloadName()` in [`lib/download.ts`](../frontend/src/lib/download.ts), which both writers share along with `triggerDownload()`. **The project number goes first** so a client working on several conversions can sort one downloads folder by name and have each project's files — sheet and rapport alike — fall together: the files leave the tool, get mailed around, and come back with nothing but their name to say which conversion they belong to. Anything the tool put there before — number at the front, timestamp at the end — is **replaced, not stacked**: clients re-upload the file the tool handed them — that's the point of the annotated export — so appending blindly grew a tail per round trip (`…_2026-07-30_132557_2026-07-30_153149.pdf`), and would grow a head per project switch. Only our own exact shapes are stripped, and each only at its own end — `^\d{6}_` and `_YYYY-MM-DD_HHMMSS$` — so a client's own `Wagenpark_2026-07-30` keeps its date and a client's own `2026_Wagenpark` isn't mistaken for one of ours. The number is optional in the signature for the one caller that has no project: the standalone schema pages under `/afas`, whose files are named exactly as they were before this existed.
- **Naming a file the tool didn't write** — `projectFileName()`, same module: the module **sjabloon**, which is one fixed file in `public/templates/` that every project downloads the same bytes of. So only the name can say whose copy it is, and that matters more here than anywhere — an empty template is the one file you cannot tell apart by looking inside. No timestamp: the file has no moment to record, and downloading it twice should give the same name twice. It rides on the `<a download>` attribute, which takes the name to save under, so the rename costs no fetch; the paths in `lib/modules.tsx` are percent-encoded URLs and are decoded first, since a `download` attribute is a file name and would otherwise save a literal `%20`.
- **Reading the number back** — `projectNumberIn()` answers the number in an uploaded file's name, or null for a name the tool never wrote (the client's own export — the normal first upload). That is what lets the intake notice a sheet from another conversion before it is validated against this project's rules — see **Recognition modals** above.
- **Annotated export** — the downloaded `.xlsx` is the client's *own file, patched* — not a rebuilt copy. `downloadSheet()` re-opens the upload and writes only the edited cells and the flags, so fonts, fills, borders, number formats, row heights, merges, frozen panes, conditional formatting, data validation and any other sheets all survive. Two deliberate departures from the original, plus the flags themselves:
  - **Column widths are re-fitted** to the longest value in each column (capped at 60 characters, `+2` padding, merged cells excluded since their text spans columns). This is the one piece of the client's formatting the export overrides — a column sized for a short label hides the long values under it. Widths can narrow as well as widen.
  - **Every sheet comes along**, in the original order. The patch path gets this for free (ExcelJS loads the whole workbook); the fallback rebuilds one sheet per parsed sheet, with the edited one carrying the edits and flags.
  - **A filter is added only if the sheet has neither an `autoFilter` nor an Excel Table.** A table carries its own filter, and a worksheet-level filter overlapping a table range makes Excel reject the sheet outright.
  - Untouched cells are never written, so a numeric cell stays numeric and keeps its format; an edited numeric cell stays numeric when the new value parses as a number, and anything else (dates included, which have no unambiguous text form here) goes back as text.
  - **Fallback**: `.xls` (ExcelJS can't read it), `.csv`, and any workbook ExcelJS refuses to open — notably **any file containing an image or a chart**, which makes its drawing reconciliation throw — export as plain rebuilt sheets instead. Flags, notes, fitted widths and all sheets still apply; only the original styling is lost.

  Six ExcelJS traps this code works around — all but the fifth produced files Excel rejected or mangled, so don't undo them:
  1. **`cell.fill = …` mutates a *shared* style object.** Every cell that shared an `xf` in the original file gets handed the same style instance, so tinting one cell tints all of them. On a real client sheet that meant 2037 of 2058 cells coming out tinted. Always assign a fresh object: `cell.style = { ...cell.style, fill }`.
  2. **ExcelJS writes `<legacyDrawing>` after `<tableParts>`**, but `CT_Worksheet` requires it before. The XML stays well-formed, so nothing complains until Excel drops the sheet — *"Replaced Part: /xl/worksheets/sheet1.xml part with XML error. Load error."* Any sheet with both a Table and one of our notes hits it. `reorderLegacyDrawings()` repairs the produced zip (via `jszip`) as a post-pass.
  3. **A worksheet `autoFilter` over a Table range is invalid** — see the filter rule above.
  4. **ExcelJS reads an omitted table attribute as `false` instead of its default.** `headerRowCount` defaults to 1 and Excel omits it when it *is* 1, so every ordinary Excel Table loads as headerless and the re-save writes `headerRowCount="0"`. That single attribute broke the export twice at once: Excel stops painting the header band — and a template whose header font is white (Wagenpark's is `theme="0"`) then shows an *empty* header row, labels still there but white on white — while a headerless table may not carry filter buttons, so Excel strips the table's `<autoFilter>` and prompts to repair the file (*"Removed Records: AutoFilter from /xl/tables/table1.xml part (Table)"*). Same mistake on `hiddenButton` (defaults to shown, omitted when every column is default), which hid all the filter dropdowns. `restoreTableDefaults()` re-reads the truth from the upload's own `xl/tables/*.xml` — matching tables **by name**, since ExcelJS renumbers the parts on write — and writes it onto the raw table model, *not* through the `Table` wrapper's setters: those re-measure the table from `rows`, which a loaded table doesn't have, so `table.headerRow = true` throws. Note ExcelJS drops `<dxfs>` wholesale on write — `restoreDxfs()` splices the original block back into `xl/styles.xml` afterwards, so the table's `headerRowDxfId`/`dataDxfId` refs point at the list they were written against again. It only does so where ExcelJS emitted none of its own (it does emit dxfs for conditional formatting): there the indices would need renumbering around the reinserted entries, so that case is left alone, and the file stays self-consistent either way since the visible formats live in `cellXfs` regardless. The repair applies to **every worksheet's** tables, not just the edited one: ExcelJS re-serializes all of them, so a table two sheets away breaks identically — the HRM Uitzendkrachten template (`Table1` on sheet 1, `Table13` on sheet 2) still prompted for repair on `table2.xml` while only the edited sheet was being fixed.
  5. **ExcelJS silently drops the parts it doesn't know about.** `customXml/*` (arbitrary XML a client's own tooling embedded) and `docProps/custom.xml` (the *Aangepaste eigenschappen* set under Bestand → Info) are never read, so they simply aren't in what it writes. Neither absence corrupts the file, but a client process that reads either back out of the workbook this tool returns finds it gone. `restoreDroppedParts()` copies them over from the upload's own zip as a post-pass — **and re-registers them**, since a part nothing points at is a part Excel ignores: a `Relationship` under a fresh `rIdN` in `_rels/.rels` (read off the highest already in use, so it can't collide with ExcelJS's own numbering), plus an `Override` in `[Content_Types].xml` for `docProps/custom.xml`. A `customXml` item's sibling `customXml/_rels/itemN.xml.rels` travels with it, found by folder rather than by name — a walk of the root relationships never sees it.
  6. **ExcelJS writes a conditional-formatting rule it doesn't know as nothing — but keeps the wrapper.** Its `cfRule` writer covers `expression`, `cellIs`, `top10`, `containsText` and a few more; `duplicateValues`/`uniqueValues` (*Duplicaten markeren*, which templates put on their key column) come out as an empty `<conditionalFormatting sqref="A1:A1048576"/>`. `CT_ConditionalFormatting` needs at least one `cfRule`, so Excel opens the download — after a check and after a send alike — with *"We found a problem with some content"*. `restoreConditionalFormatting()` runs after `restoreDxfs()` and puts the upload's own element on that range back verbatim, but only when its references still hold: no column was inserted, and the `<dxfs>` its `dxfId` indexes into is the original's. Otherwise it drops the empty element — the highlight is lost, the file opens clean.

  The flag styling itself is deliberately quiet, because the file is a worklist and not an alarm:
  - **Only the offending cell is filled**, never the whole row — a row-wide fill swamps a 60-column sheet.
  - **One pale fill**, the table's own hue one stop darker (`red-100` `#FEE2E2`). Excel offers no focus ring or corner triangle to help the eye, so the `-50` tint the table uses reads as white there; `-100` still keeps black text legible. One fill and not two because there is one severity — an `amber-100` warning tint sat beside it until the `warning` severity was removed.
  - **No other formatting** — no bold, no coloured font, no borders. One signal per cell, and it survives greyscale printing as two light greys.
  - **The message rides along as an Excel note** on the same cell, prefixed `Fout:` (multiple issues become multiple lines). The finding therefore isn't carried by colour alone, which matters for colourblind clients and for print. Excel adds its own small corner marker.
  - **`autoFilter` on the header row**, so the client can gather the flagged rows themselves.
  - **The sheet's shape is untouched** — no status column, no legend row. The client will often re-upload this same file, and either would shift the header row and break module recognition. A legend belongs on a second sheet.
  - `.csv` sources still export as `.csv`, which carries values only — fills and notes need the `.xlsx` path.
- **Errors-only filter** — the row set comes from the *last* validation run, so a row never disappears mid-typing; **Hercontroleren** refreshes it, and clearing the last error leaves the filter automatically. Row numbers stay the sheet's own, so a filtered row still shows (and edits) its real row. With nothing to show the grid reads `Geen rijen met fouten.`
- **Validatierapport** — [`ValidationReportDrawer`](../frontend/src/components/uploader/ValidationReportDrawer.tsx): the same [`Drawer`](../frontend/src/components/Drawer.tsx) as the module help drawer, one step wider (`max-w-lg`) for the grouped lists. Opened from **Validatierapport** in the toolbar's admin menu — **admins only**, by design: the client's copy of this report is the PDF that comes with **Opslaan en downloaden**. Mounted only while open, so the report is regrouped on open and never for a drawer nobody is looking at. Purely presentational: the shape comes from `buildValidationReport()` in [`lib/validation/report.ts`](../frontend/src/lib/validation/report.ts). Top to bottom:
  - **Header** — *Validatierapport*, module + filename underneath, then one quiet outlined action and the close button: **PDF** (`FileDown`; downloads the report — see **Report PDF** below; shows a spinner while the writer loads, since it is fetched on first use, and flips to *Mislukt* if it fails).
  - **Stale banner** (amber) when cells were edited after the run the report describes — it points at **Hercontroleren** rather than silently showing old numbers.
  - **Identity** — `Blad` (the sheet's own name) and `Omvang` (`163 rijen · 68 kolommen`, worded by `omvangText()` so the drawer and the PDF can't pluralize it differently), so the report — on screen and in the PDF that leaves the tool — says which sheet of which file it is about. The PDF carries the same two in its hero's right column rather than as rows of their own.
  - **The two metrics** — a `bg-surface/60` card carrying the two figures the report is read for, side by side in a `grid-cols-2` split by a `divide-x` hairline, both `text-4xl` and of **equal weight**: the **percentage of rows** carrying no error — the records AFAS would take as they are (*van de rijen kan zo naar AFAS*, with `148 van 163 rijen` under it) — and the **checked fields carrying an error** (*velden met fouten*, with `van 1.200 totaal` under it — the count says how much is left to fix, the line beneath gives it its scale). The field figure counts the fields that are **wrong**, not the ones that are right: it is the worklist, and a five-figure count of fine fields next to a red meter only read as a score nobody asked for — *8.339 velden zonder fouten* invited the reader to check whether that was good, where *237 velden met fouten* says what to do. Only the row figure carries a **percentage**: the field detail line used to end in `99% compleet`, and a share of good fields reads as a score of the sheet where the percentage beside it already is that score — *97% compleet* next to *0% van de rijen* only invited the reader to pick the kinder of the two. Two metrics rather than one hero because they answer different questions and neither stands in for the other: the percentage says how much of the sheet can actually be imported, the field count says how much of the data still needs work, and one bad field in every row reads as *0%* and *163 velden*. Records on the left, because that is the figure the sidebar badge carries and the one that decides whether the upload can go; fields on the right, because that is where a sheet with a single wrong column shows how small the remaining job is. Proportional figures for the two headline numbers — not `tabular-nums`, which makes a standalone number look loose — with the quiet denominators underneath set in `tabular-nums`. Columns the sheet doesn't have, and columns nothing checks, stay out of the field denominator — the first lands in the missing-column banner instead. Underneath the pair, a `Geen fouten` pill when there are none, then a thin (`h-2.5`) **stacked meter** breaking the percentage down into two status segments — green `Zonder fouten`, red `Met fouten`, both **per row** — separated by **2px gaps in the surface colour** (never a border on the mark) and each `rounded-full`. Two segments and not three: an amber `Waarschuwingen` band sat between them for rows carrying an issue that didn't block the upload, and with one severity left no such row exists — the meter is now exactly the percentage above it, drawn. Segment widths are `flex-grow: count` on a `flex-basis: 0`, so they share the track *minus* the gaps and can't overflow it, with a 3px floor so a single bad row in five thousand still shows. Zero-count segments aren't rendered. A legend row below names both with their counts, so the meter never depends on colour alone (it also carries an `aria-label` with the same numbers). The percentage is never rounded to a flattering 100% while something is still wrong, nor to a discouraging 0% while something is already right — it rounds through `percentageOf()` in [`validation/metrics.ts`](../frontend/src/lib/validation/metrics.ts), so the rule is stated once. Every figure on this card, and the words next to it, come from that one module (`SheetMetrics`, `rowMetricText()`, `fieldMetricText()`, `rowSegments()`) — the PDF renders the same strings, and anything that shows these numbers elsewhere should read them from there rather than re-derive them.
  - **No tiles.** There were two, `Fouten` and `Waarschuwingen`; the second went with the severity, and the first went after it. The row of tiles was the same mistake as the count pills above: `Fouten` counted *issues* while the metric card beside it counted fields and the meter under it counted rows, so one sheet was being reported three ways in one screen and the reader had to work out why three numbers disagreed. A cell failing three rules is one field, one row and three issues — true, and not a distinction anyone acts on. `report.errorCount` still exists for the `Geen fouten` pill, which only needs to know whether it is zero.
  - **Missing-column banner** — the same amber strip the table shows above the grid.
  - **Per kolom** — one card per column *that has issues*, in **sheet order** (`[A]`, `[B]`, `[C]`, …), each headed by its Excel column letter in brackets — quiet `font-mono text-xs text-body`, ahead of the column name — plus its **error count as a badge**, built like [`ProjectStatusPill`](../frontend/src/components/ProjectStatusPill.tsx) and the picker's category tags: one hue at three strengths (`border-status-bad/30 bg-status-bad/10 text-status-bad`) on `rounded-badge`, since `--radius-badge` is the radius every badge in a list shares and a verdict at the end of a row should be drawn the same way wherever the app puts one. Inside the card, one line per distinct message: `AlertCircle`, `4×`, the message, and the rows it lands on. Sheet order rather than worst-first on purpose: the report is worked through side by side with the file, so it reads left to right the way the sheet does instead of making the reader hunt for each column. Within a column the biggest message group leads — the most rows fixed by one correction. Runs of three or more consecutive rows collapse to a range (`rijen 3–5, 10`); past 20 segments the list folds behind a `+N meer` link. With nothing wrong the section is a single green *Geen fouten gevonden* strip.
  - **Rows and columns are named as Excel names them** — rows from `ParsedSheet.rowNumbers`, letters from `columnLetter(index, firstColumnNumber)`, the same cells the annotated export flags. Neither is a grid position: SheetJS indexes from the sheet's first used row *and column*, so a sheet whose data starts at B1 gets `[B]` for its first column. A footnote in the drawer says the row numbers are the file's, because the table's `#` column counts grid rows instead, and with the default `skipRows` the two differ by two.
- **Report PDF** — [`lib/report-pdf.ts`](../frontend/src/lib/report-pdf.ts), the version that gets mailed to the client. Same content in the same order as the drawer, on A4 (`jspdf`, dynamically imported — ~340 KB that stays out of the initial bundle, the deal `excel.ts` makes with ExcelJS). `buildReportPdf()` returns a blob and `downloadReportPdf()` saves it as `Validatierapport_<bestand>_<timestamp>.pdf` (see **Download naming** above); the split exists so the layout can be rendered and inspected without a DOM.
  - **Layout** — the app's own **hero** over an orange rule: the **Van Excel naar / AFAS zonder gedoe** wordmark [`Hero`](../frontend/src/components/Hero.tsx) opens every screen with (same `.highlight-band` recipe from `globals.css`, geometry measured off the text rather than guessed) on the left, and what the report *is* right-aligned beside it — **`VALIDATIERAPPORT` as the heading** (13pt navy small caps), then the file name at 8.5pt under it, then the module, `Blad <naam> · 163 rijen · 68 kolommen` and `Gegenereerd …` as quieter lines. The *kind* leads and the subject is set small, not the other way round: the kind is what a reader identifies the page by and it is the same length every time, where a real export name (`20260825 HRM 1_5fMedewerkers V3_2026 Multiclean definitief.xlsx`) set large only crowded the wordmark. **The subject wraps rather than ellipsizing** — a validatierapport is filed against a specific export, and the part that tells two of them apart is usually at the end, so a name trimmed to `… V3_2026…` loses exactly what it is for. Right-aligned line by line, since jsPDF aligns each string it is handed. Shared with the projectrapport as `drawHero()` (it takes a `HeroCaption`, so each report says as much about itself as it needs to), because both PDFs leave the app through the same inbox and should open identically rather than nearly so — and because it replaced a plain title *and* the standalone `Blad`/`Omvang`/`Gegenereerd` table that said the same thing twice, at the cost of the ~60pt that keeps a short report's findings off page two. Then the **stale notice above everything else**, where the drawer has it and for the drawer's reason: it says the figures underneath have stopped being true, and a reader who meets it afterwards has already been misled; the metric card — **laid out across, not down**, the shape the projectrapport's card has: the two figures side by side on the left at 24pt sharing a baseline, the meter with its `RIJEN` heading, 2pt gaps and legend beside them on the right, a hairline between the halves, and the `Geen fouten` pill under the legend when there is nothing to report. The figures half takes 56% of the width, not the projectrapport's 46%: portrait is ~250pt narrower, and at half the page *van de rijen kan zo naar AFAS* wrapped and left the pair lopsided. Its height is measured from the wrapped captions, and from whether that pill is there, since the box is filled before its text is written. Then the missing-column notice; then `PER KOLOM (n)` and, per column, a `surface` band carrying `[A]` in **Courier** bold — the drawer sets a column letter in mono, because it is a coordinate rather than a word — ahead of the name in navy bold, the same tinted-and-outlined count badge at the right (`STATUS_BAD` pre-blended over white, so the page shows the colour the screen does, at the badge radius rather than as a capsule), and its messages underneath. A running footer on every page carries the filename and `pagina n van m`, added in a final pass once the page count is known.
  - **Nothing is capped** — the drawer's `+N meer` exists because a drawer is a viewport; the PDF is the worklist, so every row number is printed and the document simply runs on. Column bands and message lines are separate blocks rather than one boxed card, so a column with a hundred messages flows across pages; a band is only ever placed where its first message line fits with it.
  - **The drawer's own marks and notices**, drawn rather than imported — a PDF cannot mount a React icon. `AlertTriangle` on a notice, `AlertCircle` on a finding, `CheckCircle2` on a clean sheet, each traced from lucide's geometry in its 24-unit box at lucide's `strokeWidth` of 1.8 (`strokeIcon()` and the three `IconMark`s), and each notice tinted **and** outlined like the `AmberNotice` / `GreenNotice` it echoes — the border is what keeps a pale strip reading as a band on paper. A notice's text is `Run[]` rather than a string, so a `<strong>` survives the trip: `wrapRuns()` wraps word by word, measures every word in its own weight, and keeps a word made of several runs together, so the bold `Kostendrager` and the regular `.` behind it can never break into a line starting with a lone full stop (jsPDF's own `splitTextToSize` knows one font per call).
  - **Nothing rides on colour.** Every finding carries its count in words beside its mark and its band spells out `31 fouten`, so the page survives greyscale printing and colourblind readers. The message line no longer opens with `fout ·` in front of the rows: with a single severity it said nothing the count didn't, on every line of a long report, and the drawer doesn't carry it either.
  - **Text goes through one WinAnsi guard**, whose main job is to *leave things alone*. The standard PDF fonts are WinAnsi-encoded, and jsPDF folds the 27 Unicode characters CP1252 keeps in its `0x80`–`0x9F` range onto those bytes before it writes (en dash → `0x96`, `…` → `0x85`, `€` → `0x80`, the curly quotes, …), so real typography reaches the page: `rijen 121–123` and `Formaat: X.X. — uitsluitend hoofdletters` print exactly as the drawer shows them. What breaks is anything **outside** CP1252, and it breaks loudly rather than quietly — one such character flips the whole string to UCS-2BE, which a WinAnsi font renders as every letter of that line spaced out and interleaved with blanks. So `winAnsi()` passes Latin-1 and those 27 through untouched and substitutes only what is left: `≥` → `>=`, `→` → `->`, anything else a `?`. That last part earns its keep — `checks.ts` phrases a bound as `Moet ≥ 0 zijn`. Every string is drawn, wrapped *and* measured through the guard, so a substitution can't shift a layout that was measured on the original. Check this by **rendering**, never by eye on a byte dump: the WinAnsi bytes are invisible in terminal output, which is how they came to be called dropped in the first place.
- **Updateconnectors** — [`afas/UpdateConnectorExplorer`](../frontend/src/components/afas/UpdateConnectorExplorer.tsx) at `/afas/updateconnectors`, reached from the sidebar's admin block (`Braces`, under *Bekijk als gebruiker*): what an AFAS UpdateConnector accepts, read from `metainfo/update`. **Admin-only, and a page of its own** — a connector schema belongs to an AFAS *environment*, not to a project, so there is no sidebar here and the page carries its own header: the back arrow, the title, and the environment that answered (`12345.rest.afas.online`, `NymbusConversies · O12345AB`) at the right edge, because the same connector id can differ per environment.
  - **There is no client to pick, and that is a design decision, not an omission.** The module connectors come from Nymbus's **test** environment because it is the template every customer environment is copied from: the schema is the same everywhere, so the mapping is made once here and used to write records at every client. The header therefore names an environment but never a customer.
  - **Two columns**: a `w-60` white rail listing the connectors ([`afas/ConnectorRail`](../frontend/src/components/afas/ConnectorRail.tsx) — id in mono over its description, active row in `bg-primary/10 text-primary` like the sidebar's, with a search field above it), and the schema beside it at `max-w-4xl`.
    - **Two groups, said out loud** — uppercase `text-xs font-extrabold text-navy`, the heaviest type on the rail, with a quiet `tabular-nums` count at the right edge: **NYMBUS** (the dossier and workflow connectors this tool writes through — `KnSubject`, `KnSubjectReaction`, `KnSubjectWorkflowReaction` — in Nymbus's **live** environment) and **MODULES** (the conversion connectors a module's sheet is mapped onto, in Nymbus's **test** environment, the template every customer environment copies). The split is not cosmetic: they are **two AFAS environments**, so the heading's tooltip names the host and app connector behind it, the page header follows the open connector's group, and the same connector name in the other group is a different schema — which is why a connector is addressed as group + id everywhere, the stored mapping included. Neither list is hardcoded; both are whatever `metainfo` answers with, so a connector added in AFAS appears without a code change. A group that can't be read shows an `AmberNotice` with AFAS's reason **under its own heading** and leaves the other working; one that is empty says so.
    - **Three levels, stepping down together** — size, weight *and* indent, four pixels a step (`RAIL_INDENT`): the group above (`text-xs font-extrabold` uppercase navy, `pl-3`), the category under it (`text-[11px] font-semibold` navy with its icon brought down to `h-3.5`, `pl-4`), and the connector rows lightest of all (`pl-5`, or `pl-4` in a group without categories — the id in mono `text-[11px] font-medium`, `font-semibold` only while it is the open one, over a `text-[10px]` description). Each step is small on its own; the three together are what makes seventeen rows in a 240px column read as a tree instead of one run of equal lines — which is why the indent stays a nudge and no rule or guide is drawn: the width belongs to `KnSubjectWorkflowReaction`.
    - **Both groups fold shut**, and so do the categories inside them — the section chevron this page already uses (`ChevronRight`, `rotate-90` when open, `h-3.5` on a group and `h-3` on a category), open unless the reader closed it, like the sidebar's module groups. The two groups are worked in one at a time, and fourteen conversion connectors otherwise push the three dossier ones off the top of a `w-60` rail.
    - **The conversion connectors arrive per category, HRM and ERP** — the sidebar's own two, labels and icons included, since it is the same question asked from the other end. Which one a connector belongs to is **read off its name**: AFAS's prefix names the functiegebied (`Hr` HR/verzuim, `Kn` CRM/relaties, `Fb` logistiek, `Fi` financieel, `Pt` projecten — [API reference](AFAS-Profit-API-Referentie.md) §5), so `Hr*` is HRM and the rest ERP, with `KnEmployee` the one exception the prefix gets wrong. It is a reading of a name, not something AFAS states, so an unknown prefix lands under **Overig** rather than being guessed into a category — the list stays whatever `metainfo` answered. A group whose connectors all land in one category is left as a plain list: *Nymbus*'s three are the tool's own plumbing, not a side of Profit, and a lone **ERP** heading over them would be a claim rather than a grouping. When a module carries the connector it converts into ([todo.md](todo.md) item 8), the category comes from the module and the name-reading goes.
    - A search narrows within the groups and **never removes a group heading** — the two are what the rail is for, and one vanishing mid-search reads as though its environment had gone. A category with no hit *does* drop out (that heading is organisation, not an environment), and everything is shown open while it runs: a search that answers with a row of collapsed headings hasn't answered — the same rule the schema tree follows.
  - **The root key is named where it differs from the connector id**, in a quiet line under the description: *Root van de body: `KnReaction` — niet de connectornaam*. It is the trap AFAS sets (`KnSubjectReaction` → `KnReaction`) and the most common way a payload fails, so it is said before anything else rather than left to be spotted in the JSON. Where the two are the same — `KnSubject` — **nothing is said**: the tree's own root section already carries that name, and the `bg-surface` strip that used to state it for every connector was a line telling most readers what was already on their screen.
  - **One collapsible section per object**, rendering itself for the nested ones ([`SchemaObjectSection`](../frontend/src/components/afas/SchemaObjectSection.tsx)): a chevron, the object name in mono, and pills saying what opening it shows — `n velden`, `n verplicht`, `n objecten`. Those counts are the object's **own**; the figures beside the title are the connector's totals with everything nested included, which their tooltip says (`KnSubject` is 651 fields over 63 objects, so the two numbers must not be read as the same claim). Only the root opens by default. Children are indented behind a `border-l-2` rule — at three levels deep the line is the only thing saying what belongs to what.
  - **A field is a row of four columns**: its code in mono (the one string that ends up in a payload) in `w-40`, its Dutch label in `w-48`, **what fills it** in a `w-48` lane of its own, and then the schema's own pills against the right edge (`ml-auto`) — an orange **verplicht** first, then type with its length (`string (20)`), a **sleutel** for a primary key, and a `n waarden` button opening the value list as chips (`I` Intern, `EI` Extern en intern). The three left columns are **fixed widths rather than a stretching label**, because that is what puts every row's mapping badge at the same x; sitting at the head of the pill cluster it landed somewhere different in every row, that cluster's width being whatever the field happens to need. **Verplicht leads** the pills for the same reason it earns a filter: whether a field *has* to be filled is what makes the reader do something, where its type only says what with. The value list is behind a button because some run to dozens of codes and the question is only ever asked of one field at a time.
  - **Filters, and what they do to the tree**: a search over field codes, labels, object names and value codes, plus an **Alleen verplicht** toggle (the filled active style, like the errors-only filter). **That toolbar is one row**, which is what makes its action buttons square 36px icons instead of words — `Asterisk` for *Alleen verplicht*, `Unlink` for *Alles leegmaken*, the save button below — each carrying its words in `title` *and* `aria-label`, since an icon-only button without both is a button only its author can read. Three labelled buttons beside a search box and the segmented switch wrapped onto a second row, and a toolbar that reflows as the panes change width is one whose controls move out from under the pointer. The search box keeps `flex-1` and gives way first (`min-w-40`). An object whose *name* matches keeps its whole subtree — searching a name is asking what it holds. While either filter is on, everything left is shown **open**: a search that answers with a row of collapsed sections hasn't answered. There are **no expand-all / collapse-all buttons** — the search is the way to reach a field in a 63-object connector, and opening all 63 at once is not something anyone wanted twice; the chevrons on the sections are the manual way.
  - **The mapping is saved, not just shown.** **Opslaan sits in a bar pinned along the bottom of the schema pane** — outside the scroll area, so it holds its place through all 289 fields of a `KnPurchaseRelationOrg` rather than scrolling off with the work it saves. It is the page's **only filled, labelled button**: everything else here is a quiet outlined toggle that changes nothing, saving is the one thing that does, so it takes the primary tone and a word instead of a glyph. Three states, in the label as well as the icon — `Save` + *Opslaan* while something is unsaved, a spinner + *Opslaan…* while it is being written, a dimmed `Check` + *Opgeslagen* once there is nothing to write. Left of it, in the same bar, one line of standing: *Niet opgeslagen — n velden gevuld* in navy, or *Opgeslagen door {naam} op {moment}*, so the reader never has to open a tab to learn whether their work is safe. The whole bar appears only once a field is filled — before that there is nothing to save, and a permanently greyed bar across the pane is a promise the page can't keep. It serves all three views, because there is one mapping and it is either saved or it isn't; a failed save says so in an `AmberNotice` under the toolbar, where a full-width notice is readable in a way a line squeezed in beside the button is not. It replaced an icon-only disk in that toolbar: one action deserves one control, and a second save button invites the question of whether the two differ. The **Koppeling** tab keeps **Kopieer JSON** and — when a stored version exists — **Opgeslagen versie wissen**, which unsaves the mapping and deliberately leaves what is on screen standing; throwing the work away is *Alles leegmaken*, and the two shouldn't be one press apart. Under the document, one line says where it stands: *Opgeslagen door {naam} op {moment}, gemaakt met {bestand}* — with **Niet-opgeslagen wijzigingen** in orange ahead of it when the screen has moved on — or *Nog niet opgeslagen*, then the file it lives in. A connector that has **no** stored mapping yet wears a **small red dot** in the connector list, so "which of these still need doing" is answered without opening them — the marker is on what is missing, not on what is done, because most of the rail is mapped by now and a dot per finished row is a column that says least where the eye should land. Red is `COMPLETENESS_TONE_FILL.poor`'s own fill, so red reads as "needs work" in both rails, and it keeps its colour on the selected row — the row highlight already says which one is open. Amber stays free for the state the mapping doesn't have yet: stored, but no longer fitting its schema. Reopening a connector shows its stored mapping straight away (derived, never copied into state, so there is no frame where the page shows an empty mapping a fetch is about to fill) — **re-pointed at whichever copy of the template is open**, by the same header-matching rule a re-dropped file follows.
  - **Structuur / JSON / Koppeling** — a segmented switch. **JSON** is the body this connector describes, in the envelope `afas_envelope()`/`afas_element()` build (`{ root: { Element: { Fields, Objects } } }`), with **Kopieer JSON** beside it. It renders the *filtered* tree, so *Alleen verplicht* turns it into the smallest payload the connector will take. Values are placeholders per type (`""`, `0`, `false`, a real date) — the line above the block says so, since a skeleton that looks fillable must not look sendable. A **mapped** column with no template open resolves to **`null`**, with its column name and *geen bestand* in the note beside the line and the count in the text above: leaving it unresolved handed the field its type placeholder back, so a mapped field read `""` exactly like the unmapped ones around it and a saved mapping looked lost. **Koppeling** is the mapping below, as the document a module's config will hold.
- **Kolomkoppeling** — the same page, once an Excel template is on it: the module's sheet over the connector's fields, and a **column dragged onto a field**. This is how a module's template gets tied to its connector; the model is [`lib/field-mapping.ts`](../frontend/src/lib/field-mapping.ts) and none of it is counted or phrased in the components.
  - **Three panes, each with its own scroll** — connectors (`w-60`), the sheet's columns ([`afas/ExcelColumnsPanel`](../frontend/src/components/afas/ExcelColumnsPanel.tsx), `w-72`), the schema tree. Source **beside** target, so a column is dragged sideways in one short move and both lists stay where they were. It was a table of the first rows across the top, and that made the page's one gesture hard: 78 columns scrolling sideways over fields scrolling down meant half the drags started with the target off screen. The connector rail is the narrow one on purpose — picked from a few times a session, where the other two are worked in continuously.
  - **A column is a row**: its Excel letter (`columnLetter()`, exported from [`validation/report.ts`](../frontend/src/lib/validation/report.ts) rather than re-implemented), its header, and — once it feeds something — the field codes under it in orange (`→ SbTx`), which is the mapping read backwards and the quickest way to see what is left. **The values live behind a chevron**: what a column *is* is its name, and the first values are what you check when the name isn't enough, so they cost a click instead of a screenful. Expanded, a column shows **two** values, from the example row down, each with its Excel row number and the example row's in stronger type. Above the list: the filename, the werkblad picker when there are several, the **Voorbeeld** row picker (which row the values *and* the JSON body are read from), a search over column names, and an **Alleen ongekoppeld (n)** toggle — the worklist, in one press. The skipped instruction row is skipped here too (`DEFAULT_SKIP_ROWS`), so what is on screen is what the tool would import.
  - **Before a file** the pane is one dashed `rounded-card` filling it (*Sleep het Excel-sjabloon hierheen*), deliberately **not** the shared `Dropzone` — that one is the module page's and is sized to fill it (`min-h-72`); here the file is one input to a page about a connector.
  - **The row is the handle *and* a button.** Dragging it carries the column (a `GripVertical` says so); clicking it picks the column, and every unmapped field then shows a **Koppel {kolom}** pill to press. Native drag-and-drop has no keyboard, and a 78-column mapping is exactly the work someone does from the keyboard — so the click path is not a fallback bolted on, it is the same gesture in two steps. A picked column is white-on-orange, a mapped one sits on `bg-primary/5`.
  - **What a field row does with it**: while a column is held, every field wears a dashed primary ring (droppable) and the one under the pointer a solid one with an orange tint. During a **drag** that is all — the pointer is busy and a button under it would be in the way; the *Koppel* pill only appears for a **picked** column. A mapped field wears a filled orange pill with the column name and an `×` that unmaps it, **in the row's own mapping column** between the label and the type badges: once there is a mapping it is the answer to the label beside it. Dragging onto a **closed object opens it**, so a field two levels down is reachable without dropping the drag first.
  - **A field can also get a value of its own** — the `=` button holding the mapping column of every unfilled row opens a small editor under it, and what it saves is a constant that goes into the body for every row of the conversion. It is there for the fields that are the same all the way down (a dossieritemtype, a verwerkingscode, a flag AFAS insists on), which are otherwise a column of 3000 identical cells. **One field, one source**: a fixed value and a column exclude each other, and assigning either replaces the other. The pill is **navy with an `=`** where a column's is orange with a link — two different kinds of answer, told apart without reading them; its body reopens the editor and its `×` clears it. The count joins the figures above the tree as a second, navy figure (`3 vast`).
    - **The editor is the field's own type, made hard to break.** The control comes from the metainfo: a `<select>` where AFAS gives a value list, a date picker for a date, digits for a number, a length-capped box for a string — and **two checkboxes, `true` and `false`, for a boolean**, which are exclusive and unset again when the ticked one is unticked. Whatever comes out is still checked by `parseFixedValue()` ([`field-mapping.ts`](../frontend/src/lib/field-mapping.ts)), and everything it refuses is something AFAS states: the type, the length, the number of decimals, `notzero`, and the allowed values — *Maximaal 8 cijfers*, *Mag niet 0 zijn*, *Maximaal 2 decimalen*, *Kies een waarde uit de lijst*. The refusal appears under the box, in red, and nothing is stored until it passes: the point of checking here is that the person who typed it is still looking. A date is stored the way AFAS reads one (`2026-08-12T00:00:00`) and shown back in the picker as the day alone.
  - The two counts join the figures above the tree (`12 gekoppeld` in orange, `3 vast` in navy) and **Alles leegmaken** clears both for that connector; mappings are kept **per connector**, so comparing two connectors doesn't throw the work away.
  - **The JSON tab becomes real.** With a mapping, the mapped fields carry the actual values of the example row — clicking any row of the preview makes it the example (orange tint, its Excel row number named in the line above the block) — converted per the field's `dataType`, so an `int` field gets `1234` and not `"1234"`. A value that doesn't parse as its type stays the text it was: a finding to see, not a `0` that hides it. Everything unmapped keeps its placeholder, so the shape stays whole.
  - **Alleen gevuld** (on by default, next to the copy button, and only there once something is filled) narrows the body to the fields that actually have a source — a column or a fixed value — **keeping the objects they live in** — a field two levels down keeps its parents, which then carry an empty `"Fields": {}`. That is the body as it is being built, instead of 651 empty fields with three real values somewhere among them. It filters the **payload only**: the tree beside it is how you find the next field to map, and a tree that hid everything unmapped would hide exactly what you are looking for. The narrowing is `keepField` on the same `filterSchema()` the search uses, so all three filters (zoeken, verplicht, gekoppeld) compose.
  - **Every filled line names where it came from**, in orange after the value (`"SbId": 10056   ← Debiteur Nummer`, or `← vaste waarde`), because a value on its own doesn't say whether it landed in the field you meant — `10056` is right for four different fields. Toggled with **Kolomnamen** (on by default, same rule). The arrow and its text are **not in the JSON**: a body with a comment in it is not a body AFAS takes, so **Kopieer JSON** hands over exactly the text to the left of the arrows. That is why the payload is written line by line (`payloadLines()` in [`afas-schema.ts`](../frontend/src/lib/afas-schema.ts)) instead of through `JSON.stringify` — a line has to be able to carry the note. Keys and values still go through `JSON.stringify` and the output is byte-identical to what `JSON.stringify(…, null, 2)` would have produced; the object form parses back from those same lines, so the two can't drift.
  - **Nothing is stored.** The mapping lives while the page is open, and the Koppeling tab says so under the JSON. Where it belongs — a file per module, beside the rule sets — is in [todo.md](todo.md#upload-to-afas).
- **Payloads** — [`uploader/ModulePayloadPanel`](../frontend/src/components/uploader/ModulePayloadPanel.tsx), the module page at `?view=payloads` (admin-only, via the `AdminOnly`-wrapped switch in [`SheetToolbar`](../frontend/src/components/uploader/SheetToolbar.tsx)): every body this sheet would send to AFAS, one per record, and the place they are actually sent from. It **replaces** the grid rather than sitting beside it — both are readings of the same sheet, and a page showing two at once has room for neither.
  - **Two panes**: a `w-72` white record list on the left (one two-line row per body, in sheet order, separated by faint `divide-y divide-zinc-100` rules: the number and the full-width identifier on the first line, the variant's badge, status badges and the Excel rows behind it on the second — on one line the identifier was squeezed to a few characters), and the body itself beside it. A list rather than a stepper, because the question is *does every row come out right*, which means scanning them.
  - **Which records go is a column of tick boxes, defaulting to all.** A payload view whose send button meant "everything" would be a view you have to trust rather than one you can use — the point of seeing the bodies is to be able to leave one out. **Alles selecteren** sits in the list's own header row, aligned with the boxes under it so it reads as the column's switch rather than one more toolbar button; it goes **indeterminate** on a partial selection, and from partial it selects everything (the common press is *give me back the three I unticked*), clearing only from all-selected. The state is held as the set of **excluded** ordinals, so a rebuilt set — an edited cell, a changed phase — comes back all-selected by construction instead of by an effect that has to notice the rebuild.
  - **The tick box and the row are two controls in one row.** *Which records go* and *what does this one look like* are asked at the same moment and would otherwise fight over one click: the box selects, the rest of the row opens the body on the right.
  - **Omgeving is a segmented switch, and Live is the app's one red control.** Two options, both worth reading without opening anything, and which one is armed is the most important fact on the screen — so not a dropdown. It defaults to **Test** and is never inherited from anywhere: live has to be picked, here, in view of the record count it applies to. Live wears `bg-red-600` where every other active state in the app is orange, and the send button and its confirm dialog follow it red — orange is the colour of *active* throughout the app and cannot also mean *irreversible*.
  - **The send and delete buttons are an icon and a count** (`Send` / `Trash2` and the number of records the press acts on). The phase and the environment are in the tooltip and the accessible name (`Verstuur 248 · stap 2 naar test`), and on the switches right beside them. It opens [`SendPayloadsDialog`](../frontend/src/components/uploader/SendPayloadsDialog.tsx) — a `max-w-md` `Modal` with `ModalWarningHeader` stating the three things that decide whether this is the send that was meant (how many records, which module, which environment), plus a red band on live saying that AFAS cannot undo an insert. It asks for **test too**: *how many records am I about to insert* is worth a look either way, and a flow that sometimes asks teaches people to click through the times it does.
  - **Only the filled fields, always.** The body is built in the `mapped` scope, which leaves out every field the mapping does not fill. The whole connector shape has no switch here: it carries typed placeholders in the unmapped fields, and sending it would write them into AFAS as data. The connector explorer still offers *Alleen gevuld* for looking at the whole shape.
  - **What came back is said three times, at three scales**: two numbers and the environment in a `GreenNotice` / `AmberNotice` above the panes, AFAS's own words per refused record under it (a rejection nearly always names a field, and paraphrasing loses the only thing that fixes it — the first five, then *en nog n…*), and a `Check` or `X` on the record's own row. The row carries the verdict but not the reason: a `w-72` row has no space for one, and the reason is already directly above.
  - **The body sent is the body shown.** `payloadBody()` ([`payload-send.ts`](../frontend/src/lib/payload-send.ts)) parses back the very lines the panel renders — the text left of the orange column notes — so nothing is added or dropped between looking and sending. Rebuilding it server-side would be a second implementation of the mapping, and the one on screen would no longer be the one that was sent.
  - **Voortgang naar AFAS sturen sits beside Koppeling openen** in the body pane's header — admin-only (`ToolbarButton adminOnly`, `CloudUpload`, `Loader2` while it goes). It stamps the module's deeltaak with **how much of the sheet the armed environment holds**, without sending a record: of the rows the records cover, the share whose records are all *Bestaat al* (`Voortgang`) and the rest as still to send (`Fouten`) — the count a send stamps when its run ends, so the two can't disagree. Here and not in **Instellingen** (until 20-10-2026) because this is where that count is on screen. The tooltip carries the figure it will send (*… · 120 van 288 rijen in test*), and the result lands in the notice carousel like a send's. **Disabled, with the reason in the tooltip**, while the count can't be trusted: no existence lookup for this module, no credentials for this stage, the read still going or failed, or a run in progress (it stamps its own figure when it ends). Never on a custom module, which only adds fields to the parent's records.
  - **The send is a background run, and the screen says so** — [`SendProgress`](../frontend/src/components/uploader/SendProgress.tsx), a strip under the toolbar that started it. A send is one sequential AFAS call per record, so a few hundred records is minutes; the old spinner over that said only *something is happening*, which is the one thing the presser already knew. The strip says the three things they can't otherwise tell: how far along it is (`128 van 265 verstuurd naar test`), whether AFAS has started refusing (the count in red, the moment it happens rather than saved for the end), and — in words, because it is the point — *Je kunt ondertussen doorwerken*. The meter is §14's stacked one, emerald over red, with the widths taken as shares of **`total`** rather than of what has answered: scaled to the answers it would sit at 100% from the first record and only change colour, which is a progress bar that never progresses. It carries `aria-hidden` and `role="status"`/`aria-live="polite"` sits on the strip, so the numbers are announced once and calmly instead of the meter being read by colour.
    - **The run outlives the panel.** State lives in [`SendRunProvider`](../frontend/src/components/SendRunProvider.tsx), above the module route, because the payload panel unmounts on a tab switch and that is exactly what this change exists to allow. A reopened module or a reloaded page asks the backend for the run it left behind, so the screen never offers an idle send button over records being written at that moment.
    - **And its end reaches you elsewhere — the app's one toast.** [`RunWatchProvider`](../frontend/src/components/RunWatchProvider.tsx) sits in the root layout, above every project, and puts a card bottom-right (`fixed right-4 bottom-4 z-50 w-96`, `rounded-card border border-zinc-200 bg-white shadow-lg`) when a send or delete run stops running: a title (*Versturen klaar*, *… met weigeringen*, *… gestopt*, *… mislukt*), the panel's own sentence (*17 records aangemaakt in …*), and `projectnummer · project · module` under it in `text-xs text-zinc-500`, because by then you may well be in another project. The icon and its colour follow `SendProgress`'s. A clean run dismisses itself after 10s with `role="status"`; refusals, a stop or an error stay up until closed, with `role="alert"`. It is not shown on the run's own module page, where the panel's notice already says the same thing, and it has **no link**: it renders outside the `NavigationGuardProvider`, and a link there would bypass the guard protecting an open sheet. Everywhere else the rule still holds: an outcome is reported where its action was pressed, not in a toast.
    - **Three icons, three outcomes, and a partial success is not a failure.** Emerald `CheckCircle2` when everything landed, red `X` only when the **run itself** stopped, and amber `AlertTriangle` when AFAS refused part of it — 240 of 265 records really did go in, and a red cross over that reads as a send that failed. The per-record reasons stay in the notice carousel above the list, which is where a finished run already reports them; this strip is the glance, and it holds after the run ends (with a dismiss) because *did that go through* is asked after the fact more often than during.
    - **While a run is going, the send button becomes *Stop verzending*** — the `DANGER` outline (`border-red-200 bg-white text-red-600 hover:bg-red-50`) with a `Square` icon, in the same place: a second send is the one thing that press must not do (the backend refuses it with a 409 anyway), and stopping is what somebody watching a run of refusals wants. No confirm, since a stop only ever writes less. It stops **after the record in flight** (a cancel mid-call would lose the answer to a call AFAS may already have executed), so it reads *Stoppen…* with a spinner until the loop notices, and the strip then says *Gestopt na n van m*. The phase toggle stays disabled for the run's length (switching rebuilds every payload, which would put the other step's bodies under the marks of records being written now).
    - **Verwijder n uit test/live sits beside the send button, never in its place** — the `DANGER` outline with `Trash2`, shown only on a module whose existing records can be deleted (today Voorcalculatie) and counting the ticked records marked *Bestaat al*. Outlined rather than filled red because it is the rarer press and must not be the eye's first stop. It opens [`DeleteRecordsDialog`](../frontend/src/components/uploader/DeleteRecordsDialog.tsx): the send dialog's shape and its shared [`EnvironmentTarget`](../frontend/src/components/uploader/EnvironmentTarget.tsx) block, but it **lists** every record (key in mono, the AFAS name beside it, the rows) in a `max-h-48` scrolling list, since after a delete there is nothing left to look at. On live the danger-toned confirm stays disabled until the count is typed — a second, deliberate act where a habitual click would remove customer data; test keeps the plain confirm. The run then reports through the same progress strip, worded *verwijderd uit* instead of *verstuurd naar*.
    - **Alleen nieuwe sits in the records rail's header, and starts on.** It decides what the list *is*: on, the records marked *Bestaat al* leave the list, and with it the send, and the toolbar says how many it hid (`n bestaande verborgen`). In the payload view the toolbar's metrics row carries the record counts **in place of** the validation's *100% / velden met fouten*: the payloads ticked, how many are already in AFAS or hidden, and how many errors keep out (`onMetrics` on `ModulePayloadPanel`). It leads with the share of rows already in AFAS, the same `coverage` figure *Voortgang naar AFAS sturen* stamps. The error-stepping buttons aren't shown there, since there is no grid to step through, so the figures span the full row. The rail keeps only its label and switches. It is 288px wide, too narrow for those counts with the environment named, and the counts are this view's headline. Because hidden records aren't selected, *Verwijder* counts 0 until the toggle is off. Off means the existing records are *updated* (PUT) — the half of the choice that changes what is already in AFAS — so that is the one a person switches to, not the one they find armed.
    - **Every refusal is reachable, grouped by what AFAS said.** The refusals notice above the list groups refused records by AFAS's exact message (`groupRefusals()` in [`payload-send.ts`](../frontend/src/lib/payload-send.ts)), with the largest group first. Each group shows the message once, then one line per record: *Rij 5. Organisatie 101 [Opgestuurd 101]*. The bracket is the value the body sent for the field AFAS names, because AFAS names the field but never the value. The notice shows the first five rows; *Alle N weigeringen tonen* opens the rest in a `max-h-64` scrolling list inside the same band. A refused row's red `X` carries the same sentence as its `title`. The body pane shows **no** refusal strip: the notice already says it, and the body is there to be read. Once the run has settled, the strip's quiet **Rapport** button (`FileDown`) and a link in the notice download the **verzendrapport** ([`send-report-pdf.ts`](../frontend/src/lib/send-report-pdf.ts)). It uses the same hero, footer and palette as the other two PDFs, then shows the figures and meter, the same groups with each record's full AFAS log reference, and then the accepted records as a table of *Regel* (the sheet row or rows), *Record*, *Connector*, *Actie*, *Tijdstip* (when AFAS answered, `HH:MM:SS`) and the key AFAS assigned. Each refused record carries its attempted action and tijdstip too, in grey beside its log reference. The notice's *Download* also writes the sheet with the refused cells red, and the lookup cell of every *niet verstuurd* record (`missingIssues()`). While that notice is up, a workflow action's two checkboxes (*Aanpassingen nodig* and the rest) attach **those two files** instead of the validation's, worded *Excel met de weigeringen* and *Verzendrapport (PDF)*. After a send it is AFAS's refusals that need fixing, and a validation report would call the sheet clean. Outside the payload view, or with no refusals, they attach the validation's files as before.

## 26. Component conventions

*The mechanics of the shared pieces named below are Part I — overlays §11, notices §9,
buttons §6, inputs §7. This section is which of them this app uses, and for what.*

- This is **Next.js 16** — check `node_modules/next/dist/docs/` before adding routes/components/data-fetching. See [AGENTS.md](../frontend/AGENTS.md).
- Keep parsing/validation out of presentational components — put it in `lib/`.
- Reusable UI in `src/components/`; mark hook/state components `"use client"`.
- **Use the shared scaffolding; don't re-roll it.** Three overlays and panels recur, and each one is a component rather than a block to copy — every one of them had drifted into two character-identical copies before it was extracted:
  - **[`Modal`](../frontend/src/components/Modal.tsx)** — centred dialog: overlay, card, Escape + backdrop dismissal. Width via `className`. `ModalWarningHeader` is the amber round-chip + heading + paragraph the confirm-prompts open with (*Wisselen van module?*, *Niet-opgeslagen wijzigingen*, *Naar {module}?* with the sheet unsaved), and `ModalConfirmHeader` is that same block with a green `Check` — the confirm where nothing is at stake, currently only *Naar {module}?* once the sheet is saved. Same layout either way, so the chip is the whole of the difference. `ModalSearch` is the full-width search field of a dialog that is a list to pick from — magnifier, autofocus, a clear button once something is typed — shared by the two pickers so the field can't be one size in one and another in the other. `AfasListPicker` keeps its own copy on purpose: same markup, but its input is a `combobox` driving a `listbox` with ↑/↓ and Enter.
  - **[`Drawer`](../frontend/src/components/Drawer.tsx)** — right slide-over: overlay, `bg-navy/20` backdrop, the slide-in transition, Escape + backdrop dismissal, plus `DrawerCloseButton`. **Mount it only while open** — the slide-in is driven by a flag flipped one frame after mount, so a drawer left mounted while closed animates once and never again. Pass `onEscape` when the drawer peels off a layer of its own first (the help drawer clears an active search before it closes). `width` is `max-w-md` for reference content, `max-w-lg` where grouped lists need the room. `modal={false}` drops the backdrop and leaves the page clickable, for a panel that follows a pick on the page (the admin's appointments beside the `/book-demo` calendar); Escape still closes it, an outside click doesn't.
  - **[`uploader/Notices`](../frontend/src/components/uploader/Notices.tsx)** — `AmberNotice` (the tinted strip) and `MissingColumnsNotice`, which renders itself only when there is something missing. Above the table, an admin's copy ends in a link-style **Kolommen herstellen** button (§6) opening `ColumnRepairDialog` — a save dialog (`X` top right, *Toepassen* as the footer's one primary), one row per missing column: the name, two `Checkbox`es (*Toevoegen*, *Negeren*) and a select of the sheet's unclaimed columns, of which at most one answer holds; the report's copy has no button, since it describes the sheet rather than changing it. The latter appears above the table *and* in the report on purpose: it is one finding about one sheet, and the two may never disagree about what was checked.
- **Admin-only UI goes in [`AdminOnly`](../frontend/src/components/AdminOnly.tsx)** — one wrapper for every "admins see this, others don't", at any size: a sidebar row (*Projectinstellingen*, *Bekijk als gebruiker*), a single toolbar button (`adminOnly` on `ToolbarButton`, which wraps itself in it), or a whole page (`fallback` is what non-admins get instead — leave it out for a button, pass it where an empty screen would just confuse). It renders no element of its own, so it drops into a flex row or a `<ul>` without touching the layout. The check itself lives in exactly one place, `AuthProvider` (`isAdmin`, or `useIsAdmin()` when a component needs the boolean and not the gate) — **don't read `session.isAdmin` at a call site**, and don't confuse the rule with gates that merely correlate with it: `ProjectSelector`'s dropdown is about having more than one project, and a non-admin in two projects gets it too. Hiding is cosmetic — anything a non-admin must not *do* is checked again by `_require_admin` in [main.py](../backend/main.py).
- **Counted Dutch nouns come from [`validation/metrics.ts`](../frontend/src/lib/validation/metrics.ts)**, not from the component: `errorCountText()` for *1 fout* / *12 fouten*, `countText()` for anything else. Dutch pluralizes irregularly and three surfaces print these counts (drawer pills, PDF pills and message lines) — four when the toolbar still carried an issue chip, and that was the one getting *1 fouten* wrong. The uninflected words (`Fout:` on an Excel note, `fout` on a PDF message line) are written as literals where they appear; there is no plural rule left in them to get wrong.
- **Interactive elements and the button/input class strings are §6 and §7** — `cursor-pointer`,
  a hover state and `transition-colors` on everything interactive; primary =
  `bg-primary text-white hover:bg-primary-dark`, quiet/outlined tinting orange on hover,
  icon-only toolbar buttons in the outlined style with a hover tooltip, and
  `focus:ring-2 focus:ring-primary/20` on inputs.
