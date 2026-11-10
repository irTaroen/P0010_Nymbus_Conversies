# Design System — portable extract

> A self-contained version of [design-system.md](design-system.md) **Part I**: the CSS, the
> tokens and the class string of every UI element, with everything specific to this app —
> Excel/AFAS, its screens, its Dutch copy — taken out. Copy this file and §2's CSS block into
> another project and every recipe below works, with no import from this repo. Example copy is
> in English placeholders; swap it for your own.
>
> Inside *this* repo, [design-system.md](design-system.md) stays the source of truth.

Stack the recipes assume: **Tailwind v4** (CSS-first config, no `tailwind.config.js`),
**lucide-react** for icons, **Inter** as the only typeface, **light theme only**.

---

## 1. Setup

```bash
npm i tailwindcss @tailwindcss/postcss lucide-react
```

```js
// postcss.config.mjs
const config = { plugins: { "@tailwindcss/postcss": {} } };
export default config;
```

```tsx
// app/layout.tsx (Next.js). Outside Next: link Inter from Google Fonts and set
// --font-inter yourself.
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="h-screen overflow-hidden flex bg-background text-navy">
        {children}
      </body>
    </html>
  );
}
```

Two things there are load-bearing and easy to lose:

- **`antialiased`** on `<html>`. Without it Inter renders heavier and the whole palette looks
  a shade darker than it was picked to be.
- **`h-screen overflow-hidden flex`** on `<body>`. This is an *app shell*: the page never
  scrolls, panes inside it do (§5). Drop it and every `min-h-0 flex-1 overflow-auto` below
  silently stops working. For a document-style site instead, drop it and let the page scroll.

---

## 2. The CSS — copy this whole block

The entire stylesheet. Everything else is Tailwind utilities.

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

/* The one attention animation: a control whose result has gone stale. color-mix
   rather than fixed hex, so re-pointing --color-primary re-tints it. */
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

Tailwind v4 derives utility names from token names: `--color-navy` gives `text-navy`,
`bg-navy`, `border-navy` **and** every opacity step (`bg-navy/20`, `text-body/70`). Same for
`--radius-btn` → `rounded-btn`. Rename a token and you rename its utilities.

| Token                  | Value     | Use                                                              |
| ---------------------- | --------- | ---------------------------------------------------------------- |
| `--color-primary`      | `#f1941f` | The single accent: primary buttons, active state, focus ring, icon chips, highlight band |
| `--color-primary-dark` | `#d97e0c` | Hover/pressed of a filled primary — nothing else                 |
| `--color-navy`         | `#1a1f36` | Headings, primary text, tooltips, system chrome bars              |
| `--color-body`         | `#5b6478` | Body copy, secondary text, quiet icons                           |
| `--color-surface`      | `#f4f5f7` | Subtle fills: input rest state, chips, column bands, hover rows   |
| `--background`         | `#fafafa` | Page ground. Off-white, so white cards read as raised             |
| `--color-status-good`  | `#147b3a` | Badge ink: reads as *good*                                       |
| `--color-status-bad`   | `#ce2323` | Badge ink: reads as *not good*                                   |
| `--color-status-none`  | `#6a6a72` | Badge ink: a value whose meaning you don't know                   |
| `--radius-btn`         | `10px`    | Buttons, inputs, list rows, tinted strips                        |
| `--radius-card`        | `16px`    | Cards, panels, dialogs, dropzones                                |
| `--radius-badge`       | `6px`     | Every badge, tag and chip — see §8                                |

### Greys: use `zinc`, not `slate` or `gray`

Tokens cover text and accent; structure comes from Tailwind's **zinc** ramp, and only these
five rungs are in use. Reaching for a sixth is the usual way this palette starts to look
muddy.

| Class             | Where                                                            |
| ----------------- | ---------------------------------------------------------------- |
| `border-zinc-100` | Hairline *inside* a card — divides its sections                  |
| `border-zinc-200` | The default border: cards, inputs, buttons, dialog dividers      |
| `border-zinc-300` | Dashed dropzone at rest (must read heavier than a card edge)      |
| `bg-zinc-100`     | Hover ground of a bare icon button; neutral count-badge fill      |
| `text-zinc-300`   | A badge drawn as an empty outline — "no" as a visible answer      |
| `text-zinc-400`   | Icons inside inputs, placeholders, section eyebrow labels         |
| `text-zinc-500`   | Text on a `bg-zinc-100` count badge                              |

