import * as React from 'react';
import { createPortal } from 'react-dom';
import { Toaster as HotToaster, resolveValue, toast as hotToast } from 'react-hot-toast';
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

export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  iconRight?: IconName;
  /** Square button showing only the icon; children become its screen-reader label and, without `tooltip`, its tooltip. */
  iconOnly?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  /** Shown on hover and keyboard focus. Buttons take no `title`: the browser's tooltip is not ours. */
  tooltip?: React.ReactNode;
}

/** The one button. Primary (green) once per view, for the thing the screen is for. */
export function Button(props: ButtonProps) {
  const { variant = 'secondary', size = 'md', icon, iconRight, iconOnly, loading, fullWidth, tooltip, disabled, className, children, type = 'button', ...rest } = props;
  const iconSize = size === 'lg' ? 18 : 16;
  const button = (
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
  // An icon-only button shows its label (or a shorter `tooltip`) as a tooltip; its screen-reader
  // label already says the same, so the tooltip is not read out as well.
  const tip = tooltip ?? (iconOnly ? children : null);
  return tip ? <Tooltip content={tip} repeatsLabel={iconOnly}>{button}</Tooltip> : button;
}

/* -------------------------------------------------------------- Floating */

const FLOAT_GAP = 4;
const FLOAT_EDGE = 8;

interface FloatingProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The element the panel opens from. */
  anchor: React.RefObject<HTMLElement | null>;
  panel: React.RefObject<HTMLDivElement | null>;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  /** At least as wide as the anchor (a list under its field). */
  matchWidth?: boolean;
  /** Taller content scrolls inside the panel. */
  maxHeight?: number;
  /** Called on a press outside the anchor and the panel. */
  onDismiss?: () => void;
}

/**
 * A menu, list, calendar or tooltip in a portal on <body>, fixed next to the element it opens
 * from, so no table or scrolling card clips it and it shows above dialogs. It opens on the side
 * asked for, or the opposite one when that has more room, keeps inside the window and follows
 * its anchor while the page scrolls.
 */
function Floating(props: FloatingProps) {
  const { anchor, panel, side = 'bottom', align = 'start', matchWidth, maxHeight, onDismiss, className, children, ...rest } = props;
  const dismiss = React.useRef(onDismiss);
  React.useEffect(() => { dismiss.current = onDismiss; }, [onDismiss]);

  React.useLayoutEffect(() => {
    const place = () => {
      const a = anchor.current;
      const p = panel.current;
      if (!a || !p) return;
      p.style.visibility = a.isConnected ? '' : 'hidden';
      const r = a.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      if (matchWidth) p.style.minWidth = r.width + 'px';
      const w = p.offsetWidth;
      // The full height, also while a scrolling panel is capped below it.
      const natural = p.scrollHeight + p.offsetHeight - p.clientHeight;
      let h = maxHeight ? Math.min(natural, maxHeight) : natural;
      let top: number;
      let left: number;
      if (side === 'left' || side === 'right') {
        const after = r.right + FLOAT_GAP;
        const before = r.left - FLOAT_GAP - w;
        left = side === 'right' ? (after + w <= vw - FLOAT_EDGE ? after : before) : before >= FLOAT_EDGE ? before : after;
        top = r.top + (r.height - h) / 2;
      } else {
        const below = vh - r.bottom - FLOAT_GAP - FLOAT_EDGE;
        const above = r.top - FLOAT_GAP - FLOAT_EDGE;
        const down = side === 'bottom' ? h <= below || below >= above : h > above && below > above;
        if (maxHeight) {
          h = Math.min(h, Math.max(down ? below : above, 96));
          p.style.maxHeight = h + 'px';
        }
        top = down ? r.bottom + FLOAT_GAP : r.top - FLOAT_GAP - h;
        left = align === 'start' ? r.left : align === 'end' ? r.right - w : r.left + (r.width - w) / 2;
      }
      p.style.left = Math.round(Math.max(FLOAT_EDGE, Math.min(left, vw - FLOAT_EDGE - w))) + 'px';
      p.style.top = Math.round(Math.max(FLOAT_EDGE, Math.min(top, vh - FLOAT_EDGE - h))) + 'px';
    };
    // Scrolling inside the panel moves nothing; scrolling the page or a card moves the anchor.
    const onScroll = (e: Event) => { if (!panel.current?.contains(e.target as Node)) place(); };
    place();
    const resize = new ResizeObserver(place);
    if (panel.current) resize.observe(panel.current);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', place);
    return () => {
      resize.disconnect();
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', place);
    };
  }, [anchor, panel, side, align, matchWidth, maxHeight]);

  React.useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!anchor.current?.contains(t) && !panel.current?.contains(t)) dismiss.current?.();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [anchor, panel]);

  return createPortal(
    <div ref={panel} className={cx('pbx-float', className)} {...rest}>
      {children}
    </div>,
    document.body,
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
  // Set when the keyboard opens the menu, so its first item takes focus once it renders.
  const focusFirst = React.useRef(false);

  React.useEffect(() => {
    if (open && focusFirst.current) list.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
    focusFirst.current = false;
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) (root.current?.firstElementChild as HTMLElement | null)?.focus();
  };

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      // Only the menu closes, not a dialog it sits in.
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key === 'Tab') {
      // Tab leaves from the menu's button, so focus moves on to whatever follows it.
      close(true);
      return;
    }
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
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (open) list.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
        else {
          focusFirst.current = true;
          setOpen(true);
        }
      }
    },
  });

  return (
    <div ref={root} className={cx('pbx-menu', className)}>
      {opener}
      {open ? (
        <Floating
          anchor={root}
          panel={list}
          align={align}
          onDismiss={() => setOpen(false)}
          role="menu"
          aria-label={label}
          className="pbx-menu__list"
          style={minWidth ? { minWidth } : undefined}
          onKeyDown={onListKey}
        >
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
                onClick={() => { close(!!list.current?.contains(document.activeElement)); it.onSelect?.(); }}
              >
                {it.icon ? <Icon name={it.icon} size={16} /> : null}
                <span className="pbx-menu__label">{it.label}</span>
                {it.hint ? <span className="pbx-menu__hint">{it.hint}</span> : null}
              </button>
            ),
          )}
        </Floating>
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
        <label id={id + '-label'} htmlFor={id} className="pbx-field__label">
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

