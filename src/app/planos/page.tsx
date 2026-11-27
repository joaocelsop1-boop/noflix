"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import {
  createPanelOrder,
  fetchPanelMe,
  fetchPanelOrderStatus,
  fetchPanelPlans,
  formatBRL,
  type PanelOrder,
  type PanelPlan,
} from "@/lib/panel";
import { cn } from "@/lib/cn";
import { appUrl } from "@/lib/paths";

/**
 * Planos do painel: cards com nome, preço, duração e selo RECOMENDADO.
 * "Assinar" cria o pedido (Pix) e faz polling do status a cada 5s até
 * approved → "PLANO LIBERADO!" com botão para /browse.
 * Sem login, redireciona para /login.
 */
export default function PlanosPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [plans, setPlans] = useState<PanelPlan[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [order, setOrder] = useState<PanelOrder | null>(null);
  const [orderPlan, setOrderPlan] = useState<PanelPlan | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [ordering, setOrdering] = useState<number | null>(null);
  const [approved, setApproved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [preselectedId, setPreselectedId] = useState<number | null>(null);
  const pollRef = useRef<number | null>(null);

  /* Pix a mostrar: QR do gateway ou QR fixo do admin (manual); o mesmo vale
     para o copia e cola. No modo manual não há pix_code do gateway. */
  const payQr = order?.pix_qr_url || order?.pix_fixed_qr || null;
  const payCode = order?.pix_code || order?.pix_fixed_code || null;
  const isManual = order?.mode === "manual";
  const manualEmpty =
    isManual && !payQr && !payCode && !order?.pix_key;

  useEffect(() => {
    let alive = true;
    void fetchPanelMe().then((me) => {
      if (!alive) return;
      if (!me?.loggedIn) {
        router.replace(appUrl("/login"));
        return;
      }
      setChecking(false);
      void fetchPanelPlans()
        .then((list) => {
          if (alive) {
            setPlans(list);
            // ?plano=<id ou nome> (vem do site de vendas): já deixa o plano
            // selecionado e rola até ele.
            const q = new URLSearchParams(window.location.search).get("plano");
            if (q) {
              const found = list.find(
                (p) => String(p.id) === q || p.name.toLowerCase() === q.toLowerCase(),
              );
              if (found) {
                setPreselectedId(found.id);
                setOrderPlan(found);
                requestAnimationFrame(() => {
                  document
                    .querySelector(`[data-plan-id="${found.id}"]`)
                    ?.scrollIntoView({ behavior: "smooth", block: "center" });
                });
              }
            }
          }
        })
        .catch(() => {
          if (alive) setLoadError("Não foi possível carregar os planos. Tente novamente.");
        });
    });
    return () => {
      alive = false;
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [router]);

  /* polling do pedido a cada 5s até approved/cancelled */
  useEffect(() => {
    if (!order?.order_id || approved) return;
    const tick = async () => {
      const status = await fetchPanelOrderStatus(order.order_id as number | string);
      if (!status) return;
      if (status.status === "approved") {
        setApproved(true);
        if (pollRef.current) window.clearInterval(pollRef.current);
      } else if (status.status === "cancelled") {
        setOrderError("Este pedido foi cancelado. Gere um novo pedido para tentar de novo.");
        if (pollRef.current) window.clearInterval(pollRef.current);
      }
    };
    void tick();
    pollRef.current = window.setInterval(() => void tick(), 5000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [order?.order_id, approved]);

  const subscribe = async (plan: PanelPlan) => {
    setOrderError(null);
    setApproved(false);
    /* "Gerar novo Pix" (já existe pedido deste plano): força uma cobrança
       nova na API em vez de devolver o QR antigo. O primeiro "Assinar"
       continua reaproveitando (proteção contra duplo clique). */
    const hadOrder = Boolean(order && orderPlan?.id === plan.id);
    setOrder(null);
    setOrderPlan(plan);
    setOrdering(plan.id);
    const result = await createPanelOrder(plan.id, undefined, hadOrder);
    setOrdering(null);
    if (!result.ok) {
      // || em vez de ?? — "" ?? x devolve "" e a tela ficava sem erro nenhum.
      setOrderError(result.error || "Não foi possível criar o pedido. Tente novamente.");
      setOrderPlan(null);
      return;
    }
    setOrder(result);
  };

  const copyPix = async () => {
    if (!payCode) return;
    try {
      await navigator.clipboard.writeText(payCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      /* clipboard indisponível — o código continua visível para copiar à mão */
    }
  };

  if (checking) {
    return (
      <main className="grid min-h-screen place-items-center bg-black">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/25 border-t-[#22e6ff]" />
      </main>
    );
  }

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-[#07080f] pb-16 pt-24 md:pt-28">
        <div className="mx-auto max-w-[1100px] px-4 md:px-12">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#22e6ff]">
            CinePlus · Planos
          </p>
          <h1 className="mt-1 font-display text-[clamp(1.6rem,4vw,2.6rem)] leading-none text-white">
            Escolha seu plano
          </h1>
          <p className="mt-2 max-w-[60ch] text-[13px] text-white/50">
            Pague com Pix e assista na hora. O acesso libera automaticamente após a
            confirmação do pagamento.
          </p>

          {loadError && (
            <p role="alert" className="mt-6 rounded-md border border-[#ff2bd6]/40 bg-[#ff2bd6]/10 px-3 py-2 text-sm text-[#ff9ecf]">
              {loadError}
            </p>
          )}

          {!loadError && plans.length === 0 && (
            <p className="mt-8 text-sm text-white/50">Carregando planos…</p>
          )}

          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {plans.map((plan) => {
              const recommended = Boolean(plan.is_recommended);
              const selected = orderPlan?.id === plan.id;
              const preselected = preselectedId === plan.id;
              return (
                <article
                  key={plan.id}
                  data-plan-id={plan.id}
                  className={cn(
                    "relative flex flex-col rounded-xl border bg-[#0f1220] p-6",
                    recommended ? "border-[#22e6ff] shadow-[0_0_40px_rgba(34,230,255,0.25)]" : "border-white/10",
                    selected && "ring-2 ring-[#22e6ff]",
                    preselected && !selected && "ring-2 ring-[#22e6ff]/60",
                  )}
                >
                  {recommended && (
                    <span className="absolute -top-3 left-6 rounded-full bg-[#ff2bd6] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-white">
                      Recomendado
                    </span>
                  )}
                  {preselected && !recommended && (
                    <span className="absolute -top-3 left-6 rounded-full bg-[#ff2bd6] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-white">
                      Selecionado
                    </span>
                  )}
                  <h2 className="text-lg font-bold text-white">{plan.name}</h2>
                  <p className="mt-3 text-3xl font-bold text-white">{formatBRL(plan.price)}</p>
                  <p className="mt-1 text-[13px] text-white/50">
                    {plan.duration_days} dia{plan.duration_days === 1 ? "" : "s"} de acesso
                  </p>
                  <button
                    type="button"
                    disabled={ordering !== null}
                    onClick={() => void subscribe(plan)}
                    className={cn(
                      "mt-6 w-full rounded-md py-2.5 text-sm font-bold transition disabled:opacity-60",
                      recommended
                        ? "btn-neon"
                        : "bg-white text-black hover:bg-white/85",
                    )}
                  >
                    {ordering === plan.id ? "Gerando Pix…" : selected ? "Gerar novo Pix" : "Assinar"}
                  </button>
                </article>
              );
            })}
          </div>

          {orderError && (
            <p role="alert" className="mt-6 rounded-md border border-[#ff2bd6]/40 bg-[#ff2bd6]/10 px-3 py-2 text-sm text-[#ff9ecf]">
              {orderError}
            </p>
          )}

          {/* Pix do pedido */}
          {order?.ok && !approved && (
            <section className="mx-auto mt-10 max-w-lg rounded-xl border border-white/10 bg-[#0f1220] p-6 text-center">
              <h2 className="text-lg font-bold text-white">Pague com Pix para liberar</h2>
              <p className="mt-1 text-sm text-white/55">
                {orderPlan?.name} ·{" "}
                <span className="font-semibold text-white">
                  {formatBRL(order.amount ?? orderPlan?.price ?? 0)}
                </span>
              </p>
              {manualEmpty ? (
                <p role="alert" className="mt-5 rounded-md border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-left text-sm text-amber-200">
                  O pagamento manual ainda não foi configurado pelo administrador. Fale com o suporte para concluir sua assinatura.
                </p>
              ) : (
                <>
                  {payQr ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={payQr}
                      alt="QR Code Pix"
                      className="mx-auto mt-5 h-56 w-56 rounded-lg bg-white p-2"
                    />
                  ) : null}
                  {payCode && (
                    <div className="mt-5 text-left">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/50">
                        Código copia e cola
                      </p>
                      <p className="mt-1.5 break-all rounded-md border border-white/15 bg-black/60 p-3 text-xs leading-relaxed text-white/80">
                        {payCode}
                      </p>
                      <button
                        type="button"
                        onClick={() => void copyPix()}
                        className="mt-3 w-full rounded-md bg-white py-2.5 text-sm font-bold text-black transition hover:bg-white/85"
                      >
                        {copied ? "Código copiado!" : "Copiar código Pix"}
                      </button>
                    </div>
                  )}
                  {isManual && order.pix_key && (
                    <div className="mt-5 text-left">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/50">
                        Chave Pix
                      </p>
                      <p className="mt-1.5 break-all rounded-md border border-white/15 bg-black/60 p-3 text-sm text-white/80">
                        {order.pix_key}
                      </p>
                      {order.pix_beneficiary && (
                        <p className="mt-2 text-xs text-white/50">
                          Beneficiário: <span className="font-semibold text-white/80">{order.pix_beneficiary}</span>
                        </p>
                      )}
                    </div>
                  )}
                  <p className="mt-4 flex items-center justify-center gap-2 text-xs text-white/45">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
                    {isManual
                      ? "Após pagar, seu acesso é liberado assim que confirmarmos o pagamento."
                      : "Aguardando pagamento… conferimos automaticamente a cada 5 segundos."}
                  </p>
                </>
              )}
            </section>
          )}

          {/* liberado */}
          {approved && (
            <section className="mx-auto mt-10 max-w-lg rounded-xl border border-[#46d369]/40 bg-[#46d369]/10 p-6 text-center">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#46d369]">
                Pagamento confirmado
              </p>
              <h2 className="mt-2 text-2xl font-bold text-white">PLANO LIBERADO!</h2>
              <p className="mt-1 text-sm text-white/60">
                Seu plano {orderPlan?.name ?? ""} já está ativo. Bom filme!
              </p>
              <Link
                href={appUrl("/browse")}
                className="mt-5 inline-block rounded-md btn-neon px-6 py-3 text-sm font-bold transition"
              >
                Assistir agora
              </Link>
            </section>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