### Semantic colours beyond the status inks

Status inks are for badges *in a list*, where one luminance keeps a column even. Full notices
and one-off marks use Tailwind's own ramps, at `-50` fill / `-200` border / `-600`–`-800` text:

| Meaning         | Palette   | Notice                                              |
| --------------- | --------- | --------------------------------------------------- |
| Error / blocked | `red`     | `border-red-200 bg-red-50 text-red-600`             |
| Warning / risk  | `amber`   | `border-amber-200 bg-amber-50 text-amber-800`       |
| Success         | `emerald` | `border-emerald-200 bg-emerald-50 text-emerald-800` |
| Informational   | `sky`     | `bg-sky-50 text-sky-700`                            |

---

## 3. Typography

One family (Inter), four weights, and a scale that only moves in these steps.

| Role                    | Classes                                                                     |
| ----------------------- | --------------------------------------------------------------------------- |
| Hero heading            | `text-3xl font-extrabold leading-[1.1] tracking-tight text-navy lg:text-4xl` |
| Hero, full-page (login) | `text-4xl font-extrabold leading-[1.1] tracking-tight text-navy sm:text-5xl` |
| Card / dialog title     | `text-lg font-semibold text-navy`                                           |
| Section title in a card | `text-base font-semibold text-navy`                                         |
| Headline figure         | `text-4xl font-extrabold leading-none tracking-tight text-navy` (drawer) · `text-3xl …` (page) · `text-2xl …` (inline) |
| Body                    | `text-sm text-body` · `text-base leading-snug text-body` for intro copy      |
| Quiet detail            | `text-xs text-body` — one step down: `text-body/80`, `text-body/70`          |
| Eyebrow / section label | `text-xs font-semibold uppercase tracking-wide text-zinc-400`               |
| Column band label       | `text-[11px] font-semibold uppercase tracking-wide text-body`               |
| Badge text              | `text-[11px] font-semibold` · `text-[10px] font-semibold leading-none` for counts |
| Button label            | `text-sm font-semibold` (primary/secondary) · `text-sm font-medium` (quiet rows) |
| Code / field name       | `font-mono text-xs font-semibold text-body`                                 |

Two rules that do more work than they look like they do:

- **`tabular-nums` on any number in a column or updating in place** — row numbers,
  percentages in a list, counts in a footer, timestamps. Without it the digits shift width as
  the value changes and the column visibly jitters.
- **Proportional (i.e. *no* `tabular-nums`) on a standalone headline figure.** At `text-2xl`
  and up, tabular figures look loose and badly spaced.

`leading-none` on big figures, `leading-snug` on stacked small text, default elsewhere.

---

## 4. Depth, borders, motion, focus

**Elevation** — four steps, and they mean things:

| Class        | Where                                                    |
| ------------ | -------------------------------------------------------- |
| `shadow-sm`  | Cards, filled primary buttons, quiet outlined buttons    |
| `shadow-md`  | A dropzone under the cursor; tooltips                    |
| `shadow-lg`  | Popover panel; a cursor-following tooltip                |
| `shadow-xl`  | Centred modal card                                       |
| `shadow-2xl` | Drawer panel (it lifts off a full-height page edge)      |

A **card is a border plus `shadow-sm`**, never one or the other:
`rounded-card border border-zinc-200 bg-white shadow-sm`. Inside it, sections divide with
`border-t border-zinc-100` — a full-strength `zinc-200` line inside a `zinc-200` box reads as
two boxes.

**Motion** is `transition-colors` almost everywhere, and nothing is slower than 200ms:

- `transition-colors` — every interactive element; the default duration is right.
- `transition-all` — only the dropzone, which changes border *and* shadow together.
- `transition-opacity duration-150` — tooltip fade-in.
- `transition-opacity duration-200` / `transition-transform duration-200 ease-out` — drawer
  backdrop and panel.
- `animate-spin` on `Loader2` — the only spinner.
- `animate-pulse` on the brand mark — the only full-screen loading state.
- `.toolbar-btn-pulse` — the only attention-seeking animation, reserved for *your last
  action's result is now out of date*. Don't spend it on anything else.

**Focus.** One ring in the whole app:
`focus:border-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20`
on inputs, and `focus:ring-1 focus:ring-inset focus:ring-primary/50` on a cell editor inside
a table. Never `focus:outline-none` on its own.

