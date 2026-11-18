import { db } from "./index";
import { orderTimelineEvents, type OrderTimelineEventType } from "./schema";

export type TimelineInput = {
  orderId: string;
  type: OrderTimelineEventType;
  title: string;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
  /** Torna a gravação idempotente (retentativas de webhook). */
  dedupeKey?: string;
};

/** Query de inserção (pode entrar em `db.batch`). Duplicata por `dedupeKey` é ignorada. */
export function timelineInsert(input: TimelineInput) {
  return db
    .insert(orderTimelineEvents)
    .values({
      orderId: input.orderId,
      type: input.type,
      title: input.title,
      description: input.description ?? null,
      metadata: input.metadata ?? null,
      dedupeKey: input.dedupeKey ?? null,
    })
    .onConflictDoNothing();
}

/** Grava um evento sem nunca lançar: a timeline é auditoria e não pode derrubar o fluxo principal. */
export async function recordTimelineEvent(input: TimelineInput): Promise<void> {
  try {
    await timelineInsert(input);
  } catch (error) {
    console.error("[timeline] falha ao registrar evento", {
      orderId: input.orderId,
      type: input.type,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
