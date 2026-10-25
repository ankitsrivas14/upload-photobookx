# Ledger redesign plan

Every admin screen, the login page and the customer upload page move to Ledger, the approved
PhotoBookX design system: white paper, black ink, 1px rules instead of cards, IBM Plex Sans with
Plex Mono figures, one deep green accent, light and dark themes.

The work lives on branch `redesign/ledger-shell` (worktree `.claude/worktrees/ledger-redesign`).
`main` keeps the old screens until the redesign ships (see Shipping).

## The design system

| Piece | File |
|---|---|
| Tokens: colours, type, spacing, radii, shadows, z-index, light and dark | `frontend/src/styles/tokens.css` |
| Components: `Button`, `Menu`, `TextField`, `Select`, `Checkbox`, `Switch`, `SegmentedControl`, `Dropzone`, `OptionCard`, `PageHeader`, `Tabs`, `Stepper`, `StatCard`, `StatStrip`, `Amount`, `Badge`, `DeliveryBadge`, `DataTable`, `DataList`, `Heatmap`, `Card`, `Avatar`, `Alert`, `Toast`, `EmptyState`, `Skeleton`, `Tooltip`, `Dialog`, `Drawer`, `PhotoTile` | `frontend/src/components/ui/pbx.tsx`, styled by `pbx.css` |
| Icons (`<Icon name="…" />`, Lucide shapes) | `frontend/src/components/ui/icons.ts` |
| `formatINR`, `cx` | `frontend/src/components/ui/format.ts` |
| Chart styling for Recharts | `frontend/src/pages/dashboard/chartStyles.ts` |
| Admin shell: sidebar, topbar, theme switch | `frontend/src/layouts/AdminLayout.tsx` |

Reference screens: `DashboardPage.tsx` and `SalesPage.tsx`.

## Rules for every screen

1. Build from the `pbx` components. Don't hand-roll buttons, inputs, selects, tables, badges, tabs,
   cards, dialogs, drawers, alerts, tooltips or empty states.
2. Take every colour, font, size, radius, shadow and z-index from the tokens (`var(--…)`). Hex,
   `rgb()` and `hsl()` values belong in `tokens.css` only.
3. Page layout goes in the page's `.module.css`, built on tokens. Use inline `style` only for
   computed values, such as a bar's width or a chart's height.
4. Show money with `Amount` or `formatINR`, and figures in Plex Mono (`.pbx-num`). Join class
   names with `cx`. Draw icons with `Icon`; add a missing icon to `icons.ts` instead of importing
   `lucide-react`.
5. If a screen needs a component Ledger lacks, add it to `pbx.tsx` and `pbx.css` (tokens only,
   both themes) and use it from there.
6. Every screen works in light and dark, at phone width without sideways scrolling, and with a
   visible keyboard focus. Ask for confirmation with `Dialog`, never `window.confirm` or `alert`.
7. Restyle without changing behaviour: data fetching, the query cache, virtualisation and API
   calls stay as they are. If a change is needed, say so in the commit.
8. `npm run lint:design` (in `frontend/`) passes. It fails on colour literals, raw font
   families, `confirm`/`alert` and `lucide-react` imports outside the files still listed as
   legacy in `frontend/scripts/check-design.mjs`.

## Status