---

## 5. App shell

Fixed viewport, no page scroll; every pane scrolls itself. Three nested rules make it work:

1. `<body>` is `h-screen overflow-hidden flex`.
2. Each level down is a flex container with `min-h-0` (or `min-w-0`) on the child that should
   be allowed to shrink. **`min-h-0` is the one everybody forgets** — a flex child defaults to
   `min-height: auto`, so without it an inner `overflow-auto` grows the page instead of
   scrolling.
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

**Sidebar widths:** `w-68` expanded, `w-16` collapsed to an icon rail. Nothing on the rail may
*require* expanding the sidebar to be usable — which is why pickers are centred dialogs rather
than popovers hanging off a `w-68` rail.

**Content widths:** `max-w-3xl` prose and forms · `max-w-5xl` a wide table card · `max-w-md` a
centred single-purpose card (login, error) · `max-w-6xl` a two-grid dialog. Blocks on the same
screen share an edge *unless* one is a table — a readable column beats a shared margin.

**Vertical rhythm:** `px-6 py-5` inside a dialog or card header · `px-5 py-4` a denser card ·
`px-3 py-2` a list row · `gap-2`/`gap-3` between controls · `mb-8` under a hero.

---

## 6. Buttons

Four tones. Every one carries `cursor-pointer`, a hover state and `transition-colors` — an
interactive element without all three reads as text.

```tsx
const BASE =
  "inline-flex cursor-pointer items-center justify-center gap-2 rounded-btn px-4 py-2 " +
  "text-sm font-semibold transition-colors " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const PRIMARY   = "bg-primary text-white shadow-sm hover:bg-primary-dark";
const SECONDARY = "border border-zinc-200 bg-white text-navy hover:bg-surface";
const DANGER    = "border border-red-200 bg-white text-red-600 hover:bg-red-50";
```

**Quiet outlined** — the workhorse beside a primary. Same outline as `SECONDARY`, but it tints
*orange* on hover instead of grey, which is what marks it as an action rather than a dismissal:

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

Note `disabled:cursor-wait` rather than `not-allowed`: that button disables *while its work
runs*, and the cursor should say "wait", not "never".

**Bare icon button** — a close `×`, a clear `×` in a field. No border; the hover ground is the
affordance:

```
inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full
text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-navy
```

**Outlined icon button** — a drawer's close, at `h-9 w-9`:

```
inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-btn
border border-zinc-200 text-body transition-colors
hover:border-primary/70 hover:bg-primary/5 hover:text-primary
```

**Link-style button** inside body text:
`cursor-pointer font-medium text-primary underline-offset-2 hover:underline`.

Icons inside buttons: `h-4 w-4 shrink-0` with `strokeWidth={1.8}`.

### Toolbar button (icon-only, with tooltip)

