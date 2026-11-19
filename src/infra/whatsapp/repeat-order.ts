import { formatCents } from "@/lib/utils";

import { updateCartTool } from "./draft-flow";
import type { CustomerContext } from "./customer-context";
import { signWhatsAppToken } from "./session-token";
import { appUrl, type ToolContext } from "./shared";

/**
 * Atalho "Repetir pedido": grava os itens do último pedido entregue no rascunho (validados no catálogo atual) e arma
 * UM botão "Finalizar pedido" que abre direto a etapa de entrega/endereço/pagamento (sem passar pelo cardápio).
 * Devolve o corpo do botão ou null se não deu para repetir (item sumiu do cardápio, preço mudou etc.).
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
  if (!result.ok) return null;

  const lines = result.lines
    .map((l) => `• ${l.quantity}x ${l.name}${l.addons.length ? ` (+ ${l.addons.join(", ")})` : ""}`)
    .join("\n");
  const token = signWhatsAppToken({ phone: ctx.phone, purpose: "QUICK_CHECKOUT" });
  const body = `Anotei o de sempre!\n${lines}\nSubtotal: ${formatCents(result.subtotalCents)}\n\nToque abaixo pra escolher entrega ou retirada e pagar 👇`;
  ctx.cta = { buttonText: "Finalizar pedido", url: `${appUrl()}/cardapio-rapido?token=${encodeURIComponent(token)}`, bodyText: body };
  return body;
}
