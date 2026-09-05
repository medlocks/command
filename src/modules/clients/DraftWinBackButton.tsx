import { Button, useCopyToClipboard } from '@/shared';

/**
 * "One-tap action" for lapse-risk/colour-top-up clients (added 5 Sep
 * 2026) — same pattern as the stock reorder and hiring-signal job-post
 * actions: turns a real, already-computed insight into a ready-to-send
 * draft instead of leaving the owner to write it from scratch. Never
 * sends anything itself — `wa.me`/`mailto` open the owner's own
 * WhatsApp/email app with the message pre-filled, a human still reviews
 * and hits send.
 *
 * Gated on `marketingConsent`, not just labelled — a client who hasn't
 * opted in to marketing contact gets no draft action at all, since a
 * personal win-back message is exactly the kind of contact that consent
 * field exists to gate (Requirements Section 10's GDPR fields aren't
 * decorative). This is checked here, not just by the caller, so the gate
 * can't be silently bypassed by a future call site.
 */

const LINK_BUTTON_CLASSES =
  'inline-flex shrink-0 items-center rounded-lg border border-[var(--color-border)] bg-transparent px-3 py-1.5 text-xs font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-grid)]';

function buildWhatsAppHref(phone: string, message: string): string {
  const digits = phone.replace(/[^\d]/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

function buildMailtoHref(email: string, message: string): string {
  const subject = encodeURIComponent('A little overdue for your next visit!');
  return `mailto:${email}?subject=${subject}&body=${encodeURIComponent(message)}`;
}

export function draftColourTopUpMessage(clientName: string, daysUntilDue: number): string {
  const firstName = clientName.split(' ')[0] ?? clientName;
  const dueClause = daysUntilDue < 0 ? "you're overdue for your colour top-up" : "you're due for a colour top-up soon";
  return `Hi ${firstName}, it's Medlocks Hair — just a friendly nudge that ${dueClause}. Book in whenever suits you, we'd love to see you! x`;
}

export function draftLapseRiskMessage(clientName: string, daysSinceLastVisit: number): string {
  const firstName = clientName.split(' ')[0] ?? clientName;
  return `Hi ${firstName}, it's Medlocks Hair — we've missed you! It's been ${daysSinceLastVisit} days since your last visit, so thought I'd check in. Fancy booking something in? x`;
}

export function DraftWinBackButton({
  clientName,
  email,
  mobile,
  marketingConsent,
  message,
}: {
  clientName: string;
  email: string | null;
  mobile: string | null;
  marketingConsent: boolean;
  message: string;
}) {
  const { copied, copy } = useCopyToClipboard();

  if (!marketingConsent) {
    return <span className="text-[10px] text-[var(--color-ink-muted)]">No marketing consent on file</span>;
  }

  if (mobile) {
    return (
      <a href={buildWhatsAppHref(mobile, message)} target="_blank" rel="noopener noreferrer" className={LINK_BUTTON_CLASSES}>
        Message {clientName.split(' ')[0]}
      </a>
    );
  }

  if (email) {
    return (
      <a href={buildMailtoHref(email, message)} className={LINK_BUTTON_CLASSES}>
        Email {clientName.split(' ')[0]}
      </a>
    );
  }

  return (
    <Button variant="secondary" className="!px-3 !py-1.5 text-xs" onClick={() => void copy(message)}>
      {copied ? 'Copied!' : 'Copy message'}
    </Button>
  );
}