The densest control: a square button in a row of them, its label carried by a tooltip on hover
and by `aria-label` always. Split into state constants so a hand-rolled trigger (a menu's, say)
can't style its states differently.

```tsx
export const TOOLBAR_BTN =
  "group relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-btn " +
  "border text-sm font-semibold shadow-sm transition-colors";

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
  "shadow-md transition-opacity duration-150 group-hover:opacity-100";
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
      {/* `trailing` anchors the tooltip to the button's right edge — for buttons at a
          card's right edge, where a centred one would hang out. */}
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

**Search field** — leading magnifier, and a clear button that appears once something is typed
(`pr-10` reserves its room from the start, so the text doesn't reflow when it appears).
Autofocus is right here: opening the dialog is how you got here, and typing is what's next.

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
      type="button" onClick={() => onChange("")} aria-label="Clear search"
      className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-navy"
    >
      <X className="h-3.5 w-3.5" strokeWidth={2} />
    </button>
  )}
</label>
```

A search field brings **no spacing of its own** — the caller places it (`px-6 pb-4`, with or
without a divider under it). Same rule for notices (§9): styling here, margin at the call site.

---

## 8. Badges

### The soft-tinted badge — the whole family

**Every badge is drawn this one way, and each status colour is an *ink*, not a fill.** One hue
makes the whole badge at three strengths: `/10` ground, `/30` hairline, full-strength letters.

```
inline-flex max-w-full items-center rounded-badge border px-2 py-0.5
text-[11px] font-semibold
   border-status-good/30 bg-status-good/10 text-status-good   /* good     */
   border-status-bad/30  bg-status-bad/10  text-status-bad    /* not good */
   border-status-none/30 bg-status-none/10 text-status-none   /* unknown  */
   border-primary/30     bg-primary/10     text-primary       /* "this one" / yes */
```

Why it's built this way, and what breaks if you change it:

- **Letters are the hue, never white.** A badge whose fill is dark enough to carry white text
  is a badge that shouts, and a list where twenty of them shout is a list nobody reads.
  Tinted, it reads as one material rather than as a coloured box with something in it.
- **One luminance across the family.** Picking each colour on its own is what gives a neon
  green, a mid red and a brand-orange amber in one column: three badges shouting at three
  volumes, one close enough to the accent to read as a highlight rather than a warning.
- **One radius** (`rounded-badge`) for all of them, verdicts included. What tells a verdict at
  the end of a row from a fact in the middle of it is its ink, its size and its place — not a
  second silhouette. Capsule pills beside rounded-slot tags read as two components that happen
  to share a colour scheme.
- **Reach for `--color-status-none` whenever the value came out of a free-text field.** Grey is
  how this design prints a status *without claiming to know what it means*.
- **Solid orange stays reserved** for "this is the one you have open". Spend it on a routine
  yes/no in every row and it stops meaning anything.

Two more shapes in the same family:

```tsx
// Category tag: accent tint for yes, an empty outline for no. Draw BOTH states —
// "no" is worth as much as "yes" here, and a gap reads as a cell that failed to load.
<span role="img" aria-label={`${name}: ${on ? "yes" : "no"}`}
  className={`inline-flex flex-1 items-center justify-center rounded-badge border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
    on ? "border-primary/30 bg-primary/10 text-primary" : "border-zinc-200 text-zinc-300"
  }`}>
  {name}
</span>
```

`role="img"` rather than a disabled checkbox: it reports a fact, it isn't a control, and a
greyed-out checkbox reads as a switch someone turned off.

```tsx
// Warning flag inside a row's quiet metadata line — a size down from a verdict pill.
<span className="inline-flex items-center gap-1 rounded-badge border border-status-bad/30 bg-status-bad/10 px-1.5 py-0.5 text-[10px] font-semibold text-status-bad">
  <AlertTriangle className="h-3 w-3 shrink-0" strokeWidth={2} />
  Missing record
</span>
```

### Counts, measures and headings — the same family

**Every pill is that badge, not only the ones in a row.** Counts, measures, verdicts, category
tags, flags, field chips, environment headings in a settings dialog. A mix of capsules and
rounded slots is the same mistake one level up: a reader meets two silhouettes and has to work
out whether they mean two kinds of thing. They don't.

`rounded-full` is left to the three things that are **not** pills:

- a **status dot** (`h-1.5 w-1.5` — below),
- a **meter** and its segments (§16),
- a **circular icon slot** — an avatar, a modal's icon chip, a close button (§14, §6, §11).

Those are round because of what they *are*, not because of a family they belong to. And a chip
the user can **click** is still a badge: `rounded-btn` belongs to controls with a real hit area
— `h-8`, `h-9`, a form control — not to a `py-0.5` label with an `onClick`.

What varies inside the family is the **ink**, never the shape. The status inks are for a
*verdict*; a **measure** keeps its own green and amber, because it reports a quantity rather
than a judgement, and amber left the ink family on purpose.

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
// first measurement, because a rail of 0% pills reads as failure rather than "not started".
<span className={`shrink-0 rounded-badge border px-1.5 py-0.5 text-[10px] font-semibold leading-none tabular-nums ${
  complete ? "border-green-200 bg-green-50 text-green-700" : "border-amber-200 bg-amber-50 text-amber-700"
}`}>
  {pct}%
  <span className="sr-only"> complete at the last check</span>
</span>

// A count that is a verdict — an error total at the end of a row — is the status ink,
// not a red of its own.
<span className="shrink-0 rounded-badge border border-status-bad/30 bg-status-bad/10 px-2 py-0.5 text-[11px] font-semibold text-status-bad">{n}</span>