/** What is wrong with a field, in our words rather than the browser's. */
function validityMessage(el: HTMLInputElement | HTMLTextAreaElement) {
  const v = el.validity;
  const { min, max, step, type } = el as HTMLInputElement;
  if (v.valueMissing) return 'Fill this in.';
  if (v.badInput) return type === 'number' ? 'Enter a number.' : 'Check this value.';
  if (v.typeMismatch) return type === 'email' ? 'Enter an email address.' : type === 'url' ? 'Enter a web address, starting https://' : 'Check this value.';
  if (v.rangeUnderflow) return `Enter ${min} or more.`;
  if (v.rangeOverflow) return `Enter ${max} or less.`;
  if (v.stepMismatch) return step === '1' ? 'Enter a whole number.' : `Use steps of ${step}.`;
  if (v.tooShort) return `Use at least ${el.minLength} characters.`;
  if (v.tooLong) return `Use at most ${el.maxLength} characters.`;
  if (v.patternMismatch) return 'Check the format.';
  return el.validationMessage;
}

/**
 * Our fields show their own validation messages. Each cancels its `invalid` event, which keeps the
 * browser's bubble away while `required`, `min` and the rest still stop the form from submitting,
 * shows the message under itself, and the form's first invalid field takes focus.
 */
function useValidity(focus?: () => void) {
  const [message, setMessage] = React.useState('');
  const onInvalid = (e: React.FormEvent<HTMLInputElement | HTMLTextAreaElement>, text?: string) => {
    e.preventDefault();
    const el = e.currentTarget;
    setMessage(text || validityMessage(el));
    if (el.form?.querySelector('input:invalid, textarea:invalid') === el) {
      if (focus) focus();
      else el.focus();
    }
  };
  return { message, onInvalid, clear: () => setMessage('') };
}

/* ------------------------------------------------------------- TextField */

export interface TextFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement & HTMLTextAreaElement>, 'size' | 'prefix' | 'title'> {
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
  /** The input element (not a multiline field's textarea). */
  ref?: React.Ref<HTMLInputElement>;
}

/**
 * A labelled text, number or search input, or a textarea; dates and months use DateField. The
 * browser's own suggestions stay off unless `autoComplete` asks for them (the sign-in form does).
 */
