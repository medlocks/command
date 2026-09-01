import { useEffect, useMemo, useState } from 'react';
import { Button, Card } from '@/shared';
import { buildOperationalMemoryContext, formatImpact } from '@/modules/insight-engine';
import { useRecommendationOverrides } from '@/modules/recommendations/RecommendationOverridesProvider';
import { sendChatMessage, type ChatTurn } from './chatClient';

interface ChatMessage extends ChatTurn {
  isError?: boolean;
}

/**
 * "Salon Consultant" conversational dashboard (Requirements Section 5.4) —
 * Stage A of the Chat cutover: the LLM orchestration layer is now real
 * (`chat-respond`, calling OpenAI's gpt-5.6-terra server-side via the
 * Responses API — the OpenAI key never reaches the browser). Deliberately
 * scoped: the model only has the real rolling operational memory (the
 * to-do list's current state) — the
 * static salon profile (roster/pricing/service menu) is Stage B, long-term
 * structured memory (`chat_memory_facts`) is Stage C. The system prompt
 * (assembled server-side, see that function's own doc comment) tells the
 * model this explicitly, so it says "I don't have that yet" instead of
 * guessing when asked about anything outside the to-do list.
 *
 * The card above the conversation still shows the same rolling operational
 * memory summary (real since Stage 4) — it's the same data the model was
 * just given, displayed for the owner too, not a separate computation.
 *
 * Conversation history is session-only (component state, not persisted) —
 * re-sent to the Edge Function each turn so the model has continuity
 * within a session, but never stored server-side. Section 5.4.1 treats raw
 * chat logs as the wrong shape for durable memory; Stage C's extracted-
 * facts model is what actually persists across sessions, not a transcript.
 */
export function ChatPage() {
  const { items, loadCurrent } = useRecommendationOverrides();

  useEffect(() => {
    void loadCurrent();
  }, [loadCurrent]);

  const referenceDate = new Date().toISOString().slice(0, 10);
  const memory = useMemo(() => buildOperationalMemoryContext(items, referenceDate), [items, referenceDate]);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || isSending) return;

    const history: ChatTurn[] = messages.map(({ role, text: turnText }) => ({ role, text: turnText }));
    setMessages((prev) => [...prev, { role: 'owner', text }]);
    setDraft('');
    setIsSending(true);
    try {
      const result = await sendChatMessage(text, history);
      if (result.ok && result.reply) {
        setMessages((prev) => [...prev, { role: 'assistant', text: result.reply! }]);
      } else {
        setMessages((prev) => [...prev, { role: 'assistant', text: result.error ?? 'Something went wrong.', isError: true }]);
      }
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <Card>
        <p className="text-xs font-semibold tracking-wide text-[var(--color-ink-muted)] uppercase">
          Rolling operational memory
        </p>
        <p className="mt-1 text-sm text-[var(--color-ink-secondary)]">
          {memory.openItemCount} open, {memory.inProgressItemCount} in progress —{' '}
          {formatImpact(memory.totalOpenImpact)} outstanding this week.
        </p>
      </Card>

      <Card className="flex-1 space-y-3 overflow-y-auto">
        {messages.length === 0 && (
          <p className="text-sm text-[var(--color-ink-secondary)]">
            Ask about what's currently on the to-do list — what's open, what's waiting and why, what's already been
            done. It doesn't yet have the stylist roster, pricing, or revenue trends, and will say so if asked.
          </p>
        )}
        {messages.map((message, index) => (
          <p
            key={index}
            className={
              message.role === 'owner'
                ? 'text-right text-sm text-[var(--color-ink)]'
                : `text-sm ${message.isError ? 'text-[var(--color-critical)]' : 'text-[var(--color-ink-secondary)]'}`
            }
          >
            {message.text}
          </p>
        ))}
        {isSending && <p className="text-sm text-[var(--color-ink-muted)]">Thinking…</p>}
      </Card>
      <form className="flex gap-2" onSubmit={(event) => void handleSubmit(event)}>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask a question…"
          disabled={isSending}
          className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)]"
        />
        <Button type="submit" disabled={isSending || !draft.trim()}>
          {isSending ? 'Sending…' : 'Send'}
        </Button>
      </form>
    </div>
  );
}
