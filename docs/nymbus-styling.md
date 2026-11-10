# Nymbus Styling Guide

> One file to reproduce the Nymbus look in any app (Kairos, Hermes, and whatever comes next).
> Soft neumorphism on a warm cream canvas, a warm-purple night theme, Poppins type, and a single sacred brand color: cloud-blue.
>
> **Source of truth:** the Kairos frontend (`frontend/app/globals.css`, `frontend/app/layout.tsx`, `frontend/components/ui/`). Where older docs disagree with the code, this file follows the code.
> **Extracted:** September 2026 from Kairos v1.1.

---

## Contents

0. [How to use this file](#0-how-to-use-this-file)
1. [Philosophy](#1-philosophy)
2. [Stack & dependencies](#2-stack--dependencies)
3. [File setup (copy-paste)](#3-file-setup-copy-paste)
4. [Fonts & typography](#4-fonts--typography)
5. [Colors](#5-colors)
6. [Shadows & depth](#6-shadows--depth)
7. [Radius & spacing](#7-radius--spacing)
8. [Themes (light / dark)](#8-themes-light--dark)
9. [shadcn/ui](#9-shadcnui)
10. [Component recipes](#10-component-recipes)
11. [Icons & brand assets](#11-icons--brand-assets)
12. [Motion](#12-motion)
13. [Layout patterns](#13-layout-patterns)
14. [Data display & copy](#14-data-display--copy)
15. [Accessibility](#15-accessibility)
16. [Do / Don't](#16-do--dont)
17. [Gotchas](#17-gotchas)
18. [Appendix: Kairos domain mappings](#18-appendix-kairos-domain-mappings)

---

## 0. How to use this file

**For people:** follow §2 and §3 once to set up a new app, then use §4–§14 as a reference while building.

**For Claude Code:** put this file in the repo root and add it to the project's `CLAUDE.md`:

```md
| `nymbus-styling.md` | Any UI work — tokens, components, themes, icons, fonts |
```

Then prefix UI requests with *"Follow nymbus-styling.md"*, and ask Claude to name the tokens and recipes it's using. That makes drift visible early.

### The golden rules (TL;DR)

1. **Every color, shadow and surface comes from a `--k-*` CSS variable.** No hex values in components. The only exceptions are the theme toggle's sun and moon art (§3.9) and the modal backdrop scrim, `bg-black/30` (§10.11).
2. **Depth, not borders.** Separate things with paired neumorphic shadows, not lines. The exception is a `--k-divider` hairline between the header, body and footer of a modal (§10.11) or on a printed page, where there are no shadows.
3. **Every surface is `--k-bg`.** Only the lighting changes (raised, lifted or inset), never the surface color.
4. **Color means something.** Semantic pairs (`fg`/`bg`) signal state. Cloud-blue is the only brand color, and it's used sparingly.
5. **Components never branch on theme.** No `theme === "dark" ? … : …`. If one theme looks wrong, fix the token. The one sanctioned `dark:` swap is the chart fill in `TONE[tone].bar` (§5.4, §8.2).
6. **Poppins for everything**, with `tabular-nums` for numbers.
7. **Empty values render as `—`** (em-dash) in the tertiary text color.
8. **Soft over sharp.** Pill shapes, 16–28px radii, 0.15–0.25s ease transitions.

### New-app checklist

- [ ] Next.js app created, dependencies installed (§2)
- [ ] `postcss.config.mjs`, `components.json`, `lib/utils.ts`, `.prettierrc` copied (§3)
- [ ] `app/globals.css` replaced with the Nymbus version (§3.6). **Don't run `shadcn init`**, because it overwrites this file
- [ ] `app/layout.tsx` loads Poppins and Geist Mono, renders the starfield and the `relative z-[1]` wrapper (§3.7)
- [ ] `providers/index.tsx` with `next-themes` set to `attribute="data-theme"` and the themed Sonner toaster (§3.8)
- [ ] `ThemeToggle` added to the header (§3.9)
- [ ] shadcn components added with `npx shadcn@latest add …` (§9), and the `globals.css` diff checked afterwards
- [ ] Smoke test: toggle the theme. Cream to warm purple, stars appear in dark mode, the body fades over 0.4s, and raised buttons lift on hover and sink on press, and the header icon buttons sink on hover (§10.1)

---

## 1. Philosophy

Nymbus is **warm, calm and hand-crafted**: the opposite of the typical cold enterprise dashboard. Every surface should feel like something you could **touch**, pressed in or lifted up. The interface should be pleasant to spend a whole workday in.

**Three principles:**

1. **Depth, not borders.** Elements separate through soft paired shadows (a highlight at the top-left and a shade at the bottom-right). The same surface color flows everywhere; only the lighting direction changes.
2. **Color = signal.** The cream canvas is neutral. Each color in the palette means something specific, and color is never decorative.
3. **Soft over sharp.** Rounded corners, gentle transitions, pastel fills and hand-drawn illustration. Nothing is harsh, and nothing pops aggressively.

**Two themes, two rooms.** Light is a warm cream room with slate-blue text. Dark is a deep **warm-purple-black** night with lavender text, an ambient cosmic glow and a sparse starfield. Dark is *not* an inversion of light, and never a cold navy. Both share the same depth language, spacing, type and semantic structure.

---

## 2. Stack & dependencies

| Layer | Package | Version (Kairos) | Why |
|---|---|---|---|
| Framework | `next` | 16.2.x | App Router, `next/font` |
| UI runtime | `react`, `react-dom` | ^19.2 | |
| CSS | `tailwindcss`, `@tailwindcss/postcss`, `postcss` | ^4.2 | Config lives in CSS, no `tailwind.config.ts` |
| Animations | `tw-animate-css` | ^1.4 | `animate-in` / `fade-in` etc. used by shadcn overlays |
| Components | `shadcn` (dev, CLI and `shadcn/tailwind.css`) | ^4.4 | Style **`base-nova`** |
| Primitives | `@base-ui/react` | ^1.4 | base-nova is built on Base UI, **not Radix** |
| Variants | `class-variance-authority` | ^0.7 | `cva()` in shadcn components |
| Class merge | `clsx`, `tailwind-merge` | ^2.1 / ^3.5 | `cn()` helper |
| Icons | `lucide-react` | ^1.8 | shadcn `iconLibrary: "lucide"` |
| Theming | `next-themes` | ^0.4 | Sets `data-theme` on `<html>` |
| Toasts | `sonner` | ^2.0 | Styled with Nymbus tokens |
| Command / combobox | `cmdk` | ^1.1 | For `command.tsx` |
| Date picker | `react-day-picker`, `date-fns` | ^9.14 / ^4.1 | For `calendar.tsx` |
| Data tables (optional) | `@tanstack/react-table`, `@tanstack/react-virtual` | ^8.21 / ^3.13 | Virtualized tables |
| Formatting | `prettier`, `prettier-plugin-tailwindcss` | ^3.8 / ^0.7 | Sorts Tailwind classes |
| Types | `typescript` | ^5.9 | |

### Install

```bash
npx create-next-app@latest my-app --ts --app --tailwind --eslint --no-src-dir --import-alias "@/*"
cd my-app

# Core styling stack
npm i @base-ui/react class-variance-authority clsx tailwind-merge lucide-react next-themes sonner tw-animate-css
npm i -D shadcn prettier prettier-plugin-tailwindcss

# Only if you need them
npm i cmdk react-day-picker date-fns                       # command menu / calendar
npm i @tanstack/react-table @tanstack/react-virtual        # large tables
```

> `shadcn` must be installed locally (as a dev dependency) because `globals.css` imports `shadcn/tailwind.css` from it.

---

## 3. File setup (copy-paste)

### 3.1 Folder structure

```
app/
  globals.css          ← ALL design tokens + neu-* classes + keyframes
  layout.tsx           ← fonts, starfield, providers
components/
  ui/                  ← shadcn (base-nova) primitives
  theme-toggle.tsx
  app-header.tsx
features/              ← feature folders (UI + api + hooks per feature)
lib/
  utils.ts             ← cn()
providers/
  index.tsx            ← ThemeProvider, TooltipProvider, Toaster (+ app-specific providers)
public/
postcss.config.mjs
components.json
.prettierrc
```

### 3.2 `postcss.config.mjs`

```js
/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
}

export default config
```

### 3.3 `components.json`

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "base-nova",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "app/globals.css",
    "baseColor": "zinc",
    "cssVariables": true,
    "prefix": ""
  },
  "iconLibrary": "lucide",
  "rtl": false,
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "menuColor": "default",
  "menuAccent": "bold",
  "registries": {}
}
```

- `"config": ""` because Tailwind v4 has no config file.
- `baseColor: "zinc"` only matters when shadcn generates tokens. Nymbus overrides every token anyway.
- Kairos sets `"hooks": "@/features"`. Use `"@/hooks"` in new apps unless you follow the same feature-folder layout.

### 3.4 `tsconfig.json` path alias

```json
{
  "compilerOptions": {
    "paths": { "@/*": ["./*"] }
  }
}
```

### 3.5 `lib/utils.ts`

```ts
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

/** Merges Tailwind class names, resolving conflicts via tailwind-merge. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

### 3.6 `app/globals.css` (the whole design system)

This is the **single source of truth**. Copy it unchanged. What it contains:

| Block | Purpose |
|---|---|
| `@import` ×3 | Tailwind, tw-animate-css, shadcn variants (`data-open:` etc.) |
| `@custom-variant dark` | Makes Tailwind's `dark:` follow `[data-theme="dark"]` instead of `prefers-color-scheme` |
| `@theme inline` | Exposes tokens as Tailwind utilities: `bg-k-bg`, `text-k-amber-fg`, `shadow-raised`, `rounded-pill`… `inline` keeps them as live `var()` references so theme switching works at runtime |
| `:root` | Light tokens: surface, text, brand, semantic pairs, shadows, shadcn tokens |
| `[data-theme="dark"]` | Dark overrides: same names, different values |
| `@layer base` | Body background, ambient glow, theme fade, default font |
| `@layer components` | `neu-sheet`, `neu-form-*`, `neu-action-*`, `neu-popover`, `neu-selected-chip` |
| `@layer utilities` | `neu-button`, `neu-button-primary`, `neu-input`, `starfield`, `day-row` |
| `@keyframes` | `slideDown`, `float-up`, `drift`, `drift-cloud`, `drift-tape`, `pulse` |

> The capacity-bar tokens (`--k-cap-*`) and the `signin-*` / `maint-*` classes are Kairos-specific. They're harmless to keep, and you can reuse the animation classes on your own auth and maintenance screens.

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

/* Dark mode via data-theme attribute set by next-themes */
@custom-variant dark (&:is([data-theme="dark"] *));

@theme inline {
  --font-heading: var(--font-sans);
  --font-sans: var(--font-sans);

  /* shadcn semantic token mappings — unchanged names, Kairos-tuned values */
  --color-sidebar-ring:                var(--sidebar-ring);
  --color-sidebar-border:              var(--sidebar-border);
  --color-sidebar-accent-foreground:   var(--sidebar-accent-foreground);
  --color-sidebar-accent:              var(--sidebar-accent);
  --color-sidebar-primary-foreground:  var(--sidebar-primary-foreground);
  --color-sidebar-primary:             var(--sidebar-primary);
  --color-sidebar-foreground:          var(--sidebar-foreground);
  --color-sidebar:                     var(--sidebar);
  --color-chart-5:                     var(--chart-5);
  --color-chart-4:                     var(--chart-4);
  --color-chart-3:                     var(--chart-3);
  --color-chart-2:                     var(--chart-2);
  --color-chart-1:                     var(--chart-1);
  --color-ring:                        var(--ring);
  --color-input:                       var(--input);
  --color-border:                      var(--border);
  --color-destructive:                 var(--destructive);
  --color-accent-foreground:           var(--accent-foreground);
  --color-accent:                      var(--accent);
  --color-muted-foreground:            var(--muted-foreground);
  --color-muted:                       var(--muted);
  --color-secondary-foreground:        var(--secondary-foreground);
  --color-secondary:                   var(--secondary);
  --color-primary-foreground:          var(--primary-foreground);
  --color-primary:                     var(--primary);
  --color-popover-foreground:          var(--popover-foreground);
  --color-popover:                     var(--popover);
  --color-card-foreground:             var(--card-foreground);
  --color-card:                        var(--card);
  --color-foreground:                  var(--foreground);
  --color-background:                  var(--background);

  /* Radius scale — Kairos values per DESIGN_SYSTEM.md */
  --radius-pill: 9999px;
  --radius-sm:     8px;
  --radius-md:    12px;
  --radius-lg:    16px;
  --radius-xl:    20px;
  --radius-2xl:   22px;
  --radius-3xl:   28px;
  --radius-4xl:   32px;

  /* Kairos surface + text tokens as Tailwind utilities */
  --color-k-bg:             var(--k-bg);
  --color-k-shade:          var(--k-shade);
  --color-k-highlight:      var(--k-highlight);
  --color-k-divider:        var(--k-divider);
  --color-k-text-primary:   var(--k-text-primary);
  --color-k-text-secondary: var(--k-text-secondary);
  --color-k-text-tertiary:  var(--k-text-tertiary);

  /* Kairos cloud-blue brand */
  --color-k-cloud-light: var(--k-cloud-light);
  --color-k-cloud-mid:   var(--k-cloud-mid);
  --color-k-cloud-deep:  var(--k-cloud-deep);

  /* Kairos semantic color pairs */
  --color-k-amber-fg:  var(--k-amber-fg);
  --color-k-amber-bg:  var(--k-amber-bg);
  --color-k-red-fg:    var(--k-red-fg);
  --color-k-red-bg:    var(--k-red-bg);
  --color-k-purple-fg: var(--k-purple-fg);
  --color-k-purple-bg: var(--k-purple-bg);
  --color-k-orange-fg: var(--k-orange-fg);
  --color-k-orange-bg: var(--k-orange-bg);
  --color-k-cyan-fg:   var(--k-cyan-fg);
  --color-k-cyan-bg:   var(--k-cyan-bg);
  --color-k-green-fg:  var(--k-green-fg);
  --color-k-green-bg:  var(--k-green-bg);
  --color-k-grey-fg:   var(--k-grey-fg);
  --color-k-grey-bg:   var(--k-grey-bg);
  --color-k-yellow-fg: var(--k-yellow-fg);
  --color-k-yellow-bg: var(--k-yellow-bg);

  /* Kairos capacity bar states */
  --color-k-cap-under: var(--k-cap-under);
  --color-k-cap-exact: var(--k-cap-exact);
  --color-k-cap-over:  var(--k-cap-over);
  --color-k-cap-sick:  var(--k-cap-sick);
  --color-k-cap-leave: var(--k-cap-leave);

  /* Neumorphic shadow utilities — values compose from k-highlight/k-shade automatically */
  --shadow-raised:    var(--k-shadow-raised);
  --shadow-raised-sm: var(--k-shadow-raised-sm);
  --shadow-raised-xs: var(--k-shadow-raised-xs);
  --shadow-lifted:    var(--k-shadow-lifted);
  --shadow-lifted-sm: var(--k-shadow-lifted-sm);
  --shadow-inset:     var(--k-shadow-inset);
  --shadow-inset-sm:  var(--k-shadow-inset-sm);
  --shadow-modal:     var(--k-shadow-modal);
}

/* ─── Kairos design tokens — light theme ─────────────────────────────────────
   Edit values here to change the look of the entire app. Dark overrides below.
   Never hardcode these values in components — always reference the variable.    */
:root {
  /* Surface */
  --k-bg:        #f5f0eb;   /* warm cream canvas */
  --k-shade:     #c9c2b8;   /* shadow side — darker than bg */
  --k-highlight: #ffffff;   /* highlight side — lighter than bg */
  --k-divider:   #d9d2c8;

  /* Text */
  --k-text-primary:   #31344b;  /* deep slate-blue */
  --k-text-secondary: #6b6f8e;
  --k-text-tertiary:  #9a9db4;  /* em-dashes, placeholders */

  /* Brand — cloud-blue (the only brand-owned color) */
  --k-cloud-light: #cfe8f5;
  --k-cloud-mid:   #a5d3ec;
  --k-cloud-deep:  #5fa8d3;

  /* Semantic color pairs: fg for text/icons, bg for tinted fills */
  --k-amber-fg:  #b87333;  --k-amber-bg:  #f0d9b8;  /* incomplete states */
  --k-red-fg:    #b04545;  --k-red-bg:    #f0c8c8;  /* not approved / errors */
  --k-purple-fg: #7a5fb3;  --k-purple-bg: #d8cfeb;  /* payroll signals */
  --k-orange-fg: #c4763a;  --k-orange-bg: #f2d5b8;  /* over-capacity */
  --k-cyan-fg:   #4a8fa8;  --k-cyan-bg:   #c8e0e8;
  --k-green-fg:  #5a8a4a;  --k-green-bg:  #d2e2c0;  /* all clear */
  --k-grey-fg:   #6b6f7e;  --k-grey-bg:   #dcdbd4;  /* capacity flags */
  --k-yellow-fg: #a38a2a;  --k-yellow-bg: #ece1b8;  /* double-bookings */

  /* Capacity bar */
  --k-cap-under: #FFB38E;
  --k-cap-exact: #7db533;   /* lime green — exact-capacity fill (light) */
  --k-cap-over:  #5fa8d3;   /* cloud-deep blue — over-capacity fill (light) */
  --k-cap-sick:  #e3bb3a;   /* yellow — sickness (verzuim) fill (light) */
  --k-cap-leave: #9478d4;   /* purple — leave (verlof) fill (light) */

  /* Neumorphic shadow primitives — reference k-highlight/k-shade so they
     auto-adapt when the theme switches. Never override these directly;
     change k-highlight and k-shade instead. */
  --k-shadow-raised:    -6px -6px 12px var(--k-highlight),  6px  6px 12px var(--k-shade);
  --k-shadow-raised-sm: -4px -4px  8px var(--k-highlight),  4px  4px  8px var(--k-shade);
  --k-shadow-raised-xs: -2px -2px  4px var(--k-highlight),  2px  2px  4px var(--k-shade);
  --k-shadow-lifted:    -8px -8px 16px var(--k-highlight),  8px  8px 16px var(--k-shade);
  --k-shadow-lifted-sm: -6px -6px 12px var(--k-highlight),  6px  6px 12px var(--k-shade);
  --k-shadow-inset:     inset -4px -4px  8px var(--k-highlight), inset  4px  4px  8px var(--k-shade);
  --k-shadow-inset-sm:  inset -3px -3px  6px var(--k-highlight), inset  3px  3px  6px var(--k-shade);

  /* Hover card shadow — lifted-sm + a soft blue outer glow. */
  --k-shadow-hover-card:
    -6px -6px 12px var(--k-highlight), 6px 6px 12px var(--k-shade),
    0 0 18px color-mix(in srgb, var(--k-cloud-deep) 22%, transparent);

  /* Pressed/selected card shadow. Light mode: plain inset (gaps barely shift). */
  --k-shadow-card-active: var(--k-shadow-inset);

  /* Modal shadow — raised, but with a tighter, half-strength top-left highlight.
     Over the dimmed backdrop the full-white raised highlight reads as a glow.
     Composes from highlight/shade, so no dark override is needed. */
  --k-shadow-modal:
    -4px -4px 8px color-mix(in srgb, var(--k-highlight) 50%, transparent),
    6px 6px 12px var(--k-shade);

  /* Ambient background — none in light mode */
  --k-ambient: none;

  /* ── shadcn tokens — Kairos-tuned so shadcn components inherit the palette ── */
  --background:                #f5f0eb;
  --foreground:                #31344b;
  --card:                      #f5f0eb;
  --card-foreground:           #31344b;
  --popover:                   #ffffff;
  --popover-foreground:        #31344b;
  --primary:                   #5fa8d3;
  --primary-foreground:        #ffffff;
  --secondary:                 #cfe8f5;
  --secondary-foreground:      #31344b;
  --muted:                     #d9d2c8;
  --muted-foreground:          #6b6f8e;
  --accent:                    #5fa8d3;
  --accent-foreground:         #ffffff;
  --destructive:               #b04545;
  --border:                    #d9d2c8;
  --input:                     #d9d2c8;
  --ring:                      #a5d3ec;
  --chart-1:                   #5fa8d3;
  --chart-2:                   #5a8a4a;
  --chart-3:                   #a38a2a;
  --chart-4:                   #b87333;
  --chart-5:                   #b04545;
  --radius:                    0.5rem;
  --sidebar:                   #f5f0eb;
  --sidebar-foreground:        #31344b;
  --sidebar-primary:           #5fa8d3;
  --sidebar-primary-foreground: #ffffff;
  --sidebar-accent:            #cfe8f5;
  --sidebar-accent-foreground: #31344b;
  --sidebar-border:            #d9d2c8;
  --sidebar-ring:              #a5d3ec;
}

/* ─── Kairos design tokens — dark theme ──────────────────────────────────────
   Warm-purple-black, NOT a cold-blue inversion of light. Same depth language,
   different room. See DESIGN_SYSTEM.md §Dark mode for the reasoning.           */
[data-theme="dark"] {
  /* Surface */
  --k-bg:        #1a1626;   /* deep warm-purple-black */
  --k-shade:     #0f0c18;   /* darker than bg — drives raised/lifted depth */
  --k-highlight: #2a2438;   /* lighter than bg */
  --k-divider:   #2f2940;

  /* Softer inset in dark mode: the default --k-shade (#0f0c18) is near-black, so a
     pressed/selected card's inset ring blends into the canvas and reads as a shrunken
     recess. Use a shade close to --k-bg AND thinner offset/blur so the inset claims a
     narrower edge band and stays a gentle press. */
  --k-shadow-inset:     inset -3px -3px  6px var(--k-highlight), inset  3px  3px  6px #15111f;
  --k-shadow-inset-sm:  inset -2px -2px  4px var(--k-highlight), inset  2px  2px  4px #15111f;

  /* Pressed/selected card keeps the resting raised OUTER footprint so the bottom/right
     gaps don't jump when it's selected; the inset is layered on top as the press cue. */
  --k-shadow-card-active:
    -6px -6px 12px var(--k-highlight),  6px  6px 12px var(--k-shade),
    var(--k-shadow-inset);

  /* Hover card shadow — slightly stronger glow in dark mode. */
  --k-shadow-hover-card:
    -6px -6px 12px var(--k-highlight), 6px 6px 12px var(--k-shade),
    0 0 22px color-mix(in srgb, var(--k-cloud-deep) 30%, transparent);

  /* Text */
  --k-text-primary:   #e8e4f0;
  --k-text-secondary: #a8a2bc;
  --k-text-tertiary:  #6c6580;

  /* Brand — shifts brighter to glow against dark */
  --k-cloud-light: #7ac4e8;
  --k-cloud-mid:   #5fa8d3;
  --k-cloud-deep:  #a5d8f0;

  /* Semantic colors — brighter fg, deep tinted bg so inset wells still recede */
  --k-amber-fg:  #f5a04f;  --k-amber-bg:  #3a2818;
  --k-red-fg:    #e87878;  --k-red-bg:    #3a1f1f;
  --k-purple-fg: #b794f6;  --k-purple-bg: #2e2348;
  --k-orange-fg: #f59e4f;  --k-orange-bg: #3a2614;
  --k-cyan-fg:   #7ac4e0;  --k-cyan-bg:   #1a2c32;
  --k-green-fg:  #9bcf85;  --k-green-bg:  #1f2e1a;
  --k-grey-fg:   #9d9db4;  --k-grey-bg:   #28253a;
  --k-yellow-fg: #f5d76e;  --k-yellow-bg: #352c14;

  /* Capacity bar — under pastel carries over; exact + over keep the original pales */
  --k-cap-exact: #C7EABB;
  --k-cap-over:  #BFECFF;
  --k-cap-sick:  #F3E2A6;
  --k-cap-leave: #DCCFF5;

  /* Ambient cosmic glow — applied as background-image on body */
  --k-ambient:
    radial-gradient(ellipse at 20% 10%, rgba(139, 92, 246, 0.12), transparent 50%),
    radial-gradient(ellipse at 80% 90%, rgba(245, 158, 79,  0.08), transparent 50%),
    radial-gradient(ellipse at 60% 50%, rgba(245, 215, 110, 0.05), transparent 60%);

  /* ── shadcn tokens — dark Kairos palette ─────────────────────────────────── */
  --background:                #1a1626;
  --foreground:                #e8e4f0;
  --card:                      #1a1626;
  --card-foreground:           #e8e4f0;
  --popover:                   #2a2438;
  --popover-foreground:        #e8e4f0;
  --primary:                   #a5d8f0;
  --primary-foreground:        #1a1626;
  --secondary:                 #2f2940;
  --secondary-foreground:      #e8e4f0;
  --muted:                     #2f2940;
  --muted-foreground:          #a8a2bc;
  --accent:                    #a5d8f0;
  --accent-foreground:         #1a1626;
  --destructive:               #e87878;
  --border:                    rgba(255, 255, 255, 0.08);
  --input:                     rgba(255, 255, 255, 0.10);
  --ring:                      #5fa8d3;
  --chart-1:                   #a5d8f0;
  --chart-2:                   #9bcf85;
  --chart-3:                   #f5d76e;
  --chart-4:                   #f5a04f;
  --chart-5:                   #e87878;
  --sidebar:                   #2a2438;
  --sidebar-foreground:        #e8e4f0;
  --sidebar-primary:           #a5d8f0;
  --sidebar-primary-foreground: #1a1626;
  --sidebar-accent:            #2f2940;
  --sidebar-accent-foreground: #e8e4f0;
  --sidebar-border:            rgba(255, 255, 255, 0.08);
  --sidebar-ring:              #5fa8d3;
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    background-color: var(--k-bg);
    background-image: var(--k-ambient);
    background-attachment: fixed;
    color: var(--k-text-primary);
    transition: background 0.4s ease, color 0.4s ease;
  }
  html {
    @apply font-sans;
  }
}

/* ─── ETL panel form + sheet utilities ───────────────────────────────────────
   Neumorphic classes used by the DEV tools side panel. These use the Kairos
   token names directly so they follow the existing light/dark theme system. */
@layer components {
  .neu-sheet {
    background: var(--k-bg);
    border-left: none;
    box-shadow:
      -12px 0 32px var(--k-shade),
      -1px 0 0 var(--k-highlight);
    color: var(--k-text-primary);
    font-family: var(--font-sans);
  }

  .neu-sheet [data-slot="sheet-header"] {
    background: var(--k-bg);
    padding: 20px 24px 16px;
    border-bottom: none;
  }

  .neu-sheet [data-slot="sheet-title"] {
    font-size: 22px;
    font-weight: 700;
    letter-spacing: -0.5px;
    color: var(--k-text-primary);
    line-height: 1.15;
  }

  .neu-sheet button[data-slot="sheet-close"],
  .neu-sheet > button[type="button"]:has(svg) {
    background: var(--k-bg);
    border: none;
    box-shadow: none;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    color: var(--k-text-secondary);
    opacity: 1;
    transition: box-shadow 0.2s ease, color 0.2s ease;
  }

  .neu-sheet button[data-slot="sheet-close"]:hover,
  .neu-sheet > button[type="button"]:has(svg):hover {
    box-shadow: var(--k-shadow-inset-sm);
    color: var(--k-cloud-deep);
  }

  .neu-form-label {
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.4px;
    text-transform: uppercase;
    color: var(--k-text-secondary);
    margin-bottom: 6px;
    display: block;
  }

  .neu-form-field {
    background: var(--k-bg);
    box-shadow: var(--k-shadow-inset-sm);
    border: none !important;
    border-radius: 99px;
    padding: 11px 18px;
    font-family: var(--font-sans);
    font-size: 13px;
    font-weight: 500;
    color: var(--k-text-primary);
    width: 100%;
    text-align: left;
    transition: box-shadow 0.2s ease;
    min-height: 42px;
    display: inline-flex;
    align-items: center;
    gap: 10px;
  }

  .neu-form-field:hover {
    box-shadow: var(--k-shadow-inset-sm);
  }

  .neu-form-field:focus,
  .neu-form-field:focus-visible,
  .neu-form-field[data-state="open"],
  .neu-form-field[aria-expanded="true"] {
    outline: none;
    box-shadow:
      var(--k-shadow-inset-sm),
      0 0 0 2px var(--k-cloud-light);
  }

  .neu-form-field[data-placeholder],
  .neu-form-field:placeholder-shown,
  .neu-form-field .placeholder {
    color: var(--k-text-tertiary);
    font-weight: 400;
  }

  .neu-form-field svg {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
    color: var(--k-text-tertiary);
  }

  .neu-form-field[data-state="open"] svg,
  .neu-form-field:focus svg {
    color: var(--k-cloud-deep);
  }

  .neu-icon-btn {
    background: var(--k-bg);
    box-shadow: none;
    border: none;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    color: var(--k-text-tertiary);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: box-shadow 0.2s ease, color 0.2s ease;
  }

  .neu-icon-btn:hover {
    box-shadow: var(--k-shadow-inset-sm);
    color: var(--k-cloud-deep);
  }

  /* "On" state for header toggles (settings open, dark mode on): pressed in
     deeper than hover and tinted cloud-deep, so it reads as held down. */
  .neu-icon-btn[data-active="true"] {
    box-shadow: var(--k-shadow-inset);
    color: var(--k-cloud-deep);
  }

  .neu-form-field-selected {
    border-radius: 22px;
    padding: 10px 14px;
    align-items: flex-start;
  }

  .neu-selected-list {
    display: flex;
    flex: 1;
    min-width: 0;
    flex-wrap: wrap;
    gap: 6px;
  }

  .neu-selected-chip {
    position: relative;
    display: inline-flex;
    min-width: 0;
    max-width: 100%;
    flex-direction: column;
    gap: 1px;
    border-radius: 14px;
    background: color-mix(in srgb, var(--k-cloud-light) 38%, transparent);
    box-shadow: var(--k-shadow-inset-sm);
    padding: 5px 9px;
    padding-right: 22px;
    line-height: 1.15;
  }

  .neu-selected-chip-remove {
    position: absolute;
    top: 4px;
    right: 5px;
    display: inline-flex;
    width: 13px;
    height: 13px;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 999px;
    background: transparent;
    color: var(--k-text-tertiary);
    cursor: pointer;
    padding: 0;
    transition: background 0.15s ease, color 0.15s ease;
  }

  .neu-selected-chip-remove:hover {
    background: color-mix(in srgb, var(--k-red-bg) 72%, transparent);
    color: var(--k-red-fg);
  }

  .neu-selected-chip-id {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--k-text-primary);
    font-size: 12px;
    font-weight: 600;
  }

  .neu-selected-chip-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--k-text-secondary);
    font-size: 11px;
    font-weight: 400;
  }

  .neu-action-primary {
    background: var(--k-bg);
    box-shadow: var(--k-shadow-raised);
    color: var(--k-text-primary);
    border: none;
    outline: none;
    border-radius: 99px;
    padding: 13px 24px;
    font-family: var(--font-sans);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    transition: box-shadow 0.25s ease, transform 0.2s ease, color 0.2s ease;
  }

  .neu-action-primary:hover:not(:disabled) {
    box-shadow: var(--k-shadow-lifted);
    color: var(--k-cloud-deep);
  }

  .neu-action-primary:active:not(:disabled) {
    box-shadow: var(--k-shadow-inset);
    transform: translateY(0);
  }

  .neu-action-primary:disabled {
    cursor: not-allowed;
    opacity: 0.55;
    box-shadow: var(--k-shadow-inset-sm);
  }

  .neu-action-secondary {
    background: var(--k-bg);
    box-shadow: var(--k-shadow-raised-sm);
    color: var(--k-text-secondary);
    border: none;
    outline: none;
    border-radius: 99px;
    padding: 11px 20px;
    font-family: var(--font-sans);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    transition: box-shadow 0.2s ease, transform 0.15s ease, color 0.2s ease;
  }

  .neu-action-secondary:hover:not(:disabled) {
    box-shadow: var(--k-shadow-lifted-sm);
    color: var(--k-cloud-deep);
  }

  .neu-action-secondary:active:not(:disabled) {
    box-shadow: var(--k-shadow-inset-sm);
    transform: translateY(0);
  }

  .neu-popover {
    background: var(--k-bg);
    box-shadow: var(--k-shadow-raised);
    border: none;
    border-radius: 16px;
    overflow: hidden;
    padding: 6px;
    font-family: var(--font-sans);
  }

  .neu-popover [data-slot="command-item"],
  .neu-popover [cmdk-item] {
    border-radius: 10px;
    padding: 8px 12px;
    font-size: 13px;
    color: var(--k-text-primary);
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
  }

  .neu-popover [data-slot="command-item"][data-selected="true"],
  .neu-popover [cmdk-item][data-selected="true"],
  .neu-popover [data-slot="command-item"]:hover,
  .neu-popover [cmdk-item]:hover {
    background: var(--k-bg);
    box-shadow: var(--k-shadow-inset-sm);
    color: var(--k-cloud-deep);
  }

  .neu-popover [data-slot="command-input-wrapper"] {
    border-bottom: 1px solid var(--k-divider);
    padding: 8px 12px 14px;
  }

  .neu-popover [data-slot="command-input"] {
    background: transparent;
    border: none;
    outline: none;
    font-family: var(--font-sans);
    font-size: 13px;
    color: var(--k-text-primary);
    width: 100%;
  }

  .neu-popover [data-slot="command-input"]::placeholder {
    color: var(--k-text-tertiary);
  }

  .neu-popover [data-slot="calendar"] button[name="day"] {
    border-radius: 8px;
    font-family: var(--font-sans);
  }

  .neu-popover [data-slot="calendar"] button[name="day"][data-selected="true"] {
    background: var(--k-cloud-deep);
    color: var(--k-bg);
  }

  .neu-popover [data-slot="calendar"] button[name="day"]:hover:not([data-selected="true"]) {
    background: var(--k-cloud-light);
    color: var(--k-text-primary);
  }
}

/* ─── Neumorphic utility classes ─────────────────────────────────────────────
   Apply these to HTML elements directly. Never branch by theme inside a
   component — the CSS variables handle everything automatically.               */
@layer utilities {
  /* Three-state interactive button (rest → hover → active) */
  .neu-button {
    background: var(--k-bg);
    box-shadow: var(--k-shadow-raised-sm);
    color: var(--k-text-primary);
    transition: box-shadow 0.2s ease, transform 0.15s ease, color 0.2s ease;
  }
  .neu-button:hover {
    box-shadow: var(--k-shadow-lifted-sm);
    color: var(--k-cloud-deep);
  }
  .neu-button:active,
  .neu-button[data-active="true"] {
    box-shadow: var(--k-shadow-inset-sm);
    transform: translateY(0);
    color: var(--k-cloud-deep);
  }

  /* Input — always inset at rest; focus adds cloud-blue glow ring */
  .neu-input {
    background: var(--k-bg);
    box-shadow: var(--k-shadow-inset-sm);
    border: none;
    color: var(--k-text-primary);
    transition: box-shadow 0.2s ease;
  }
  .neu-input:focus {
    outline: none;
    box-shadow: var(--k-shadow-inset-sm), 0 0 0 2px var(--k-cloud-light);
  }
  .neu-input::placeholder {
    color: var(--k-text-tertiary);
  }

  /* Starfield — fixed behind all content; populated with stars in dark mode */
  .starfield {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 0;
  }
  [data-theme="dark"] .starfield {
    background-image:
      radial-gradient(1px   1px   at 20% 30%, rgba(245, 215, 110, 0.5), transparent),
      radial-gradient(1px   1px   at 70% 60%, rgba(183, 148, 246, 0.4), transparent),
      radial-gradient(1.5px 1.5px at 45% 80%, rgba(245, 158,  79, 0.5), transparent),
      radial-gradient(1px   1px   at 85% 15%, rgba(122, 196, 232, 0.4), transparent),
      radial-gradient(1px   1px   at 15% 75%, rgba(245, 215, 110, 0.3), transparent),
      radial-gradient(1.5px 1.5px at 60% 25%, rgba(245, 160,  79, 0.4), transparent),
      radial-gradient(1px   1px   at 90% 85%, rgba(183, 148, 246, 0.5), transparent),
      radial-gradient(1px   1px   at 30% 90%, rgba(122, 196, 232, 0.3), transparent),
      radial-gradient(2px   2px   at 75% 45%, rgba(245, 215, 110, 0.4), transparent),
      radial-gradient(1px   1px   at  5% 50%, rgba(255, 255, 255, 0.4), transparent);
  }

  /* Primary action button — larger raised/lifted/inset shadows than neu-button */
  .neu-button-primary {
    background: var(--k-bg);
    box-shadow: var(--k-shadow-raised);
    color: var(--k-text-primary);
    transition: box-shadow 0.25s ease, transform 0.2s ease, color 0.2s ease;
  }
  .neu-button-primary:hover {
    box-shadow: var(--k-shadow-lifted);
    color: var(--k-cloud-deep);
  }
  .neu-button-primary:active {
    box-shadow: var(--k-shadow-inset);
    transform: translateY(0);
    color: var(--k-cloud-deep);
  }

  /* Day-row reveal — stagger delay set inline per row: animationDelay: `${j * 30}ms` */
  .day-row {
    animation: slideDown 0.25s ease both;
  }
}

@keyframes slideDown {
  from { opacity: 0; transform: translateY(-8px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes float-up {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes drift {
  0%, 100% { transform: translateY(0); }
  50%       { transform: translateY(-6px); }
}

/* Maintenance cloud — same float as drift but adds a gentle tilt */
@keyframes drift-cloud {
  0%, 100% { transform: translateY(0) rotate(-1deg); }
  50%       { transform: translateY(-8px) rotate(1deg); }
}

/* Animated caution-tape stripe — shifts one full stripe cycle */
@keyframes drift-tape {
  from { background-position: 0 0; }
  to   { background-position: 32px 0; }
}

/* Pulsing ring for the "maintenance in progress" status dot */
@keyframes pulse {
  0%   { box-shadow: 0 0 0 0 color-mix(in srgb, var(--k-amber-fg) 40%, transparent); }
  70%  { box-shadow: 0 0 0 10px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
}

.signin-card { animation: float-up 0.6s ease both; }
.signin-logo { animation: drift 6s ease-in-out infinite; }

.maint-card         { animation: float-up 0.7s ease both; }
.maint-card-delay-1 { animation: float-up 0.7s 0.1s ease both; }
.maint-card-delay-2 { animation: float-up 0.7s 0.2s ease both; }
.maint-illu         { animation: drift-cloud 8s ease-in-out infinite; }
```

### 3.7 `app/layout.tsx`

```tsx
/**
 * Root layout — wraps every route in the app with the shared provider stack,
 * applies the Poppins font, and renders the fixed starfield layer used by the
 * dark-mode cosmic background. The starfield div is always in the DOM but only
 * painted in CSS under [data-theme="dark"] — no JS branching needed.
 */
import { Geist_Mono, Poppins } from "next/font/google"

import "./globals.css"
import { AppProviders } from "@/providers"
import { cn } from "@/lib/utils"

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-sans",
})

// Sets --font-mono for use in specific elements (status bar, sign-in page, etc.)
const fontMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" })

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      // next-themes sets data-theme="light"|"dark" on <html>.
      // suppressHydrationWarning prevents React from treating that attribute
      // change between server and client render as a mismatch.
      suppressHydrationWarning
      className={cn("antialiased", poppins.variable, fontMono.variable, "font-sans")}
    >
      <body>
        {/* Starfield — fixed behind all content; CSS paints stars only in dark mode */}
        <div className="starfield" aria-hidden="true" />

        <AppProviders>
          {/* Stacking context so content sits above the starfield */}
          <div className="relative z-[1]">
            {children}
          </div>
        </AppProviders>

        <span className="fixed bottom-2 right-3 text-[10px] text-muted-foreground/40 select-none pointer-events-none">
          v{process.env.NEXT_PUBLIC_APP_VERSION ?? "dev"}
        </span>
      </body>
    </html>
  )
}
```

Why each piece is there:

- **`Poppins` → `--font-sans`, `Geist_Mono` → `--font-mono`.** `next/font` self-hosts the fonts and exposes CSS variables. `globals.css` maps them to `font-sans` / `font-mono`.
- **`suppressHydrationWarning`** is required because `next-themes` writes `data-theme` on `<html>` before React hydrates.
- **`antialiased`** gives the soft text rendering the look depends on.
- **`.starfield`** is always in the DOM and only painted in dark mode (pure CSS).
- **`relative z-[1]` wrapper** stacks content above the fixed starfield. Portaled overlays (Sheet, Dialog, Popover) render outside it with their own z-index, so they're unaffected.
- **Version stamp** is a tiny, faded version number in the bottom-right. It needs the `next.config.mjs` below.

```js
// next.config.mjs — exposes package.json version as NEXT_PUBLIC_APP_VERSION
import { createRequire } from "module"
const require = createRequire(import.meta.url)
const { version } = require("./package.json")

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: { NEXT_PUBLIC_APP_VERSION: version },
}

export default nextConfig
```

### 3.8 `providers/index.tsx`

A generic Nymbus provider stack: theme, tooltips and the themed toaster. Add app-specific providers (NextAuth `SessionProvider`, TanStack `QueryClientProvider`, …) around or inside it. Kairos's order, outermost to innermost, is: Session → ActiveClient → Theme → Query → Tooltip.

```tsx
"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes"
import { Toaster } from "sonner"
import { TooltipProvider } from "@/components/ui/tooltip"

/**
 * Toast host. Follows the resolved theme and uses the neumorphic surface
 * via --k-* variables, so toasts look native in both themes.
 */
function ThemedToaster() {
  const { resolvedTheme } = useTheme()
  return (
    <Toaster
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      position="bottom-right"
      toastOptions={{
        style: {
          background: "var(--k-bg)",
          color: "var(--k-text-primary)",
          border: "none",
          boxShadow: "var(--k-shadow-raised)",
          borderRadius: "14px",
          fontFamily: "inherit",
        },
      }}
    />
  )
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="data-theme" defaultTheme="system" enableSystem>
      <TooltipProvider>{children}</TooltipProvider>
      <ThemedToaster />
    </NextThemesProvider>
  )
}
```

- `attribute="data-theme"` is **required**, because every dark token and the `dark:` variant key off `[data-theme="dark"]`.
- `defaultTheme="system"` with `enableSystem` follows the OS until the user picks a theme, and `next-themes` remembers the choice.
- Leave `disableTransitionOnChange` **off**: the 0.4s body fade on theme switch is part of the feel.

### 3.9 `components/theme-toggle.tsx`

A flat 36px `neu-icon-btn`, the same as the settings button next to it (§10.1). The button shows *which theme is active*, not which one you'd switch to: the moon means light mode is on, and the sun means dark mode is on.

```tsx
"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";

// Hydration guard. The classic recipe is useEffect(() => setMounted(true)),
// but this project's react-hooks rules reject it as a cascading render.
// useSyncExternalStore gives the same answer — false on the server and on the
// hydration pass, true afterwards — without the extra render.
const emptySubscribe = () => () => {};
const useMounted = () =>
  useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );

/**
 * Dark/light toggle. Uses resolvedTheme (never the literal "system") and a
 * mounted guard so the icon doesn't flash the wrong state during hydration.
 *
 * The sun gold and moon violet are icon art, not UI color — the two sanctioned
 * hardcoded colors outside the brand logo (nymbus-styling.md §3.9).
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();

  const isDark = mounted && resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      data-active={isDark}
      className="neu-icon-btn focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-k-cloud-mid"
      aria-pressed={isDark}
      aria-label={isDark ? "Schakel naar lichte modus" : "Schakel naar donkere modus"}
    >
      {mounted &&
        (isDark ? (
          <span className="text-[#f5c842] drop-shadow-[0_0_4px_#f5c84266]">☀</span>
        ) : (
          <svg
            viewBox="0 0 24 24"
            width={15}
            height={15}
            className="drop-shadow-[0_0_4px_#7c5cbf88]"
            aria-hidden="true"
          >
            <path
              fill="#7c5cbf"
              d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z"
            />
          </svg>
        ))}
    </button>
  );
}
```

- **At rest (light mode):** flat, showing the violet moon with its soft glow.
- **Hover:** a small inset shadow. The moon and sun keep their own colors; only the button surface changes.
- **Dark mode on:** `data-active="true"`, so the button stays pressed in with `--k-shadow-inset` and shows the gold sun. `aria-pressed` follows the same state.
- **Focus:** a 2px `k-cloud-mid` outline, offset by 2px, on keyboard focus only.
- **Hydration guard:** use `useSyncExternalStore`, not `useEffect(() => setMounted(true))`. The react-hooks lint rules reject the `useEffect` version because it causes an extra render. Both render no icon on the server and during hydration.
- **The Dutch aria-label names the action:** "Schakel naar lichte modus" or "Schakel naar donkere modus".

> The sun gold (`#f5c842`) and moon violet (`#7c5cbf`) are the **only** sanctioned hardcoded colors outside the brand logo. They are icon art, not UI color.

### 3.10 `.prettierrc`

```json
{
  "endOfLine": "lf",
  "semi": false,
  "singleQuote": false,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 80,
  "plugins": ["prettier-plugin-tailwindcss"],
  "tailwindStylesheet": "app/globals.css",
  "tailwindFunctions": ["cn", "cva"]
}
```

`tailwindStylesheet` points the class sorter at `globals.css` (Tailwind v4 has no JS config), so it knows the custom `k-*` utilities.

---

## 4. Fonts & typography

### Typefaces

| Role | Font | How it's loaded | Utility |
|---|---|---|---|
| Everything (UI, headings, numbers) | **Poppins** 300 / 400 / 500 / 600 / 700 | `next/font/google`, variable `--font-sans` | `font-sans` (default on `<html>`), `font-heading` |
| Code / technical strings (rare) | **Geist Mono** | `next/font/google`, variable `--font-mono` | `font-mono` |

- **Numbers stay in Poppins** with `tabular-nums` (`font-variant-numeric: tabular-nums`) so digits line up. Geist Mono is loaded but reserved for code-like strings.
- `--font-heading` maps to the same Poppins. Headings differ by size, weight and tracking, not by family.
- **Not on Next.js?** Load the same weights from Google Fonts and set the variable yourself:

  ```html
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&family=Geist+Mono&display=swap" rel="stylesheet" />
  ```
  ```css
  :root { --font-sans: "Poppins", system-ui, -apple-system, sans-serif; --font-mono: "Geist Mono", ui-monospace, monospace; }
  ```

### Weight usage

| Weight | Used for |
|---|---|
| 300 | Em-dash placeholders (`—`) |
| 400 | Body copy, captions, KPI labels, secondary cell text |
| 500 | Emphasized cells, inputs, form labels, secondary buttons, eyebrow labels |
| 600 | Primary buttons, badges, stat values, page titles, table headers |
| 700 | Hero headings, card and sheet titles |

### Type scale

Headings use **negative** tracking. Uppercase labels use **positive** tracking.

| Role | Size / weight | Tracking | Line height | Color | Tailwind |
|---|---|---|---|---|---|
| Display (maintenance) | 36 / 700 | -1px | 1.1 | primary | `text-[36px] font-bold tracking-[-1px] leading-[1.1]` |
| Hero / welcome | 32 / 700 | -0.8px | 1.15 | primary | `text-[32px] font-bold tracking-[-0.8px] leading-[1.15]` |
| Auth card title | 28 / 700 | -0.5px | — | primary | `text-[28px] font-bold tracking-[-0.5px]` |
| Stat / KPI value | 28 / 600 | -0.5px | 1 | primary | `text-[28px] font-semibold tracking-[-0.5px] leading-none tabular-nums` |
| Sheet / panel title | 22 / 700 | -0.5px | 1.15 | primary | `text-[22px] font-bold tracking-[-0.5px] leading-[1.15]` |
| Page title (header) | 20 / 600 | -0.4px | 1.2 | primary | `text-xl font-semibold tracking-[-0.4px] leading-[1.2]` |
| Lead paragraph | 15 / 400 | — | 1.55 | secondary | `text-[15px] leading-[1.55] text-k-text-secondary` |
| Primary button | 14 / 600 | — | — | primary | `text-sm font-semibold` |
| Body / subhead / inputs | 13 / 400–500 | — | — | primary / secondary | `text-[13px]` |
| Cell text | 12 / 500 | — | — | primary | `text-xs font-medium` |
| Caption / stat label | 11.5 / 400 | — | 1.3 | secondary | `text-[11.5px] leading-[1.3] text-k-text-secondary` |
| Form label | 11 / 500 | 0.4px | — | secondary | `neu-form-label` (or `text-[11px] font-medium uppercase tracking-[0.4px]`) |
| Table column header | 11 / 600 | 0.5px | — | primary | `text-[11px] font-semibold uppercase tracking-[0.5px]` |
| Eyebrow / brand label | 10–11 / 500 | 0.6–1.5px | — | tertiary | `text-[10px] font-medium uppercase tracking-[0.6px] text-k-text-tertiary` |
| Badge | 10 / 600 | — | — | semantic fg | `text-[10px] font-semibold` |
| Micro label | 9 / 600 | — | 1 | tertiary | `text-[9px] font-semibold leading-none` |
| Version stamp | 10 / 400 | — | — | muted, 40% | `text-[10px] text-muted-foreground/40` |

### Headline accent

A headline may carry **one** accent: the key word in **italic cloud-deep**. This is the only place the brand color appears in copy.

```tsx
<h1 className="text-[32px] leading-[1.15] font-bold tracking-[-0.8px] text-k-text-primary">
  Welkom terug, <span className="text-k-cloud-deep italic">{firstName}</span>
</h1>
```

### Eyebrow label

A small uppercase label above titles that names the product family:

```tsx
<div className="mb-1 text-[10px] font-medium tracking-[0.6px] text-k-text-tertiary uppercase">
  Nymbus · Kairos
</div>
```

Kairos uses 0.6px tracking in the dense header and 1.5px (at 11px) on spacious screens such as sign-in and loading.

---

## 5. Colors

All colors are CSS variables on `:root` (light) and `[data-theme="dark"]` (dark). They are exposed to Tailwind as `k-*` color utilities: `bg-k-…`, `text-k-…`, `border-k-…`, `fill-k-…`, `ring-k-…`, `outline-k-…`.

### 5.1 Surface

| Token | Light | Dark | Tailwind | Use |
|---|---|---|---|---|
| `--k-bg` | `#f5f0eb` warm cream | `#1a1626` warm purple-black | `bg-k-bg` | **Every** surface: page, cards, buttons, inputs, popovers |
| `--k-shade` | `#c9c2b8` | `#0f0c18` | `text-k-shade`… | Shadow side of every neumorphic shadow (darker than bg) |
| `--k-highlight` | `#ffffff` | `#2a2438` | `text-k-highlight`… | Highlight side (lighter than bg) |
| `--k-divider` | `#d9d2c8` | `#2f2940` | `bg-k-divider`, `border-k-divider` | Hairlines, dashed row separators, column separators |

> The rule that makes neumorphism work in any palette: **highlight is lighter than bg, and shade is darker than bg.** The absolute values matter less than keeping that relationship.

### 5.2 Text

| Token | Light | Dark | Tailwind | Use |
|---|---|---|---|---|
| `--k-text-primary` | `#31344b` deep slate-blue | `#e8e4f0` light lavender | `text-k-text-primary` | Headings, data, button labels |
| `--k-text-secondary` | `#6b6f8e` | `#a8a2bc` | `text-k-text-secondary` | Descriptions, captions, labels, secondary buttons |
| `--k-text-tertiary` | `#9a9db4` | `#6c6580` | `text-k-text-tertiary` | Placeholders, em-dashes, eyebrows, idle icons, timestamps. **Never body text** |

Never use pure black or pure white for content.

### 5.3 Brand: cloud-blue (the only brand-owned color)

| Token | Light | Dark | Tailwind | Use |
|---|---|---|---|---|
| `--k-cloud-light` | `#cfe8f5` | `#7ac4e8` | `bg-k-cloud-light` | Focus ring (`0 0 0 2px`), logo fill, calendar hover, chip tint |
| `--k-cloud-mid` | `#a5d3ec` | `#5fa8d3` | `bg-k-cloud-mid` | Logo fill (lower cloud), glow on active dots |
| `--k-cloud-deep` | `#5fa8d3` | `#a5d8f0` | `text-k-cloud-deep` | **Hover and active text/icon tint**, active filter dot, headline accent, links, selected calendar day, progress fill |

In dark mode the brand shifts **brighter** so it glows. Note that `cloud-light` and `cloud-deep` swap lightness between themes; that's intentional.

**Use cloud-blue for:** hover/active tint on interactive elements, focus rings, active-filter indicators, links, the headline accent and the logo.
**Never for:** errors or warnings, body text, decorative backgrounds, or chart gradients.

### 5.4 Semantic pairs

Each semantic color is a pair: **`fg`** for text, icons and dots, and **`bg`** for tinted fills such as badges and icon wells. Tinted fills are almost always combined with `shadow-inset-sm` so they read as pressed-in wells. In dark mode, `fg` gets brighter and `bg` becomes a deep tint, so wells still recede.

| Pair | Light fg / bg | Dark fg / bg | Meaning (general) | Kairos usage |
|---|---|---|---|---|
| **amber** | `#b87333` / `#f0d9b8` | `#f5a04f` / `#3a2818` | Incomplete, pending, in progress | "Niet compleet", maintenance "Bezig" |
| **red** | `#b04545` / `#f0c8c8` | `#e87878` / `#3a1f1f` | Error, rejected, destructive | "Niet geaccordeerd", error banners, remove-hover |
| **purple** | `#7a5fb3` / `#d8cfeb` | `#b794f6` / `#2e2348` | Finance, "improved" | Payroll, "Verbeterd" release badge |
| **orange** | `#c4763a` / `#f2d5b8` | `#f59e4f` / `#3a2614` | Deviation, under target | Under-capacity chip |
| **cyan** | `#4a8fa8` / `#c8e0e8` | `#7ac4e0` / `#1a2c32` | Over target, informational | Over-capacity chip |
| **green** | `#5a8a4a` / `#d2e2c0` | `#9bcf85` / `#1f2e1a` | Success, all clear, new | "Alles in orde", "Nieuw" badge, loaded dot |
| **grey** | `#6b6f7e` / `#dcdbd4` | `#9d9db4` / `#28253a` | Neutral flag | Capacity check |
| **yellow** | `#a38a2a` / `#ece1b8` | `#f5d76e` / `#352c14` | Duplicate, needs attention | Double bookings |

Tailwind: `text-k-amber-fg`, `bg-k-amber-bg`, `bg-k-amber-fg` (for dots), and the same for every pair.

#### Chart and bar fills

Graphs and bars use the same pairs, but **the fill changes sides between themes**:

- **Light mode:** the pale **`bg`** tint, flat. On the cream canvas the saturated `fg` looks too heavy for a big area.
- **Dark mode:** the saturated **`fg`**. The dark `bg` tints are too close to the canvas, so a column would barely show and wouldn't read as the same color as its legend dot.
- **Legend dot:** always the **`fg`**, in both themes.

| Tone | Light fill (`bg`) | Dark fill (`fg`) | Dot, light / dark (`fg`) |
|---|---|---|---|
| **green** | `#d2e2c0` | `#9bcf85` | `#5a8a4a` / `#9bcf85` |
| **purple** | `#d8cfeb` | `#b794f6` | `#7a5fb3` / `#b794f6` |
| **yellow** | `#ece1b8` | `#f5d76e` | `#a38a2a` / `#f5d76e` |
| **orange** | `#f2d5b8` | `#f59e4f` | `#c4763a` / `#f59e4f` |
| **amber** | `#f0d9b8` | `#f5a04f` | `#b87333` / `#f5a04f` |
| **red** | `#f0c8c8` | `#e87878` | `#b04545` / `#e87878` |
| **cyan** | `#c8e0e8` | `#7ac4e0` | `#4a8fa8` / `#7ac4e0` |
| **grey** | `#dcdbd4` | `#9d9db4` | `#6b6f7e` / `#9d9db4` |

In code this is the `bar` entry of the `TONE` map (`lib/tone.ts`): `bar: "bg-k-green-bg dark:bg-k-green-fg"`. Write it out in full for every tone, because Tailwind can't see class names that are built at runtime (§17). Use `TONE[tone].bar` for the fill and `TONE[tone].dot` for the legend dot.

- **No blending, no outline.** Mixing the dark `fg` into the tint shifts the hue and looks murky. An `fg` ring around a light-mode column was tried and dropped.
- **Printed reports always use the light fill (`bg`)**, because the print stylesheet fixes the report to light tokens (§8.2).
- **Color never carries identity on its own.** The light tints are too close together to tell apart, so every column shows its value on the cap and its label underneath.

**Actions are not colored.** Buttons are neutral raised surfaces whose label turns cloud-deep on hover. Color on a button only signals destructive intent (red text on hover, for example). **One exception:** the submit dock's **Verzenden** — the page's single commit action — is filled `bg-k-cloud-deep` with `text-k-bg` (the selected-calendar-day pairing, legible in both themes) so it stands out. Don't add a second.

### 5.5 shadcn tokens (Nymbus-tuned)

shadcn components read these, so they inherit the palette automatically.

| Token | Light | Dark |
|---|---|---|
| `--background` / `--card` | `#f5f0eb` | `#1a1626` |
| `--foreground` / `*-foreground` | `#31344b` | `#e8e4f0` |
| `--popover` | `#ffffff` | `#2a2438` |
| `--primary` / `--accent` | `#5fa8d3` | `#a5d8f0` |
| `--primary-foreground` / `--accent-foreground` | `#ffffff` | `#1a1626` |
| `--secondary` | `#cfe8f5` | `#2f2940` |
| `--muted` | `#d9d2c8` | `#2f2940` |
| `--muted-foreground` | `#6b6f8e` | `#a8a2bc` |
| `--destructive` | `#b04545` | `#e87878` |
| `--border` / `--input` | `#d9d2c8` | `rgba(255,255,255,.08)` / `rgba(255,255,255,.10)` |
| `--ring` | `#a5d3ec` | `#5fa8d3` |
| `--chart-1…5` | cloud-deep, green, yellow, amber, red (light fg values) | same hues, dark fg values |
| `--sidebar-*` | mirrors background / primary / secondary / border / ring | same |

Prefer `k-*` utilities in your own components. Use the shadcn names (`bg-background`, `text-muted-foreground`, `text-destructive`) only inside shadcn primitives or for quick one-offs.

### 5.6 Special-purpose tokens

| Token | Light | Dark | Use |
|---|---|---|---|
| `--k-ambient` | `none` | 3 radial gradients (violet 20%/10%, orange 80%/90%, yellow 60%/50%) | Body `background-image`, dark-only cosmic glow |
| `--k-cap-under` / `-exact` / `-over` | `#FFB38E` / `#7db533` / `#5fa8d3` | `#FFB38E` / `#C7EABB` / `#BFECFF` | Capacity-bar fills only (§18): Kairos, and the Uren Import Kalender day cards (worked vs. roster) |
| `--k-cap-sick` / `-leave` | `#e3bb3a` / `#9478d4` | `#F3E2A6` / `#DCCFF5` | Uren Import Kalender day cards only: the Verzuim / Verlof fills, at the same strength as `-exact` / `-over` |

---

## 6. Shadows & depth

The most important part of the system. Every surface uses one of these shadows. They're built from `--k-highlight` and `--k-shade`, so they **adapt to the theme automatically**. Never define a shadow per theme in a component.

### 6.1 Primitives

| Token | Tailwind | Value (x/y offset, blur) | Use |
|---|---|---|---|
| `--k-shadow-raised` | `shadow-raised` | ±6px, 12px | Cards, panels, logo plates, primary buttons, popovers, toasts |
| `--k-shadow-raised-sm` | `shadow-raised-sm` | ±4px, 8px | Standard buttons at rest, row cards, secondary actions |
| `--k-shadow-raised-xs` | `shadow-raised-xs` | ±2px, 4px | Tiny chip buttons (e.g. "Wissen ✕") |
| `--k-shadow-lifted` | `shadow-lifted` | ±8px, 16px | **Hover** state of raised elements |
| `--k-shadow-lifted-sm` | `shadow-lifted-sm` | ±6px, 12px | **Hover** state of raised-sm elements |
| `--k-shadow-inset` | `shadow-inset` | inset ±4px, 8px | **Pressed** large elements, expanded row cards |
| `--k-shadow-inset-sm` | `shadow-inset-sm` | inset ±3px, 6px | Inputs, badges, icon wells, progress tracks, status pills, **pressed** small elements |
| `--k-shadow-hover-card` | `shadow-(--k-shadow-hover-card)` | lifted-sm + cloud-blue glow (22% light / 30% dark) | Hover on list or row cards |
| `--k-shadow-card-active` | `shadow-(--k-shadow-card-active)` | light: inset · dark: raised outer + inset | Selected or toggled cards (KPI filter on) |

Every shadow is a **pair**: highlight at the top-left (negative offset) and shade at the bottom-right (positive offset). Never use a single one-sided shadow.

**Dark-mode tuning (already in `globals.css`):** `inset` and `inset-sm` use a softer shade (`#15111f`) and a smaller offset in dark mode, because the near-black `--k-shade` makes pressed wells look like holes. `card-active` keeps the raised outer shadow so the card's footprint doesn't jump when selected.

### 6.2 Mental model: rest, hover and press

| State | Shadow | Transform | Label color |
|---|---|---|---|
| **Rest** | `raised` / `raised-sm` | none | `text-k-text-primary` |
| **Hover** | `lifted` / `lifted-sm` (bigger, softer) | none | `text-k-cloud-deep` |
| **Pressed / active** | `inset` / `inset-sm` | `translateY(0)`, optionally `scale(0.99)` | stays `text-k-cloud-deep` |
| **Disabled** | `inset-sm` | none | 55% opacity, `cursor-not-allowed` |

The surface color **never** changes between states; only the lighting does. That's what makes it feel physical.

### 6.3 Other shadows in use

| Where | Value |
|---|---|
| Modal panel | `--k-shadow-modal` / `shadow-modal`: `-4px -4px 8px` highlight at 50% + `6px 6px 12px` shade (§10.11) |
| Side sheet edge | `-12px 0 32px var(--k-shade), -1px 0 0 var(--k-highlight)` (in `.neu-sheet`) |
| Focus ring on inset fields | `var(--k-shadow-inset-sm), 0 0 0 2px var(--k-cloud-light)` |
| Status dot glow | `0 0 6px var(--k-green-fg)` / `0 0 6px var(--k-cloud-mid)` |

**Never** mix in Material-style drop shadows (`0 4px 8px rgba(0,0,0,.1)`, `shadow-md`, `shadow-lg`). They clash with the neumorphic pairs.

---

## 7. Radius & spacing

### 7.1 Radius scale

Nymbus **overrides** Tailwind's radius scale in `@theme`. `rounded-lg` is 16px, not 8px.

| Utility | Value | Used for |
|---|---|---|
| `rounded-pill` / `rounded-full` | 9999px | Buttons, inputs, form fields, badges, status pills, progress tracks, dots |
| `rounded-sm` | 8px | Calendar days, small controls |
| `rounded-[10px]` | 10px | 36px icon buttons (`neu-icon-btn`), command items |
| `rounded-md` | 12px | 42px icon wells, header status bar |
| `rounded-[14px]` | 14px | Toasts, selected chips |
| `rounded-lg` | 16px | Row cards, popovers, 52px header logo plate |
| `rounded-xl` | 20px | KPI / stat cards |
| `rounded-2xl` | 22px | Large panels (table container), selected form fields |
| `rounded-3xl` | 28px | Hero cards (sign-in), hero logo plate |
| `rounded-4xl` | 32px | Extra-large surfaces |

> **Consequence for shadcn:** base-nova components use `rounded-lg`, so under Nymbus their buttons and inputs get 16px corners and look almost pill-shaped at `h-8`. That's intended.

**Rule of thumb:** the bigger the surface, the bigger the radius. Controls are pills.

### 7.2 Spacing

The default Tailwind spacing scale, with these recurring values:

| Where | Value |
|---|---|
| Page gutter (left/right) | `px-9` (36px) |
| Header | `px-9 py-4`, `gap-6` between zones, `gap-5` logo→title, `gap-3` between actions |
| Section below header | `px-9 pb-4` |
| Card grids | `gap-4` (16px) |
| Stat card interior | `p-[18px]`, `gap-3.5` (14px) icon→text |
| Large panel interior | 16px sides (`px-4`); header row `pt-3.5 pb-2` |
| Row cards | `mb-2` between cards |
| Sheet header | `pt-5 px-6 pb-4` (20 / 24 / 16) |
| Hero card | `px-11 pt-11 pb-9` (44 / 44 / 36), `max-w-[420px]` |
| Form stack | `gap-3.5` (14px); label→field `mb-1.5` (6px) |
| Badge padding | `px-2 py-0.5` (8 × 2) |
| Chip / pill gap | `gap-1` to `gap-2` |

---

## 8. Themes (light / dark)

### 8.1 Mechanism

1. `next-themes` sets `data-theme="light" | "dark"` on `<html>` (§3.8).
2. `globals.css` defines every token on `:root` and overrides it in `[data-theme="dark"]`.
3. Components reference tokens only, so they re-color automatically.
4. `@custom-variant dark (&:is([data-theme="dark"] *));` makes Tailwind's `dark:` prefix follow the same attribute (shadcn primitives rely on this).

### 8.2 Rules

- **Components never read the theme to pick a color.** No `resolvedTheme === "dark" ? "#fff" : "#000"` and no `dark:` classes for Nymbus colors. If something looks wrong in one theme, **fix the token** in `globals.css`.
- There are three legitimate places that read `resolvedTheme`, and all are about *content*, not color: (1) the theme toggle's icon, (2) Sonner's `theme` prop, (3) a `mounted` guard around either.
- `dark:` is fine inside shadcn primitives, which use it for opacity tweaks against the shadcn tokens.
- **Exception: chart and bar fills.** A fill is `bg` in light mode and `fg` in dark mode (§5.4, *Chart and bar fills*). This swaps which of two existing tokens is used, not the color itself, so no token needs to change. Keep the `dark:` class inside the `TONE[tone].bar` entry, never inline in a component.
- **Print is always light.** The printable report sets the light `--k-*` values again inside `@media print`, so a dark screen never prints a black A4 page.
- Always use `resolvedTheme`, never `theme`, which can be the literal `"system"`.

### 8.3 Dark-mode ambience

Two layers make dark mode feel like a night sky instead of an inverted UI:

1. **Ambient glow:** `--k-ambient` holds three soft radial gradients (violet, orange, yellow) applied as the body's `background-image` with `background-attachment: fixed`. In light mode it's `none`.
2. **Starfield:** `<div className="starfield" aria-hidden="true" />` sits once in the root layout. It's a fixed layer painted with 10 tiny radial-gradient dots, **only** under `[data-theme="dark"]`. Keep it to about 10 stars; more starts to look like a screensaver.

Full-screen pages that paint their own background (such as a loading screen) should reuse the ambient glow:

```tsx
<div className="min-h-screen bg-k-bg bg-fixed text-k-text-primary [background-image:var(--k-ambient)]">…</div>
```

### 8.4 Theme transition

`body { transition: background 0.4s ease, color 0.4s ease; }` gives a soft cross-fade on switch. Components carry their own 0.15–0.25s transitions, so shadows re-light smoothly with no extra work.

### 8.5 Adding a new token

1. Add the light value under `:root`, as `--k-<name>`.
2. Add the dark value under `[data-theme="dark"]`, designed for the night room rather than inverted.
3. If you want a Tailwind utility, map it in `@theme inline`: `--color-k-<name>: var(--k-<name>);` (or `--shadow-<name>` for shadows).

---

## 9. shadcn/ui

### 9.1 Setup specifics

- **Style: `base-nova`.** Components are built on **Base UI** (`@base-ui/react`), not Radix. The main API difference is composition: use the **`render` prop** instead of `asChild`:

  ```tsx
  <SheetTrigger render={<button className="neu-button …" />}>
    <Wrench size={14} /> DEV Tools
  </SheetTrigger>
  ```

- **Add components with the CLI and never re-init:**

  ```bash
  npx shadcn@latest add button card dialog popover sheet tooltip command calendar collapsible scroll-area separator textarea input-group
  ```

  After each `add`, check `git diff app/globals.css`. The CLI may inject its own token values; revert them to the Nymbus values.
- `shadcn/tailwind.css` (imported in `globals.css`) provides state variants such as `data-open:`, `data-closed:`, `data-checked:` and `data-selected:`, plus accordion keyframes.

### 9.2 Components in use (Kairos)

| Component | Notes |
|---|---|
| `button` | Stock base-nova `cva` variants. Picks up Nymbus via `--primary`, `--muted` etc. Use for utility buttons inside shadcn surfaces; use `neu-*` recipes for hero and toolbar actions. |
| `card` | **Simplified, hand-written** (plain `div`s with `data-slot`). Flat (`border shadow-sm`), so for Nymbus surfaces prefer the raised panel recipe (§10.4). |
| `input` | **Hand-written compact input** (`text-xs`, thin border) for dense inline editing. For forms, use `neu-input` / `neu-form-field`. |
| `sheet`, `popover`, `tooltip` | Stock. Skin with `neu-sheet` / `neu-popover` (below). |
| `dialog` | **Not used for modals.** Modals are built from tokens with a portal (§10.11), because the stock dialog's flat border and `shadow-lg` fight the neumorphic depth. |
| `command` | Stock (cmdk). Inside `neu-popover` its items become inset-on-hover pills. |
| `calendar` | Stock (react-day-picker). Inside `neu-popover` days get 8px radius, cloud-deep selection and cloud-light hover. |
| `collapsible`, `scroll-area`, `separator`, `textarea`, `input-group` | Stock. |
| `virtual-table` | **Custom**, not shadcn: the virtualized TanStack Table core with the raised 22px panel, inset pill filters and row cards. |

### 9.3 Skinning shadcn with `neu-*` classes

`globals.css` ships component classes that restyle shadcn parts through their `data-slot` attributes, so you don't need to fork the primitives:

```tsx
<Sheet>
  <SheetTrigger render={<button className="neu-button inline-flex cursor-pointer items-center gap-1.5 rounded-full px-4 py-2 text-[13px]" />}>
    <Wrench size={14} /> DEV Tools
  </SheetTrigger>

  <SheetContent className="neu-sheet">            {/* cream panel, soft left edge shadow, 22px/700 title, inset-on-hover close */}
    <SheetHeader>
      <SheetTitle>DEV Tools</SheetTitle>
    </SheetHeader>

    <div className="flex flex-col gap-3.5 px-6">
      <label className="neu-form-label">Client</label>
      <Popover>
        <PopoverTrigger render={<button className="neu-form-field" />}>
          <span className="flex-1 truncate">Kies een client</span>
          <ChevronDown />
        </PopoverTrigger>
        <PopoverContent className="neu-popover">   {/* raised, 16px, cmdk items inset on hover */}
          <Command>
            <CommandInput placeholder="Zoeken…" />
            <CommandList>
              <CommandItem>…</CommandItem>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <button className="neu-action-primary mt-2">Opslaan</button>
    </div>
  </SheetContent>
</Sheet>
```

| Class | Applies to | Effect |
|---|---|---|
| `neu-sheet` | `SheetContent` | `--k-bg` surface, soft edge shadow, restyled header, title and close button |
| `neu-popover` | `PopoverContent` | Raised, 16px, 6px padding; styles cmdk items, input and calendar days |
| `neu-form-label` | `<label>` | 11px / 500 / uppercase / 0.4px, secondary |
| `neu-form-field` | Trigger button or input | Inset pill, 42px min height; cloud-light ring on focus or open; tertiary placeholder; 14px icon that turns cloud-deep when open |
| `neu-form-field-selected` | + `neu-form-field` | 22px radius and top-aligned content, for multi-select chip lists |
| `neu-selected-list` / `neu-selected-chip` (`-id`, `-name`, `-remove`) | Multi-select chips | Cloud-tinted inset chips with a red-on-hover remove button |
| `neu-icon-btn` | 36px icon button | Flat at rest, inset and cloud-deep on hover; `data-active="true"` keeps it pressed in (header toggles) |
| `neu-action-primary` | Main action | Raised pill, 14/600, lifted on hover, inset when active, disabled state |
| `neu-action-secondary` | Secondary action | Raised-sm pill, 13/500 secondary text |

### 9.4 When to skip shadcn

Build straight from tokens (§10) when the element is **tactile and signature**: stat or KPI cards, row cards, status pills, the header, hero or auth cards, charts (§10.7) and **modals** (§10.11). shadcn's flat defaults (borders, `shadow-sm`) fight the neumorphic depth.

---

## 10. Component recipes

All recipes are **Tailwind-first** and use the `k-*` utilities. For reference, this is what the same styling looks like inline, which is how most of Kairos is written today:

```tsx
// Inline equivalent — valid, but prefer the utilities below in new code
<div style={{ background: "var(--k-bg)", boxShadow: "var(--k-shadow-raised)", borderRadius: 20, color: "var(--k-text-primary)" }} />
// ≙ className="rounded-xl bg-k-bg text-k-text-primary shadow-raised"
```

> **Semantic tones as a class map.** Tailwind only generates classes it can find as complete strings, so never build `bg-k-${tone}-bg` at runtime. Use a map instead:
>
> ```ts
> export const TONE = {
>   amber:  { text: "text-k-amber-fg",  fill: "bg-k-amber-bg",  dot: "bg-k-amber-fg"  },
>   red:    { text: "text-k-red-fg",    fill: "bg-k-red-bg",    dot: "bg-k-red-fg"    },
>   purple: { text: "text-k-purple-fg", fill: "bg-k-purple-bg", dot: "bg-k-purple-fg" },
>   orange: { text: "text-k-orange-fg", fill: "bg-k-orange-bg", dot: "bg-k-orange-fg" },
>   cyan:   { text: "text-k-cyan-fg",   fill: "bg-k-cyan-bg",   dot: "bg-k-cyan-fg"   },
>   green:  { text: "text-k-green-fg",  fill: "bg-k-green-bg",  dot: "bg-k-green-fg"  },
>   grey:   { text: "text-k-grey-fg",   fill: "bg-k-grey-bg",   dot: "bg-k-grey-fg"   },
>   yellow: { text: "text-k-yellow-fg", fill: "bg-k-yellow-bg", dot: "bg-k-yellow-fg" },
> } as const
> export type Tone = keyof typeof TONE
> ```

### 10.1 Buttons

**Header toggle buttons** (settings, theme): flat 36px `neu-icon-btn`s placed next to each other with `gap-3`. They have **no raised shadow**, so the header controls stay quiet next to the raised content cards.

```tsx
<div className="flex items-center gap-3">
  <button
    type="button"
    onClick={() => setConfigModalOpen(true)}
    data-active={configModalOpen}
    aria-pressed={configModalOpen}
    aria-label="Configuratie"
    title="Configuratie"
    className="neu-icon-btn"
  >
    <Settings size={16} />
  </button>
  <ThemeToggle />
</div>
```

| State | Settings (gear) | Theme (moon / sun) |
|---|---|---|
| Rest | Flat, 16px Lucide gear in `--k-text-tertiary` grey | Flat, 15px violet moon with a violet glow (light mode) |
| Hover | Small inset shadow (`--k-shadow-inset-sm`), icon turns `--k-cloud-deep` | Small inset shadow; the icon keeps its own color |
| On (`data-active="true"`) | Stays pressed in (`--k-shadow-inset`) and cloud-deep while the settings modal is open | Stays pressed in while dark mode is on, showing the gold sun |

In dark mode the same tokens apply. The surface is `--k-bg`, and the inset uses the dark `--k-shade` and `--k-highlight`, so the pressed state is still visible on the dark canvas. Every button that switches something on or off sets `data-active` and `aria-pressed` together (§15).

**Round icon button** (header nav, sign-out): 34px circle, three-state.

```tsx
<button
  type="button"
  aria-label="Vorige periode"
  className="neu-button flex size-[34px] cursor-pointer items-center justify-center rounded-full text-sm disabled:cursor-not-allowed disabled:opacity-30"
>
  ‹
</button>
```

**Pill button with icon + label:**

```tsx
<button className="neu-button inline-flex cursor-pointer items-center gap-1.5 rounded-full px-4 py-2 text-[13px]">
  <Wrench size={14} /> DEV Tools
</button>
```

**Primary action** (auth submit, panel save): bigger shadows, 14/600.

```tsx
<button type="submit" className="neu-action-primary w-full">
  Inloggen <span className="text-base leading-none">→</span>
</button>

{/* or, when you need custom sizing: */}
<button className="neu-button-primary flex cursor-pointer items-center justify-center gap-2 rounded-full px-6 py-3.5 text-sm font-semibold">
  Inloggen →
</button>
```

**Secondary action:**

```tsx
<button className="neu-action-secondary">Annuleren</button>
```

**Quiet icon button** (inside panels and rows): flat until hovered.

```tsx
<button className="neu-icon-btn" aria-label="Sluiten"><X size={16} /></button>

{/* 22px micro version (row edit pencil) */}
<button
  aria-label="Bewerken"
  title="Bewerken"
  className="inline-flex size-[22px] shrink-0 cursor-pointer items-center justify-center rounded-md bg-k-bg text-k-text-tertiary transition-all duration-150 hover:text-k-cloud-deep hover:shadow-inset-sm"
>
  <Pencil size={12} />
</button>
```

**Tiny chip button** (clear filter): raised-xs pill that turns red on hover.

```tsx
<button className="shrink-0 cursor-pointer rounded-full bg-k-bg px-2.5 py-[3px] text-[11px] text-k-text-secondary shadow-raised-xs transition-colors duration-150 hover:text-k-red-fg">
  Wissen ✕
</button>
```

**Link-style text button:**

```tsx
<button type="button" className="cursor-pointer text-[11px] font-medium tracking-[0.3px] text-k-cloud-deep">Vergeten?</button>
```

### 10.2 Inputs

**Search / filter input** (inset pill with a leading glyph):

```tsx
<div className="relative">
  <span className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-[11px] text-k-text-tertiary">⌕</span>
  <input className="neu-input w-full rounded-full py-[7px] pr-2.5 pl-[22px] text-[11px]" placeholder="Medewerker" />
</div>
```

**Form field with label and icon** (auth forms). The icon turns cloud-deep while the field is focused, using `group-focus-within` instead of JS state:

```tsx
<div>
  <label htmlFor="email" className="neu-form-label">E-mail</label>
  <div className="group relative">
    <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-sm text-k-text-tertiary transition-colors group-focus-within:text-k-cloud-deep">✉</span>
    <input id="email" type="email" placeholder="naam@werkgever.nl" className="neu-input w-full rounded-full py-[13px] pr-4 pl-[42px] text-sm" />
  </div>
</div>
```

**Select-style trigger:** `<button className="neu-form-field">…</button>`, opening a `neu-popover` (§9.3).

### 10.3 Stat / KPI card (signature element)

A raised card with an inset colored icon well, a big number and a small label. It lifts on hover, sinks when toggled on, and its number turns cloud-deep.

```tsx
import { ClipboardList } from "lucide-react"

<button
  type="button"
  aria-pressed={active}
  onClick={onToggle}
  className="group relative flex w-full cursor-pointer items-center gap-3.5 rounded-xl bg-k-bg p-[18px] text-left shadow-raised transition-[box-shadow,transform] duration-250 hover:shadow-lifted active:scale-[0.99] active:shadow-(--k-shadow-card-active) aria-pressed:shadow-(--k-shadow-card-active)"
>
  {/* Inset icon well — tone from TONE map */}
  <span className="flex size-[42px] shrink-0 items-center justify-center rounded-md bg-k-amber-bg text-k-amber-fg shadow-inset-sm transition-transform duration-200 group-hover:scale-105 group-aria-pressed:scale-100">
    <ClipboardList size={18} />
  </span>

  <span className="min-w-0 flex-1">
    <span className="mb-1.5 block text-[28px] leading-none font-semibold tracking-[-0.5px] text-k-text-primary tabular-nums transition-colors duration-200 group-hover:text-k-cloud-deep group-aria-pressed:text-k-cloud-deep">
      {value.toLocaleString("nl-NL")}
    </span>
    <span className="block text-[11.5px] leading-[1.3] break-words text-k-text-secondary">
      Weken niet compleet
    </span>
  </span>
</button>
```

- **Zero state:** when the value is 0, swap in the green well with a `Check` icon and a positive sentence ("Alle weken zijn compleet") instead of showing a big `0`.
- **Grid:** `grid grid-cols-5 gap-4`. For custom templates always use `minmax(0, 1fr)` (§13).

### 10.4 Surfaces: panels, cards, plates

```tsx
{/* Large panel (tables, main content) */}
<div className="flex h-full flex-col overflow-hidden rounded-2xl bg-k-bg shadow-raised">…</div>

{/* Row / list card — raised-sm → glow on hover → inset when expanded */}
<div
  data-open={open}
  className="mb-2 overflow-hidden rounded-lg bg-k-bg shadow-raised-sm transition-shadow duration-200 hover:shadow-(--k-shadow-hover-card) data-[open=true]:shadow-inset"
>…</div>

{/* Hero card (sign-in, maintenance) — floats up on mount */}
<div className="signin-card flex w-full max-w-[420px] flex-col items-center rounded-3xl bg-k-bg px-11 pt-11 pb-9 shadow-raised">…</div>

{/* Logo plate — header (52px / r16) and hero (96–108px / r26–28, gently drifting) */}
<div className="flex size-[52px] shrink-0 items-center justify-center rounded-lg bg-k-bg shadow-raised"><CloudLogo size={32} /></div>
<div className="signin-logo mb-6 flex size-24 items-center justify-center rounded-[26px] bg-k-bg shadow-raised"><CloudLogo size={56} /></div>

{/* Inset well (nested content, empty states, info blocks) */}
<div className="rounded-md bg-k-bg p-4 shadow-inset-sm">…</div>
```

### 10.5 Status badges

**Labeled badge:** an inset pill with a dot. Render it **only when something is wrong**.

```tsx
<span className="inline-flex items-center gap-1 rounded-full bg-k-amber-bg px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap text-k-amber-fg shadow-inset-sm">
  <span className="size-[5px] shrink-0 rounded-full bg-k-amber-fg" />
  Niet compleet
</span>
```

**Mini badge** (color-only, dense rows): an 18px inset circle with an 11px icon. It **must** carry a `title`.

```tsx
<span title="Payroll" className="inline-flex size-[18px] items-center justify-center rounded-full bg-k-purple-bg text-k-purple-fg shadow-inset-sm">
  <Euro size={11} />
</span>
```

**All clear:** one quiet confirmation instead of a row of green checkmarks.

```tsx
<span className="inline-flex items-center gap-[5px] text-[11px] font-medium text-k-green-fg">
  <span className="inline-flex size-[15px] items-center justify-center rounded-full bg-k-bg text-[9px] shadow-inset-sm">✓</span>
  Alles in orde
</span>
```

**Release or state tag** ("Nieuw", "Verbeterd", "Bezig"): uppercase inset pill.

```tsx
<span className="rounded-full bg-k-green-bg px-2 py-0.5 text-[10px] font-semibold tracking-[0.3px] text-k-green-fg uppercase shadow-inset-sm">Nieuw</span>
```

**Value chip** (e.g. `+4`, `-2`): `rounded-full px-[7px] py-px text-[10px] font-semibold shadow-inset-sm` plus a tone.

### 10.6 Status pill bar

An always-visible inset strip showing context such as counts, the active filter and the last refresh. Only its content changes; it never appears or disappears.

```tsx
<div className="flex min-w-0 flex-1 items-center justify-between rounded-md bg-k-bg px-4 py-2 text-xs text-k-text-secondary shadow-inset-sm transition-all duration-200">
  <span className="flex items-center gap-[7px]">
    <span className="size-[7px] shrink-0 rounded-full bg-k-green-fg shadow-[0_0_6px_var(--k-green-fg)]" />
    <b className="font-medium text-k-text-primary">611</b> medewerkers
    <span className="text-k-text-tertiary">·</span>
    <b className="font-medium text-k-text-primary">2.418</b> weken
    <span className="text-k-text-tertiary">·</span>
    Geladen
  </span>
  <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-k-text-tertiary">
    Bijgewerkt <b className="font-medium text-k-text-secondary">19 sep · 08:30</b>
  </span>
</div>
```

With a filter active, the dot becomes `bg-k-cloud-deep shadow-[0_0_6px_var(--k-cloud-mid)]` and the text reads "Gefilterd op: **{label}** · n resultaten", with the chip button from §10.1.

### 10.7 Progress & capacity bars

An **inset track** with a **solid** fill: no gradient and no glow.

```tsx
<div className="relative h-[7px] overflow-hidden rounded-full bg-k-bg shadow-inset-sm">
  <div className="absolute inset-y-0 left-0 rounded-full bg-k-cloud-deep transition-[width] duration-500" style={{ width: `${pct}%` }} />
</div>
```

`style={{ width }}` is the one place inline style is expected, because the value is dynamic. For an **indeterminate** loader, use a 6px track with a 40%-wide fill animated from `left: -40%` to `left: 100%` over 1.8s, ease-in-out, infinite.

**Column chart** (for example "Uren per categorie"): the same inset track stood upright, filled with the tone's chart fill (§5.4). The fill is the pale `bg` in light mode and the bright `fg` in dark mode. The value sits above the cap, and a label with an `fg` dot sits below the column.

```tsx
<div className="flex w-[72px] shrink-0 flex-col items-center gap-1.5">
  <span className="text-[11px] leading-none font-semibold tabular-nums text-k-text-primary">{formatHours(hours)}</span>
  <div className="flex w-[28px] flex-col justify-end overflow-hidden rounded-md bg-k-bg shadow-inset-sm" style={{ height: 150 }}>
    <div className={`w-full rounded-t-[4px] ${TONE[tone].bar} transition-[height] duration-300 ease-out`} style={{ height: `${h}px` }} />
  </div>
  <span className="flex items-center gap-1 text-[10.5px] text-k-text-secondary">
    <span className={`size-2 shrink-0 rounded-full ${TONE[tone].dot}`} /> {label}
  </span>
</div>
```

Scale the columns against the largest value, not the total, and give every column at least 3px. Leave out categories with zero hours; don't draw an empty column for them.

**Pagination dots:** 6px inset dots; the active one widens to 18px and fills with `bg-k-cloud-deep` (`transition-[width,background] duration-300`).

### 10.8 Banners & messages

```tsx
{/* Error banner — inset red pill */}
<div className="flex w-full items-center gap-2 rounded-full bg-k-red-bg px-3.5 py-2 text-xs text-k-red-fg shadow-inset-sm">
  <span className="size-[5px] shrink-0 rounded-full bg-k-red-fg" />
  Er is een fout opgetreden. Probeer het opnieuw.
</div>

{/* Loading */}
<div className="flex h-24 items-center justify-center">
  <Loader2 className="size-5 animate-spin text-k-text-tertiary" />
</div>

{/* Empty / error line in a section */}
<p className="px-9 text-sm text-k-text-secondary">Er is nog geen data voor deze periode.</p>
<p className="px-9 text-sm text-destructive">Fout bij laden van tabeldata.</p>
```

**Toasts:** `import { toast } from "sonner"` then `toast.success("Opgeslagen")`. The `ThemedToaster` (§3.8) makes them raised, 14px-radius cream (or night) cards at the bottom-right.

### 10.9 Dividers

```tsx
{/* Hairline inside a panel */}
<div className="mx-4 h-px bg-k-divider" />

{/* Labeled divider ("of") */}
<div className="my-5 flex w-full items-center gap-3">
  <div className="h-px flex-1 bg-k-divider" />
  <span className="text-[10px] font-medium tracking-[1px] text-k-text-tertiary uppercase">of</span>
  <div className="h-px flex-1 bg-k-divider" />
</div>

{/* Dense rows: dashed separators; column groups: solid right border */}
<div className="border-b border-dashed border-k-divider" />
<div className="border-r border-k-divider pr-1.5" />
```

Dividers are a last resort. Reach for spacing or a shadow change first.

### 10.10 Data table (Kairos pattern)

- **Container:** raised panel, `rounded-2xl`.
- **Header row:** `grid gap-2 px-4 pt-3.5 pb-2 text-[11px] font-semibold tracking-[0.5px] text-k-text-primary uppercase`.
- **Filter row:** one inset pill search input per column (§10.2), then a hairline divider.
- **Body:** scrollable (`flex-1 overflow-y-auto px-4 pt-2 pb-4`), with rows grouped into **row cards** (§10.4) that turn inset when expanded.
- **Expanded sub-rows:** `day-row` class for a staggered slide-down (`style={{ animationDelay: \`${i * 30}ms\` }}`), dashed separators, 11px secondary text.
- **Every grid column** uses `minmax(0, …)` or percentages so header, filters and rows stay aligned.

### 10.11 Modals

Modals are built **from tokens, not from shadcn `Dialog`** (§9.4). A modal is one cream `--k-bg` panel that floats over a dimmed page. Its sections are divided by hairlines, and all depth comes from the cards and fields *inside* it. There are two sizes:

| Variant | Example | Size |
|---|---|---|
| **Settings modal** (tabs on the left) | `ConfigModal` ("Instellingen") | `h-[90vh] w-full max-w-7xl`: a **fixed** height, so switching tabs never resizes the modal or moves the footer buttons |
| **Confirm dialog** (one column) | `SubmitDialog` ("Uren verzenden") | `max-h-[90vh] w-full max-w-[540px]`: grows with its content and rises in with `animate-[float-up_0.35s_ease_both]` |

```tsx
createPortal(
  // Backdrop: 30% black, no blur (see Backdrop below). Clicking the backdrop itself closes the modal.
  <div
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
    onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
  >
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="config-modal-title"
      className="flex h-[90vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-k-bg shadow-modal"
    >
      {/* Header: title + subtitle on the left, quiet close button on the right */}
      <div className="flex items-center justify-between gap-4 px-6 pt-4 pb-3">
        <div>
          <h2 id="config-modal-title" className="text-lg font-semibold tracking-[-0.3px] text-k-text-primary">Instellingen</h2>
          <p className="mt-0.5 text-[11.5px] text-k-text-secondary">Verbinding met AFAS, kolomkoppen en componentmapping.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Sluiten" className="neu-icon-btn"><X size={16} /></button>
      </div>

      <div className="mx-6 h-px bg-k-divider" />

      {/* Body: tab rail | vertical hairline | scrolling content */}
      <div className="flex min-h-0 flex-1">
        <nav aria-label="Instellingen" className="flex w-52 shrink-0 flex-col gap-1 overflow-y-auto py-3 pl-4">
          <button
            aria-current={isActive ? "page" : undefined}
            className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[12.5px] transition-colors ${
              isActive ? "bg-k-cyan-bg text-k-cyan-fg shadow-inset-sm" : "text-k-text-secondary hover:text-k-text-primary"
            }`}
          >
            <Icon size={15} className="shrink-0" /> <span className="truncate">{label}</span>
          </button>
        </nav>
        <div className="w-px shrink-0 bg-k-divider" />
        <div className="min-w-0 flex-1 overflow-y-auto px-6 py-3">{/* tab content */}</div>
      </div>

      <div className="mx-6 h-px bg-k-divider" />

      {/* Footer: save error on the left, actions on the right */}
      <div className="flex items-center justify-between gap-4 px-6 py-3">
        <div className="min-h-[16px] text-[11.5px] text-k-red-fg">{saveError && `Opslaan mislukt: ${saveError}`}</div>
        <div className="flex items-center gap-2.5">
          <button type="button" onClick={onClose} className="neu-action-secondary">Annuleren</button>
          <button type="button" onClick={handleSave} disabled={!isDirty} className="neu-action-primary">Opslaan</button>
        </div>
      </div>
    </div>
  </div>,
  document.body,
)
```

**Anatomy**

- **Backdrop:** `bg-black/30`, **no `backdrop-blur`**. The page behind stays visible, dimmed. A blur was tried and removed (2026-11): the dialog sits inside the backdrop, so every repaint in it (scroll, hover, focus) re-blurs the whole viewport — on a Retina screen, and in Firefox especially, that made every modal feel sluggish. Don't add it back.
- **Scrolling body:** give a modal's `overflow-y-auto` area its own `bg-k-bg`, so the browser can scroll it as one layer instead of repainting every neu shadow in it per frame. This is the one place a raw black overlay is allowed. It is a scrim over the page, not a surface color, so it works in both themes.
- **Panel:** `bg-k-bg`, `rounded-2xl` (22px), `overflow-hidden`, and `shadow-modal`. **Don't use `shadow-raised` for a panel:** its full-white top-left highlight glows against the dark backdrop. `--k-shadow-modal` is the raised shadow with a tighter highlight at half strength (§6.3).
- **Header:** 18px/600 title with `-0.3px` tracking, and an 11.5px secondary subtitle. A confirm dialog can add a 10px uppercase tertiary eyebrow above the title ("Verzenden naar AFAS"). The close button is a quiet `neu-icon-btn` with an `X`.
- **Hairlines:** `mx-6 h-px bg-k-divider` under the header and above the footer. A `w-px` vertical line separates the tab rail from the content. These are the only lines in a modal; everything else is separated by depth.
- **Tab rail:** `w-52`, and the items have no shadow at rest. The **active tab** is a cyan inset well (`bg-k-cyan-bg text-k-cyan-fg shadow-inset-sm`) and gets `aria-current="page"`. Inactive tabs use secondary text that turns primary on hover. Icons are 15px Lucide.
- **Content:** scrolls on its own (`min-h-0 flex-1 overflow-y-auto`), so the header and footer stay fixed.
  - Group fields in **raised cards** (`rounded-xl bg-k-bg p-4 shadow-raised-sm`), side by side with `grid grid-cols-2 gap-4`.
  - Each card header has a 13px/600 title on the left and an 11px tertiary blurb on the right.
  - Fields are **inset pills** (`neu-input rounded-full px-3 py-1.5 text-[12px]`) in a label/field grid: `grid-cols-[minmax(0,108px)_minmax(0,1fr)]`. Labels are 11.5px secondary, with an optional 10.5px tertiary hint underneath.
  - Actions inside a card (for example "Verbinding testen") use `neu-action-secondary` with an icon, followed by an 11px tertiary status text.
  - A notice is a flat tinted block (`rounded-xl bg-k-amber-bg px-3.5 py-2.5 text-[11px] text-k-amber-fg`) that starts with a bold **"Let op:"**. A load error is the red inset pill with a 5px dot (§10.8).
- **Footer:** the save error sits on the left in 11.5px `k-red-fg`, and reserves its height with `min-h-[16px]` so the footer doesn't jump when an error appears. The actions sit on the right: `neu-action-secondary` "Annuleren", then `neu-action-primary` "Opslaan". The primary action stays **disabled until something has changed** and shows a spinner while saving.

**Behavior**

- Render the modal with `createPortal(…, document.body)` so it sits above the starfield wrapper (§3.7).
- **Escape** and a **mousedown on the backdrop** both close the modal. Use `onMouseDown` and check `e.target === e.currentTarget`, so a text selection that starts inside the panel and ends outside doesn't close it. While a submit is running, block both.
- The trigger button shows it's on while the modal is open: `data-active` and `aria-pressed` on the header gear (§10.1).
- **Dark mode:** there's nothing to override. The panel, hairlines, cards, inset fields and `--k-shadow-modal` all come from tokens. The cyan and amber pairs switch to their deep dark tints with bright text.

---

## 11. Icons & brand assets

### 11.1 Icon library: Lucide

- `lucide-react` v1 (set as shadcn's `iconLibrary`). Import named icons: `import { Loader2, Pencil } from "lucide-react"`. Both `X` and `XIcon` style names exist; shadcn primitives use the `…Icon` names.
- Icons inherit `currentColor`, so **color them through the parent's text token** (`text-k-amber-fg`, `hover:text-k-cloud-deep`). Don't pass `color=` hex props.
- Keep the default stroke width (2).

| Size | Where |
|---|---|
| 11 | Inside 18px mini badges |
| 12 | Inside 22px micro buttons |
| 14 | In pill buttons next to a label, in form fields (`neu-form-field` forces 14) |
| 16 (`size-4`) | shadcn default inside `Button`; quiet 36px icon buttons |
| 18 | Inside 42px icon wells (stat cards), third-party logos |
| 20 (`size-5`) | Section spinners (`Loader2 … animate-spin text-k-text-tertiary`) |

Icons Kairos uses, as a vocabulary: `ClipboardList` (completeness), `BadgeCheck` (approval), `Euro` (payroll), `TrendingUp` (capacity), `Copy` (duplicates), `Check`, `X`, `Plus`, `Trash2`, `Undo2`, `Pencil`, `Loader2`, `Wrench` (dev tools), `Calculator`, `ArrowLeft`, `ChevronLeft/Right/Down`, `Search`.

### 11.2 Unicode glyphs

Small round header buttons and inline hints use **typographic glyphs** instead of SVG icons. That's part of the hand-crafted feel:

| Glyph | Use |
|---|---|
| `‹` `›` | Previous / next (period navigation) |
| `⇥` | Sign out |
| `☀` / moon SVG | Theme toggle |
| `✓` | All-clear check |
| `✕` | Clear / remove in chip buttons |
| `⌕` | Search hint inside filter inputs |
| `✉` `⚿` | Email / password field hints |
| `→` | Trailing arrow on the primary action |
| `·` | Separator in labels ("Nymbus · Kairos", "19 sep · 08:30") |
| `—` | Empty value (§14) |

### 11.3 Brand logo: the Nymbus cloud

Two overlapping hand-inked clouds — a pale blue one behind, an off-white one in front with a blue swell — in a heavy black ink outline with hatching strokes. Three flat fills, no gradients. The artwork is a fixed-color asset, not token-driven: its colors belong to the logo, so it looks the same in both themes.

The source drawing is `nymbus-logo.png` in the repo root (1536×1024, on paper). The SVG is traced from it into three stacked layers: the ink silhouette, then the blue fills, then the white fills. `nymbus-logo.svg` in the root is the same file as the one in `public/`.

| File | Use |
|---|---|
| `apps/web/public/nymbus-logo.svg` | The logo in the UI, through `CloudLogo` |
| `apps/web/public/nymbus-logo.png` | 512px transparent raster for places SVG can't go (e-mail, exports) |
| `apps/web/src/app/icon.svg` | Browser favicon (Next `icon` file convention) |
| `apps/web/src/app/apple-icon.png` | Home-screen icon (Next `apple-icon` file convention), on an opaque `--k-bg` cream: iOS fills transparent areas with black, which would hide the outline |

```tsx
import Image from "next/image";

export function CloudLogo({ size = 56 }: { size?: number }) {
  return (
    <Image src="/nymbus-logo.svg" width={size} height={size} alt="" aria-hidden="true" preload className="block" />
  );
}
```

- **Sizes:** 32px in the 52px header plate, 56px in the 96px auth plate.
- **Hex values stay in the asset.** Don't inline the SVG into a component; render the file.
- **Placement:** always on a raised plate (§10.4). Hero and auth plates animate with `signin-logo` (6s drift) or `maint-illu` (8s drift with tilt).
- **Product label** always follows the logo: `NYMBUS · <PRODUCT>` eyebrow (§4).

### 11.4 Third-party logos

Lucide v1 ships no brand icons. Inline the official SVG (e.g. the four-color Google "G" at 18px on the "Doorgaan met Google" button) and keep its official colors. That is the only other place hardcoded colors are allowed.

---

## 12. Motion

### 12.1 Timing

| What | Duration | Easing |
|---|---|---|
| Hover color shift | 0.15–0.2s | ease |
| Shadow change, standard button (`neu-button`) | 0.2s | ease |
| Shadow change, large or primary (`neu-button-primary`, cards) | 0.25s | ease |
| Press transform | 0.15s (standard), 0.2s (large) | ease |
| Icon-well scale on hover | 0.2s | ease |
| Bar width | 0.5s | ease |
| Chart column height | 0.3s | ease-out |
| Dots / pagination width | 0.3s | ease |
| Row expand (`day-row`) | 0.25s, **30ms stagger** per row | ease |
| Theme cross-fade (body) | 0.4s | ease |
| Entrance (`float-up`), page cards | 0.6–0.7s, 0.1s stagger between cards | ease |
| Entrance (`float-up`), dialogs and the submit dock | 0.35s | ease |
| Ambient loops (`drift`, `drift-cloud`, breathe) | 4–8s infinite | ease-in-out |
| Auto-rotating content | every 7s, 0.5s fade | ease |

**Why shadow is slower than transform:** a snappier transform with a softer shadow feels like a real button, while equal speeds feel mushy.

In Tailwind: `transition-[box-shadow,transform] duration-250`. Tailwind's default easing is `cubic-bezier(0.4,0,0.2,1)`; add `ease-[ease]` if you need an exact match with the CSS classes.

### 12.2 Keyframes (in `globals.css`)

| Keyframe | Motion | Ready-made classes |
|---|---|---|
| `slideDown` | fade in + 8px down → 0 | `.day-row` |
| `float-up` | fade in + 12px up → 0 | `.signin-card`, `.maint-card`, `.maint-card-delay-1/2`; dialogs via `animate-[float-up_0.35s_ease_both]` |
| `drift` | bob 6px up and down | `.signin-logo` |
| `drift-cloud` | bob 8px with ±1° tilt | `.maint-illu` |
| `drift-tape` | slide a 32px stripe | caution tape (maintenance) |
| `pulse` | amber ring expanding from a dot | maintenance status dot |

Use them on any element with Tailwind arbitrary animations: `animate-[float-up_0.6s_ease_both]`, `animate-[drift_6s_ease-in-out_infinite]`.

**Rule:** motion is ambient and soft. Nothing bounces, overshoots or flashes.

---

## 13. Layout patterns

### 13.1 App shell (dashboard)

```tsx
<div className="flex h-svh flex-col overflow-hidden">
  {/* Header: logo plate + eyebrow + title/nav · status pill (flex-1) · actions */}
  <header className="flex items-center justify-between gap-6 px-9 py-4">
    <div className="flex items-center gap-5">{/* logo plate + title block */}</div>
    {/* status pill bar — §10.6 */}
    <div className="flex items-center gap-3">{/* Settings · ThemeToggle (§10.1) */}</div>
  </header>

  {/* KPI / stat row */}
  <section className="px-9 pb-4">
    <div className="grid grid-cols-5 gap-4">{/* stat cards */}</div>
  </section>

  {/* Main panel fills the rest */}
  <main className="min-h-0 flex-1 px-9 pb-9">
    <div className="h-full overflow-hidden rounded-2xl bg-k-bg shadow-raised">…</div>
  </main>
</div>
```

### 13.2 Centered page (auth, maintenance, errors)

```tsx
<div className="relative flex min-h-screen flex-col">
  <div className="absolute top-6 right-7 z-10"><ThemeToggle /></div>
  <main className="flex flex-1 items-center justify-center p-8">
    {/* hero card — §10.4 (signin-card rounded-3xl bg-k-bg shadow-raised …) */}
  </main>
</div>
```

### 13.3 Side panel (detail or edit)

`<SheetContent side="right" className="neu-sheet w-full !max-w-[520px] gap-0 border-0 p-0">`. The header has an eyebrow (10px uppercase, 1.5px tracking), a 22/700 title and a quiet close button.

### 13.4 Grid rule

Every flexible grid column is wrapped in `minmax(0, …)`:

```css
grid-template-columns: repeat(5, minmax(0, 1fr));             /* equal cards regardless of label length */
grid-template-columns: 20px minmax(0, 1.4fr) minmax(0, 2fr);   /* aligned tables */
```

A bare `1fr` lets long `nowrap` content widen its column and break alignment. Pair it with `min-w-0` on flex children and `truncate` or `break-words` on text.

---

## 14. Data display & copy

- **Empty values render as `—`** (em-dash, U+2014) in tertiary at weight 300. Never render blank, `N/A` or `0` for missing data, and never `—` for a real zero.

  ```tsx
  export const Empty = () => <span className="font-light text-k-text-tertiary">—</span>
  // {value ?? <Empty />}
  ```

- **Numbers:** `tabular-nums`, right- or center-aligned in columns, localized with `toLocaleString("nl-NL")` (`2.418`). Signed differences show an explicit `+`.
- **Units** are secondary: `32<span className="text-k-text-tertiary"> / 40h</span>`.
- **Dates:** short Dutch month names (`19 sep 2026`, `19 sep · 08:30`), with `·` as the separator.
- **Negative signal** in numbers: tint `text-k-red-fg` only when negative actually means a problem.
- **Copy tone:** short, friendly, Dutch for end users. Positive zero states ("Alle weken zijn compleet") instead of bare zeros.
- **Uppercase** only for small labels (eyebrows, form labels, table headers, tags), always with positive tracking.

---

## 15. Accessibility

Neumorphism trades contrast for tactility. Compensate as follows:

1. **Text contrast:** body text is always `text-primary` or `text-secondary`. Tertiary is for decoration, placeholders and em-dashes only.
2. **Focus must be visible.** Inset fields get the 2px cloud-light ring (built into `neu-input` and `neu-form-field`). For raised buttons, use an **outline** (not `ring-*`, see §17) so the neumorphic shadow survives:

   ```tsx
   className="neu-button … focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-k-cloud-mid"
   ```

3. **Prefer `:active` / `aria-pressed` over JS mouse state** for pressed looks. Keyboard and touch then get the same feedback. (Kairos's KPI card still uses `onMouseDown` state; new code should use the §10.3 recipe.)
4. **Icon-only elements** get `aria-label`, and color-only mini badges get a `title`.
5. **`aria-expanded`** on expandable rows, **`aria-pressed`** on toggle cards and header toggle buttons (together with `data-active`, §10.1), **`aria-current="page"`** on the active modal tab, and `aria-hidden` on decorative layers (starfield, logo).
6. **Reduced motion.** *Recommended addition, not yet in Kairos*: append this to `globals.css`:

   ```css
   @media (prefers-reduced-motion: reduce) {
     *, *::before, *::after {
       animation-duration: 0.01ms !important;
       animation-iteration-count: 1 !important;
       transition-duration: 0.01ms !important;
     }
   }
   ```

---

## 16. Do / Don't

| ✅ Do | ❌ Don't |
|---|---|
| Use `k-*` tokens and utilities for every color and shadow | Hardcode hex values in components |
| Use `bg-k-bg` for every surface and change depth with shadows | Give cards their own background colors, or use pure `#fff` / `#000` (the `bg-black/30` modal scrim is the one exception) |
| Use paired shadows (`shadow-raised`, `shadow-inset-sm`, `shadow-modal` for modal panels) | Use `shadow-md` / Material drop shadows, one-sided shadows, or `shadow-raised` on a modal panel |
| Use rest → lifted → inset for raised controls, and flat → inset for quiet icon buttons (§10.1) | Change the surface color on hover |
| Use cloud-deep for hover, active and focus tints | Use cloud-blue for errors, body text or backgrounds |
| Use semantic `fg`/`bg` pairs in inset wells, and the §5.4 chart fills for bars | Use saturated or neon colors, or gradients on data |
| Use Poppins everywhere with `tabular-nums` for figures | Introduce a second display font |
| Render `—` for empty and "Alles in orde" for all-clear | Render blanks, `N/A`, or a row of green checks |
| Fix theme issues in the token layer | Write `theme === "dark" ? …` or use `dark:` for Nymbus colors (except `TONE[tone].bar`, §8.2) |
| Design dark mode as a warm-purple night | Invert light mode or use cold navy |
| Keep the starfield to ~10 stars | Skip it, or clutter it |
| Use pills for controls and a bigger radius for bigger surfaces | Use sharp corners or hard 1px borders as primary separation (modal hairlines are the exception, §10.11) |
| Use full class strings in a `TONE` map | Build `bg-k-${tone}-bg` dynamically |

---

## 17. Gotchas

1. **Don't run `shadcn init`** in an existing Nymbus app; it rewrites `globals.css`. Copy `components.json` and use `shadcn add`. Check the CSS diff after every `add`.
2. **`ring-*` replaces `neu-*` shadows.** Tailwind rings are box-shadows. On elements styled with a `neu-*` class, a `focus:ring-2` overrides the neumorphic shadow. Use `outline-*` for focus there. (With the `shadow-*` utilities, rings do compose correctly.)
3. **Don't mix `neu-button` with `shadow-*` utilities** on the same element. Both set `box-shadow`, and whichever comes last wins, so the result is unpredictable. Pick one approach per element.
4. **Tailwind v4 buttons default to `cursor: default`.** Add `cursor-pointer` to clickable non-shadcn buttons.
5. **Dynamic class names aren't generated.** Use complete strings (`TONE` map, §10).
6. **`@keyframes pulse` name collision.** The maintenance status ring in `globals.css` is called `pulse`, the same name as Tailwind's `animate-pulse`. When anything in the app uses `animate-pulse` (a shadcn Skeleton, for example), Tailwind emits its own `@keyframes pulse` *after* the Nymbus one, and it wins: the amber ring turns into an opacity blink. In new apps, rename the Nymbus keyframe (e.g. `status-pulse`) and update its `animation:` reference.
7. **Base UI, not Radix:** use `render={<button … />}` instead of `asChild`. Radix-based snippets from older shadcn docs won't drop in unchanged.
8. **`dark:` matches descendants of `[data-theme="dark"]`**, not `<html>` itself. That's fine for components; don't rely on `dark:` on the `html` element.
9. **`@theme inline` is required** for the token mappings. Without `inline`, Tailwind resolves values at build time and theme switching stops re-coloring utilities.
10. **Hydration:** anything that depends on the theme (the toggle icon) needs a `mounted` guard, and `<html>` needs `suppressHydrationWarning`. Build the guard with `useSyncExternalStore` (§3.9). The `useEffect(() => setMounted(true))` version is rejected by the react-hooks lint rules.
11. **Radius scale is overridden** (`rounded-lg` = 16px). Snippets copied from other projects will look rounder than they did there.
12. **Stacking:** page content must sit inside the `relative z-[1]` wrapper, or it renders underneath the fixed starfield.

---

## 18. Appendix: Kairos domain mappings

Useful as a worked example of mapping domain states to the semantic palette. Keep these in lockstep across KPI cards, week badges and day badges.

| Check key | Label | Tone | Icon |
|---|---|---|---|
| `checkCompleet` | Niet compleet | amber | `ClipboardList` |
| `checkGeaccordeerd` | Niet geaccordeerd | red | `BadgeCheck` |
| `checkPayroll` | Payroll / niet uitbetaald | purple | `Euro` |
| `checkWithinCapacity` | Over capaciteit | grey | `TrendingUp` |
| `checkNietDubbel` | Dubbele boeking | yellow | `Copy` |

**Capacity bar:** caption `{worked} / {scheduled}h` with a signed diff chip, and an inset 7px track with a solid fill.

| State | Fill token | Chip tone |
|---|---|---|
| Under (diff < 0) | `--k-cap-under` | orange |
| Exact (diff = 0) | `--k-cap-exact` | green |
| Over (diff > 0) | `--k-cap-over` | cyan |
| Nothing booked (0 hours, roster > 0) | `--k-cap-under`, striped (`.cap-under-stripes`) | orange |
| No schedule | no bar, render `—` | — |