export function TextField(props: TextFieldProps) {
  const { label, hint, error, icon, prefix, suffix, size = 'md', multiline, rows = 4, id, className, required, autoComplete = 'off', onChange, onInvalid, ref, ...rest } = props;
  const auto = React.useId();
  const fid = id || auto;
  const validity = useValidity();
  const shown = error || validity.message || undefined;
  const field = {
    id: fid,
    required,
    autoComplete,
    'aria-invalid': shown ? true : undefined,
    'aria-describedby': hint || shown ? fid + '-msg' : undefined,
    ...rest,
    onChange: (e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => { validity.clear(); onChange?.(e); },
    onInvalid: (e: React.FormEvent<HTMLInputElement & HTMLTextAreaElement>) => { validity.onInvalid(e); onInvalid?.(e); },
  };
  // Our clear button in place of the browser's: it sets the value the way typing does, so onChange runs.
  const clearSearch = (e: React.MouseEvent<HTMLButtonElement>) => {
    const input = e.currentTarget.parentElement?.querySelector('input');
    if (!input) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  };
  return (
    <FieldShell id={fid} label={label} hint={hint} error={shown} required={required} className={className}>
      {multiline ? (
        <textarea rows={rows} className="pbx-input pbx-input--multiline" {...field} />
      ) : (
        <div className={cx('pbx-input', 'pbx-input--' + size)}>
          {icon ? <Icon name={icon} size={16} className="pbx-input__icon" /> : null}
          {prefix ? <span className="pbx-input__affix">{prefix}</span> : null}
          <input ref={ref} {...field} />
          {rest.type === 'search' && rest.value && !rest.disabled && !rest.readOnly ? (
            <button type="button" className="pbx-input__clear" aria-label="Clear" onClick={clearSearch}>
              <Icon name="x" size={14} />
            </button>
          ) : null}
          {suffix ? <span className="pbx-input__affix">{suffix}</span> : null}
        </div>
      )}
    </FieldShell>
  );
}

/* ---------------------------------------------------------------- Select */

export interface SelectOption { value: string; label: string; disabled?: boolean }

export interface SelectProps {
  value: string;
  onChange?: (value: string) => void;
  /** Options in order; `{ divider: true }` draws a rule between groups. */
  options: Array<SelectOption | { divider: true }>;
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Label sits to the left ("Period  [This month]") for toolbar filters. */
  inlineLabel?: boolean;
  /** Shown while the value matches no option. */
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  /** Submits the value with a form. */
  name?: string;
  id?: string;
  className?: string;
  'aria-label'?: string;
}

const isOption = (o: SelectOption | { divider: true } | undefined): o is SelectOption => !!o && !('divider' in o);

/**
 * Our select, for periods, years, employees and other short lists: a field that opens its options
 * in a list under it. Arrows, Home and End move, typing jumps to an option, Enter or Space picks
 * and Escape closes; focus stays on the field throughout. It is as wide as its longest option.
 */
export function Select(props: SelectProps) {
  const { value, onChange, options, label, hint, error, size = 'md', inlineLabel, placeholder = 'Select…', required, disabled, name, id, className } = props;
  const auto = React.useId();
  const fid = id || auto;
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(-1);
  const box = React.useRef<HTMLDivElement>(null);
  const list = React.useRef<HTMLDivElement>(null);
  const button = React.useRef<HTMLButtonElement>(null);
  const typed = React.useRef({ text: '', at: 0 });
  const validity = useValidity(() => button.current?.focus());
  const shown = error || validity.message || undefined;

  const selected = options.findIndex((o) => isOption(o) && o.value === value);
  const current = selected >= 0 ? (options[selected] as SelectOption) : null;
  const usable = (i: number) => { const o = options[i]; return isOption(o) && !o.disabled; };
  // The option `times` usable steps from `from`, or the last one found on the way.
  const step = (from: number, dir: 1 | -1, times = 1) => {
    let at = from;
    for (let i = from + dir, left = times; left > 0 && i >= 0 && i < options.length; i += dir) {
      if (usable(i)) { at = i; left--; }
    }
    return at;
  };
  const show = (at = usable(selected) ? selected : step(-1, 1)) => { setActive(at); setOpen(true); };
  const choose = (i: number) => {
    if (!usable(i)) return;
    setOpen(false);
    const next = (options[i] as SelectOption).value;
    if (next === value) return;
    validity.clear();
    onChange?.(next);
  };

  // Typing jumps to the next option that starts with the typed text; one letter again and again
  // cycles through the options starting with it, as in a native select.
  const find = (key: string) => {
    const t = typed.current;
    const now = Date.now();
    t.text = now - t.at > 700 ? key : t.text + key;
    t.at = now;
    const text = t.text.toLowerCase();
    const query = text.split('').every((c) => c === text[0]) ? text[0] : text;
    const from = open ? active : selected;
    const start = query.length === 1 ? from + 1 : Math.max(from, 0);
    for (let n = 0; n < options.length; n++) {
      const i = (start + n) % options.length;
      if (usable(i) && (options[i] as SelectOption).label.toLowerCase().startsWith(query)) return i;
    }
    return -1;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const k = e.key;
    const char = k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
    if (!open) {
      // Enter opens through the button's click.
      if (k === 'ArrowDown' || k === 'ArrowUp' || k === ' ') {
        e.preventDefault();
        show();
      } else if (char) {
        const i = find(k);
        if (i >= 0) show(i);
      }
      return;
    }
    if (k === 'Escape') {
      // Only the list closes, not a dialog the field sits in.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (k === 'Tab') {
      setOpen(false);
    } else if (k === 'Enter' || (k === ' ' && Date.now() - typed.current.at > 700)) {
      // A space right after typing continues the name ("New D…") instead.
      e.preventDefault();
      choose(active);
    } else {
      const next =
        k === 'ArrowDown' ? step(active, 1) : k === 'ArrowUp' ? step(active, -1)
        : k === 'Home' ? step(-1, 1) : k === 'End' ? step(options.length, -1)
        : k === 'PageDown' ? step(active, 1, 8) : k === 'PageUp' ? step(active, -1, 8)
        : char ? find(k) : -2;
      if (next === -2) return;
      e.preventDefault();
      if (next >= 0) setActive(next);
    }
  };

  // Keep the active option in view as the keys move through a long list.
  React.useLayoutEffect(() => {
    const l = list.current;
    const el = open ? l?.querySelector<HTMLElement>(`[data-index="${active}"]`) : null;
    if (!l || !el) return;
    if (el.offsetTop < l.scrollTop) l.scrollTop = el.offsetTop;
    else if (el.offsetTop + el.offsetHeight > l.scrollTop + l.clientHeight) l.scrollTop = el.offsetTop + el.offsetHeight - l.clientHeight;
  }, [open, active]);

  return (
    <FieldShell id={fid} label={label} hint={hint} error={shown} required={required} inline={inlineLabel} className={className}>
      <div ref={box} className={cx('pbx-select', 'pbx-select--' + size, open && 'is-open')}>
        <button
          ref={button}
          id={fid}
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? fid + '-list' : undefined}
          aria-activedescendant={open && usable(active) ? fid + '-' + active : undefined}
          aria-label={props['aria-label']}
          aria-required={required || undefined}
          aria-invalid={shown ? true : undefined}
          aria-describedby={hint || shown ? fid + '-msg' : undefined}
          disabled={disabled}
          className="pbx-select__trigger"
          onClick={() => (open ? setOpen(false) : show())}
          onKeyDown={onKeyDown}
          // Space picks on keydown; its keyup would click the button open again.
          onKeyUp={(e) => { if (e.key === ' ') e.preventDefault(); }}
          onBlur={() => setOpen(false)}
        >
          <span className="pbx-select__value">
            <span className={current ? undefined : 'is-placeholder'}>{current ? current.label : placeholder}</span>
            {options.map((o, i) => (isOption(o) ? <span key={i} className="pbx-select__sizer" aria-hidden="true">{o.label}</span> : null))}
          </span>
          <Icon name="chevron-down" size={16} className="pbx-select__chev pbx-select__chev--turn" />
        </button>
        {name ? <input type="hidden" name={name} value={value} /> : null}
        {/* Keeps `required` in the form's validation; the field shows the message. */}
        {required ? (
          <input className="pbx-sr" tabIndex={-1} aria-hidden="true" required value={current ? value : ''} onChange={() => {}} onInvalid={(e) => validity.onInvalid(e, 'Choose one.')} />
        ) : null}
      </div>
      {open ? (
        <Floating
          anchor={box}
          panel={list}
          matchWidth
          maxHeight={320}
          onDismiss={() => setOpen(false)}
          id={fid + '-list'}
          role="listbox"
          aria-labelledby={label ? fid + '-label' : undefined}
          aria-label={label ? undefined : props['aria-label']}
          className="pbx-select__list"
          // Focus stays on the field while the pointer picks.
          onMouseDown={(e) => e.preventDefault()}
        >
          {options.map((o, i) =>
            isOption(o) ? (
              <div
                key={i}
                id={fid + '-' + i}
                data-index={i}
                role="option"
                aria-selected={i === selected}
                aria-disabled={o.disabled || undefined}
                className={cx('pbx-select__opt', i === active && 'is-active')}
                onMouseMove={() => { if (i !== active && usable(i)) setActive(i); }}
                onClick={() => choose(i)}
              >
                <span className="pbx-select__label">{o.label}</span>
                {i === selected ? <Icon name="check" size={14} /> : null}
              </div>
            ) : (
              <div key={i} role="separator" className="pbx-menu__sep" />
            ),
          )}
        </Floating>
      ) : null}
    </FieldShell>
  );
}

