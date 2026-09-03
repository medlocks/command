import { Button, useCopyToClipboard } from '@/shared';
import type { HiringSignal } from '@/modules/insight-engine';

/**
 * "One-tap action" for the Hiring Signal (added 3 Sep 2026) — only ever
 * shown for a 'strong' signal (checked by the caller, not here), since a
 * job post only makes sense once the case for hiring is actually strong.
 * Generates a deterministic template from the signal's own real numbers,
 * not an AI-written draft — consistent with the rest of the Business
 * Indicator Framework staying "a defined calculation, not the AI's
 * judgment" (Requirements Section 13). Copy-to-clipboard only: unlike a
 * reorder message there's no single recipient to deep-link to, the owner
 * pastes this into whichever job board/social post they actually use, and
 * is expected to edit specifics (role, hours) before posting.
 */

function buildJobPostDraft(signal: HiringSignal): string {
  const { avgTrailingUtilizationPct, sustainedWindowWeeks } = signal.currentValues;
  const utilPct = Math.round(avgTrailingUtilizationPct * 100);

  return `We're hiring at Medlocks Hair!

We've been running at ${utilPct}% capacity over the last ${sustainedWindowWeeks} weeks and need an extra pair of hands to keep up with demand.

We're looking for:
- An experienced hair stylist [edit: add the specific role/skills you need]
- Full-time or part-time [your call]
- Immediate start

If you're interested — or know someone who might be — get in touch, we'd love to hear from you.

[Edit this before posting: add your contact details, working hours, and pay.]`;
}

export function DraftJobPostButton({ signal }: { signal: HiringSignal }) {
  const { copied, copy } = useCopyToClipboard();
  const draft = buildJobPostDraft(signal);

  return (
    <Button variant="secondary" className="!px-3 !py-1.5 text-xs" onClick={() => void copy(draft)}>
      {copied ? 'Copied!' : 'Draft job post'}
    </Button>
  );
}
