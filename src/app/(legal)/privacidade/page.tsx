import type { Metadata } from "next";

import { LEGAL_CONTACT as C, LegalPage, type LegalSection } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Política de Privacidade",
  description: "Como o Passaporte Burguer coleta, usa e protege seus dados pessoais.",
};

const sections: LegalSection[] = [
  {
    id: "quem-somos",
    title: "Quem somos",
    body: (
      <p>
        O <strong>{C.company}</strong> (CNPJ {C.cnpj}, {C.city}) é o responsável pelo site e pelos pedidos feitos
        por ele, e trata seus dados pessoais conforme a Lei Geral de Proteção de Dados (Lei nº 13.709/2018 — LGPD).
      </p>
    ),
  },
  {
    id: "dados-que-coletamos",
    title: "Quais dados coletamos?",
    body: (
      <ul>
        <li>
          <strong>Identificação e contato:</strong> nome e número de WhatsApp.
        </li>
        <li>
          <strong>Entrega:</strong> endereço, bairro, número e complemento (somente quando você escolhe entrega).
        </li>
        <li>
          <strong>Pedidos:</strong> itens, valores, forma de pagamento e histórico.
        </li>
        <li>
          <strong>Validação de acesso:</strong> o código de embarque (ex.: PASS-XXXX) que você envia pelo WhatsApp e o
          número de onde ele foi enviado.
        </li>
        <li>
          <strong>Dados técnicos:</strong> um cookie de sessão necessário para manter você conectado.
        </li>
      </ul>
    ),
  },
  {
    id: "para-que-usamos",
    title: "Para que usamos seus dados?",
    body: (
      <>
        <ul>
          <li>Confirmar que o número informado é seu e liberar o acesso ao “Meu Passaporte”;</li>
          <li>Receber, preparar, entregar e acompanhar seus pedidos;</li>
          <li>Entrar em contato sobre o pedido (status, dúvidas, problemas na entrega);</li>
          <li>Cumprir obrigações legais, fiscais e de prevenção a fraudes.</li>
        </ul>
        <p>Não vendemos seus dados e não enviamos publicidade sem que você tenha solicitado.</p>
      </>
    ),
  },
  {
    id: "bases-legais",
    title: "Bases legais",
    body: (
      <p>
        Tratamos dados com base na execução de contrato (seu pedido), no cumprimento de obrigação legal, no legítimo
        interesse (segurança e prevenção a fraudes) e, quando aplicável, no seu consentimento (art. 7º da LGPD).
      </p>
    ),
  },
  {
    id: "whatsapp-e-meta",
    title: "WhatsApp e Meta",
    body: (
      <p>
        A validação do seu número acontece quando você envia uma mensagem ao WhatsApp da loja. Essas mensagens são
        recebidas pela WhatsApp Business Platform (Cloud API), operada pela Meta Platforms, Inc., que possui sua
        própria política de privacidade. Lemos da mensagem apenas o <strong>código de embarque</strong> e o{" "}
        <strong>número do remetente</strong>, para confirmar seu acesso.
      </p>
    ),
  },
  {
    id: "compartilhamento",
    title: "Com quem compartilhamos?",
    body: (
      <>
        <p>Somente com quem é necessário para operar o serviço:</p>
        <ul>
          <li>provedores de hospedagem e banco de dados (infraestrutura do site);</li>
          <li>Meta (WhatsApp), conforme a seção anterior;</li>
          <li>serviços de mapas, quando você usa a localização para preencher o endereço;</li>
          <li>meios de pagamento (ex.: PIX), para confirmar o pagamento;</li>
          <li>autoridades, quando exigido por lei.</li>
        </ul>
      </>
    ),
  },
  {
    id: "cookies",
    title: "Cookies",
    body: (
      <p>
        Usamos apenas um <strong>cookie essencial de sessão</strong> (seguro, restrito ao servidor e válido por até 30
        dias) para identificar você no site. Não usamos cookies de publicidade.
      </p>
    ),
  },
  {
    id: "retencao",
    title: "Por quanto tempo guardamos?",
    body: (
      <p>
        Os códigos de embarque expiram em 10 minutos e são apagados após o uso. Dados de cadastro e pedidos são
        mantidos enquanto necessários para o atendimento e para cumprir obrigações legais e fiscais, sendo depois
        excluídos ou anonimizados.
      </p>
    ),
  },
  {
    id: "seus-direitos",
    title: "Quais são os seus direitos?",
    body: (
      <>
        <p>A qualquer momento você pode solicitar:</p>
        <ul>
          <li>confirmação de que tratamos seus dados e acesso a eles;</li>
          <li>correção de dados incompletos ou desatualizados;</li>
          <li>anonimização, portabilidade ou eliminação dos dados;</li>
          <li>informações sobre compartilhamento e revogação de consentimento.</li>
        </ul>
      </>
    ),
  },
  {
    id: "seguranca",
    title: "Como protegemos seus dados?",
    body: (
      <p>
        Usamos conexão criptografada (HTTPS), cookies protegidos, validação de assinatura nas comunicações com a Meta e
        remoção dos códigos após o uso. Nenhum sistema é 100% imune, mas trabalhamos para reduzir riscos.
      </p>
    ),
  },
  {
    id: "fale-com-a-gente",
    title: "Fale com a gente",
    body: (
      <>
        <p>
          Para exercer seus direitos, indicando o número cadastrado, fale com a gente pelo{" "}
          <a href={C.instagram} target="_blank" rel="noopener noreferrer">
            Instagram
          </a>{" "}
          ou pelo WhatsApp da loja.
        </p>
        <p>Podemos atualizar esta política; a data da última revisão fica sempre no topo da página.</p>
      </>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="LGPD · Lei 13.709/2018"
      title="Política de Privacidade"
      highlight="Privacidade"
      intro="Uma nota de transparência sobre os dados que coletamos, por que coletamos, por quanto tempo guardamos e como você pode acessá-los, corrigi-los ou apagá-los."
      summary={
        <p>
          Pedimos só o <strong>necessário</strong> (nome, WhatsApp e endereço de entrega) para você fazer pedidos.
          Validamos seu número pelo <strong>WhatsApp</strong>, <strong>não vendemos seus dados</strong> e você pode
          pedir acesso, correção ou exclusão quando quiser.
        </p>
      }
      sections={sections}
      related={[
        { href: "/termos", label: "Termos de Uso" },
        { href: "/#cardapio", label: "Cardápio" },
      ]}
    />
  );
}