// Loud section heading badge — for the one distinction a form must not get wrong.
// Bigger padding and uppercase, same silhouette as every badge above it.
<h3 className="inline-flex items-center rounded-badge border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-emerald-700">Test environment</h3>
<h3 className="inline-flex items-center rounded-badge border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-sky-700">Live environment</h3>
```

### Status dot

A dot, not a second pill, when the row is primarily navigation and a badge would push the
label out of a narrow rail. `h-1.5 w-1.5` in a list, `h-2 w-2` in a legend.

```tsx
const TONE_FILL = {
  none:    "bg-zinc-300",
  bad:     "bg-red-500",
  partial: "bg-amber-500",
  good:    "bg-emerald-500",
};

<span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE_FILL[tone]}`} />
```

**Keep one tone→fill map in one module and import it everywhere.** The moment two surfaces
each hold their own copy, the same record shows green in one place and amber in the other. And
a dot never says it alone: the wording leads the row's `title`, with an `sr-only` tail spelling
it out.

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

`mt-0.5` on the icon and `shrink-0` matter: they optically align the glyph with the first line
of wrapped text instead of centring it against the whole block.

`role="alert"` for errors, `role="status"` for confirmations — so a screen reader announces the
thing that just went wrong without the user going looking for it.

**System banner** — full-width chrome above *everything*, sidebar included, for a mode the user
must not overlook. Navy, so it reads as chrome and doesn't compete with the accent:

```tsx
<div className="flex shrink-0 items-center gap-3 bg-navy px-4 py-2 text-xs text-white">
  <Eye className="h-4 w-4 shrink-0" strokeWidth={2} />
  <p className="min-w-0 flex-1 truncate">
    You are viewing as <span className="font-semibold">{name}</span>{" "}
    <span className="text-white/60">({email})</span>
  </p>
  <button className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-btn border border-white/25 px-2.5 py-1 font-medium transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50">
    <Undo2 className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
    Back
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

**Centred single-purpose card** — an error, an empty state, a not-found. Always a heading, a
sentence and one way onward; never an empty shell, which reads as a broken app:

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

Four of these recur, and each should be **one component, not a block you copy** — every one of
them had drifted into two near-identical copies before it was extracted.

### Modal — centred dialog

Backdrop `bg-black/40`. Dismisses on Escape and on a backdrop click; the card stops propagation
so a click inside it doesn't close it. Width comes in through `className` (`max-w-sm` …
`max-w-6xl`); the card already owns rounding, ground and shadow.

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
         onClick={onDismiss}>
      <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}
           className={`w-full rounded-card bg-white shadow-xl ${className}`}>
        {children}
      </div>
    </div>
  );
}
```

**Prompt header** — a round icon chip beside a heading and one paragraph. The two variants
differ in *nothing but the chip*, so a question lays out the same way whether or not there is
anything at stake in it:

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

Use the green one rather than dropping the chip: the amber triangle would claim a risk that
isn't there, and no chip at all leaves the reassurance to be read out of a sentence.

**Footer** — `flex items-center justify-between gap-4 border-t border-zinc-200 px-6 py-4`, with
the primary action last. A dialog that's only a list to close gets a quieter button than a real
secondary — it isn't the alternative to anything:

```
cursor-pointer rounded-btn border border-zinc-200 bg-white px-4 py-2 text-sm
font-semibold text-navy transition-colors hover:border-primary hover:text-primary
```

**Undismissable variant:** make `onClose` optional and pass nothing. No close button, no footer
button, Escape ignored — for a dialog that *is* the page, with nothing behind it to dismiss to.

### Drawer — right slide-over

Backdrop `bg-navy/20` (softer than the modal's — the page behind stays legible, which is the
point of a side panel). **Mount it only while open:** the slide-in is driven by a flag flipped
one frame after mount, so a drawer left mounted while closed animates once and never again.

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

`max-w-md` for reference content, `max-w-lg` where grouped lists need the room. Pass `onEscape`
when the drawer should peel off a layer of its own state (an active search) before it closes.
Inside: a `shrink-0` header with `border-b border-zinc-200`, then
`min-h-0 flex-1 overflow-y-auto px-6 py-5`.

### Popover — dropdown beside its trigger

`pointerdown` rather than `click` for the outside-dismiss: it fires before focus moves, so the
panel is already closing when the next control takes over. Listeners attach only while open, so
a closed popover costs nothing.

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

`z-10` sticky table first column · `z-20` sticky table header · `z-30` a toolbar a dropdown
hangs off · `z-50` overlays, popovers, tooltips. Four values; don't invent a fifth.

---

## 12. Tabs and segmented switches

