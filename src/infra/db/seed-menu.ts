/**
 * Cardápio real da Passaporte Burguer, usado pelo seed.
 *
 * Observações sobre a fonte (exportação do cardápio atual):
 * - `maxQuantity` de um adicional é limitado pelo máximo do grupo no seed.
 * - Textos de nome e descrição foram mantidos exatamente como vieram.
 */

export type SeedAddon = {
  name: string;
  priceCents: number;
  /** Máximo por item. Sem valor = 1. */
  max?: number;
};

export type SeedGroup = {
  name: string;
  min: number;
  max: number;
  addons: SeedAddon[];
};

export type SeedProduct = {
  name: string;
  description?: string;
  priceCents: number;
  featured?: boolean;
  groups?: SeedGroup[];
};

export type SeedCategory = {
  name: string;
  products: SeedProduct[];
};

const GIMME_THE_WORKS: SeedGroup = {
  name: "Gimme the Works!",
  min: 0,
  max: 5,
  addons: [
    { name: "Bacon", priceCents: 399, max: 4 },
    { name: "Smash Bovino 90g + Queijo prato", priceCents: 899, max: 3 },
    { name: "Picles de Pimenta Jalapeño", priceCents: 299, max: 3 },
    { name: "Alface + Tomate + Cebola Roxa", priceCents: 350, max: 2 },
  ],
};

const SALA_VIP: SeedGroup = {
  name: "Sala Vip!",
  min: 0,
  max: 2,
  addons: [{ name: "+ 1 Porções de Batata", priceCents: 899, max: 2 }],
};

