#!/usr/bin/env node
// Ledger design check (`npm run lint:design`). Screens use the components in
// src/components/ui/pbx.tsx and take every colour and font from src/styles/tokens.css, so this
// fails on colour literals, raw font families, confirm()/alert() and lucide-react imports.
// Files still on the old styles are listed in LEGACY and skipped until their screen moves (a .tsx
// entry covers its .module.css too). Remove a screen's entries in the commit that moves it;
// docs/ledger-redesign-plan.md tracks the rollout.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const TOKENS = 'styles/tokens.css';

const LEGACY = new Set([
  'index.css',
  'pages/AdminDashboard.tsx',
  'pages/AdminLogin.tsx',
  'pages/AnalysisPage.tsx',
  'pages/AttendancePage.tsx',
  'pages/BankAccountPage.tsx',
  'pages/COGSPage.tsx',
  'pages/ExpensesOverview.tsx',
  'pages/ExpensesPage.tsx',
  'pages/FixedMonthlyPage.tsx',
  'pages/MetaAdsPage.tsx',
  'pages/ProfitPredictionCalculator.tsx',
  'pages/StockPrediction.tsx',
  'pages/UploadPage.tsx',
  'pages/analysis/Agency.tsx',
  'pages/analysis/ClaudeAnalysis.tsx',
  'pages/analysis/CreateTicketForm.tsx',
  'pages/analysis/FailedOrdersAnalysis.tsx',
  'pages/analysis/PinCodesAnalysis.tsx',
  'pages/analysis/Reels.tsx',
  'pages/analysis/StuckOrdersAnalysis.tsx',
  'pages/analysis/TaggingLogsAnalysis.module.css',
  'pages/analysis/TicketsAnalysis.tsx',
  'pages/tools/Labels.tsx',
  'pages/tools/ProductsManager.tsx',
  'pages/tools/VariantPerformance.tsx',
]);

const RULES = [
  {
    message: 'colour literal; use a token from styles/tokens.css',
    test: (line, css) => (css ? /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/ : /['"`]#[0-9a-fA-F]{3,8}['"`]|\b(?:rgba?|hsla?)\(/).test(line),
  },
  {
    message: 'font family; use var(--font-sans) or var(--font-mono)',
    test: (line, css) => (css ? /font-family\s*:(?!\s*(?:var\(--font-|inherit))/ : /fontFamily\s*:\s*['"`](?!var\(--font-|inherit)/).test(line),
  },
  {
    message: 'confirm()/alert(); use Dialog or Alert',
    test: (line, css) => !css && /\b(?:confirm|alert)\(/.test(line),
  },
  {
    message: 'lucide-react import; use Icon from components/ui/pbx',
    test: (line, css) => !css && /from\s+['"]lucide-react['"]/.test(line),
  },
];

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

const isLegacy = (rel) => LEGACY.has(rel) || (rel.endsWith('.module.css') && LEGACY.has(rel.replace(/\.module\.css$/, '.tsx')));

const problems = [];
let checked = 0;
let skipped = 0;
for (const file of walk(SRC)) {
  const rel = relative(SRC, file).split(sep).join('/');
  if (!/\.(tsx?|css)$/.test(rel) || rel === TOKENS) continue;
  if (isLegacy(rel)) {
    skipped++;
    continue;
  }
  checked++;
  const css = rel.endsWith('.css');
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    for (const rule of RULES) if (rule.test(line, css)) problems.push(`  src/${rel}:${i + 1}  ${rule.message}`);
  });
}
for (const rel of LEGACY) {
  if (!existsSync(join(SRC, rel))) problems.push(`  src/${rel}  is in LEGACY but no longer exists; remove the entry`);
}

if (problems.length) {
  console.error(`Ledger design check: ${problems.length} problem(s)\n${problems.join('\n')}`);
  process.exit(1);
}
console.log(`Ledger design check passed: ${checked} files checked, ${skipped} legacy files skipped.`);