**Segmented switch** — 2–4 mutually exclusive options. A `p-0.5` track holding `h-8` buttons,
the active one filled orange. `rounded-[7px]` inside `rounded-btn` (10px) is deliberate: it's
the inner radius that keeps a 2px track looking concentric.

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

**Chip tabs** — for jumping between sections of a scrolling panel, where a filled track would
be too loud. `rounded-badge`, not a capsule: a chip you can click is still a badge (§8), and
`rounded-btn` is for controls with a real hit area:

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

`min-w-0 flex-1 truncate` on the label and `shrink-0` on everything else is what stops a long
name pushing the badge out of the rail. Nested lists get `pl-4`, rows `space-y-0.5`.

**Footer rows** (settings, sign-out) are quieter — no dot, no badge, and destructive ones tint
red on hover only:

```
flex w-full cursor-pointer items-center gap-2 rounded-btn px-3 py-2 text-sm font-medium
text-body transition-colors hover:bg-surface hover:text-navy
/* destructive: */ hover:bg-red-50 hover:text-red-600
```

**Brand mark** — an icon chip plus a wordmark, both tinting on hover via `group`:

```tsx
<a href="/" className="group flex min-w-0 flex-1 cursor-pointer items-center gap-2">
  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-white shadow-sm transition-colors group-hover:bg-primary-dark">
    <Boxes className="h-5 w-5" strokeWidth={2} />
  </span>
  <span className="min-w-0 flex-1 truncate text-lg font-bold tracking-tight text-navy transition-colors group-hover:text-primary">
    App name
  </span>
</a>
```

---

## 14. Avatars and entity tiles

**A circle is a person; a rounded square is a thing.** Hold that distinction and a mixed list
reads without labels.

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

**Entity tile** — an identifier eyebrow over the name, the name being the line that truncates.
The code goes *beside* the word, `tabular-nums`, because it's what someone pastes into chat:

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

With only one option to pick from, render the same tile **inert, without the chevron** — rather
than a disabled button or a dropdown that opens onto a list of one.

---

## 15. Data table

Orange sticky header, sticky first column, hairline rows, and a `p-0` cell wrapping a
borderless input where cells are editable.

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

- **Column dividers are a `w-px bg-white/30` pseudo-element at half height**, not a border. A
  border on an orange header reads as a grid; a short hairline reads as a separator.
- **The row-number column repeats its own background.** `position: sticky` doesn't inherit a
  ground — without `bg-white` on the cell (and `bg-primary` on the header cell), rows scroll
  visibly underneath it.
- **`border-t border-zinc-100` on rows**, never `divide-y` — the top row keeps its edge against
  the sticky header.
- **`overflow-hidden p-0` on an editable cell**, with the padding on the input inside, so the
  focus ring hugs the cell instead of floating inside it.
- **`caret-primary`** on the editor. Small, and the only place the accent appears in the grid.

**Corner marks** — a 7px triangle in a cell corner, for state that mustn't cost a whole column.
Built from borders, so it needs no SVG:

```tsx
{/* top-left: changed */}
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
template**, and the right-hand columns must be **fixed widths, not `auto`** — each row is its
own grid container, so an `auto` column sizes to that row's content and the columns stagger
down the list. If the template is computed, pass it as an inline `style`: Tailwind reads class
names out of source text and won't generate a `grid-cols-[…]` you build at runtime.

```tsx
const ROW_GRID = "grid items-center gap-3";

<div className={`${ROW_GRID} bg-surface px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-body`}
     style={{ gridTemplateColumns: template }}>…</div>
```

Long scroll lists get a **fade at the bottom edge** — a list whose last visible row is sliced
through the middle reads as a layout that ran out of room rather than one there is more of. And
take the height off the **viewport** (`max-h-[min(24rem,42vh)]`), not a fixed `rem`, or the
footer below it goes under the fold on a laptop.

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

**Inline metric** — the same three strings laid out sideways, where there's no room to stack:

```tsx
<div className="flex min-w-0 items-center gap-2.5">
  <span className="shrink-0 text-2xl font-extrabold leading-none tracking-tight text-navy">{figure}</span>
  <span className="min-w-0">
    <span className="block text-sm leading-snug text-body">{caption}</span>
    <span className="block truncate text-xs leading-snug tabular-nums text-body/80">{detail}</span>
  </span>
