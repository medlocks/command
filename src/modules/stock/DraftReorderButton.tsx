import { Button, useCopyToClipboard } from '@/shared';

/**
 * "One-tap action" for a stock flag/reorder forecast (added 3 Sep 2026) —
 * turns an insight into a ready-to-send draft instead of leaving the owner
 * to write the message themselves. Deliberately never sends anything on
 * its own: `wa.me`/`mailto` open the owner's own WhatsApp/email app with
 * the message pre-filled, so a human still reviews and hits send. With no
 * supplier contact on file, it falls back to plain copy-to-clipboard —
 * still useful, just not a live link.
 */

const LINK_BUTTON_CLASSES =
  'inline-flex shrink-0 items-center rounded-lg border border-[var(--color-border)] bg-transparent px-3 py-1.5 text-xs font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-grid)]';

function buildWhatsAppHref(phone: string, message: string): string {
  const digits = phone.replace(/[^\d]/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

function buildMailtoHref(email: string, productName: string, message: string): string {
  const subject = encodeURIComponent(`Reorder: ${productName}`);
  return `mailto:${email}?subject=${subject}&body=${encodeURIComponent(message)}`;
}

export function draftReorderMessage(productName: string, supplier: string | null, reasonClause: string): string {
  const greeting = supplier ? `Hi ${supplier}` : 'Hi';
  return `${greeting}, ${reasonClause} ${productName} at Medlocks Hair — could you get a reorder sorted? Thanks!`;
}

export function DraftReorderButton({
  productName,
  supplierEmail,
  supplierPhone,
  message,
}: {
  productName: string;
  supplierEmail: string | null;
  supplierPhone: string | null;
  message: string;
}) {
  const { copied, copy } = useCopyToClipboard();

  if (supplierPhone) {
    return (
      <a href={buildWhatsAppHref(supplierPhone, message)} target="_blank" rel="noopener noreferrer" className={LINK_BUTTON_CLASSES}>
        Message supplier
      </a>
    );
  }

  if (supplierEmail) {
    return (
      <a href={buildMailtoHref(supplierEmail, productName, message)} className={LINK_BUTTON_CLASSES}>
        Email supplier
      </a>
    );
  }

  return (
    <Button variant="secondary" className="!px-3 !py-1.5 text-xs" onClick={() => void copy(message)}>
      {copied ? 'Copied!' : 'Copy reorder message'}
    </Button>
  );
}
