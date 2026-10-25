#!/usr/bin/env node
// Ledger design check (`npm run lint:design`). Screens use the components in
// src/components/ui/pbx.tsx and take every colour and font from src/styles/tokens.css, so this
// fails on colour literals, raw font families, confirm()/alert()/prompt() and lucide-react imports.
// It also fails on controls the browser draws itself, which look and behave unlike the rest of the
// app: <select> and other native widgets, raw <input>s, date/colour/range pickers and `title`
// tooltips. pbx.tsx builds the app's own versions (Select, DateField, TextField, Tooltip).
// `npm run build` runs it first, so a problem fails the build and the Vercel deploy. Every screen is
// on Ledger, so LEGACY is empty; add a file there only as a short-lived, explained exception (a .tsx
// entry covers its .module.css too).

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const TOKENS = 'styles/tokens.css';

const LEGACY = new Set([]);

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
    message: 'confirm()/alert()/prompt(); use Dialog or Alert',
    test: (line, css) => !css && /\b(?:confirm|alert|prompt)\(/.test(line),
  },
  {
    message: 'lucide-react import; use Icon from components/ui/pbx',
    test: (line, css) => !css && /from\s+['"]lucide-react['"]/.test(line),
  },
];

const PBX = 'components/ui/pbx.tsx';
const NATIVE = /^(?:select|textarea|datalist|details|progress|meter|dialog)$/;
const PICKER = /\btype=["'](?:date|month|week|time|datetime-local|color|range)["']/;

// A JSX tag's own attributes: the text from after its name to the ">" that closes it, read past
// strings, template literals, comments and {expressions}. Each expression comes back as "{}", so a
// check sees this tag's attributes and not those of JSX nested inside them.
function tagAttributes(text, i) {
  const stack = []; // open "{" and "`", innermost last
  let quote = null;
  let top = '';
  for (; i < text.length; i++) {
    const c = text[i];
    const inner = stack[stack.length - 1];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      // A "string" inside an expression that reaches a line end was JSX text ("Don't"), not a string.
      else if (c === '\n' && stack.length) quote = null;
      if (!stack.length) top += c;
    } else if (inner === '`') {
      if (c === '\\') i++;
      else if (c === '`') stack.pop();
      else if (c === '$' && text[i + 1] === '{') {
        stack.push('{');
        i++;
      }
    } else if (c === '/' && text[i + 1] === '/') {
      i = text.indexOf('\n', i);
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i) + 1;
    } else if (c === '`') {
      stack.push('`');
    } else if (c === '{') {
      if (!stack.length) top += '{}';
      stack.push('{');
    } else if (c === '}') {
      stack.pop();
    } else if (c === '>' && !stack.length) {
      return top;
    } else {
      if (c === '"' || c === "'") quote = c;
      if (!stack.length) top += c;
    }
    if (i < 0) break;
  }
  return top;
}

// Browser-drawn controls in a screen's JSX (pbx.tsx itself may wrap the native elements).
function controlProblems(rel, text) {
  const found = [];
  const tag = /<([A-Za-z][\w.]*)(?=[\s/>])/g;
  for (let m; (m = tag.exec(text)); ) {
    const name = m[1];
    const top = tagAttributes(text, m.index + m[0].length);
    const at = `  src/${rel}:${text.slice(0, m.index).split('\n').length}  `;
    if (PICKER.test(top)) found.push(at + 'browser date/colour/range picker; use DateField');
    if (/^[a-z]/.test(name) && /(?:^|\s)title=/.test(top)) found.push(at + 'title attribute (the browser\'s tooltip); use Tooltip, or Button tooltip');
    if (rel === PBX) continue;
    if (NATIVE.test(name)) found.push(at + `<${name}>; use the pbx component (Select, TextField multiline, Dialog)`);
    if (name === 'input' && !/\btype=["'](?:file|hidden)["']/.test(top)) found.push(at + 'raw <input>; use TextField, DateField, Checkbox or Switch');
  }
  return found;
}

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
  const text = readFileSync(file, 'utf8');
  text.split('\n').forEach((line, i) => {
    for (const rule of RULES) if (rule.test(line, css)) problems.push(`  src/${rel}:${i + 1}  ${rule.message}`);
  });
  if (rel.endsWith('.tsx')) problems.push(...controlProblems(rel, text));
}
for (const rel of LEGACY) {
  if (!existsSync(join(SRC, rel))) problems.push(`  src/${rel}  is in LEGACY but no longer exists; remove the entry`);
}

if (problems.length) {
  console.error(`Ledger design check: ${problems.length} problem(s)\n${problems.join('\n')}`);
  process.exit(1);
}
console.log(`Ledger design check passed: ${checked} files checked, ${skipped} legacy files skipped.`);