| Area | Screen | Files (`frontend/src/…`) | Lines | Status |
|---|---|---|---|---|
| Shell | Sidebar, topbar, theme switch | `layouts/AdminLayout` | 137 | Done |
| Dashboard | Dashboard | `pages/DashboardPage`, `pages/dashboard/*` | 1,348 | Done |
| Sales | Sales management | `pages/SalesManagementPage`, `pages/SalesPage`, `pages/SalesPage/*` | 2,660 | Done |
| Orders | Backlog | `pages/BacklogPage` | 261 | Done |
| Orders | Abandoned checkouts | `pages/AbandonedCheckoutsPage` | 263 | In progress |
| Analysis | Section tabs | `pages/AnalysisPage` | 163 | To do |
| Analysis | Claude Analysis | `pages/analysis/ClaudeAnalysis` | 247 | To do |
| Analysis | Agency | `pages/analysis/Agency` | 540 | To do |
| Analysis | Tickets | `pages/analysis/TicketsAnalysis`, `pages/analysis/CreateTicketForm` | 812 | To do |
| Analysis | Stuck orders | `pages/analysis/StuckOrdersAnalysis` | 712 | To do |
| Analysis | Failed orders | `pages/analysis/FailedOrdersAnalysis` | 238 | To do |
| Analysis | Pincodes | `pages/analysis/PinCodesAnalysis` | 516 | To do |
| Analysis | Reels | `pages/analysis/Reels` | 287 | To do |
| Expenses | Section tabs | `pages/ExpensesPage` | 146 | To do |
| Expenses | Overview | `pages/ExpensesOverview` | 106 | To do |
| Expenses | Meta ads | `pages/MetaAdsPage` | 290 | To do |
| Expenses | Fixed monthly | `pages/FixedMonthlyPage` | 233 | To do |
| Expenses | COGS | `pages/COGSPage` | 489 | To do |
| Expenses | Bank account | `pages/BankAccountPage` | 1,211 | To do |
| Tools | Section tabs | `pages/ToolsPage` | 149 | Done |
| Tools | GST reports | `pages/GSTReportsPage`, `pages/GSTMonthlyReports` | 527 | In progress |
| Tools | Products | `pages/tools/ProductsManager` | 480 | In progress |
| Tools | Labels | `pages/tools/Labels` | 270 | In progress |
| Tools | Variant performance | `pages/tools/VariantPerformance` | 232 | In progress |
| Tools | Profit prediction | `pages/ProfitPredictionCalculator` | 437 | In progress |
| Tools | Stock prediction | `pages/StockPrediction` | 334 | In progress |
| People | Attendance | `pages/AttendancePage` | 864 | To do |
| Access | Login | `pages/AdminLogin` | 116 | To do |
| Customer | Photo upload (magic link) | `pages/UploadPage` | 954 | To do |

## Phases

1. **Guardrails.** This plan, the rules in the repo's `CLAUDE.md`, and `npm run lint:design`.
2. **Daily screens.** Backlog, then Abandoned checkouts.
3. **Analysis.** Section tabs, Claude Analysis, Agency, Tickets with the ticket form, Stuck
   orders, Failed orders, Pincodes, Reels.
4. **Expenses.** Section tabs, Overview, Meta ads, Fixed monthly, COGS, Bank account.
5. **Tools.** Section tabs, GST reports, Products, Labels, Variant performance, Profit
   prediction, Stock prediction.
6. **Attendance and login.**
7. **Customer upload page.** Phone first, built from `Stepper`, `OptionCard`, `Dropzone` and
   `PhotoTile`. Customers see this page, so check it on a real phone.
8. **Cleanup.**
   - Delete the unrouted `pages/AdminDashboard.tsx`; Products borrows its CSS, so move that
     first.
   - Delete the orphaned `pages/analysis/TaggingLogsAnalysis.module.css`.
   - Remove Tailwind (nothing uses its classes), the Poppins rules in `index.css`, and the
     `lucide-react`, `@radix-ui/react-dropdown-menu`, `class-variance-authority`,
     `tailwind-merge` and `clsx` packages once nothing imports them.
   - Empty the legacy list in `check-design.mjs`, then run `lint:design` in the build.
   - Compare the bundle size with today's.

## How each screen moves

1. Read the old screen and list everything it does (fields, filters, actions, empty and error
   states), so nothing is lost.
2. Rebuild it from the `pbx` components on its existing data calls.
3. Check it at http://localhost:5173 (the dev server reads the production API; sign in
   yourself): light and dark, 375px wide, keyboard only.
4. Run `npm run build` and `npm run lint:design` in `frontend/`. Both must pass.
5. Remove the screen's files from the legacy list, set its Status row to Done, and commit only
   that screen's files.

## Shipping

The new shell makes old-style screens look out of place, so `main` takes the redesign in one go
once phases 2–6 are done (the upload page can follow on its own). Merge `main` into the branch,
check every route, then fast-forward `main` so Vercel ships it.

## Working in parallel

More than one session works in this worktree. Before starting a screen, set its Status to "In
progress" here. Stage only your own files (`git add <paths>`, never `git add -A`), and don't edit
a screen that another session has in progress.

Current split (2026-10-25): one session works down the sidebar from the top (Backlog first);
another takes the Tools area from the bottom.
