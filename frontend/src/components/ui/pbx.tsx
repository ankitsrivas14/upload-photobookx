import * as React from 'react';
import { ICONS, type IconName } from './icons';
import { cx, formatINR } from './format';

export type { IconName };
export type { FormatINROptions } from './format';

export type Tone = 'neutral' | 'brand' | 'positive' | 'negative' | 'caution' | 'info';

/* ------------------------------------------------------------------ Icon */

export interface IconProps extends Omit<React.SVGAttributes<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  /** Accessible name. Omit for decorative icons (they are hidden from assistive tech). */
  label?: string;
}

/** A Lucide icon from the app's curated set, drawn in currentColor. */
export function Icon(props: IconProps) {
  const { name, size = 16, strokeWidth = 1.75, label, className, ...rest } = props;
  const node = ICONS[name] || [];
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cx('pbx-icon', className)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      {...rest}
    >
      {node.map(([tag, attrs], i) => React.createElement(tag, { key: i, ...attrs }))}
    </svg>
  );
}

/* ---------------------------------------------------------------- Button */

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  iconRight?: IconName;
  /** Square button showing only the icon; children become its screen-reader label. */
  iconOnly?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
}

/** The one button. Primary (green) once per view, for the thing the screen is for. */
export function Button(props: ButtonProps) {
  const { variant = 'secondary', size = 'md', icon, iconRight, iconOnly, loading, fullWidth, disabled, className, children, type = 'button', ...rest } = props;
  const iconSize = size === 'lg' ? 18 : 16;
  return (
    <button
      type={type}
      className={cx('pbx-btn', 'pbx-btn--' + variant, 'pbx-btn--' + size, iconOnly && 'pbx-btn--icon', fullWidth && 'pbx-btn--full', loading && 'is-loading', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="pbx-spinner" aria-hidden="true" /> : icon ? <Icon name={icon} size={iconSize} /> : null}
      {iconOnly ? <span className="pbx-sr">{children}</span> : children}
      {iconRight && !iconOnly ? <Icon name={iconRight} size={iconSize} /> : null}
    </button>
  );
}

/* ------------------------------------------------------------------ Menu */

export interface MenuItem {
  label?: React.ReactNode;
  icon?: IconName;
  tone?: 'neutral' | 'positive' | 'negative';
  hint?: React.ReactNode;
  disabled?: boolean;
  divider?: boolean;
  onSelect?: () => void;
}

export interface MenuProps {
  /** The element that opens the menu, usually a Button. */
  trigger: React.ReactElement<React.HTMLAttributes<HTMLElement>>;
  items: MenuItem[];
  align?: 'start' | 'end';
  label?: string;
  defaultOpen?: boolean;
  minWidth?: number;
  className?: string;
}

/** A dropdown of actions for a row, a selection or the account. */
export function Menu(props: MenuProps) {
  const { trigger, items, align = 'end', label, defaultOpen = false, minWidth, className } = props;
  const [open, setOpen] = React.useState(defaultOpen);
  const root = React.useRef<HTMLDivElement>(null);
  const list = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const move = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const els = Array.from(list.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') || []);
    if (!els.length) return;
    const at = els.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? els.length - 1 : e.key === 'ArrowDown' ? (at + 1) % els.length : (at - 1 + els.length) % els.length;
    els[next].focus();
  };

  const opener = React.cloneElement(trigger, {
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    onClick: (e: React.MouseEvent<HTMLElement>) => { trigger.props.onClick?.(e); setOpen((o) => !o); },
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      trigger.props.onKeyDown?.(e);
      if (e.key !== 'ArrowDown') return;
      e.preventDefault();
      setOpen(true);
      // Find the list through the DOM: the menu renders it on the next frame.
      const menu = e.currentTarget.closest('.pbx-menu');
      requestAnimationFrame(() => menu?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus());
    },
  });

  return (
    <div ref={root} className={cx('pbx-menu', className)}>
      {opener}
      {open ? (
        <div ref={list} role="menu" aria-label={label} className={cx('pbx-menu__list', 'pbx-menu__list--' + align)} style={minWidth ? { minWidth } : undefined} onKeyDown={move}>
          {items.map((it, i) =>
            it.divider ? (
              <div key={i} role="separator" className="pbx-menu__sep" />
            ) : (
              <button
                key={i}
                type="button"
                role="menuitem"
                disabled={it.disabled}
                className={cx('pbx-menu__item', it.tone && it.tone !== 'neutral' && 'pbx-menu__item--' + it.tone)}
                onClick={() => { setOpen(false); it.onSelect?.(); }}
              >
                {it.icon ? <Icon name={it.icon} size={16} /> : null}
                <span className="pbx-menu__label">{it.label}</span>
                {it.hint ? <span className="pbx-menu__hint">{it.hint}</span> : null}
              </button>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ Form field */

interface FieldShellProps {
  id: string;
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  inline?: boolean;
  className?: string;
  children: React.ReactNode;
}

function FieldShell(props: FieldShellProps) {
  const { id, label, hint, error, required, inline, className, children } = props;
  return (
    <div className={cx('pbx-field', inline && 'pbx-field--inline', error ? 'has-error' : false, className)}>
      {label ? (
        <label htmlFor={id} className="pbx-field__label">
          {label}
          {required ? <span className="pbx-field__req" aria-hidden="true"> *</span> : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p id={id + '-msg'} className="pbx-field__msg pbx-field__msg--error"><Icon name="circle-x" size={14} />{error}</p>
      ) : hint ? (
        <p id={id + '-msg'} className="pbx-field__msg">{hint}</p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------- TextField */

export interface TextFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement & HTMLTextAreaElement>, 'size' | 'prefix'> {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  icon?: IconName;
  /** Text before the value, e.g. "₹". */
  prefix?: React.ReactNode;
  /** Text after the value, e.g. "days" or "%". */
  suffix?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  multiline?: boolean;
  rows?: number;
}

/** A labelled text, number, date or search input — or a textarea. */
export function TextField(props: TextFieldProps) {
  const { label, hint, error, icon, prefix, suffix, size = 'md', multiline, rows = 4, id, className, required, ...rest } = props;
  const auto = React.useId();
  const fid = id || auto;
  const described = hint || error ? fid + '-msg' : undefined;
  return (
    <FieldShell id={fid} label={label} hint={hint} error={error} required={required} className={className}>
      {multiline ? (
        <textarea id={fid} rows={rows} required={required} aria-invalid={error ? true : undefined} aria-describedby={described} className="pbx-input pbx-input--multiline" {...rest} />
      ) : (
        <div className={cx('pbx-input', 'pbx-input--' + size)}>
          {icon ? <Icon name={icon} size={16} className="pbx-input__icon" /> : null}
          {prefix ? <span className="pbx-input__affix">{prefix}</span> : null}
          <input id={fid} required={required} aria-invalid={error ? true : undefined} aria-describedby={described} {...rest} />
          {suffix ? <span className="pbx-input__affix">{suffix}</span> : null}
        </div>
      )}
    </FieldShell>
  );
}

/* ---------------------------------------------------------------- Select */

export interface SelectOption { value: string; label: string; disabled?: boolean }

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  /** Options in order; `{ divider: true }` draws a disabled rule between groups. */
  options: Array<SelectOption | { divider: true }>;
  size?: 'sm' | 'md' | 'lg';
  /** Label sits to the left ("Period  [This month]") for toolbar filters. */
  inlineLabel?: boolean;
}

/** A native select, styled; for periods, years, employees and other short lists. */
export function Select(props: SelectProps) {
  const { label, hint, error, options, size = 'md', inlineLabel, id, className, required, ...rest } = props;
  const auto = React.useId();
  const fid = id || auto;
  return (
    <FieldShell id={fid} label={label} hint={hint} error={error} required={required} inline={inlineLabel} className={className}>
      <div className={cx('pbx-select', 'pbx-select--' + size)}>
        <select id={fid} required={required} aria-invalid={error ? true : undefined} aria-describedby={hint || error ? fid + '-msg' : undefined} {...rest}>
          {options.map((o, i) =>
            'divider' in o ? <option key={'d' + i} disabled>{'─'.repeat(12)}</option> : <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>,
          )}
        </select>
        <Icon name="chevron-down" size={16} className="pbx-select__chev" />
      </div>
    </FieldShell>
  );
}

/* -------------------------------------------------------------- Checkbox */

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: React.ReactNode;
  description?: React.ReactNode;
  indeterminate?: boolean;
}

/** A checkbox with an optional label; table row selection uses it bare with an aria-label. */
export function Checkbox(props: CheckboxProps) {
  const { label, description, indeterminate, className, id, ...rest } = props;
  const ref = React.useRef<HTMLInputElement>(null);
  const auto = React.useId();
  const fid = id || auto;
  React.useEffect(() => { if (ref.current) ref.current.indeterminate = !!indeterminate; }, [indeterminate]);
  return (
    <label className={cx('pbx-check', !label && 'pbx-check--bare', className)} htmlFor={fid}>
      <span className="pbx-check__box">
        <input ref={ref} id={fid} type="checkbox" {...rest} />
        <Icon name="check" size={14} strokeWidth={3} className="pbx-check__mark" />
        <span className="pbx-check__bar" />
      </span>
      {label ? (
        <span className="pbx-check__text">
          <span>{label}</span>
          {description ? <span className="pbx-check__desc">{description}</span> : null}
        </span>
      ) : null}
    </label>
  );
}

/* ---------------------------------------------------------------- Switch */

export interface SwitchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: React.ReactNode;
  description?: React.ReactNode;
}

/** An on/off setting that applies immediately (show AWB column, untagged only). */
export function Switch(props: SwitchProps) {
  const { label, description, className, ...rest } = props;
  return (
    <label className={cx('pbx-switch', className)}>
      <input type="checkbox" role="switch" {...rest} />
      <span className="pbx-switch__track" aria-hidden="true"><span className="pbx-switch__thumb" /></span>
      {label ? (
        <span className="pbx-switch__text">
          <span>{label}</span>
          {description ? <span className="pbx-switch__desc">{description}</span> : null}
        </span>
      ) : null}
    </label>
  );
}

/* ------------------------------------------------------ SegmentedControl */

export interface SegmentedOption { value: string; label: React.ReactNode; icon?: IconName }

export interface SegmentedControlProps {
  options: SegmentedOption[];
  value: string;
  onChange?: (value: string) => void;
  /** Names the group for assistive tech, e.g. "View mode". */
  label: string;
  size?: 'sm' | 'md';
  className?: string;
}

/** Two to five mutually exclusive views or modes, switched in place. */
export function SegmentedControl(props: SegmentedControlProps) {
  const { options, value, onChange, label, size = 'md', className } = props;
  const group = React.useRef<HTMLDivElement>(null);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const at = Math.max(0, options.findIndex((o) => o.value === value));
    const next = (at + (e.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length;
    onChange?.(options[next].value);
    group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  };
  return (
    <div ref={group} role="radiogroup" aria-label={label} className={cx('pbx-seg', 'pbx-seg--' + size, className)} onKeyDown={onKey}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} className={cx('pbx-seg__opt', on && 'is-active')} onClick={() => onChange?.(o.value)}>
            {o.icon ? <Icon name={o.icon} size={14} /> : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------- Dropzone */

export interface DropzoneProps {
  onFiles?: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  title?: React.ReactNode;
  hint?: React.ReactNode;
  icon?: IconName;
  buttonLabel?: string;
  disabled?: boolean;
  /** `lg` is the customer upload surface; `md` is for admin imports (CSV, XLSX, PDF). */
  size?: 'md' | 'lg';
  className?: string;
}

/** Drag-and-drop or browse for files, with a real button for keyboard users. */
export function Dropzone(props: DropzoneProps) {
  const { onFiles, accept, multiple = true, title = 'Drop files here', hint, icon = 'upload', buttonLabel = 'Browse files', disabled, size = 'md', className } = props;
  const [over, setOver] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);
  const take = (files: FileList | null) => { if (files && files.length && onFiles) onFiles(Array.from(files)); };
  return (
    <div
      className={cx('pbx-drop', 'pbx-drop--' + size, over && 'is-over', disabled && 'is-disabled', className)}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled) take(e.dataTransfer.files); }}
    >
      <span className="pbx-drop__icon"><Icon name={icon} size={size === 'lg' ? 24 : 20} /></span>
      <div className="pbx-drop__title">{title}</div>
      {hint ? <div className="pbx-drop__hint">{hint}</div> : null}
      <Button variant={size === 'lg' ? 'primary' : 'secondary'} size={size === 'lg' ? 'lg' : 'md'} disabled={disabled} onClick={() => input.current?.click()}>
        {buttonLabel}
      </Button>
      <input ref={input} type="file" accept={accept} multiple={multiple} hidden onChange={(e) => { take(e.target.files); e.target.value = ''; }} />
    </div>
  );
}

/* ------------------------------------------------------------ OptionCard */

export interface OptionCardProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'title'> {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** A small picture of the choice, e.g. the print-style thumbnail. */
  media?: React.ReactNode;
  badge?: React.ReactNode;
}

/** A large radio choice with a title, a line of detail and an optional picture. */
export function OptionCard(props: OptionCardProps) {
  const { title, description, media, badge, className, ...rest } = props;
  return (
    <label className={cx('pbx-option', className)}>
      <input type="radio" className="pbx-option__input" {...rest} />
      {media ? <span className="pbx-option__media" aria-hidden="true">{media}</span> : null}
      <span className="pbx-option__text">
        <span className="pbx-option__title">{title}{badge}</span>
        {description ? <span className="pbx-option__desc">{description}</span> : null}
      </span>
      <span className="pbx-option__mark" aria-hidden="true"><Icon name="check" size={12} strokeWidth={3} /></span>
    </label>
  );
}

/* --------------------------------------------------------------- Sidebar */

export interface NavItem {
  id: string;
  label: string;
  /** Top-level items show one; sub-pages go without. */
  icon?: IconName;
  href?: string;
  badge?: React.ReactNode;
  /** Sub-pages, listed under the item while it or one of them is current. */
  children?: NavItem[];
}
export interface NavGroup { label?: string; items: NavItem[] }

export interface SidebarProps {
  groups: NavGroup[];
  activeId?: string;
  collapsed?: boolean;
  onToggle?: () => void;
  onNavigate?: (id: string) => void;
  /** Replaces the PhotoBookX wordmark (e.g. with the logo once it is in the repo). */
  brand?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

function Wordmark(props: { collapsed?: boolean }) {
  return props.collapsed ? (
    <span className="pbx-monogram" aria-label="PhotoBookX">P</span>
  ) : (
    <span className="pbx-wordmark">PHOTOBOOKX<span className="pbx-wordmark__suffix">Admin</span></span>
  );
}

/** The admin's main navigation: grouped destinations, collapsible to icons. */
export function Sidebar(props: SidebarProps) {
  const { groups, activeId, collapsed, onToggle, onNavigate, brand, footer, className } = props;
  return (
    <aside className={cx('pbx-sidebar', collapsed && 'is-collapsed', className)}>
      <div className="pbx-sidebar__brand">
        {brand || <Wordmark collapsed={collapsed} />}
        {onToggle ? (
          <Button variant="ghost" size="sm" iconOnly icon="panel-left" className="pbx-sidebar__toggle" onClick={onToggle} aria-expanded={!collapsed}>
            {collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          </Button>
        ) : null}
      </div>
      <nav className="pbx-sidebar__nav" aria-label="Main">
        {groups.map((g, gi) => (
          <div key={gi} className="pbx-sidebar__group">
            {g.label ? <div className="pbx-sidebar__label">{g.label}</div> : null}
            <ul>
              {g.items.map((it) => {
                const on = it.id === activeId;
                // A section is open while it or one of its sub-pages is current; the marker sits on the page itself.
                const childOn = !!it.children?.some((c) => c.id === activeId);
                const link = (item: NavItem, current: boolean, extra?: string) => (
                  <a
                    href={item.href || '#'}
                    className={cx('pbx-nav', current && 'is-active', extra)}
                    aria-current={current ? 'page' : undefined}
                    title={collapsed ? item.label : undefined}
                    onClick={onNavigate ? (e) => { e.preventDefault(); onNavigate(item.id); } : undefined}
                  >
                    {item.icon ? <Icon name={item.icon} size={18} /> : null}
                    <span className="pbx-nav__label">{item.label}</span>
                    {item.badge != null ? <span className="pbx-nav__badge">{item.badge}</span> : null}
                  </a>
                );
                return (
                  <li key={it.id}>
                    {link(it, on, childOn ? 'is-open' : undefined)}
                    {it.children && (on || childOn) ? (
                      <ul className="pbx-subnav" aria-label={it.label}>
                        {it.children.map((c) => <li key={c.id}>{link(c, c.id === activeId)}</li>)}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      {footer ? <div className="pbx-sidebar__footer">{footer}</div> : null}
    </aside>
  );
}

/* ---------------------------------------------------------------- Topbar */

export interface Crumb { label: string; href?: string }

export interface TopbarProps {
  breadcrumbs?: Crumb[];
  /** Page-independent controls: sync status, theme toggle. */
  actions?: React.ReactNode;
  user?: { name: string; email?: string };
  onLogout?: () => void;
  /** Shows the menu button that opens the sidebar on narrow screens. */
  onMenu?: () => void;
  className?: string;
}

/** The strip above every admin page: where you are, global actions, the account menu. */
export function Topbar(props: TopbarProps) {
  const { breadcrumbs = [], actions, user, onLogout, onMenu, className } = props;
  return (
    <header className={cx('pbx-topbar', className)}>
      {onMenu ? <Button variant="ghost" size="sm" iconOnly icon="panel-left" className="pbx-topbar__menu" onClick={onMenu}>Open navigation</Button> : null}
      <nav aria-label="Breadcrumb" className="pbx-crumbs">
        <ol>
          {breadcrumbs.map((c, i) => {
            const last = i === breadcrumbs.length - 1;
            return (
              <li key={i}>
                {last || !c.href ? <span aria-current={last ? 'page' : undefined}>{c.label}</span> : <a href={c.href}>{c.label}</a>}
                {!last ? <Icon name="chevron-right" size={14} className="pbx-crumbs__sep" /> : null}
              </li>
            );
          })}
        </ol>
      </nav>
      <div className="pbx-topbar__end">
        {actions}
        {user ? (
          <Menu
            label="Account"
            minWidth={220}
            trigger={
              <button type="button" className="pbx-user">
                <Avatar name={user.name} size="sm" />
                <span className="pbx-user__name">{user.name}</span>
                <Icon name="chevron-down" size={14} />
              </button>
            }
            items={[
              { label: user.email || user.name, icon: 'users', disabled: true },
              { divider: true },
              { label: 'Log out', icon: 'log-out', onSelect: onLogout },
            ]}
          />
        ) : null}
      </div>
    </header>
  );
}

/* ----------------------------------------------------------- ThemeSwitch */

export type Theme = 'light' | 'dark';

const THEME_KEY = 'pbx-theme';

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // storage blocked: fall through to the OS preference
  }
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export interface ThemeSwitchProps {
  /** Controlled theme; omit to let the switch manage, persist and apply it. */
  value?: Theme;
  onChange?: (theme: Theme) => void;
  size?: 'sm' | 'md';
  className?: string;
}

/** The light/dark switch: sets data-theme on <html>, remembers the choice, starts from the OS setting. */
export function ThemeSwitch(props: ThemeSwitchProps) {
  const { value, onChange, size = 'md', className } = props;
  const [own, setOwn] = React.useState<Theme>(initialTheme);
  const theme = value || own;
  React.useEffect(() => {
    if (value) return;
    document.documentElement.setAttribute('data-theme', own);
    try { localStorage.setItem(THEME_KEY, own); } catch { /* not persisted */ }
  }, [own, value]);
  const pick = (t: Theme) => { if (!value) setOwn(t); onChange?.(t); };
  return (
    <div role="group" aria-label="Theme" className={cx('pbx-theme', 'pbx-theme--' + size, className)}>
      <button type="button" className="pbx-theme__opt" aria-pressed={theme === 'light'} onClick={() => pick('light')}>
        <Icon name="sun" size={12} strokeWidth={2} /><span className="pbx-theme__text">Light</span>
      </button>
      <button type="button" className="pbx-theme__opt" aria-pressed={theme === 'dark'} onClick={() => pick('dark')}>
        <Icon name="moon" size={12} strokeWidth={2} /><span className="pbx-theme__text">Dark</span>
      </button>
    </div>
  );
}

/* ------------------------------------------------------------ PageHeader */

export interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
  /** Filters and actions for the whole page, primary last. */
  actions?: React.ReactNode;
  /** Rendered full-width under the title row, usually Tabs. */
  children?: React.ReactNode;
  className?: string;
}

/** The title row of an admin page: title, one line of purpose, page-level actions. */
export function PageHeader(props: PageHeaderProps) {
  const { title, description, eyebrow, actions, children, className } = props;
  return (
    <div className={cx('pbx-pagehead', className)}>
      <div className="pbx-pagehead__text">
        {eyebrow ? <div className="pbx-pagehead__eyebrow">{eyebrow}</div> : null}
        <h1 className="pbx-pagehead__title">{title}</h1>
        {description ? <p className="pbx-pagehead__desc">{description}</p> : null}
      </div>
      {actions ? <div className="pbx-pagehead__actions">{actions}</div> : null}
      {children ? <div className="pbx-pagehead__below">{children}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ Tabs */

export interface TabItem { id: string; label: React.ReactNode; icon?: IconName; count?: number; href?: string }

export interface TabsProps {
  items: TabItem[];
  value: string;
  onChange?: (id: string) => void;
  /** Names the navigation landmark, e.g. "Expenses sections". */
  label?: string;
  className?: string;
}

/** Sub-navigation between the sections of one page (Expenses, Analysis, Tools) or order filters. */
export function Tabs(props: TabsProps) {
  const { items, value, onChange, label = 'Sections', className } = props;
  return (
    <nav className={cx('pbx-tabs', className)} aria-label={label}>
      <div className="pbx-tabs__list">
        {items.map((it) => {
          const on = it.id === value;
          const inner = (
            <>
              {it.icon ? <Icon name={it.icon} size={16} /> : null}
              <span>{it.label}</span>
              {it.count != null ? <span className="pbx-tabs__count">{it.count.toLocaleString('en-IN')}</span> : null}
            </>
          );
          return it.href ? (
            <a key={it.id} href={it.href} className={cx('pbx-tab', on && 'is-active')} aria-current={on ? 'page' : undefined} onClick={onChange ? (e) => { e.preventDefault(); onChange(it.id); } : undefined}>
              {inner}
            </a>
          ) : (
            <button key={it.id} type="button" className={cx('pbx-tab', on && 'is-active')} aria-current={on ? 'true' : undefined} onClick={() => onChange?.(it.id)}>
              {inner}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/* --------------------------------------------------------------- Stepper */

export interface StepItem { label: React.ReactNode; description?: React.ReactNode }

export interface StepperProps {
  steps: StepItem[];
  /** Zero-based index of the step in progress; earlier steps show as done. */
  current: number;
  className?: string;
}

/** Numbered progress through a short flow (the customer upload: settings, photos, submit). */
export function Stepper(props: StepperProps) {
  const { steps, current, className } = props;
  return (
    <ol className={cx('pbx-steps', className)}>
      {steps.map((s, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'todo';
        return (
          <li key={i} className={cx('pbx-step', 'is-' + state)} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="pbx-step__num">{state === 'done' ? <Icon name="check" size={14} strokeWidth={2.5} /> : i + 1}</span>
            <span className="pbx-step__text">
              <span className="pbx-step__label">{s.label}</span>
              {s.description ? <span className="pbx-step__desc">{s.description}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* -------------------------------------------------------------- StatCard */

export interface StatCardProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  /** Recent values, oldest first, drawn as a sparkline beside the figure. */
  spark?: number[];
  /** A change against the previous period; `good` colours it (omit to keep it neutral). */
  trend?: { label: string; direction: 'up' | 'down'; good?: boolean };
  tone?: 'neutral' | 'positive' | 'negative' | 'caution';
  loading?: boolean;
  /** Makes the whole card a button, e.g. to open the filtered orders. */
  onClick?: () => void;
  children?: React.ReactNode;
}

/** One headline number with its label and a line of context. */
export function StatCard(props: StatCardProps) {
  const { label, value, sub, spark, trend, tone = 'neutral', loading, onClick, className, children, ...rest } = props;
  let points = '';
  if (spark && spark.length > 1) {
    const max = Math.max(...spark);
    const min = Math.min(...spark);
    points = spark.map((v, i) => (i * 64 / (spark.length - 1)).toFixed(1) + ',' + (18 - ((v - min) / (max - min || 1)) * 16).toFixed(1)).join(' ');
  }
  const body = (
    <>
      <div className="pbx-stat__label">{label}</div>
      <div className="pbx-stat__row">
        {loading ? <Skeleton width="60%" height={22} /> : <div className={cx('pbx-stat__value', 'pbx-tone--' + tone)}>{value}</div>}
        {points ? <svg className="pbx-stat__spark" width="64" height="20" viewBox="0 0 64 20" aria-hidden="true"><polyline points={points} /></svg> : null}
      </div>
      {sub || trend ? (
        <div className="pbx-stat__sub">
          {trend ? (
            <span className={cx('pbx-trend', trend.good === undefined ? false : trend.good ? 'pbx-tone--positive' : 'pbx-tone--negative')}>
              {(trend.direction === 'up' ? '▲ ' : '▼ ') + trend.label}
            </span>
          ) : null}
          {sub ? <span>{sub}</span> : null}
        </div>
      ) : null}
      {children}
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={cx('pbx-stat', 'pbx-stat--interactive', className)} {...(rest as React.ButtonHTMLAttributes<HTMLButtonElement>)}>{body}</button>
  ) : (
    <div className={cx('pbx-stat', className)} {...(rest as React.HTMLAttributes<HTMLDivElement>)}>{body}</div>
  );
}

/* ------------------------------------------------------------- StatStrip */

export interface StatStripProps {
  children: React.ReactNode;
  /** Narrowest a figure may get before the strip wraps, in px. */
  minWidth?: number;
  label?: string;
  className?: string;
}

/** A ruled row of StatCards: an ink rule above, hairlines between, wrapping on narrow screens. */
export function StatStrip(props: StatStripProps) {
  const { children, minWidth = 160, label = 'Key figures', className } = props;
  return (
    <section aria-label={label} className={cx('pbx-strip', className)} style={{ '--strip-min': minWidth + 'px' } as React.CSSProperties}>
      {children}
    </section>
  );
}

/* ---------------------------------------------------------------- Amount */

export interface AmountProps extends React.HTMLAttributes<HTMLSpanElement> {
  value: number | null | undefined;
  /** Shows +/− and colours the value (profit, loss, P/L). Plain amounts stay ink. */
  signed?: boolean;
  decimals?: number;
  /** ₹12.3L / ₹1.2Cr for charts and tight cards. */
  compact?: boolean;
  /** Puts the value on a tinted pill (table P/L cells). */
  pill?: boolean;
  currency?: string;
}

/** A rupee amount, Indian-grouped, tabular, signed and coloured when it is a profit or loss. */
export function Amount(props: AmountProps) {
  const { value, signed, decimals = 0, compact, pill, currency = '₹', className, ...rest } = props;
  if (value === null || value === undefined || Number.isNaN(value)) {
    return <span className={cx('pbx-amount', 'pbx-amount--none', className)} {...rest}>{'—'}</span>;
  }
  const tone = signed ? (value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral') : 'neutral';
  return (
    <span className={cx('pbx-amount', 'pbx-amount--' + tone, pill && 'pbx-amount--pill', className)} {...rest}>
      {formatINR(value, { decimals, compact, signed, currency })}
    </span>
  );
}

/* ----------------------------------------------------------------- Badge */

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  /** A leading dot in the tone colour; use for states, not categories. */
  dot?: boolean;
  icon?: IconName;
  size?: 'sm' | 'md';
}

/** One or two words of status or category, always readable without its colour. */
export function Badge(props: BadgeProps) {
  const { tone = 'neutral', dot = true, icon, size = 'md', className, children, ...rest } = props;
  return (
    <span className={cx('pbx-badge', 'pbx-badge--' + tone, 'pbx-badge--' + size, className)} {...rest}>
      {dot ? <span className="pbx-badge__dot" aria-hidden="true" /> : null}
      {icon ? <Icon name={icon} size={12} strokeWidth={2} /> : null}
      {children}
    </span>
  );
}

const DELIVERY: Record<string, [string, Tone]> = {
  delivered: ['Delivered', 'positive'],
  in_transit: ['In transit', 'info'],
  out_for_delivery: ['Out for delivery', 'info'],
  attempted_delivery: ['Attempted delivery', 'negative'],
  ready_for_pickup: ['Ready for pickup', 'neutral'],
  confirmed: ['Confirmed', 'neutral'],
  label_printed: ['Label created', 'neutral'],
  label_purchased: ['Label created', 'neutral'],
  unfulfilled: ['Unfulfilled', 'neutral'],
  failure: ['Failed', 'negative'],
  rto: ['RTO', 'negative'],
};

export interface DeliveryBadgeProps { status?: string | null; size?: 'sm' | 'md'; className?: string }

/** The Shiprocket/Shopify delivery status of an order, mapped to one label and tone everywhere. */
export function DeliveryBadge(props: DeliveryBadgeProps) {
  const { status, size, className } = props;
  if (!status) return <span className={cx('pbx-amount--none', className)}>{'—'}</span>;
  const key = status.toLowerCase();
  const known = DELIVERY[key];
  const text = known ? known[0] : key.replace(/_/g, ' ');
  return <Badge tone={known ? known[1] : 'neutral'} size={size} dot className={className}>{text.charAt(0).toUpperCase() + text.slice(1)}</Badge>;
}

/* ------------------------------------------------------------- DataTable */

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  align?: 'left' | 'right' | 'center';
  /** Right-aligned, tabular figures. */
  numeric?: boolean;
  /** Geist Mono for AWB numbers, pin codes, IDs. */
  mono?: boolean;
  width?: number | string;
  render?: (row: T) => React.ReactNode;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  selectable?: boolean;
  selected?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  /** Buttons or a Menu shown in the selection bar. */
  bulkActions?: React.ReactNode;
  empty?: React.ReactNode;
  loading?: boolean;
  density?: 'compact' | 'comfortable';
  onRowClick?: (row: T) => void;
  maxHeight?: number | string;
  caption?: string;
  footer?: React.ReactNode;
  className?: string;
}

/** Rows of records with a sticky header, selection, bulk actions and empty/loading states. */
export function DataTable<T>(props: DataTableProps<T>) {
  const { columns, rows, getRowId, selectable, selected, onSelectionChange, bulkActions, empty, loading, density = 'compact', onRowClick, maxHeight, caption, footer, className } = props;
  const sel = selected || new Set<string>();
  const ids = rows.map(getRowId);
  const all = ids.length > 0 && ids.every((id) => sel.has(id));
  const some = !all && ids.some((id) => sel.has(id));
  const span = columns.length + (selectable ? 1 : 0);
  const toggle = (id: string) => { const next = new Set(sel); if (next.has(id)) next.delete(id); else next.add(id); onSelectionChange?.(next); };
  const align = (c: Column<T>) => c.align || (c.numeric ? 'right' : 'left');
  return (
    <div className={cx('pbx-table', 'pbx-table--' + density, className)}>
      {selectable && sel.size > 0 ? (
        <div className="pbx-table__bulk" role="region" aria-label="Selection">
          <span><strong className="pbx-num">{sel.size.toLocaleString('en-IN')}</strong> selected</span>
          <div className="pbx-table__bulk-actions">{bulkActions}</div>
          <Button variant="ghost" size="sm" onClick={() => onSelectionChange?.(new Set())}>Clear</Button>
        </div>
      ) : null}
      <div className="pbx-table__scroll" style={maxHeight ? { maxHeight } : undefined}>
        <table>
          {caption ? <caption className="pbx-sr">{caption}</caption> : null}
          <thead>
            <tr>
              {selectable ? (
                <th className="pbx-table__check">
                  <Checkbox aria-label="Select all rows" checked={all} indeterminate={some} onChange={() => onSelectionChange?.(all ? new Set() : new Set(ids))} />
                </th>
              ) : null}
              {columns.map((c) => <th key={c.key} scope="col" style={{ width: c.width, textAlign: align(c) }}>{c.header}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }, (_, r) => (
                <tr key={'s' + r} className="pbx-table__skel">
                  {Array.from({ length: span }, (_, c) => <td key={c}><Skeleton height={12} width={c === 0 && selectable ? 16 : '70%'} /></td>)}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr><td colSpan={span} className="pbx-table__empty">{empty || <EmptyState size="sm" icon="search" title="Nothing matches" description="Try another period or filter." />}</td></tr>
            ) : (
              rows.map((row) => {
                const id = getRowId(row);
                const on = sel.has(id);
                return (
                  <tr key={id} className={cx(on && 'is-selected', onRowClick && 'is-clickable')} onClick={onRowClick ? () => onRowClick(row) : undefined}>
                    {selectable ? (
                      <td className="pbx-table__check" onClick={(e) => e.stopPropagation()}>
                        <Checkbox aria-label={'Select ' + id} checked={on} onChange={() => toggle(id)} />
                      </td>
                    ) : null}
                    {columns.map((c) => (
                      <td key={c.key} className={cx(c.mono && 'pbx-mono', c.numeric && 'pbx-num')} style={{ textAlign: align(c) }}>
                        {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? '—')}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {footer ? <div className="pbx-table__foot">{footer}</div> : null}
    </div>
  );
}

/* -------------------------------------------------------------- DataList */

export interface DataListItem { label: React.ReactNode; sub?: React.ReactNode; value: React.ReactNode; tone?: 'neutral' | 'positive' | 'negative' | 'muted' }

export interface DataListProps {
  items: DataListItem[];
  title?: React.ReactNode;
  /** The ruled bottom line, like a receipt total. */
  total?: DataListItem;
  className?: string;
}

/** Label–value rows for a breakdown (order P/L, cost summary) with an optional ruled total. */
export function DataList(props: DataListProps) {
  const { items, title, total, className } = props;
  return (
    <div className={cx('pbx-dl', className)}>
      {title ? <div className="pbx-dl__title">{title}</div> : null}
      <dl>
        {items.map((it, i) => (
          <div key={i} className="pbx-dl__row">
            <dt><span>{it.label}</span>{it.sub ? <span className="pbx-dl__sub">{it.sub}</span> : null}</dt>
            <dd className={it.tone && it.tone !== 'neutral' ? 'pbx-tone--' + it.tone : undefined}>{it.value}</dd>
          </div>
        ))}
        {total ? (
          <div className="pbx-dl__row pbx-dl__row--total">
            <dt><span>{total.label}</span>{total.sub ? <span className="pbx-dl__sub">{total.sub}</span> : null}</dt>
            <dd className={total.tone && total.tone !== 'neutral' ? 'pbx-tone--' + total.tone : undefined}>{total.value}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

/* --------------------------------------------------------------- Heatmap */

export interface HeatmapDay { value: number | null; pending?: boolean }

export interface HeatmapProps {
  year: number;
  /** Keyed by YYYY-MM-DD (IST). */
  data: Record<string, HeatmapDay>;
  onDayClick?: (dateKey: string, day: HeatmapDay) => void;
  formatValue?: (value: number) => string;
  className?: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A year of daily profit and loss as tiles: green for profit, orange for loss, grey while not final. */
export function Heatmap(props: HeatmapProps) {
  const { year, data, onDayClick, formatValue = (v: number) => formatINR(v, { signed: true }), className } = props;
  const [tip, setTip] = React.useState<{ x: number; y: number; date: string; text: string } | null>(null);
  const box = React.useRef<HTMLDivElement>(null);
  const max = Math.max(1, ...Object.values(data).map((d) => (d.pending ? 0 : Math.abs(d.value || 0))));
  const level = (d?: HeatmapDay) => {
    if (!d || d.value === null) return 'empty';
    if (d.pending) return 'pending';
    if (d.value === 0) return 'empty';
    const r = Math.abs(d.value) / max;
    return (d.value > 0 ? 'profit-' : 'loss-') + (r > 0.6 ? 3 : r > 0.25 ? 2 : 1);
  };
  const show = (e: React.MouseEvent | React.FocusEvent, date: string, text: string) => {
    const t = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const b = box.current?.getBoundingClientRect();
    if (b) setTip({ x: t.left - b.left + t.width / 2, y: t.top - b.top, date, text });
  };
  return (
    <div ref={box} className={cx('pbx-heat', className)}>
      <div className="pbx-heat__scroll">
        <div className="pbx-heat__grid">
          <div className="pbx-heat__days" aria-hidden="true"><span>Mon</span><span /><span>Wed</span><span /><span>Fri</span><span /><span /></div>
          {MONTHS.map((m, mi) => {
            const offset = (new Date(year, mi, 1).getDay() + 6) % 7;
            const days = new Date(year, mi + 1, 0).getDate();
            const tiles = [];
            for (let d = 1; d <= days; d++) {
              const idx = offset + d - 1;
              const key = year + '-' + String(mi + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
              const day = data[key];
              const lv = level(day);
              const label = new Date(year, mi, d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
              const text = !day || day.value === null ? 'No orders' : day.pending ? 'Not final · ' + formatValue(day.value) : formatValue(day.value);
              const style = { gridColumn: Math.floor(idx / 7) + 1, gridRow: (idx % 7) + 1 };
              const common = {
                className: 'pbx-heat__tile',
                'data-l': lv,
                style,
                'aria-label': label + ': ' + text,
                onMouseEnter: (e: React.MouseEvent) => show(e, label, text),
                onMouseLeave: () => setTip(null),
              };
              tiles.push(
                onDayClick && day ? (
                  <button key={key} type="button" {...common} onFocus={(e) => show(e, label, text)} onBlur={() => setTip(null)} onClick={() => onDayClick(key, day)} />
                ) : (
                  <span key={key} role="img" {...common} />
                ),
              );
            }
            return (
              <div key={m} className="pbx-heat__month">
                <div className="pbx-heat__weeks">{tiles}</div>
                <div className="pbx-heat__mlabel">{m}</div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="pbx-heat__legend">
        <span>Loss</span>
        <span className="pbx-heat__tile" data-l="loss-3" /><span className="pbx-heat__tile" data-l="loss-2" /><span className="pbx-heat__tile" data-l="loss-1" />
        <span className="pbx-heat__tile" data-l="empty" />
        <span className="pbx-heat__tile" data-l="profit-1" /><span className="pbx-heat__tile" data-l="profit-2" /><span className="pbx-heat__tile" data-l="profit-3" />
        <span>Profit</span>
        <span className="pbx-heat__gap" />
        <span className="pbx-heat__tile" data-l="pending" /><span>Not final yet</span>
      </div>
      {tip ? (
        <div className="pbx-heat__bubble" style={{ left: tip.x, top: tip.y }} role="presentation">
          <span>{tip.date}</span>
          <strong>{tip.text}</strong>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ Card */

export interface CardProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  padding?: 'none' | 'sm' | 'md';
  as?: 'section' | 'div' | 'article';
}

/** The container for one chart, table, form or narrative on a page. */
export function Card(props: CardProps) {
  const { title, description, eyebrow, actions, footer, padding = 'md', as = 'section', className, children, ...rest } = props;
  const Tag = as as 'section';
  const head = title || description || eyebrow || actions;
  return (
    <Tag className={cx('pbx-card', 'pbx-card--pad-' + padding, className)} {...rest}>
      {head ? (
        <header className="pbx-card__head">
          <div className="pbx-card__titles">
            {eyebrow ? <div className="pbx-card__eyebrow">{eyebrow}</div> : null}
            {title ? <h2 className="pbx-card__title">{title}</h2> : null}
            {description ? <p className="pbx-card__desc">{description}</p> : null}
          </div>
          {actions ? <div className="pbx-card__actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className="pbx-card__body">{children}</div>
      {footer ? <footer className="pbx-card__foot">{footer}</footer> : null}
    </Tag>
  );
}

/* ---------------------------------------------------------------- Avatar */

export interface AvatarProps { name: string; src?: string; size?: 'sm' | 'md' | 'lg'; className?: string }

/** Initials (or a photo) for a staff member or the signed-in admin. */
export function Avatar(props: AvatarProps) {
  const { name, src, size = 'md', className } = props;
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join('');
  return (
    <span className={cx('pbx-avatar', 'pbx-avatar--' + size, className)} aria-hidden="true">
      {src ? <img src={src} alt="" /> : initials}
    </span>
  );
}

/* ----------------------------------------------------------------- Alert */

export interface AlertProps {
  tone?: 'neutral' | 'brand' | 'info' | 'positive' | 'caution' | 'negative';
  title?: React.ReactNode;
  children?: React.ReactNode;
  icon?: IconName;
  action?: React.ReactNode;
  className?: string;
}

const TONE_ICON: Record<string, IconName> = { neutral: 'info', brand: 'sparkles', info: 'info', positive: 'circle-check', caution: 'triangle-alert', negative: 'circle-x' };

/** An inline message that stays on the page: a rule, a warning, an error, an AI note. */
export function Alert(props: AlertProps) {
  const { tone = 'info', title, children, icon, action, className } = props;
  return (
    <div className={cx('pbx-alert', 'pbx-alert--' + tone, className)} role={tone === 'negative' ? 'alert' : undefined}>
      <Icon name={icon || TONE_ICON[tone]} size={18} className="pbx-alert__icon" />
      <div className="pbx-alert__body">
        {title ? <div className="pbx-alert__title">{title}</div> : null}
        {children ? <div className="pbx-alert__text">{children}</div> : null}
      </div>
      {action ? <div className="pbx-alert__action">{action}</div> : null}
    </div>
  );
}

/* ----------------------------------------------------------------- Toast */

export interface ToastProps {
  tone?: 'neutral' | 'positive' | 'negative' | 'caution' | 'info';
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  onClose?: () => void;
  className?: string;
}

/** A transient confirmation or error after an action, bottom-right. */
export function Toast(props: ToastProps) {
  const { tone = 'neutral', title, description, action, onClose, className } = props;
  return (
    <div className={cx('pbx-toast', 'pbx-toast--' + tone, className)} role={tone === 'negative' ? 'alert' : 'status'}>
      <Icon name={TONE_ICON[tone]} size={18} className="pbx-toast__icon" />
      <div className="pbx-toast__text">
        <div className="pbx-toast__title">{title}</div>
        {description ? <div className="pbx-toast__desc">{description}</div> : null}
      </div>
      {action}
      {onClose ? <button type="button" className="pbx-toast__close" aria-label="Dismiss" onClick={onClose}><Icon name="x" size={14} /></button> : null}
    </div>
  );
}

/* ------------------------------------------------------------ EmptyState */

export interface EmptyStateProps {
  icon?: IconName;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  size?: 'sm' | 'md';
  className?: string;
}

/** What a page or table says when there is nothing to show, and what to do next. */
export function EmptyState(props: EmptyStateProps) {
  const { icon = 'boxes', title, description, action, size = 'md', className } = props;
  return (
    <div className={cx('pbx-empty', 'pbx-empty--' + size, className)}>
      <span className="pbx-empty__icon"><Icon name={icon} size={size === 'sm' ? 18 : 22} /></span>
      <p className="pbx-empty__title">{title}</p>
      {description ? <p className="pbx-empty__desc">{description}</p> : null}
      {action ? <div className="pbx-empty__action">{action}</div> : null}
    </div>
  );
}

/* -------------------------------------------------------------- Skeleton */

export interface SkeletonProps { width?: number | string; height?: number | string; radius?: number | string; circle?: boolean; lines?: number; className?: string }

/** A placeholder in the shape of content that is loading. */
export function Skeleton(props: SkeletonProps) {
  const { width = '100%', height = 14, radius, circle, lines, className } = props;
  if (lines && lines > 1) {
    return (
      <span className={cx('pbx-skel-lines', className)} aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => <span key={i} className="pbx-skel" style={{ width: i === lines - 1 ? '60%' : '100%', height }} />)}
      </span>
    );
  }
  return <span className={cx('pbx-skel', className)} aria-hidden="true" style={{ width: circle ? height : width, height, borderRadius: circle ? '50%' : radius }} />;
}

/* --------------------------------------------------------------- Tooltip */

export interface TooltipProps { content: React.ReactNode; children: React.ReactElement<React.HTMLAttributes<HTMLElement>>; side?: 'top' | 'bottom' }

/** A short label on hover and focus, for icon buttons and truncated values. */
export function Tooltip(props: TooltipProps) {
  const { content, children, side = 'top' } = props;
  const id = React.useId();
  return (
    <span className={cx('pbx-tip', 'pbx-tip--' + side)}>
      {React.cloneElement(children, { 'aria-describedby': id })}
      <span role="tooltip" id={id} className="pbx-tip__bubble">{content}</span>
    </span>
  );
}

/* ---------------------------------------------------------------- Dialog */

function trapTab(e: KeyboardEvent, panel: HTMLElement | null) {
  if (!panel) return;
  const els = Array.from(panel.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])'));
  if (!els.length) return;
  const first = els[0];
  const last = els[els.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

function useModal(open: boolean, onClose: (() => void) | undefined, panel: React.RefObject<HTMLDivElement | null>) {
  // The latest onClose, so an inline handler does not re-run the focus effect on every render.
  const close = React.useRef(onClose);
  React.useEffect(() => { close.current = onClose; }, [onClose]);
  React.useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current?.();
      if (e.key === 'Tab') trapTab(e, panel.current);
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); before?.focus?.(); };
  }, [open, panel]);
}

export interface DialogProps {
  open: boolean;
  onClose?: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: IconName;
  tone?: 'neutral' | 'brand' | 'positive' | 'caution' | 'negative';
  /** `full` fills the viewport, for embedding a whole list (filtered orders). */
  size?: 'sm' | 'md' | 'lg' | 'full';
  children?: React.ReactNode;
  /** Buttons, right-aligned: secondary first, the confirming action last. */
  footer?: React.ReactNode;
}

/** A modal for a decision or a focused form; blocks the page until closed. */
export function Dialog(props: DialogProps) {
  const { open, onClose, title, description, icon, tone = 'neutral', size = 'md', children, footer } = props;
  const id = React.useId();
  const panel = React.useRef<HTMLDivElement>(null);
  useModal(open, onClose, panel);
  if (!open) return null;
  return (
    <div className="pbx-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={id + '-t'} aria-describedby={description ? id + '-d' : undefined} tabIndex={-1} className={cx('pbx-dialog', 'pbx-dialog--' + size)}>
        <header className="pbx-dialog__head">
          {icon ? <span className={cx('pbx-dialog__icon', 'pbx-tonebg--' + tone)}><Icon name={icon} size={20} /></span> : null}
          <div className="pbx-dialog__titles">
            <h2 id={id + '-t'} className="pbx-dialog__title">{title}</h2>
            {description ? <p id={id + '-d'} className="pbx-dialog__desc">{description}</p> : null}
          </div>
          {onClose ? <Button variant="ghost" size="sm" iconOnly icon="x" className="pbx-dialog__close" onClick={onClose}>Close</Button> : null}
        </header>
        {children ? <div className="pbx-dialog__body">{children}</div> : null}
        {footer ? <footer className="pbx-dialog__foot">{footer}</footer> : null}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Drawer */

export interface DrawerProps {
  open: boolean;
  onClose?: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
}

/** A panel from the right for detail you inspect without leaving the page (pending orders, an order). */
export function Drawer(props: DrawerProps) {
  const { open, onClose, title, description, children, footer, width } = props;
  const id = React.useId();
  const panel = React.useRef<HTMLDivElement>(null);
  useModal(open, onClose, panel);
  if (!open) return null;
  return (
    <div className="pbx-drawer-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={id + '-t'} tabIndex={-1} className="pbx-drawer" style={width ? { width: 'min(' + width + 'px, 100vw)' } : undefined}>
        <header className="pbx-drawer__head">
          <div className="pbx-drawer__titles">
            <h2 id={id + '-t'} className="pbx-drawer__title">{title}</h2>
            {description ? <p className="pbx-drawer__desc">{description}</p> : null}
          </div>
          {onClose ? <Button variant="ghost" size="sm" iconOnly icon="x" onClick={onClose}>Close</Button> : null}
        </header>
        <div className="pbx-drawer__body">{children}</div>
        {footer ? <footer className="pbx-drawer__foot">{footer}</footer> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- PhotoTile */

export interface PhotoTileProps {
  src?: string;
  alt?: string;
  status?: 'ready' | 'uploading' | 'uploaded' | 'error';
  /** 0–100 while uploading; leave it out when the upload reports no progress and the bar runs indeterminate. */
  progress?: number;
  /** The image's load and error events, e.g. to read its orientation or fall back when it cannot be shown. */
  onImageLoad?: React.ReactEventHandler<HTMLImageElement>;
  onImageError?: React.ReactEventHandler<HTMLImageElement>;
  /** Width / height of the print: "3 / 4" (small) or "2 / 3" (large). */
  ratio?: string;
  /** Shows the chosen print style: a Polaroid adds the white border. */
  printStyle?: 'normal' | 'polaroid';
  label?: React.ReactNode;
  onRemove?: () => void;
  className?: string;
}

/** A customer photo as it will print, with upload progress, state and remove. */
export function PhotoTile(props: PhotoTileProps) {
  const { src, alt = '', status = 'ready', progress, ratio = '3 / 4', printStyle = 'normal', label, onRemove, onImageLoad, onImageError, className } = props;
  const indeterminate = progress === undefined;
  return (
    <figure className={cx('pbx-photo', 'pbx-photo--' + printStyle, 'is-' + status, className)}>
      <div className="pbx-photo__frame" style={{ aspectRatio: ratio }}>
        <div className="pbx-photo__print">
          {src ? <img src={src} alt={alt} loading="lazy" onLoad={onImageLoad} onError={onImageError} /> : <span className="pbx-photo__ph"><Icon name="image" size={20} /></span>}
        </div>
        {status === 'uploading' ? (
          <span
            className={cx('pbx-photo__progress', indeterminate && 'pbx-photo__progress--indeterminate')}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={indeterminate ? undefined : Math.round(progress)}
            aria-label="Uploading"
          >
            <span style={indeterminate ? undefined : { width: Math.max(4, Math.min(100, progress)) + '%' }} />
          </span>
        ) : null}
        {status === 'uploaded' ? <Badge tone="positive" size="sm" icon="check" className="pbx-photo__state">Uploaded</Badge> : null}
        {status === 'error' ? <Badge tone="negative" size="sm" icon="triangle-alert" className="pbx-photo__state">Failed</Badge> : null}
        {onRemove ? (
          <button type="button" className="pbx-photo__remove" aria-label="Remove photo" onClick={onRemove}><Icon name="x" size={14} strokeWidth={2} /></button>
        ) : null}
      </div>
      {label ? <figcaption>{label}</figcaption> : null}
    </figure>
  );
}
