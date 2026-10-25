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
- Screens work in light and dark, at phone width, and by keyboard. Confirm with `Dialog`, never
  `window.confirm` or `alert`.
- Run `npm run lint:design` and `npm run build` in `frontend/` before committing.
- Reference screens: `pages/DashboardPage.tsx` and `pages/SalesPage.tsx`.

The rollout plan, its status table and the per-screen steps are in `docs/ledger-redesign-plan.md`.
Mark a screen "In progress" there before you start it, because more than one session works on the
redesign.
