# devwanna* — design system

shared design contract for all devwanna\* apps.
inheritance is full and non-negotiable. per-app docs only **add** or **specialize**, never override.

> read this top-to-bottom before writing any UI code. when ambiguity exists, the strictest interpretation wins.

---

## 0. philosophy (non-negotiable)

| principle | meaning |
|---|---|
| **local-first** | no account, no cloud, no telemetry. data on user's machine. |
| **quiet** | UI does not demand attention. no badges, modals on launch, onboarding flows. |
| **flat** | no shadows, no gradients, no glassmorphism, no blur. |
| **monospace** | all text is monospace. this is a developer tool. |
| **fast** | opens in <1s. no splash screen. autosave under 400ms. |

if a feature conflicts with these principles → **principles win**.

---

## 1. absolute rules

### MUST

- use Geist Mono for **all** text. no exceptions.
- use Material Symbols Outlined (weight 400, fill 0) for **all** icons. no other icon sets.
- use design tokens (CSS variables) for **all** colors. no hardcoded hex except in `index.css` token definitions.
- use the spacing scale (`xs sm md lg xl`) for padding/margin/gap. no arbitrary px values.
- use the 32px / 40px / 48px height grid for all interactive components.
- handle right-click via the app's custom `ContextMenu` component. native menu is suppressed globally.
- handle keyboard shortcuts via the global keymap. document every new shortcut in the cheatsheet.
- persist UI state to SQLite `app_settings` (panel sizes, theme, last selection, etc.).
- support **all 6 themes** for any new component. test in dark + light + at least one accent (pink/nord/rose-pine).

### MUST NOT

- ❌ no `box-shadow` (except 0 0 to override browser defaults).
- ❌ no `border-radius` on components — except 4px on scrollbar thumb and 10px on the window outer.
- ❌ no `linear-gradient`, `radial-gradient`, no `backdrop-filter`.
- ❌ no native browser context menu, native file dialog, native window controls.
- ❌ no animations beyond the 3 sanctioned curves (see §6).
- ❌ no spinners, skeletons, or loading shimmer. use a static `loading…` text in `text-on-surface-variant`.
- ❌ no toast popups for routine success (autosave, navigation). toasts are for **events**, not feedback.
- ❌ no decorative SVG. no illustrations. no mascots.
- ❌ no font-weight 700 (bold) unless the token explicitly allows it. use 600 for emphasis.
- ❌ no inline `style={...}` for color/spacing — must go through Tailwind tokens.

---

## 2. color system

colors are CSS variables defined as RGB tuples. Tailwind consumes them via `rgb(var(--c-X) / <alpha-value>)`.

### token contract

every theme **MUST** define every token. partial themes are forbidden.

| token | role | example use |
|---|---|---|
| `--c-background` | window/page background | body, main panes |
| `--c-surface` | same as background by default | section bg |
| `--c-surface-container-lowest` | deepest recess | code block bg |
| `--c-surface-container-low` | subtle panel | TopBar, sidebar bg |
| `--c-surface-container` | mid panel | card bg |
| `--c-surface-container-high` | borders, hover bg | divider lines |
| `--c-surface-container-highest` | strong panel | selected item bg |
| `--c-surface-variant` | active state bg | selected nav item |
| `--c-on-surface` | primary text | body content |
| `--c-on-surface-variant` | secondary text, icons | labels, metadata |
| `--c-primary` | accent color | active button bg, links |
| `--c-on-primary` | text on primary | button label |
| `--c-outline` | strong border | focus rings |
| `--c-outline-variant` | subtle border | input border |
| `--c-error` | destructive, error | trash button, errors |
| `--c-on-error` | text on error | error toast |

### state colors (deterministic)

| state | bg | text | border |
|---|---|---|---|
| default | transparent or `surface` | `on-surface-variant` | `surface-container-high` |
| hover | `surface-container-high` | `on-surface` | unchanged |
| active / selected | `surface-variant` | `primary` | `primary` (left border 2px if list) |
| focus | unchanged bg | unchanged | `outline-variant` (1px) |
| disabled | unchanged | `on-surface-variant`, `opacity-50` | unchanged |
| danger | unchanged | `error` | unchanged |

### themes (closed set)

| class | scheme | added when |
|---|---|---|
| `theme-dark` (default) | dark | v1 |
| `theme-light` | light | v1 |
| `theme-pink` | light | v1 |
| `theme-rose-pine` | dark | v1 |
| `theme-solarized-light` | light | v1 |
| `theme-nord` | dark | v1 |

new themes require a system-level decision, not per-app.

---

## 3. typography

| role | size | weight | letter-spacing | line-height |
|---|---|---|---|---|
| `headline` | 14px | 600 | 0 | 1.2 |
| `body-md` | 13px | 400 | 0.01em | 1.55 |
| `body-sm` | 12px | 400 | 0.01em | 1.55 |
| `code` | 12px | 400 | 0.01em | 1.55 |
| `label-caps` | 10px | 400 | 0.05em (uppercase) | 1.2 |

