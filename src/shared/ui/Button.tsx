import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary';

// Primary uses accent-strong (a deeper step of the brand pink), not the raw
// accent — the pale accent hex doesn't clear AA text contrast as a solid
// fill; accent-strong does (6.1:1 with white) while staying clearly on-brand.
// Primary also carries a soft tinted shadow (polish pass, 2 Sep 2026) — a
// plain flat fill reads flatter against the page's own soft gradient than
// a button with a little real lift; the shadow color is the accent itself
// at low opacity, not a generic gray, so it still reads as "this button"
// glowing rather than a generic drop shadow.
const variantClasses: Record<Variant, string> = {
  primary:
    'bg-[var(--color-accent-strong)] text-white shadow-[0_4px_14px_-2px_rgba(91,33,182,0.35)] hover:opacity-90 hover:shadow-[0_6px_18px_-2px_rgba(91,33,182,0.4)]',
  secondary:
    'bg-transparent text-[var(--color-ink)] border border-[var(--color-border)] hover:bg-[var(--color-grid)]',
};

/**
 * States that were entirely missing before this pass (polish pass, 2 Sep
 * 2026): a disabled button rendered at full opacity with no visual "this
 * won't do anything" cue anywhere in the app, and there was no visible
 * keyboard-focus indicator at all. Both are real gaps, not polish
 * nice-to-haves — a disabled Save button that looks identically clickable
 * to an active one is a genuine usability bug, not just an aesthetic one.
 */
const STATE_CLASSES =
  'disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none disabled:hover:opacity-45 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-strong)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-page)] ' +
  'active:scale-[0.98]';

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`rounded-lg px-4 py-2 text-sm font-medium transition-all duration-150 ${variantClasses[variant]} ${STATE_CLASSES} ${className}`}
      {...props}
    />
  );
}
