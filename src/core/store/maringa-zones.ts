/**
 * Bairros atendidos em Maringá-PR e suas faixas de entrega.
 *
 * ÚNICO arquivo para cadastrar novos bairros ou ajustar taxas/tempos de forma
 * padronizada. Para aplicar no banco (sem sobrescrever o que já existe):
 *
 *   npm run db:seed-zones
 *
 * O banco (`delivery_zones`) continua sendo a fonte de verdade do checkout:
 * o servidor recalcula a taxa a partir dele e o painel admin (Entregas) edita
 * valores depois. Valores monetários em centavos.
 *
 * ATENÇÃO: a faixa de cada bairro abaixo é um ponto de partida. Revise antes de
 * publicar, trocando o valor de `TIER` ou os números das faixas.
 */

export type DeliveryTier = { feeCents: number; estimatedMinutes: number };

/** Faixas de entrega. Ajuste os valores aqui e todos os bairros da faixa acompanham. */
export const TIERS = {
  NEAR: { feeCents: 500, estimatedMinutes: 30 },
  MID: { feeCents: 700, estimatedMinutes: 40 },
  FAR: { feeCents: 800, estimatedMinutes: 45 },
} as const satisfies Record<string, DeliveryTier>;

export type DeliveryZoneSeed = {
  id: string;
  name: string;
  feeCents: number;
  estimatedMinutes: number;
};

function zone(id: string, name: string, tier: DeliveryTier): DeliveryZoneSeed {
  return { id, name, ...tier };
}

/**
 * Zona de contingência: atende QUALQUER endereço de Maringá que não esteja na lista
 * abaixo, por uma taxa única (como as taxas padrão dos apps de delivery).
 * O checkout seleciona esta zona sozinho quando o bairro do cliente não é encontrado.
 */
export const OTHER_ZONE_NAME = "Demais bairros de Maringá";

export const DELIVERY_ZONES: DeliveryZoneSeed[] = [
  /* Zonas */
  zone("zona-01", "Zona 01", TIERS.MID),
  zone("zona-02", "Zona 02", TIERS.MID),
  zone("zona-03", "Zona 03", TIERS.FAR),
  zone("zona-04", "Zona 04", TIERS.FAR),
  zone("zona-05", "Zona 05", TIERS.FAR),
  zone("zona-06", "Zona 06", TIERS.MID),
  zone("zona-07", "Zona 07", TIERS.NEAR),
  zone("zona-08", "Zona 08", TIERS.FAR),

  /* Centro e Vilas */
  zone("novo-centro", "Novo Centro", TIERS.MID),
  zone("vila-operaria", "Vila Operária", TIERS.MID),
  zone("vila-bosque", "Vila Bosque", TIERS.MID),
  zone("vila-esperanca", "Vila Esperança", TIERS.MID),

  /* Jardins */
  zone("jardim-alvorada", "Jardim Alvorada", TIERS.FAR),
  zone("jardim-universo", "Jardim Universo", TIERS.FAR),
  zone("jardim-aclimacao", "Jardim Aclimação", TIERS.MID),
  zone("jardim-novo-horizonte", "Jardim Novo Horizonte", TIERS.FAR),
  zone("jardim-liberdade", "Jardim Liberdade", TIERS.FAR),
  zone("jardim-paulista", "Jardim Paulista", TIERS.FAR),
  zone("jardim-higienopolis", "Jardim Higienópolis", TIERS.MID),

  /* Parques e Conjuntos */
  zone("parque-das-grevileas", "Parque das Grevíleas", TIERS.FAR),
  zone("conjunto-borba-gato", "Conjunto Borba Gato", TIERS.FAR),

  /* Taxa padrão para qualquer outro endereço de Maringá */
  zone("demais-bairros", OTHER_ZONE_NAME, TIERS.FAR),
];

/** Cidade/UF atendidas (validação do CEP no checkout). */
export const SERVICE_CITY = { name: "Maringá", uf: "PR" } as const;
