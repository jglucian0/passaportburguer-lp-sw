import { formatCents } from "@/lib/utils";

import { updateCartTool } from "./draft-flow";
import type { CustomerContext } from "./customer-context";
import type { ToolContext } from "./shared";

/** Perguntas (entrega/retirada) depois de o carrinho estar pronto. */
export function nextQuestion(customer: CustomerContext): string {
  if (customer.isRegistered && customer.defaultAddress) {
    return `Entrego em *${customer.defaultAddress.street}, ${customer.defaultAddress.number}* ou você vai retirar?`;
  }
  return "É para entrega ou você vai retirar?";
}

/**
 * Atalho "Repetir pedido": grava os itens do último pedido entregue no rascunho (validados no catálogo atual).
 * Devolve o texto (blocos separados por linha em branco = mensagens separadas) ou null se não deu para repetir.
 */
export async function repeatLastOrder(ctx: ToolContext, customer: CustomerContext): Promise<string | null> {
  if (!customer.isRegistered || customer.lastOrderItems.length === 0) return null;
  const items = customer.lastOrderItems
    .filter((i) => !!i.productId)
    .map((i) => ({
      productId: i.productId as string,
      quantity: i.quantity,
      addons: i.addonIds.map((addonId) => ({ addonId, quantity: 1 })),
    }));
  if (items.length === 0) return null;

  const result = await updateCartTool(ctx, { items });
  if (!result.ok) return null; // item sem estoque/mudou de preço: segue pelo cardápio

  const lines = result.lines
    .map((l) => `• ${l.quantity}x ${l.name}${l.addons.length ? ` (+ ${l.addons.join(", ")})` : ""}`)
    .join("\n");
  return [`Anotei o de sempre!\n${lines}\nSubtotal: *${formatCents(result.subtotalCents)}*`, nextQuestion(customer)].join("\n\n");
}
