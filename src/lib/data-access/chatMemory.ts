import { supabase } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';

/**
 * Data-access layer for `chat_memory_facts` (Requirements Section 5.4.1) —
 * structured, queryable facts ("owner prioritizes profitability over
 * growth"), not raw chat logs. Retrieval, not full-history-in-prompt: the
 * chat module pulls relevant facts by subject, not the whole table.
 */

type ChatMemoryFactRow = Database['public']['Tables']['chat_memory_facts']['Row'];
type ChatMemoryFactInsert = Database['public']['Tables']['chat_memory_facts']['Insert'];

export interface ChatMemoryFact {
  id: string;
  factType: string;
  subject: string;
  content: string;
  sourceConversationRef: string | null;
  createdAt: string;
  expiresAt: string | null;
}

function mapFactRow(row: ChatMemoryFactRow): ChatMemoryFact {
  return {
    id: row.id,
    factType: row.fact_type,
    subject: row.subject,
    content: row.content,
    sourceConversationRef: row.source_conversation_ref,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

/** Retrieval by subject (e.g. `'stylist:<uuid>'`, `'cac'`, `'general'`) — see Section 5.4.1's "retrieval, not full-history-in-prompt" design principle. */
export async function listChatMemoryFactsForSubject(subject: string): Promise<ChatMemoryFact[]> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('chat_memory_facts')
    .select('*')
    .eq('subject', subject)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []).map(mapFactRow);
}

export async function recordChatMemoryFact(input: {
  factType: string;
  subject: string;
  content: string;
  sourceConversationRef?: string | null;
  expiresAt?: string | null;
}): Promise<ChatMemoryFact> {
  const insert: ChatMemoryFactInsert = {
    fact_type: input.factType,
    subject: input.subject,
    content: input.content,
    source_conversation_ref: input.sourceConversationRef ?? null,
    expires_at: input.expiresAt ?? null,
  };

  const { data, error } = await supabase.from('chat_memory_facts').insert(insert).select().single();
  if (error) throw error;
  return mapFactRow(data);
}