/* ------------------------------------------------------------- DateField */

const pad2 = (n: number) => String(n).padStart(2, '0');
const dateKey = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const monthKey = (d: Date) => dateKey(d).slice(0, 7);
/** `YYYY-MM-DD`, or `YYYY-MM` (the 1st), as a local date. */
function parseDateKey(s: string | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(s || '');
  return m ? new Date(+m[1], +m[2] - 1, m[3] ? +m[3] : 1) : null;
}
const shiftDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** The same day n months away, or that month's last day when it is shorter. */
function shiftMonths(d: Date, n: number) {
  const last = new Date(d.getFullYear(), d.getMonth() + n + 1, 0).getDate();
  return new Date(d.getFullYear(), d.getMonth() + n, Math.min(d.getDate(), last));
}
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface CalendarProps {
  mode: 'day' | 'month';
  value: string;
  min?: string;
  max?: string;
  clearable: boolean;
  onPick: (value: string) => void;
}

/** DateField's popup: a month of days (or a year of months) with keyboard movement. */
function Calendar(props: CalendarProps) {
  const { mode, value, min, max, clearable, onPick } = props;
  const today = new Date();
  // Outside [min, max]: compares keys cut to `len` characters (10 for days, 7 for months).
  const out = (key: string, len: number) => (!!min && key < min.slice(0, len)) || (!!max && key > max.slice(0, len));
  const [view, setView] = React.useState<'days' | 'months'>(mode === 'month' ? 'months' : 'days');
  // The day (or month) that holds focus in the grid.
  const [cursor, setCursor] = React.useState(() => {
    const start = parseDateKey(value) ?? today;
    const key = dateKey(start);
    if (max && key > max) return parseDateKey(max) ?? start;
    if (min && key < min) return parseDateKey(min) ?? start;
    return start;
  });
  const grid = React.useRef<HTMLDivElement>(null);
  // Focus follows the cursor when the calendar opens and after a key moves it, not after the arrows are clicked.
  const follow = React.useRef(true);
  React.useEffect(() => {
    if (!follow.current) return;
    follow.current = false;
    grid.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus({ preventScroll: true });
  }, [cursor, view]);
  const move = (next: Date) => { follow.current = true; setCursor(next); };

  const y = cursor.getFullYear();
  const m = cursor.getMonth();
  const todayKey = dateKey(today);

  if (view === 'days') {
    const first = new Date(y, m, 1 - new Date(y, m, 1).getDay());
    const days = Array.from({ length: 42 }, (_, i) => shiftDays(first, i));
    const cursorKey = dateKey(cursor);
    const title = cursor.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    const onKey = (e: React.KeyboardEvent) => {
      const c = cursor;
      const k = e.key;
      const next =
        k === 'ArrowLeft' ? shiftDays(c, -1) : k === 'ArrowRight' ? shiftDays(c, 1)
        : k === 'ArrowUp' ? shiftDays(c, -7) : k === 'ArrowDown' ? shiftDays(c, 7)
        : k === 'Home' ? shiftDays(c, -c.getDay()) : k === 'End' ? shiftDays(c, 6 - c.getDay())
        : k === 'PageUp' ? shiftMonths(c, e.shiftKey ? -12 : -1) : k === 'PageDown' ? shiftMonths(c, e.shiftKey ? 12 : 1)
        : null;
      if (!next) return;
      e.preventDefault();
      move(next);
    };
    return (
      <>
        <div className="pbx-cal__head">
          <Button variant="ghost" size="sm" iconOnly icon="chevron-left" onClick={() => setCursor(shiftMonths(cursor, -1))}>Previous month</Button>
          <button type="button" className="pbx-cal__title" aria-live="polite" onClick={() => { follow.current = true; setView('months'); }}>
            {title}
            <Icon name="chevron-down" size={14} />
          </button>
          <Button variant="ghost" size="sm" iconOnly icon="chevron-right" onClick={() => setCursor(shiftMonths(cursor, 1))}>Next month</Button>
        </div>
        <div ref={grid}>
          <table role="grid" aria-label={title} className="pbx-cal__grid" onKeyDown={onKey}>
            <thead>
              <tr>
                {WEEKDAYS.map((w) => <th key={w} scope="col" abbr={w}>{w.slice(0, 2)}</th>)}
              </tr>
            </thead>
            <tbody>
              {[0, 1, 2, 3, 4, 5].map((row) => (
                <tr key={row}>
                  {days.slice(row * 7, row * 7 + 7).map((d) => {
                    const key = dateKey(d);
                    const off = out(key, 10);
                    return (
                      <td key={key} aria-selected={key === value}>
                        <button
                          type="button"
                          tabIndex={key === cursorKey ? 0 : -1}
                          aria-label={d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                          aria-current={key === todayKey ? 'date' : undefined}
                          aria-disabled={off || undefined}
                          className={cx('pbx-cal__day', d.getMonth() !== m && 'is-outside', key === value && 'is-selected')}
                          onClick={() => { if (!off) onPick(key); }}
                        >
                          {d.getDate()}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="pbx-cal__foot">
          <Button variant="ghost" size="sm" disabled={out(todayKey, 10)} onClick={() => onPick(todayKey)}>Today</Button>
          {clearable ? <Button variant="ghost" size="sm" onClick={() => onPick('')}>Clear</Button> : null}
        </div>
      </>
    );
  }

  const chosen = value.slice(0, 7);
  const thisMonth = monthKey(today);
  const onKey = (e: React.KeyboardEvent) => {
    const c = cursor;
    const k = e.key;
    const by =
      k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : k === 'ArrowUp' ? -3 : k === 'ArrowDown' ? 3
      : k === 'Home' ? -c.getMonth() : k === 'End' ? 11 - c.getMonth()
      : k === 'PageUp' ? -12 : k === 'PageDown' ? 12 : 0;
    if (!by) return;
    e.preventDefault();
    move(shiftMonths(c, by));
  };
  const pickMonth = (d: Date) => {
    if (mode === 'month') return onPick(monthKey(d));
    // Picking the month for a date: back to that month's days.
    follow.current = true;
    setCursor(shiftMonths(cursor, (d.getFullYear() - y) * 12 + d.getMonth() - m));
    setView('days');
  };
  return (
    <>
      <div className="pbx-cal__head">
        <Button variant="ghost" size="sm" iconOnly icon="chevron-left" onClick={() => setCursor(shiftMonths(cursor, -12))}>Previous year</Button>
        {mode === 'day' ? (
          <button type="button" className="pbx-cal__title" aria-live="polite" onClick={() => { follow.current = true; setView('days'); }}>{y}</button>
        ) : (
          <span className="pbx-cal__title" aria-live="polite">{y}</span>
        )}
        <Button variant="ghost" size="sm" iconOnly icon="chevron-right" onClick={() => setCursor(shiftMonths(cursor, 12))}>Next year</Button>
      </div>
      <div ref={grid} role="group" aria-label={String(y)} className="pbx-cal__months" onKeyDown={onKey}>
        {MONTHS.map((short, i) => {
          const d = new Date(y, i, 1);
          const key = monthKey(d);
          const off = out(key, 7);
          return (
            <button
              key={key}
              type="button"
              tabIndex={i === m ? 0 : -1}
              aria-label={d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
              aria-pressed={key === chosen}
              aria-current={key === thisMonth ? 'date' : undefined}
              aria-disabled={off || undefined}
              className={cx('pbx-cal__month', key === chosen && 'is-selected')}
              onClick={() => { if (!off) pickMonth(d); }}
            >
              {short}
            </button>
          );
        })}
      </div>
      {mode === 'month' ? (
        <div className="pbx-cal__foot">
          <Button variant="ghost" size="sm" disabled={out(thisMonth, 7)} onClick={() => onPick(thisMonth)}>This month</Button>
          {clearable ? <Button variant="ghost" size="sm" onClick={() => onPick('')}>Clear</Button> : null}
        </div>
      ) : null}
    </>
  );
}

export interface DateFieldProps {
  /** `YYYY-MM-DD`, or `YYYY-MM` in month mode; '' while empty. */
  value: string;
  onChange?: (value: string) => void;
  /** `day` picks a date, `month` a month. */
  mode?: 'day' | 'month';
  /** Earliest and latest choices, in the value's format. */
  min?: string;
  max?: string;
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Label sits to the left, for toolbar filters. */
  inlineLabel?: boolean;
  placeholder?: string;
  required?: boolean;
  /** Offers Clear in the calendar; by default when the field is not required. */
  clearable?: boolean;
  disabled?: boolean;
  /** Submits the value with a form. */
  name?: string;
  id?: string;
  className?: string;
  'aria-label'?: string;
}

/**
 * Our date and month picker: a field that opens a calendar under it. Arrows move by day (or
 * month), Page Up and Page Down by month (or year), Enter picks and Escape closes.
 */
export function DateField(props: DateFieldProps) {
  const { value, onChange, mode = 'day', min, max, label, hint, error, size = 'md', inlineLabel, placeholder, required, clearable = !required, disabled, name, id, className } = props;
  const auto = React.useId();
  const fid = id || auto;
  const [open, setOpen] = React.useState(false);
  const box = React.useRef<HTMLDivElement>(null);
  const pop = React.useRef<HTMLDivElement>(null);
  const button = React.useRef<HTMLButtonElement>(null);
  const validity = useValidity(() => button.current?.focus());
  const shown = error || validity.message || undefined;
  const date = parseDateKey(value);
  const text = date ? date.toLocaleDateString('en-IN', mode === 'month' ? { month: 'long', year: 'numeric' } : { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const what = mode === 'month' ? 'month' : 'date';

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const pick = (next: string) => {
    close();
    if (next === value) return;
    validity.clear();
    onChange?.(next);
  };
  const onPopKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      // Only the calendar closes, not a dialog the field sits in.
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      // Tab cycles inside the calendar until it closes, as in a dialog.
      const els = Array.from(pop.current?.querySelectorAll<HTMLElement>('button:not(:disabled):not([tabindex="-1"])') || []);
      if (!els.length) return;
      const at = els.indexOf(document.activeElement as HTMLElement);
      e.preventDefault();
      e.stopPropagation();
      els[e.shiftKey ? (at <= 0 ? els.length - 1 : at - 1) : (at + 1) % els.length].focus();
    }
  };

  return (
    <FieldShell id={fid} label={label} hint={hint} error={shown} required={required} inline={inlineLabel} className={className}>
      <div ref={box} className={cx('pbx-select', 'pbx-select--' + size, open && 'is-open')}>
        <button
          ref={button}
          id={fid}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? fid + '-cal' : undefined}
          // Named by the label and the date it holds: "Joining date 25 Oct 2026".
          aria-labelledby={label ? `${fid}-label ${fid}-value` : undefined}
          aria-label={label ? undefined : [props['aria-label'], text].filter(Boolean).join(', ') || undefined}
          aria-required={required || undefined}
          aria-invalid={shown ? true : undefined}
          aria-describedby={hint || shown ? fid + '-msg' : undefined}
          disabled={disabled}
          className="pbx-select__trigger"
          onClick={() => setOpen((o) => !o)}
          onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true); } }}
        >
          <span id={fid + '-value'} className="pbx-select__value">
            <span className={text ? undefined : 'is-placeholder'}>{text || placeholder || 'Choose a ' + what}</span>
            <span className="pbx-select__sizer" aria-hidden="true">{mode === 'month' ? 'September 2026' : '28 Sept 2026'}</span>
          </span>
          <Icon name="calendar" size={15} className="pbx-select__chev" />
        </button>
        {name ? <input type="hidden" name={name} value={value} /> : null}
        {/* Keeps `required` in the form's validation; the field shows the message. */}
        {required ? (
          <input className="pbx-sr" tabIndex={-1} aria-hidden="true" required value={value} onChange={() => {}} onInvalid={(e) => validity.onInvalid(e, `Choose a ${what}.`)} />
        ) : null}
      </div>
      {open ? (
        <Floating anchor={box} panel={pop} onDismiss={() => setOpen(false)} id={fid + '-cal'} role="dialog" aria-label={'Choose a ' + what} className="pbx-cal" onKeyDown={onPopKey}>
          <Calendar mode={mode} value={value} min={min} max={max} clearable={clearable && !!value} onPick={pick} />
        </Floating>
      ) : null}
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
                const link = (item: NavItem, current: boolean, extra?: string) => {
                  const a = (
                    <a
                      href={item.href || '#'}
                      className={cx('pbx-nav', current && 'is-active', extra)}
                      aria-current={current ? 'page' : undefined}
                      aria-label={collapsed ? item.label : undefined}
                      onClick={onNavigate ? (e) => { e.preventDefault(); onNavigate(item.id); } : undefined}
                    >
                      {item.icon ? <Icon name={item.icon} size={18} /> : null}
                      <span className="pbx-nav__label">{item.label}</span>
                      {item.badge != null ? <span className="pbx-nav__badge">{item.badge}</span> : null}
                    </a>
                  );
                  // Collapsed to icons, each destination names itself in a tooltip.
                  return collapsed ? <Tooltip content={item.label} side="right" repeatsLabel>{a}</Tooltip> : a;
                };
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
  /** Work still running: a spinner in place of the icon. */
  busy?: boolean;
  onClose?: () => void;
  className?: string;
}

/** A transient confirmation or error after an action, bottom-right. */
export function Toast(props: ToastProps) {
  const { tone = 'neutral', title, description, action, busy, onClose, className } = props;
  return (
    <div className={cx('pbx-toast', 'pbx-toast--' + tone, className)} role={tone === 'negative' ? 'alert' : 'status'}>
      {busy ? <span className="pbx-spinner pbx-toast__icon" aria-hidden="true" /> : <Icon name={TONE_ICON[tone]} size={18} className="pbx-toast__icon" />}
      <div className="pbx-toast__text">
        <div className="pbx-toast__title">{title}</div>
        {description ? <div className="pbx-toast__desc">{description}</div> : null}
      </div>
      {action}
      {onClose ? <button type="button" className="pbx-toast__close" aria-label="Dismiss" onClick={onClose}><Icon name="x" size={14} /></button> : null}
    </div>
  );
}

/**
 * Where the app's toasts appear: `toast.success()`, `toast.error()` and `toast.loading()` from
 * react-hot-toast, drawn as our Toast at the bottom right. App renders it once.
 */
export function Toaster() {
  return (
    <HotToaster position="bottom-right" containerStyle={{ zIndex: 'var(--z-toast)' }}>
      {(t) => (
        <Toast
          tone={t.type === 'success' ? 'positive' : t.type === 'error' ? 'negative' : 'neutral'}
          busy={t.type === 'loading'}
          title={resolveValue(t.message, t)}
          onClose={t.type === 'loading' ? undefined : () => hotToast.dismiss(t.id)}
          className={t.visible ? 'pbx-toast--in' : 'pbx-toast--out'}
        />
      )}
    </HotToaster>
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

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement<React.HTMLAttributes<HTMLElement>>;
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** The content repeats the element's own name (an icon button's label), so it is not read twice. */
  repeatsLabel?: boolean;
}

/**
 * Our tooltip, in place of the browser's `title`: a short note on hover (after a moment) and on
 * keyboard focus, for icon buttons, truncated values and figures that need a word of explanation.
 * It wraps one element without adding a box around it, and reads its text out as a description.
 */
export function Tooltip(props: TooltipProps) {
  const { content, children, side = 'top', repeatsLabel } = props;
  const id = React.useId();
  const [open, setOpen] = React.useState(false);
  const anchor = React.useRef<HTMLElement | null>(null);
  const panel = React.useRef<HTMLDivElement>(null);
  const timer = React.useRef(0);
  React.useEffect(() => () => window.clearTimeout(timer.current), []);
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  if (content == null || content === false || content === '') return children;

  const show = (el: HTMLElement, delay: number) => {
    anchor.current = el;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setOpen(false);
  };
  const own = children.props;
  const described = repeatsLabel ? {} : typeof content === 'string' ? { 'aria-description': content } : { 'aria-describedby': open ? id : undefined };
  const trigger = React.cloneElement(children, {
    ...described,
    onPointerEnter: (e: React.PointerEvent<HTMLElement>) => { own.onPointerEnter?.(e); if (e.pointerType !== 'touch') show(e.currentTarget, 400); },
    onPointerLeave: (e: React.PointerEvent<HTMLElement>) => { own.onPointerLeave?.(e); hide(); },
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => { own.onPointerDown?.(e); hide(); },
    onFocus: (e: React.FocusEvent<HTMLElement>) => { own.onFocus?.(e); if (e.currentTarget.matches(':focus-visible')) show(e.currentTarget, 0); },
    onBlur: (e: React.FocusEvent<HTMLElement>) => { own.onBlur?.(e); hide(); },
  } as React.HTMLAttributes<HTMLElement>);
  return (
    <>
      {trigger}
      {open ? (
        <Floating anchor={anchor} panel={panel} side={side} align="center" id={id} role="tooltip" className="pbx-tip">
          {content}
        </Floating>
      ) : null}
    </>
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
