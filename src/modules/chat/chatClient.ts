/**
 * Thin client for the `chat-respond` Supabase Edge Function (Requirements
 * Section 5.4, Stage A of the Chat cutover) — same shape and reasoning as
 * `warehouseReadClient.ts`/`warehouseWriteClient.ts`: the actual LLM call
 * happens server-side (the OpenAI key never reaches the browser), gated
 * by the same shared-secret header plus the anon key satisfying Supabase's
 * own gateway JWT check.
 */

export interface ChatTurn {
  role: 'owner' | 'assistant';
  text: string;
}

export interface ChatRespondResult {
  ok: boolean;
  reply?: string;
  error?: string;
}

function functionsUrl(): string {
  const base = import.meta.env.VITE_SUPABASE_URL;
  if (!base) throw new Error('VITE_SUPABASE_URL is not set');
  return `${base.replace(/\/$/, '')}/functions/v1/chat-respond`;
}

/** Sends the owner's message plus the session-local conversation so far (never persisted server-side — see the Edge Function's own doc comment for why) and gets back a real model reply. The Edge Function assembles the real operational-memory context itself; this call carries no salon data, only the conversation. */
export async function sendChatMessage(message: string, history: readonly ChatTurn[]): Promise<ChatRespondResult> {
  const secret = import.meta.env.VITE_AD_SYNC_SHARED_SECRET;
  if (!secret) throw new Error('VITE_AD_SYNC_SHARED_SECRET is not set');
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!anonKey) throw new Error('VITE_SUPABASE_ANON_KEY is not set');

  let res: Response;
  try {
    res = await fetch(functionsUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${anonKey}`,
        'x-app-secret': secret,
      },
      body: JSON.stringify({ message, history }),
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network request failed' };
  }

  const json = (await res.json().catch(() => null)) as ChatRespondResult | null;
  if (!json) return { ok: false, error: `Request failed with HTTP ${res.status}` };
  return json;
}
