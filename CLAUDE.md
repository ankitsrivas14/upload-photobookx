# upload-photobooks

PhotoBookX admin: a Vite + React frontend (`frontend/`, on Vercel) and an Express API run as Firebase
Cloud Functions (`backend/`, Firestore database `upload-photobookx`).

## Frontend UI: always use the Ledger design system

Every UI change in `frontend/` uses Ledger. No exceptions for "quick" screens, dialogs or fixes.

- Components come from `frontend/src/components/ui/pbx.tsx` (styled by `pbx.css`). Icons are
  `<Icon name="…" />` from the same module, with shapes in `icons.ts`. `formatINR` and `cx` are in
  `format.ts`.
- Colours, fonts, spacing, radii, shadows and z-index come from `frontend/src/styles/tokens.css`
  as `var(--…)`. No hex, `rgb()` or `hsl()` anywhere else.
- Page layout goes in the page's `.module.css`, on tokens. Use inline `style` only for computed
  values.
- If Ledger lacks a component, add it to `pbx.tsx`/`pbx.css` (tokens only, light and dark), not
  inside a page.
- Nothing the browser draws itself: `Select`, not `<select>`; `DateField`, not a date or month
  input; `TextField`, not a raw `<input>`; `Tooltip` or a Button's `tooltip`, not a `title`
  attribute. Fields show their own validation messages and toasts render as our `Toast`.
- Screens work in light and dark, at phone width, and by keyboard. Confirm with `Dialog`, never
  `window.confirm` or `alert`.
- `npm run build` in `frontend/` runs `lint:design` first, so a violation fails the build and the
  Vercel deploy. Run it before committing.
- Reference screens: `pages/DashboardPage.tsx` and `pages/SalesPage.tsx`.

The rollout plan, its status table and the per-screen steps are in `docs/ledger-redesign-plan.md`.
Mark a screen "In progress" there before you start it, because more than one session works on the
redesign.