</div>
```

Render both from **one component**. Two surfaces printing the same figure their own way is how
a percentage ends up rounded differently in two places.

**Segmented meter + legend.** `gap-[2px]` between segments over a `bg-surface` track, each
segment `rounded-full` so a single-segment bar still reads as a rounded track. Widths are
inline percentages; the fills come from the same tone map as the dots (§8) — status colours,
not series colours.

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

**Dropzone.** `flex-1` with a `min-h-72` floor, so it takes every pixel the page leaves rather
than sitting as a fixed strip with dead space under it. A big drop target is worth more than a
row of buttons that can't act yet.

```tsx
<div role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onOpen(); }}
  className={`group flex h-full min-h-72 w-full flex-1 cursor-pointer flex-col items-center justify-center gap-3 rounded-card border-2 border-dashed px-8 py-12 text-center shadow-sm transition-all ${
    dragging ? "border-primary bg-primary/5" : "border-zinc-300 bg-white hover:border-primary/70 hover:shadow-md"
  }`}>
  <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
    <Upload className="h-8 w-8" strokeWidth={1.5} />
  </span>
  <p className="text-xl font-semibold text-navy">Pick a file</p>
  <p className="text-sm text-body">{acceptedExtensions}</p>
  <span className="mt-3 inline-flex items-center gap-2 rounded-btn bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors group-hover:bg-primary-dark">
    Choose file
  </span>
  <p className="mt-2 text-xs text-body/70">or drag one here</p>
</div>
```

The inner "button" is a `<span>`, not a nested `<button>` — the whole card is already the
control, and a real button inside it is invalid and unreachable by keyboard in the way you'd
expect.

---

## 17. Hero

Heading and copy **side by side, not stacked**. Stacked, they cost the better part of a screen
and push the thing the page is actually for under the fold.

```tsx
<section className="mx-auto mb-8 grid w-full max-w-3xl shrink-0 items-center gap-x-8 gap-y-4 lg:grid-cols-2">
  <h1 className="text-3xl font-extrabold leading-[1.1] tracking-tight text-navy lg:text-4xl">
    Everything in
    <br />
    <span className="highlight-band">one</span> place
  </h1>
  <div className="min-w-0">{intro}</div>
</section>
```

- **One word in the band, never a phrase.** The band is the accent's loudest use.
- **The width belongs to the component**, not the call site: the line break is hand-placed, so
  the column has to hold the line placed for it.
- **Two columns from `lg`, not `sm`.** A sidebar takes its width out of the viewport first, and
  half of a tablet's remainder won't hold a `text-4xl` phrase. Under `lg` they stack, heading
  first.

---

## 18. Loading and empty states

```tsx
// Inline: Loader2, the only spinner
<Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />

// Whole screen: the brand mark, pulsing
<main className="flex min-h-screen flex-1 items-center justify-center px-4 py-10">
  <span className="flex h-12 w-12 animate-pulse items-center justify-center rounded-xl bg-primary text-white shadow-sm">
    <Boxes className="h-6 w-6" strokeWidth={2} />
  </span>
</main>

// A list that has nothing in it, is loading, or failed — one line, in place
<p className="px-3 py-2 text-xs text-body">
  {status === "loading" ? "Loading…" : status === "error" ? "Could not be loaded." : "Nothing found."}
