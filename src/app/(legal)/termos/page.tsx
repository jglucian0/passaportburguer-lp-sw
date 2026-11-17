import type { Metadata } from "next";
import Link from "next/link";

import { LEGAL_CONTACT as C, LegalPage, type LegalSection } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Termos de Uso",
  description: "Condições de uso do site e dos pedidos do Passaporte Burguer.",
};

const sections: LegalSection[] = [
  {
    id: "o-servico",
    title: "O serviço",
    body: (
      <p>
        Estes termos regulam o uso do site do <strong>{C.company}</strong> (CNPJ {C.cnpj}, {C.city}). Por ele você
        consulta o cardápio, faz pedidos para entrega ou retirada e acompanha o andamento em “Meu Passaporte”.
      </p>
    ),
  },
  {
    id: "acesso-com-whatsapp",
    title: "Acesso com WhatsApp",
    body: (
      <ul>
        <li>O acesso é feito informando seu WhatsApp e enviando à loja o código de embarque gerado;</li>
        <li>Use somente um número do qual você seja titular ou esteja autorizado a usar;</li>
        <li>O código vale por 10 minutos e é de uso único; não o compartilhe com terceiros;</li>
        <li>Você é responsável pelas ações realizadas na sua sessão.</li>
      </ul>
    ),
  },
  {
    id: "pedidos-e-pagamento",
    title: "Pedidos, preços e pagamento",
    body: (
      <ul>
        <li>Preços e disponibilidade dos itens podem mudar sem aviso prévio;</li>
        <li>O valor final (itens, taxa de entrega e total) é confirmado no fechamento do pedido;</li>
        <li>Pode haver valor mínimo de pedido e taxa de entrega conforme o bairro atendido;</li>
        <li>O pedido só é considerado aceito após a confirmação da loja e, quando aplicável, do pagamento.</li>
      </ul>
    ),
  },
  {
    id: "entrega-e-retirada",
    title: "Entrega e retirada",
    body: (
      <p>
        Os prazos informados são estimativas e podem variar por movimento, clima e trânsito. Informe o endereço completo
        e correto: endereços incorretos ou cliente ausente podem impedir a entrega. Funcionamos nos horários indicados
        no site e podemos fechar temporariamente a loja quando necessário.
      </p>
    ),
  },
  {
    id: "cancelamentos",
    title: "Cancelamentos e problemas",
    body: (
      <p>
        Como os produtos são preparados na hora, cancelamentos só são possíveis antes do início do preparo. Havendo
        problema com seu pedido, fale com a gente o quanto antes para resolvermos, sem prejuízo dos seus direitos
        previstos no Código de Defesa do Consumidor.
      </p>
    ),
  },
  {
    id: "uso-adequado",
    title: "Uso adequado",
    body: (
      <p>
        É proibido usar o site para fraudar pedidos, tentar acessar contas de terceiros, sobrecarregar o sistema ou
        qualquer finalidade ilegal. Podemos bloquear acessos que violem estes termos.
      </p>
    ),
  },
  {
    id: "propriedade-intelectual",
    title: "Propriedade intelectual",
    body: (
      <p>
        Marca, textos, imagens e identidade visual do Passaporte Burguer pertencem à empresa e não podem ser usados sem
        autorização.
      </p>
    ),
  },
  {
    id: "privacidade",
    title: "Privacidade",
    body: (
      <p>
        O tratamento dos seus dados pessoais está descrito na nossa <Link href="/privacidade">Política de Privacidade</Link>.
      </p>
    ),
  },
  {
    id: "alteracoes-e-foro",
    title: "Alterações e foro",
    body: (
      <p>
        Podemos atualizar estes termos; a data da última revisão fica no topo da página. Fica eleito o foro da comarca
        de {C.city}, sem prejuízo do foro do domicílio do consumidor quando a lei assim garantir.
      </p>
    ),
  },
  {
    id: "contato",
    title: "Contato",
    body: (
      <p>
        Fale com a gente pelo{" "}
        <a href={C.instagram} target="_blank" rel="noopener noreferrer">
          Instagram
        </a>{" "}
        ou pelo WhatsApp da loja.
      </p>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Condições de uso"
      title="Termos de Uso"
      highlight="Uso"
      intro="As regras simples para você aproveitar o cardápio, fazer pedidos e acompanhar tudo pelo Meu Passaporte."
      summary={
        <p>
          Use um número de WhatsApp <strong>seu</strong>, confira o endereço antes de finalizar e lembre que os
          prazos de entrega são <strong>estimativas</strong>. Como tudo é feito na hora, cancelamentos só antes do
          preparo. Qualquer problema, é só falar com a gente.
        </p>
      }
      sections={sections}
      related={[
        { href: "/privacidade", label: "Política de Privacidade" },
        { href: "/#cardapio", label: "Cardápio" },
      ]}
    />
  );
}
