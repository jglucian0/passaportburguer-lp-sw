"use client";

import { Check, Copy, Loader2, Lock } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { validateCardExpiry } from "@/core/validation/card-expiry";
import { documentError, formatDocument } from "@/core/validation/document";
import { cn, formatCents } from "@/lib/utils";

type PixData = { payload: string; qrCodeBase64: string; expiresAt: string | null };

/** Valores já conhecidos do pedido/cliente para pré-preencher o titular (editáveis). */
export type CardDefaults = {
  holderName: string;
  /** CPF/CNPJ já formatado. */
  holderCpf: string;
  postalCode: string;
  addressNumber: string;
};

type Props = {
  defaults: CardDefaults;
  orderId: string;
  /** Link assinado do WhatsApp (acesso sem login): vai em todas as chamadas e desliga os redirecionamentos para o login. */
  token?: string | null;
  method: "PIX" | "CREDIT_CARD";
  /** Link do WhatsApp: o cliente escolhe Pix ou cartão aqui dentro (nenhuma cobrança é criada antes). */
  askMethod?: boolean;
  totalCents: number;
  /** Link do WhatsApp (acesso por token): após o pagamento, botão para voltar à conversa. */
  whatsappUrl?: string | null;
  customerEmail: string;
  initialPix: PixData | null;
  /** O pedido/cadastro já tem CPF no servidor: não precisa pedir de novo (nunca é enviado ao navegador anônimo). */
  documentKnown?: boolean;
};

const POLL_MS = 2500;
const PROCESSING_MESSAGE = "Processando pagamento com a operadora do cartão... Não feche esta página.";

const inputClass =
  "h-12 rounded-xl border-slate-300 bg-white text-base text-slate-900 placeholder:text-slate-400 focus:border-[#F59E0B] focus:ring-2 focus:ring-[#F59E0B]/30";
const cardClass = "space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm";

/* Máscaras (apenas apresentação; o servidor valida tudo de novo). */
const maskCardNumber = (v: string) =>
  v
    .replace(/\D/g, "")
    .slice(0, 19)
    .replace(/(\d{4})(?=\d)/g, "$1 ");
const maskExpiry = (v: string) => {
  const d = v.replace(/\D/g, "").slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
};
const maskCep = (v: string) => {
  const d = v.replace(/\D/g, "").slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
};

/* Estado do cartão só em memória (useState): nada vai para localStorage/sessionStorage/URL. */
const EMPTY_CARD = {
  holderName: "",
  number: "",
  expiry: "",
  ccv: "",
  holderCpfCnpj: "",
  postalCode: "",
  addressNumber: "",
};

const REFUSED_MESSAGE =
  "Pagamento recusado pela operadora do cartão. Verifique os dados, tente outro cartão ou pague via Pix.";
const RISK_MESSAGE =
  "Pagamento em análise de segurança. Assim que aprovado, seu pedido será enviado para a cozinha.";