font: `"Geist Mono", ui-monospace, monospace`. no fallback beyond this.
font-weight 500 is allowed for medium emphasis. **700 is forbidden.**

---

## 4. spacing scale

use these tokens. nothing else.

| token | px | use for |
|---|---|---|
| `xs` | 4 | tight gaps, icon padding |
| `sm` | 8 | button padding x, gap between siblings |
| `md` | 12 | container padding, modal padding |
| `lg` | 16 | section padding, edge insets |
| `xl` | 24 | page-level vertical rhythm |

**arbitrary px values like `p-[7px]` or `m-3.5` are forbidden.** if you need a value not on the scale, the design is wrong.

---

## 5. component dimensions (fixed grid)

interactive components must land on the height grid:

| height | use |
|---|---|
| 24px | inline tags, chips, badges |
| 32px | icon buttons, list items, inputs, select |
| 40px | primary action buttons (the "main" button per screen) |
| 48px | TopAppBar, ZenBar, page header |
| 64px | unused (reserved) |

widths follow same grid where applicable. exceptions require justification in PR.

---

## 6. motion

three sanctioned curves. **anything else is forbidden.**

| name | duration | easing | use |
|---|---|---|---|
| `dwt-anim-width` | 160ms | ease-out | panel resize, sidebar collapse |
| `dwt-fade` | 180ms | ease-in-out | overlay show/hide, preview swap |
| `dwt-pulse` | 1.2s | ease-in-out infinite | save indicator dot only |

no spring physics. no stagger. no parallax. no scroll-linked animation.

---

## 7. components (inventory)

every devwanna\* app SHALL have these. they are imported, not reimplemented.

### core (in `src/components/`)

| component | purpose | rules |
|---|---|---|
| `TopAppBar` | window chrome | 48px height, drag region, hamburger left, controls right |
| `SideNavBar` | left rail | 220px default, collapsible to 48px icon-only |
| `ResizeHandle` | panel divider | 4px hit area, invisible until hover |
| `WindowControls` | min/max/close | custom-styled, replaces native chrome |
| `Icon` | symbol wrapper | size in px (12 / 14 / 16 / 18 / 24) |
| `Overlay` | modal backdrop | `bg-background/70`, click outside to close |
| `ContextMenu` | right-click menu | flat, monospace, no shadow, custom-themed |
| `GlobalContextMenu` | right-click router | global handler, replaces native menu app-wide |
| `ConfirmDialog` | yes/no prompt | text-only, flat, 2 buttons (cancel + danger or confirm) |
| `ToastViewport` | event notifications | bottom-right stack, 3s auto-dismiss |
| `ErrorBoundary` | crash safety | shows message + reload button, never blank screen |

### layout primitives

- panels resize via `ResizeHandle`
- panel widths persist to SQLite `app_settings` immediately on resize end
- collapse states persist (boolean per panel)

---

## 8. naming conventions

### files

- React components: `PascalCase.tsx` (e.g. `EditorArea.tsx`)
- hooks: `useCamelCase.ts` (e.g. `useGlobalShortcuts.ts`)
- stores: `store.ts` inside the feature folder
- pure utilities: `kebab-case.ts` (e.g. `detect-language.ts`) — *or* `camelCase.ts` if the project's existing style uses that. pick one per repo, stick to it.

### CSS / Tailwind

- prefix custom CSS classes with `dwt-` (e.g. `dwt-fade`, `dwt-anim-width`).
- never use `style={...}` for color or spacing. use Tailwind classes referencing tokens.
- Tailwind extends in `tailwind.config.ts`: every color comes from `--c-*`, every spacing from the scale.

### CSS variables

- color tokens: `--c-<material-name>` (e.g. `--c-on-surface-variant`).
- non-color custom props: `--<app-prefix>-<descriptor>` (e.g. `--cm-font-size`).

### state stores (Zustand)

- one store per feature (`useLayoutStore`, `useSettingsStore`, …).
- actions are verbs (`setX`, `toggleX`, `bumpX`, `resetX`).
- no derived state in stores — derive in components or selectors.

### keyboard shortcuts

- document in `cheatsheet.tsx` immediately when added.
- use `Mod+` (cross-platform: Cmd on macOS, Ctrl elsewhere).
- never reuse a shortcut for two different actions in the same context.

---

## 9. data layer (universal)

every devwanna\* app uses SQLite via `tauri-plugin-sql`. one DB file per app.

### DB path convention

| OS | path |
|---|---|
| Windows | `%APPDATA%\dev.wanna<name>.app\<name>.db` |
| macOS | `~/Library/Application Support/dev.wanna<name>.app/<name>.db` |
| Linux | `~/.local/share/dev.wanna<name>.app/<name>.db` |

### universal tables

every app SHALL include `app_settings` (key/value) for persisting UI state.

