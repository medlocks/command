import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary';

// Primary uses accent-strong (a deeper step of the brand pink), not the raw
// accent — the pale accent hex doesn't clear AA text contrast as a solid
// fill; accent-strong does (6.1:1 with white) while staying clearly on-brand.
const variantClasses: Record<Variant, string> = {
  primary: 'bg-[var(--color-accent-strong)] text-white hover:opacity-90',
  secondary:
    'bg-transparent text-[var(--color-ink)] border border-[var(--color-border)] hover:bg-[var(--color-grid)]',
};

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${variantClasses[variant]} ${className}`}
      {...props}
    />
  );
}
