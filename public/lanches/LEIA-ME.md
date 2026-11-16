# Fotos dos lanches

Uma pasta por destino (mesmo id de `src/components/storefront/destinations.ts`):

    lanches/st-louis/  lanches/mexico/  lanches/tokyo/  lanches/buenos-aires/
    lanches/milao/     lanches/cremona/ lanches/corbin/
    lanches/outros/    (lanches sem destino: clássicos, combos, etc.)
    ../bebidas/        (bebidas, sobremesas)

## Nome do arquivo
`<slug-do-lanche>.webp`  (minúsculo, sem acento, sem espaço, hífen)

Exemplos:
- lanches/mexico/burguer-mexicano.webp
- lanches/tokyo/teriyaki-burguer.webp
- bebidas/coca-cola-lata.webp

Se houver mais de uma foto do mesmo lanche: `<slug>-2.webp`, `<slug>-3.webp`.
A foto principal é sempre `<slug>.webp`.

## Tamanho / formato
- Proporção 1:1 (quadrada), 800 x 800 px (cobre o card 128px e o modal ~512px em telas retina)
- Formato WebP, qualidade ~80, alvo de 60–120 KB (máx. 200 KB)
- Lanche centralizado com folga ~8% nas bordas (o card corta com cantos arredondados)
- Fundo limpo e consistente entre todas as fotos

## URL no sistema
Arquivo em `public/lanches/mexico/burguer-mexicano.webp` => `/lanches/mexico/burguer-mexicano.webp`

## Combos
Pasta `public/combos/` — mesmas regras (WebP, 800x800, 1:1, nome em hífen).
Mostre o conjunto completo na foto (lanche + batata + bebida).
Exemplos: combos/combo-mexico.webp, combos/combo-casal.webp, combos/combo-familia.webp