```sql
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

state SHALL be persisted via debounced writes (200–400ms) to avoid thrashing.

### migrations

- migration files: `src-tauri/migrations/NNNN_description.sql`.
- versioned linearly, never edited after release.
- registered in `src-tauri/src/lib.rs`.

---

## 10. settings modal (required surface)

every app has a Settings modal with these tabs minimum:

| tab | content |
|---|---|
| **Appearance** | theme picker (6 swatches, current highlighted) |
| **Storage** | DB path display, "Open data folder", "Export all data" |
| **About** | app name, version, license, GitHub link |

app-specific tabs are added between Appearance and Storage.

---

## 11. universal keyboard shortcuts

these MUST be implemented identically in every devwanna\* app:

| shortcut | action |
|---|---|
| `Ctrl+B` | toggle sidebar |
| `Ctrl+K` | command palette |
| `Ctrl+,` | open settings |
| `F11` | zen mode |
| `?` | open cheatsheet |
| `Esc` | close topmost overlay |

per-app shortcuts are additive. conflicts forbidden.

---

## 12. zen mode (required mode)

`F11` toggles zen mode:

- hides everything except the **primary content area**.
- a single small `fullscreen_exit` button at top-right (28×28px, opacity 40%, hover 100%).
- exit via `F11` or click the button.
- zen state is **not persisted** (always off on startup).

---

## 13. window chrome

- `decorations: false` in `tauri.conf.json`.
- `TopAppBar` has `data-tauri-drag-region` on bar background and app name span.
- custom `WindowControls` (min, max-restore, close) on the right.
- window border-radius: 10px, outline 1px `surface-container-high`, applied via `.dwt-window` class.

---

## 14. accessibility minimums

| requirement | rule |
|---|---|
| keyboard | every interactive element reachable via Tab. no traps. |
| focus | visible focus ring (`outline-variant`) on all focusable elements. never `outline: none` without replacement. |
| ARIA | every icon-only button has `aria-label`. context menus have `role="menu"` + `role="menuitem"`. |
| contrast | text contrast ratio ≥ 4.5:1 against bg in every theme. validate with browser devtools. |
| motion | respect `prefers-reduced-motion` — disable `dwt-fade` and `dwt-anim-width`. |
| color | never convey state with color alone. always pair with icon or text. |

---

## 15. anti-patterns (forbidden by name)

things that should never appear in a devwanna\* app, ever:

- ❌ rounded cards or buttons (border-radius > 0)
- ❌ drop shadows on hover
- ❌ "elevation" levels (we are 2D)
- ❌ glass / frosted blur effects
- ❌ animated illustrations on empty states
- ❌ skeleton loaders
- ❌ loading spinners (text only: `loading…` muted)
- ❌ snackbars/toasts for routine actions
- ❌ "did you know?" tips
- ❌ first-launch onboarding tours
- ❌ cookie banners (we have no cookies)
- ❌ A/B testing flags
- ❌ feature flags exposed to users
- ❌ AI-generated content of any kind ("smart suggest", "auto-summarize")
- ❌ telemetry, analytics, crash reporting that calls home

---

## 16. checklist for new components

before merging any new component, verify:

```
[ ] uses only design tokens (no hex, no arbitrary spacing)
[ ] respects the height grid (24/32/40/48 px)
[ ] tested in 6 themes
[ ] no shadows, no gradients, no border-radius (except scrollbar)
[ ] icon buttons have aria-label
[ ] keyboard reachable + visible focus
[ ] right-click goes through GlobalContextMenu (not native)
[ ] persistent state goes to app_settings (not localStorage)
[ ] no new fonts, no new icon packs
[ ] documented in cheatsheet if it adds a shortcut
[ ] no telemetry, no network call to third-party
```

failing any item = does not merge.

---

## 17. checklist for new app (devwanna\<name\>)

before opening v0.1:

```
[ ] DESIGN_devwanna<name>.md created, references this file
[ ] copies src/styles/index.css verbatim (token system + 6 themes)
[ ] reuses TopAppBar, SideNavBar, Overlay, ContextMenu, GlobalContextMenu,
    ConfirmDialog, ToastViewport, ErrorBoundary, Icon
[ ] app_settings table exists, state persists
[ ] Settings modal with Appearance + Storage + About
[ ] universal shortcuts implemented (Ctrl+B/K/,/F11/?/Esc)
[ ] zen mode (F11)
[ ] custom window chrome (decorations: false + WindowControls)
[ ] data path follows convention (dev.wanna<name>.app)
[ ] cheatsheet modal listing all shortcuts
[ ] CI workflow (frontend + tauri-build matrix)
[ ] release workflow (msi/dmg/deb/rpm/AppImage)
```

---

## 18. evolution

- this document is versioned with the family. tag it (`design-v1`, `design-v2`).
- breaking changes require a major version bump and migration notes.
- additions are minor; removals are breaking.
- per-app docs cite the design system version they target.

---

*if your idea conflicts with this contract, that's fine — discuss in an issue first. don't ship it and apologize later.*