</p>
```

Three rules worth stating outright:

- **An empty slot says so in place**, rather than collapsing. A section that comes and goes
  makes the layout jump and reads as a bug.
- **Loading, empty and failed are three different sentences.** One shared "No results" for all
  three hides an outage.
- **A failure gets a retry** where the content would be (`RotateCw` + *Try again*). Closing and
  reopening should never be the only way.

---

## 19. Icons

**[lucide-react](https://lucide.dev), always.** Import the named component and size with
Tailwind. No raw inline `<svg>` — a hand-pasted path is how the same upload arrow ends up in a
codebase three times over. Where lucide has one direction, **rotate rather than duplicate**
(`ChevronLeft` + `rotate-180`).

| Size          | Where                               |
| ------------- | ----------------------------------- |
| `h-3 w-3`     | Inside a small badge                |
| `h-3.5 w-3.5` | Chevrons, a clear `×`               |
| `h-4 w-4`     | The default: buttons, rows, notices |
| `h-5 w-5`     | Brand mark, modal header chip       |
| `h-6 w-6`     | Full-screen loading mark            |
| `h-8 w-8`     | Dropzone                            |

`strokeWidth`: **1.8** default (it matches Inter's weight better than lucide's 2), **2** where
the glyph is small or must read crisply, **1.5** at `h-8` and up. Always `shrink-0` in a flex
row. `aria-hidden` when the label beside it already says the same thing.

Settled meanings: `AlertTriangle` warning · `AlertCircle` error · `CheckCircle2` success ·
`Check` confirmed · `X` close · `Search` search · `Loader2` busy · `RotateCw` retry ·
`ChevronDown` collapse · `ChevronsUpDown` picker · `Download` / `Upload` · `Eye` / `EyeOff`
reveal · `LogOut` · `Settings` · `HelpCircle`.

---

## 20. Accessibility rules this design depends on

Not a checklist bolted on afterwards — several recipes above are only correct with these.

- **Colour never says it alone.** Every dot, tint and meter has the same fact in words nearby —
  in the visible label, the `title`, or an `sr-only` tail.
- **`aria-pressed`** on toggles and segmented-switch buttons; **`aria-current="page"`** on the
  active nav row.
- **`aria-label`** on every icon-only button — the tooltip is a hover affordance, not an
  accessible name.
- **`role="img"` + `aria-label`** for a badge that reports a fact. Not a disabled checkbox:
  that reads as a control someone switched off.
- **`role="alert"`** on errors, **`role="status"`** on confirmations.
- **`role="dialog" aria-modal="true"`** on modal and drawer, with `aria-label` on the drawer
  (the modal names itself through its heading).
- **`role="tooltip"`** on the tooltip span.
- **Escape closes every overlay**, and a backdrop click does too — except where the dialog *is*
  the page.
- **A clickable div needs `role="button"`, `tabIndex={0}` and an Enter/Space handler.**
- **Real `<a>` for navigation**, so it middle-clicks into a tab and its address copies. A
  `<button>` that calls a router does neither.
- Contrast: the status inks clear AA on their own tint, on `--color-surface` and on white.
  `text-body` on white is 5.9:1. `text-body/70` is for supporting detail only — don't put a
  fact there.

---

## 21. Porting checklist

1. Copy §2 into `app/globals.css`. That's the whole design system's CSS.
2. Wire Inter + the `<html>`/`<body>` classes from §1.
3. Re-point `--color-primary` and `--color-primary-dark` for a different brand. Everything that
   uses the accent — buttons, focus rings, active rows, tints, the highlight band, the pulse
   animation — follows, because they all reference the token.
4. **Recompute the status inks if you change them** — don't eyeball them. The family's rule is
   one luminance (~0.145) across all three, with letters clearing 4.5:1 on their own `/10`
   tint, on `bg-surface` and on white. Break that and the badges start shouting at different
   volumes.
5. Copy the four overlay components (§11) first. Everything else is class strings; these are
   behaviour, and they're what gets re-rolled inconsistently.
6. Keep each tone→fill map in exactly one module and import it. Same for pluralised or
   otherwise inflected count strings — the number of surfaces that print a count is always
   larger than it looks.

### Conventions to keep

- **One accent, spent sparingly.** Primary buttons, active state, focus, the band, small icon
  chips. Everything else is navy/grey on white. A second accent colour is how this design
  starts to look like a different design.
- **Light theme only.** No `dark:` variants. Add one and you're maintaining two palettes where
  the status inks were tuned for exactly three grounds.
- **Cards, not dividers.** White `rounded-card` + `border-zinc-200` + `shadow-sm`, with
  `border-zinc-100` hairlines *inside*.
- **Three radii, and one of them is not a shape you pick.** `rounded-card` for cards,
  `rounded-btn` for controls with a real hit area, `rounded-badge` for every badge, tag and
  chip. `rounded-full` is reserved for dots, meters and circular icon slots — mixing capsules
  into the badge family is how a reader ends up with two silhouettes meaning nothing.
- **`cursor-pointer` + hover + `transition-colors`** on everything interactive.
- **Styling in the component, margin at the call site.** Notices, search fields and metrics
  bring no outer spacing of their own.
- **Shared scaffolding, not copied blocks.** Every overlay had drifted into two near-identical
  copies before it was extracted into a component.
- **Truncate with `min-w-0 flex-1 truncate` on the label and `shrink-0` on its neighbours.**
  This one line is what keeps a narrow row from breaking under a long name.
- **A number in a column gets `tabular-nums`; a headline figure doesn't.**