export const MENU: SeedCategory[] = [
  {
    name: "Hambúrgueres",
    products: [
      {
        name: "Saint. Louis",
        description:
          "Sinta o sabor autêntico do Tradicional Americano com nosso Pão brioche selado na chapa, 2 Suculentos Smash Burguer Bovino de 90g, Queijo Prato derretido e a cremosa Original maionese verde Pass. Deixe seu paladar se render ao desejo!",
        priceCents: 3100,
        featured: true,
        groups: [GIMME_THE_WORKS],
      },
      {
        name: "Cidade do México",
        description:
          "Arriba! Um delicioso pão brioche selado, macio, acompanhado com 2 smash Blend bovino de 90g com queijo prato, Doritos, uma picancia media com picles de Jalapeño, fatias de Bacon crocante, cebola caramelizada, e a Original maionese pass.",
        priceCents: 4199,
        featured: true,
        groups: [
          {
            name: "Escolha sua bebida (Opcional)",
            min: 0,
            max: 3,
            addons: [
              { name: "Coca-Cola Zero 350ml", priceCents: 700, max: 3 },
              { name: "Coca-Cola Lata 350ml", priceCents: 700, max: 3 },
            ],
          },
          {
            name: "Adicionais",
            min: 0,
            max: 1,
            addons: [
              { name: "Smash + queijo (Mais uma carne)", priceCents: 899, max: 4 },
              { name: "Bacon Fatias", priceCents: 385 },
              { name: "Pimenta Jalapeño", priceCents: 299 },
            ],
          },
        ],
      },
      {
        name: "Gorngozola - Milão",
        description:
          "Hambúrguer de 170 g de carne suculenta, queijo prato derretido, Bacon e Cebola Caramelizados e um cremoso molho de Gorgonzola, tudo isso finalizado com nossa maionese especial e servido no pão Brioche macio.",
        priceCents: 4399,
        featured: true,
        groups: [GIMME_THE_WORKS],
      },
      {
        name: "Saint Louis Salad!",
        description:
          "Nosso Delicioso Burguer Tradicional Americano, 2 Suculentos Smash Burguer Bovino de 90g, queijo prato derretido, alface americana, tomate, cebola Roxa e a cremosa maionese verde Pass. Deixe seu paladar se render ao desejo desse clássico!",
        priceCents: 3449,
        groups: [
          {
            name: "Adicionais",
            min: 0,
            max: 6,
            addons: [
              { name: "Bacon", priceCents: 350, max: 3 },
              { name: "Smash Burguer Blend Bovino 90 g + Queijo prato", priceCents: 899, max: 3 },
              { name: "Maionese Verde 30 g", priceCents: 250 },
              { name: "Pimenta Jalapeño", priceCents: 350 },
            ],
          },
        ],
      },
      {
        name: "Buenos Aires",
        description:
          "Hermanos e Hermanas, bienvenidos! 1 Delicioso Burguer bovino suculento de 170g ao ponto, queijo prato, chimichurri artesanal, tomates chapeados e nossa autêntica maionese, com um leve toque defumado. Peça agora e se delicie!",
        priceCents: 3499,
        featured: true,
        groups: [
          {
            name: "¿Hamburguesa extra?",
            min: 0,
            max: 4,
            addons: [
              { name: "Hamburguer 170g Bovino + Queijo Prato", priceCents: 1399, max: 2 },
              { name: "Fatias de Bacon", priceCents: 350 },
              { name: "Pimenta Jalapeño!", priceCents: 350 },
            ],
          },
        ],
      },
      {
        name: "Corbin, Frango",
        description:
          "Nosso delicioso Burguer de Frango: pão brioche amanteigado tostado, queijo prato, alface americana, tomate, cebola roxa, junto também de nossa deliciosa maoionese verde Pass e para finalizar, um toque de mel de florada silvestre! Um lanche leve porem com muita personalidade!",
        priceCents: 3090,
        groups: [
          {
            name: "Adicionais",
            min: 0,
            max: 1,
            addons: [
              { name: "Hamburguer de frango Supreme", priceCents: 999 },
              { name: "2 Fatias de Queijo Prato", priceCents: 299 },
            ],
          },
        ],
      },
      {
        name: "Cremona",
        description:
          'Conessione Cremona! Nosso burger vem com 2 blends suínos, queijo prato, pepperoni, cebola roxa fresca, tomate, mel e a autêntica maionese pass. Com carnes de qualidade, e tudo isso em um delicioso pão brioche. Uma delícia que vai fazer você dizer "Mamma mia!". Peça agora!',
        priceCents: 3290,
        featured: true,
        groups: [
          {
            name: "Extra gostosura!",
            min: 0,
            max: 5,
            addons: [
              { name: "Bacon", priceCents: 350, max: 3 },
              { name: "Smash Suino 90 g + Queijo prato", priceCents: 799, max: 4 },
              { name: "Maioneses Verde 30 g", priceCents: 250 },
            ],
          },
          {
            name: "Vai uma bebida Sr(a)?",
            min: 0,
            max: 5,
            addons: [
              { name: "Kuat Guaraná 350ml", priceCents: 700, max: 5 },
              { name: "Coca-Cola Zero 350ml", priceCents: 700, max: 5 },
              { name: "Coca-Cola Lata 350ml", priceCents: 700, max: 5 },
            ],
          },
        ],
      },
      {
        name: "Tokyo",
        description:
          "Aceite o desafio de saborear o melhor burger de Tokyo! Com 2 blends de carne bovina de 90g, cream cheese, bacon crocante, tarê, cebola roxa fresca e maionese pass, tudo em um delicioso pão brioche selado. Surpreenda seu paladar com essa mistura única de sabores. Peça agora!",
        priceCents: 3960,
        featured: true,
        groups: [
          {
            name: "Escolha sua Maionese que irá compor o lanche",
            min: 1,
            max: 1,
            addons: [
              { name: "Maionese Verde!", priceCents: 0 },
              { name: "Maionese Wasabi!", priceCents: 0 },
            ],
          },
          {
            name: "Adicionais",
            min: 0,
            max: 5,
            addons: [
              { name: "Fatias de Bacon", priceCents: 350 },
              { name: "Smash burguer bovino 90g", priceCents: 850, max: 2 },
              { name: "Combo Batata 150 g + Coca 350 ml", priceCents: 1499 },
            ],
          },
        ],
      },
      {
        name: "Gwangju",
        description:
          "Apaixonados por pimenta, preparem-se para conhecer o Gwangju! Dois smash blends bovinos de 90g, queijo prato, o tradicional Kimchi coreano com picância moderada, nossa deliciosa maionese verde e bacon crocante, tudo acompanhado de um pão brioche fofinho, selado na chapa. Uma combinação marcante para surpreender seu paladar!",
        priceCents: 3960,
        featured: true,
        groups: [GIMME_THE_WORKS],
      },
    ],
  },

  {
    name: "Combos",
    products: [
      {
        name: "Saint Louis + Batata + Coca-Cola 350ml",
        description:
          "Descubra o sabor incrível do tradicional Burguer Saint Louis acompanhado de uma porção de batatas crocantes (150g) e Coca-Cola gelada de 350ml.",
        priceCents: 4299,
        groups: [
          {
            name: "Adicionais",
            min: 0,
            max: 10,
            addons: [
              { name: "Fatias de Bacon", priceCents: 350 },
              { name: "Alface + Tomate + Cebola roxa", priceCents: 250 },
              { name: "Smash Burguer Bovino 90 g + Queijo Prato", priceCents: 899 },
              { name: "Maionese Verde 30 g", priceCents: 250 },
            ],
          },
        ],
      },
      {
        name: "Cidade Do México + Batata + Coca-Cola 350ml",
        description:
          "Saboreie nosso 'carro chef' Cidade do México acompanhado por uma porção generosa de batatas crocantes (150g) e a refrescante Coca Cola Lata (350ml). Com carnes selecionadas, a combinação jalapeño/Doritos/bacon faz cada mordida ser uma explosão de sabores irresistíveis que vão deixar o seu paladar apaixonado. Experimente já e sinta o desejo de repetir essa experiência única!",
        priceCents: 5199,
        groups: [
          {
            name: "Adicionais",
            min: 0,
            max: 4,
            addons: [
              { name: "Smash Blend Bovino 90g com Queijo Prato", priceCents: 899, max: 2 },
              { name: "Fatias de Bacon", priceCents: 350, max: 2 },
            ],
          },
        ],
      },
      {
        name: "Cremona + Batata + Coca-Cola 350ml",
        description:
          "Nosso burger vem com 2 blends suínos, queijo prato, pepperoni, cebola roxa fresca, tomate, mel e a autêntica maionese pass. Tudo isso em um delicioso pão brioche! Acompanhado uma porção de batatas crocantes (150g) e Coca-Cola gelada de 350ml.",
        priceCents: 4199,
        groups: [
          {
            name: "Adicionais",
            min: 0,
            max: 4,
            addons: [
              { name: "Delicioso Bacon Crocante", priceCents: 350, max: 2 },
              { name: "Maionese Verde 30 g", priceCents: 250 },
              { name: "Ketchup 30 g", priceCents: 199 },
            ],
          },
        ],
      },
      {
        name: "Tokyo + Batata + Coca-Cola 350ml",
        description:
          "Nosso Delicioso Tokyo agora na versão Combo, (Batata e Coca Cola lata).Com 2 blends de carne bovina de 90g, cream cheese, bacon crocante, tarê, cebola roxa fresca e maionese pass, tudo em um delicioso pão brioche selado. Surpreenda seu paladar com essa mistura única de sabores. Peça agora!",
        priceCents: 5199,
        groups: [GIMME_THE_WORKS],
      },
      {
        name: "Los Favoritos + 2 Batata + 2 Coca-Cola",
        description:
          "A fusão de sabores com nosso combo de favoritos composto por 1 burger levemente apimentado Cidade do México e 1 delicioso burger Asiático Tokyo, acompanhados de 2 porções generosas de batata (150g) e 2 Coca-Cola (350ml) Satisfaça sua fome e seu paladar com essa combinação perfeita. Peça agora!",
        priceCents: 9165,
        groups: [SALA_VIP],
      },
      {
        name: "Conessione Eua > Italia + 2 Batata + 2 Coca-Cola",
        description:
          "Experimente a combinação perfeita: o suculento Burguer Cremona com toque agridoce, o clássico Burguer Americano Saint Louis e acompanhados de 2 porções generosas de batata (150g) e 2 Coca-Cola (350ml). Uma experiência de sabores inesquecível em um só pedido.",
        priceCents: 7650,
        groups: [SALA_VIP],
      },
      {
        name: "Familia Los favoritos + 4 Batata + 2 Coca-Cola",
        description:
          "Pega essa combinação de sabores para família: o apimentado Cidade do México, o delicioso Burguer Asiático Tokyo e 2 Saint Louis Kids. Acompanhados de 4 batatas (150g) e 2 Coca-Cola (350ml), você terá uma experiência completa de sabor. Faça já o seu pedido!",
        priceCents: 12190,
        groups: [SALA_VIP],
      },
      {
        name: "Familia Conessione Eua > Italia + 4 Batata + 2 Coca-Cola",
        description:
          "Outro incrível combo com 4 burguers - 2 Cremona (1 normal e 1 kids) com um toque agridoce e 2 Saint Louis (1 normal e 1 kids) - Acompanhados de 4 batatas (150g) e 2 Coca-Cola (350ml). Satisfaça sua fome com essa mistura de sabores deliciosos em uma única refeição. Peça agora!",
        priceCents: 11099,
        groups: [SALA_VIP],
      },
    ],
  },

  {
    name: "Kids",
    products: [
      {
        name: "Saint Louis Kids",
        description:
          "O nosso tradicional americano na versão Kids! Um Delicioso Pão Brioche, 1 smash Blend Bovino (90g), queijo prato e a nossa Original maionese verde pass.",
        priceCents: 1999,
      },
      {
        name: "Cremona Kids",
        description:
          "Experimente o sabor irresistível do nosso Cremona Kids! O delicioso Pão Brioche com o smash Blend suíno (90g) é acompanhado por queijo prato, rodelas de pepperoni, cebola roxa fresca, mel e a Original maionese pass. Uma mistura perfeita de sabores que vão conquistar o seu paladar e deixar você com água na boca. Não espere mais, peça já e surpreenda-se!",
        priceCents: 2299,
      },
    ],
  },

  {
    name: "Acompanhamentos",
    products: [
      {
        name: "Porçao de Batata",
        description:
          "Saboreie ainda mais sua viagem com nossa deliciosa batata, servida em uma porção generosa de 150g. Experimente agora e sinta o sabor incrível que ela traz!",
        priceCents: 960,
      },
      {
        name: "Nuggets",
        description:
          "Saboreie nossos Nuggets suculentos feitos de Peito de frango, com qualidade única e livres de hormônios. Com uma crocância leve e macia, cada mordida é uma explosão de sabor. Experimente já e sinta o desejo pelo próximo!",
        priceCents: 0,
        groups: [
          {
            name: "Inteira ou Meia porçao?",
            min: 1,
            max: 1,
            addons: [
              { name: "5 Unidades de Nugget", priceCents: 1550 },
              { name: "10 unidades", priceCents: 2399 },
            ],
          },
        ],
      },
      {
        name: "Bolinha de queijo Gouda",
        description: "Deliciosa empanado crocante por fora e queijo derretido por dentro!",
        priceCents: 0,
        groups: [
          {
            name: "Qual tamanho da sua fome?",
            min: 1,
            max: 1,
            addons: [
              { name: "5 unidades", priceCents: 1200 },
              { name: "10 unidades", priceCents: 2300 },
            ],
          },
        ],
      },
      {
        name: "Onion Rings",
        description: "Nossa Deliciosa cebola empanada!",
        priceCents: 0,
        groups: [
          {
            name: "Qual tamanho da sua fome?",
            min: 1,
            max: 1,
            addons: [
              { name: "5 unidades", priceCents: 1099 },
              { name: "10 unidades", priceCents: 1999 },
            ],
          },
        ],
      },
    ],
  },

  {
    name: "Molhos Pass",
    products: [
      { name: "Maionese Verde", priceCents: 250 },
      { name: "Maionese Pimenta Jalapeño", priceCents: 349 },
      { name: "Ketchup", priceCents: 199 },
      { name: "Mostarda e Mel", priceCents: 299 },
      { name: "Maionese de Wasabi", priceCents: 260 },
    ],
  },

  {
    name: "Bebidas",
    products: [
      { name: "Coca-Cola Original 350 ml", priceCents: 750 },
      {
        name: "Refrigerante sem Açúcar Coca-Cola 350 ml",
        description: "Lata 350ml",
        priceCents: 750,
      },
      { name: "Sprite Original 350 ml", description: "Lata 350ml", priceCents: 750 },
      { name: "Kuat Guarana 350 ml", priceCents: 750 },
      { name: "Heineken Long Neck", priceCents: 1200 },
      { name: "Suco Prats Laranja 300 ml", priceCents: 899 },
    ],
  },

  {
    name: "Sobremesas",
    products: [
      { name: "Brownie Pug Factory! 50 g", priceCents: 999 },
      {
        name: "Leitinho Recheado com avela!",
        description: "Delicioso Bombom Leitinho Recheado com avela Pug Factory! (20 g)",
        priceCents: 350,
      },
      { name: "Pudim", description: "Delicioso Pudim no copo americano", priceCents: 1599 },
    ],
  },
];
