import { useState } from 'react';

/** Shared "Copy" button behavior — a transient `copied` flag, reset after `resetAfterMs`. Clipboard access can fail (permissions, insecure context); there's no real fallback beyond letting the user select the text themselves, so a failure is a silent no-op rather than an alarming error for something this low-stakes. */
export function useCopyToClipboard(resetAfterMs = 2000) {
  const [copied, setCopied] = useState(false);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), resetAfterMs);
    } catch {
      // no-op — see doc comment above
    }
  }

  return { copied, copy };
}