export function PaymentView({
  defaults,
  orderId,
  token = null,
  method: initialMethod,
  askMethod = false,
  totalCents,
  whatsappUrl = null,
  customerEmail,
  initialPix,
  documentKnown = false,
}: Props) {
  /* O cliente pode trocar Pix <-> cartão no mesmo pedido (ex.: cartão recusado). null = ainda vai escolher. */
  const [method, setMethod] = useState<"PIX" | "CREDIT_CARD" | null>(askMethod ? null : initialMethod);
  const router = useRouter();
  const endpoint = `/api/orders/${orderId}/payment${token ? `?token=${encodeURIComponent(token)}` : ""}`;

  const [expiryTouched, setExpiryTouched] = useState(false);
  const [pix, setPix] = useState<PixData | null>(initialPix);
  const [pixError, setPixError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [canceled, setCanceled] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  /* Endereço de entrega utilizável como cobrança (CEP de 8 dígitos + número). */
  const billingKnown = defaults.postalCode.replace(/D/g, "").length === 8 && !!defaults.addressNumber.trim();
  const [sameAddress, setSameAddress] = useState(billingKnown);
  const [card, setCard] = useState({
    ...EMPTY_CARD,
    holderName: defaults.holderName,
    holderCpfCnpj: defaults.holderCpf,
    postalCode: billingKnown ? maskCep(defaults.postalCode) : "",
    addressNumber: billingKnown ? defaults.addressNumber : "",
  });
  /* CPF do pagador: coletado ANTES de liberar Pix/cartão (o Asaas não gera o QR Code sem ele). */
  const [payerDocument, setPayerDocument] = useState(defaults.holderCpf);
  const [documentConfirmed, setDocumentConfirmed] = useState(documentKnown || initialPix !== null);
  const [documentTouched, setDocumentTouched] = useState(false);
  const documentMessage = documentError(payerDocument);
  /** CPF válido digitado agora (vai junto da cobrança); undefined quando o servidor já tem o CPF. */
  const documentNumber = documentMessage === null ? payerDocument : undefined;
  const [email, setEmail] = useState(customerEmail);
  const [submitting, setSubmitting] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const [waitingGateway, setWaitingGateway] = useState(false);
  const [waitingMessage, setWaitingMessage] = useState(PROCESSING_MESSAGE);
  const [confirmedStatus, setConfirmedStatus] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const [switching, setSwitching] = useState(false);

  /* ---------------- Pix: gera/recupera a cobrança ---------------- */
  const requestedPix = useRef(false);
  const loadPix = useCallback(async () => {
    setPixError(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "pix", documentNumber }),
      });
      const data = (await res.json().catch(() => ({}))) as { pix?: PixData; error?: string };
      if (!res.ok || !data.pix) {
        setPixError(data.error ?? "Não foi possível gerar o Pix. Tente novamente.");
        return;
      }
      setPix(data.pix);
    } catch {
      setPixError("Sem conexão. Tente novamente.");
    }
  }, [endpoint, documentNumber]);

  useEffect(() => {
    if (!documentConfirmed || method !== "PIX" || pix || requestedPix.current) return;
    // (o guard evita dupla chamada em StrictMode; trocar de método passa por switchMethod)
    requestedPix.current = true;
    void loadPix();
  }, [documentConfirmed, method, pix, loadPix]);

  /* ---------------- Polling do status (webhook confirma) ---------------- */
  useEffect(() => {
    if (confirmed || canceled) return;
    let stopped = false;

    async function tick() {
      if (stopped || document.hidden) return;
      try {
        const res = await fetch(endpoint, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { orderStatus: string; paymentStatus: string | null };
        if (stopped) return;
        if (data.orderStatus === "AWAITING_PAYMENT") {
          if (data.paymentStatus === "RISK_ANALYSIS") {
            setWaitingMessage(RISK_MESSAGE);
            setWaitingGateway(true);
          }
          // Ignora FAILED antigo enquanto uma nova tentativa está sendo enviada.
          if (data.paymentStatus === "FAILED" && !submittingRef.current) {
            // Recusa assíncrona (captura/análise de risco): libera o formulário para nova tentativa.
            setWaitingGateway(false);
            setCardError(REFUSED_MESSAGE);
          }
          return;
        }
        stopped = true;
        if (data.orderStatus === "CANCELED") {
          setCanceled(true);
        } else {
          setConfirmedStatus(data.orderStatus);
          setConfirmed(true);
          if (!token) router.replace("/meus-pedidos");
        }
      } catch {
        /* tenta no próximo ciclo */
      }
    }

    const timer = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [endpoint, router, token, confirmed, canceled]);

  /* ---------------- Ações ---------------- */
  async function switchMethod(next: "PIX" | "CREDIT_CARD") {
    if (next === method || switching) return;
    setCardError(null);
    setPixError(null);
    if (next === "CREDIT_CARD") {
      // Invalida o QR Code pendente no servidor e tira da tela: não dá para pagar um Pix "esquecido".
      setSwitching(true);
      try {
        if (pix) {
          const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "cancel-pix" }),
          });
          if (!res.ok) {
            const data = (await res.json().catch(() => ({}))) as { error?: string };
            setPixError(data.error ?? "Não foi possível trocar para cartão agora. Tente novamente.");
            return;
          }
        }
        setPix(null);
        requestedPix.current = false;
        setMethod("CREDIT_CARD");
      } catch {
        setPixError("Sem conexão. Tente novamente.");
      } finally {
        setSwitching(false);
      }
      return;
    }
    setSwitching(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "pix", documentNumber }),
      });
      const data = (await res.json().catch(() => ({}))) as { pix?: PixData; error?: string };
      if (!res.ok || !data.pix) {
        setCardError(data.error ?? "Não foi possível gerar o Pix. Tente novamente.");
        return;
      }
      setPix(data.pix);
      setMethod("PIX");
    } catch {
      setCardError("Sem conexão. Tente novamente.");
    } finally {
      setSwitching(false);
    }
  }

  async function copyPix() {
    if (!pix) return;
    try {
      await navigator.clipboard.writeText(pix.payload);
    } catch {
      // Fallback para navegadores sem Clipboard API.
      const area = document.createElement("textarea");
      area.value = pix.payload;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2500);
  }

  async function submitCard(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setCardError(null);

    const expiry = validateCardExpiry(card.expiry);
    if (!expiry.valid) {
      setExpiryTouched(true);
      return;
    }
    submittingRef.current = true;

    const [expiryMonth = "", expiryYear = ""] = card.expiry.split("/");

    /* Cobrança = entrega (valores do pedido, enviados sem aparecer na tela) ou campos preenchidos. */
    const postalCode = (sameAddress && billingKnown ? defaults.postalCode : card.postalCode).replace(/\D/g, "");
    const addressNumber = (sameAddress && billingKnown ? defaults.addressNumber : card.addressNumber).trim();
    if (postalCode.length !== 8) {
      setCardError("Informe o CEP de cobrança com 8 dígitos.");
      submittingRef.current = false;
      return;
    }
    if (!addressNumber) {
      setCardError("Informe o número do endereço de cobrança.");
      submittingRef.current = false;
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "card",
          card: {
            holderName: card.holderName,
            number: card.number,
            expiryMonth,
            expiryYear,
            ccv: card.ccv,
            holderCpfCnpj: card.holderCpfCnpj,
            postalCode,
            addressNumber,
            email,
          },
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        status?: string;
        released?: boolean;
        message?: string;
      };
      if (res.status === 409 && data.error) {
        // Já existe pagamento em análise para este pedido.
        setWaitingMessage(RISK_MESSAGE);
        setWaitingGateway(true);
        return;
      }
      if (!res.ok || !data.ok) {
        setCardError(data.error ?? "Pagamento recusado. Confira os dados ou tente outro cartão.");
        // Descarta número/CVV da memória ao falhar: o cliente redigita.
        setCard((c) => ({ ...c, number: "", ccv: "" }));
        return;
      }
      // Aceito: descarta tudo da memória.
      setCard((c) => ({ ...EMPTY_CARD, postalCode: c.postalCode, addressNumber: c.addressNumber }));
      if (data.released) {
        // Aprovação imediata: o pedido já foi para a cozinha.
        setConfirmed(true);
        if (!token) router.replace("/meus-pedidos");
        return;
      }
      // PENDING / análise de risco: mantém o polling e aguarda a decisão final do webhook.
      setWaitingMessage(data.message ?? PROCESSING_MESSAGE);
      setWaitingGateway(true);
    } catch {
      setCardError("Sem conexão. Tente novamente.");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  async function openHostedInvoice() {
    setCardError(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "hosted", documentNumber }),
      });
      const data = (await res.json().catch(() => ({}))) as { invoiceUrl?: string; error?: string };
      if (!res.ok || !data.invoiceUrl?.startsWith("https://")) {
        setCardError(data.error ?? "Não foi possível abrir a página de pagamento.");
        return;
      }
      window.location.assign(data.invoiceUrl);
    } catch {
      setCardError("Sem conexão. Tente novamente.");
    }
  }

  /* ---------------- Render ---------------- */
  if (canceled) {
    return (
      <div className={cardClass} role="alert">
        <h2 className="font-bold">Pedido cancelado</h2>
        <p className="text-sm text-slate-600">
          O pagamento não foi confirmado a tempo e o pedido foi cancelado. Você pode fazer um novo pedido.
        </p>
        <Link href="/" className="inline-block font-semibold text-[#B45309] underline">
          Voltar ao cardápio
        </Link>
      </div>
    );
  }

  if (confirmed) {
    return (
      <div className={cardClass}>
        <p className="flex items-center gap-2 font-semibold text-emerald-700">
          <Check className="h-5 w-5" />{" "}
          {confirmedStatus === "PREPARING" || token ? "Pagamento confirmado! Seu pedido está na chapa." : "Pagamento confirmado! Redirecionando…"}
        </p>
        {whatsappUrl ? (
          <>
            <p className="text-sm text-slate-600">Pronto! Agora é só voltar ao WhatsApp: lá eu aviso quando o pedido sair.</p>
            <a
              href={whatsappUrl}
              className="flex h-12 w-full items-center justify-center rounded-xl bg-[#25D366] font-bold text-[#052e16]"
            >
              Voltar ao WhatsApp
            </a>
          </>
        ) : null}
      </div>
    );
  }

  /* Validade: avaliada a cada digitação; o erro aparece com 4 dígitos ou ao sair do campo. */
  const expiryCheck = validateCardExpiry(card.expiry);
  const showExpiryError =
    !expiryCheck.valid && (expiryTouched || card.expiry.replace(/\D/g, "").length === 4);

  const field = (key: keyof typeof EMPTY_CARD, mask?: (v: string) => string) => ({
    value: card[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setCard((c) => ({ ...c, [key]: mask ? mask(e.target.value) : e.target.value })),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <span className="text-sm text-slate-500">Total a pagar</span>
        <span className="text-xl font-bold">{formatCents(totalCents)}</span>
      </div>

      {!documentConfirmed ? (
        <form
          className={cardClass}
          onSubmit={(e) => {
            e.preventDefault();
            setDocumentTouched(true);
            if (documentMessage) return;
            // O mesmo CPF já vem preenchido no formulário do cartão.
            setCard((c) => ({ ...c, holderCpfCnpj: c.holderCpfCnpj || payerDocument }));
            setDocumentConfirmed(true);
          }}
        >
          <h2 className="font-bold">Seu CPF</h2>
          <p className="text-sm text-slate-600">Precisamos do CPF para gerar o pagamento (Pix ou cartão).</p>
          <Input
            className={inputClass}
            placeholder="000.000.000-00"
            inputMode="numeric"
            autoComplete="off"
            aria-label="CPF"
            aria-invalid={documentTouched && !!documentMessage}
            maxLength={18}
            required
            value={payerDocument}
            onChange={(e) => setPayerDocument(formatDocument(e.target.value))}
            onBlur={() => setDocumentTouched(true)}
          />
          {documentTouched && documentMessage ? (
            <p role="alert" className="-mt-2 text-sm text-red-600">
              {documentMessage}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={!!documentMessage}
            className="flex h-12 w-full items-center justify-center rounded-xl bg-[#F59E0B] font-semibold text-[#071329] transition-colors hover:bg-[#d98a09] disabled:opacity-60"
          >
            Continuar
          </button>
        </form>
      ) : method === null ? (
        <section className={cardClass}>
          <h2 className="font-bold">Como você prefere pagar?</h2>
          <button
            type="button"
            onClick={() => setMethod("PIX")}
            className="flex h-14 w-full items-center justify-center rounded-xl bg-[#F59E0B] font-semibold text-[#071329] transition-colors hover:bg-[#d98a09]"
          >
            Pix
          </button>
          <button
            type="button"
            onClick={() => setMethod("CREDIT_CARD")}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white font-semibold text-slate-900 transition-colors hover:bg-slate-50"
          >
            <Lock className="h-4 w-4" /> Cartão de crédito
          </button>
        </section>
      ) : method === "PIX" ? (
        <section className={cardClass}>
          <h2 className="font-bold">Pague com Pix</h2>
          {pix && pixError ? (
            <p role="alert" className="text-sm font-medium text-red-700">
              {pixError}
            </p>
          ) : null}

          {pix ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`data:image/png;base64,${pix.qrCodeBase64}`}
                alt="QR Code Pix"
                width={224}
                height={224}
                className="mx-auto h-56 w-56 rounded-lg border border-slate-200"
              />
              <p className="text-center text-sm text-slate-600">
                Abra o app do seu banco, escolha Pix e leia o QR Code ou use o Pix Copia e Cola.
              </p>
              <button
                type="button"
                onClick={copyPix}
                className={cn(
                  "flex h-12 w-full items-center justify-center gap-2 rounded-xl font-semibold transition-colors",
                  copied ? "bg-emerald-600 text-white" : "bg-[#F59E0B] text-[#071329] hover:bg-[#d98a09]",
                )}
              >
                {copied ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
                {copied ? "Código copiado!" : "Copiar código Pix"}
              </button>
              <p className="flex items-center justify-center gap-2 text-xs text-slate-500" aria-live="polite">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Aguardando a confirmação do pagamento…
              </p>
            </>
          ) : pixError ? (
            <div className="space-y-3" role="alert">
              <p className="text-sm font-medium text-red-700">{pixError}</p>
              <button
                type="button"
                onClick={() => void loadPix()}
                className="h-11 w-full rounded-xl border border-slate-300 font-semibold"
              >
                Tentar novamente
              </button>
            </div>
          ) : (
            <p className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Gerando seu QR Code…
            </p>
          )}
        </section>
      ) : (
        <section className={cardClass}>
          <h2 className="flex items-center gap-2 font-bold">
            <Lock className="h-4 w-4" /> Cartão de crédito
          </h2>

          {waitingGateway ? (
            <p className="flex items-start gap-2 text-sm text-slate-700" aria-live="polite">
              <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" /> {waitingMessage}
            </p>
          ) : (
            <form onSubmit={submitCard} className="space-y-3" autoComplete="on">
              <Input
                className={inputClass}
                placeholder="Nome impresso no cartão"
                autoComplete="cc-name"
                aria-label="Nome impresso no cartão"
                maxLength={60}
                required
                {...field("holderName")}
              />
              <Input
                className={inputClass}
                placeholder="Número do cartão"
                inputMode="numeric"
                autoComplete="cc-number"
                aria-label="Número do cartão"
                maxLength={23}
                required
                {...field("number", maskCardNumber)}
              />
              <div className="grid grid-cols-2 gap-3">
                <Input
                  placeholder="Validade MM/AA"
                  inputMode="numeric"
                  autoComplete="cc-exp"
                  aria-label="Validade (MM/AA)"
                  maxLength={5}
                  required
                  aria-invalid={showExpiryError}
                  aria-describedby={showExpiryError ? "card-expiry-error" : undefined}
                  {...field("expiry", maskExpiry)}
                  className={cn(inputClass, showExpiryError && "border-red-500 focus:border-red-500 focus:ring-red-500/30")}
                  onBlur={() => setExpiryTouched(true)}
                />
                <Input
                  className={inputClass}
                  placeholder="CVV"
                  inputMode="numeric"
                  autoComplete="cc-csc"
                  aria-label="Código de segurança (CVV)"
                  maxLength={4}
                  required
                  {...field("ccv", (v) => v.replace(/\D/g, "").slice(0, 4))}
                />
              </div>
              {showExpiryError && !expiryCheck.valid ? (
                <p id="card-expiry-error" role="alert" className="-mt-1 text-sm text-red-600">
                  {expiryCheck.message}
                </p>
              ) : null}
              <Input
                className={inputClass}
                placeholder="CPF do titular"
                inputMode="numeric"
                autoComplete="off"
                aria-label="CPF do titular"
                maxLength={18}
                required
                {...field("holderCpfCnpj", formatDocument)}
              />
              {billingKnown ? (
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    defaultChecked
                    onChange={(e) => setSameAddress(e.target.checked)}
                    className="h-4 w-4 accent-[#F59E0B]"
                  />
                  Endereço de cobrança é o mesmo da entrega
                </label>
              ) : null}
              {!(billingKnown && sameAddress) ? (
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    className={inputClass}
                    placeholder="CEP de cobrança"
                    inputMode="numeric"
                    autoComplete="postal-code"
                    aria-label="CEP de cobrança"
                    maxLength={9}
                    required
                    {...field("postalCode", maskCep)}
                  />
                  <Input
                    className={inputClass}
                    placeholder="Nº do endereço"
                    autoComplete="off"
                    aria-label="Número do endereço de cobrança"
                    maxLength={10}
                    required
                    {...field("addressNumber")}
                  />
                </div>
              ) : null}
              {customerEmail ? null : (
                <Input
                  className={inputClass}
                  type="email"
                  placeholder="E-mail do titular"
                  autoComplete="email"
                  aria-label="E-mail do titular"
                  maxLength={120}
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              )}

              {cardError ? (
                <div role="alert" className="space-y-2 rounded-lg bg-red-50 p-3">
                  <p className="text-sm font-medium text-red-700">{cardError}</p>
                  <p className="text-xs text-red-700/80">
                    Seu pedido continua guardado: tente outro cartão abaixo ou pague com Pix.
                  </p>
                  <button
                    type="button"
                    onClick={() => void switchMethod("PIX")}
                    disabled={switching}
                    className="h-10 w-full rounded-lg border border-red-300 bg-white text-sm font-semibold text-red-800 disabled:opacity-60"
                  >
                    {switching ? "Gerando Pix…" : "Pagar com Pix"}
                  </button>
                </div>
              ) : null}

              <button
                type="submit"
                disabled={submitting || !expiryCheck.valid}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#F59E0B] font-semibold text-[#071329] transition-colors hover:bg-[#d98a09] disabled:opacity-60"
              >
                {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Lock className="h-4 w-4" />}
                {submitting ? "Processando…" : `Pagar ${formatCents(totalCents)}`}
              </button>
              <button
                type="button"
                onClick={() => void openHostedInvoice()}
                className="w-full text-center text-sm font-medium text-slate-600 underline"
              >
                Prefiro pagar na página segura do Asaas
              </button>
            </form>
          )}
        </section>
      )}

      <p className="text-center text-xs text-slate-500">
        O pedido é enviado à cozinha assim que o pagamento é confirmado. Sem pagamento em 30 minutos,
        ele é cancelado automaticamente.
      </p>
    </div>
  );
}
