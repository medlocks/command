import type { RankedRecommendation } from '../deterministic';

/**
 * The chat's rolling operational memory (Requirements Section 5.4.1
 * update) — "the to-do list itself... current open items with their £
 * impact figures, in-progress/'waiting' items with notes, and recently
 * completed items, so the chat and the to-do list feel like one connected
 * system." This is pure, deterministic assembly over the already-computed
 * to-do list — nothing here calls an LLM. It's the context a future
 * prompt would inject (see `promptBuilder.ts`); the LLM orchestration
 * layer itself remains unimplemented in this build (no provider wired up
 * yet), so nothing here should be read as "the chat can already answer
 * these questions" — it's the data layer that would make that possible
 * once it is.
 */

export interface OperationalMemoryTodoItem {
  id: string;
  category: string;
  title: string;
  estimatedImpact: number | null;
  impactConfidence: string;
  status: string;
  urgency: string;
  notes: string | null;
}

export interface OperationalMemoryContext {
  referenceDate: string;
  /** Not yet started — `pending`. */
  openItems: OperationalMemoryTodoItem[];
  /** Started but not resolved — `in_progress`, the "waiting" state (Section 5.5). */
  inProgressItems: OperationalMemoryTodoItem[];
  /** `accepted` (done), `rejected`, or `dismissed` — closed one way or another. */
  closedItems: OperationalMemoryTodoItem[];
  /** Sum of `estimatedImpact` across open + in-progress items only — the live, unresolved opportunity size. */
  totalOpenImpact: number;
  openItemCount: number;
  inProgressItemCount: number;
}

function toMemoryItem(item: RankedRecommendation): OperationalMemoryTodoItem {
  return {
    id: item.id,
    category: item.category,
    title: item.title,
    estimatedImpact: item.estimatedImpact,
    impactConfidence: item.impactConfidence,
    status: item.status,
    urgency: item.urgency,
    notes: item.notes,
  };
}

/**
 * Assembles the current to-do list into the structured shape the chat's
 * operational memory layer needs — so a future question like "what's
 * still open from this week" or "why did I mark the retail one as
 * waiting" can be answered from this, not by re-querying the warehouse
 * independently of what's already on the list (Section 5.4.1's own
 * framing).
 */
export function buildOperationalMemoryContext(todoList: readonly RankedRecommendation[], referenceDate: string): OperationalMemoryContext {
  const openItems = todoList.filter((item) => item.status === 'pending').map(toMemoryItem);
  const inProgressItems = todoList.filter((item) => item.status === 'in_progress').map(toMemoryItem);
  const closedItems = todoList
    .filter((item) => item.status === 'accepted' || item.status === 'rejected' || item.status === 'dismissed')
    .map(toMemoryItem);

  const totalOpenImpact = [...openItems, ...inProgressItems].reduce((sum, item) => sum + (item.estimatedImpact ?? 0), 0);

  return {
    referenceDate,
    openItems,
    inProgressItems,
    closedItems,
    totalOpenImpact,
    openItemCount: openItems.length,
    inProgressItemCount: inProgressItems.length,
  };
}
