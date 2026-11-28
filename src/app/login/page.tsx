"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { Wordmark } from "@/components/wordmark";
import { ensureDefaultProfile } from "@/components/store";
import { fetchPanelMe, panelLogin, panelRegister } from "@/lib/panel";
import { appUrl } from "@/lib/paths";

type Mode = "login" | "register";

/**
 * Login / cadastro do painel — visual escuro estilo frameXTV/CinePlus.
 * Em sucesso vai DIRETO para a Início (/) — ou para /planos?plano=<mesmo>
 * quando o cliente veio do site de vendas com um plano escolhido
 * (?plano=<id|nome>). Já logado, nem vê o formulário.
 * tudo34: sem tela intermediária — o perfil local padrão é criado aqui
 * (ensureDefaultProfile) para o portão de perfis nunca aparecer.
 */
export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [error, setError] = useState<string | null>(null);
  /* Sessão única (tudo20): o middleware manda para cá com ?session=ended
     quando outro aparelho entrou e esta sessão foi encerrada. */
  const [sessionNotice, setSessionNotice] = useState(false);
  /* tudo38: plano escolhido no site de vendas (?plano=Mensal). Quem vem
     do site veio para COMPRAR (conta nova), então o formulário abre em
     "Criar conta" e mostra o plano escolhido — antes abria em "Entrar"
     e não mostrava nem o nome nem o preço do plano. */
  const [planFromSite, setPlanFromSite] = useState<string | null>(null);
  const [forgot, setForgot] = useState(false);
  const [busy, setBusy] = useState(false);

  /* destino após entrar: /planos com o plano do site de vendas, ou a Início */
  const afterAuth = () => {
    const plano = new URLSearchParams(window.location.search).get("plano");
    return plano ? appUrl(`/planos?plano=${encodeURIComponent(plano)}`) : appUrl("/");
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("session") === "ended") {
      setSessionNotice(true);
    }
    const plano = params.get("plano");
    if (plano) {
      setPlanFromSite(plano);
      setMode("register");
    }
  }, []);

  /* tudo26: o formulário renderiza IMEDIATO — antes a página mostrava
     só uma tela preta com spinner até o fetchPanelMe resolver (vários
     segundos de preto a cada abertura). A checagem de "já logado" roda em
     segundo plano e só redireciona se estiver logado. */
  useEffect(() => {
    let alive = true;
    void fetchPanelMe()
      .then((me) => {
        if (!alive) return;
        if (me?.loggedIn) {
          /* tudo34: garante o perfil local antes de sair daqui, e navega
             por recarregamento total para a store hidratar já com ele —
             senão o portão de perfis apareceria sobre a Início. */
          ensureDefaultProfile(me.user?.name);
          window.location.href = afterAuth();
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setForgot(false);
    setBusy(true);
    try {
      if (mode === "login") {
        const result = await panelLogin(email.trim(), password);
        if (!result.ok) {
          setError(result.error ?? "E-mail ou senha inválidos.");
          return;
        }
        // tudo34: perfil local padrão antes de navegar — sem ele, o portão
        // de perfis ("Who's watching?") cobriria a Início no primeiro acesso.
        ensureDefaultProfile(result.user?.name);
        // Navegação por recarregamento total: o login cria a sessão no
        // servidor, e o router.replace nem sempre refletia isso de primeira
        // (o usuário ficava na tela de login e só entrava após refresh
        // manual). Com o reload, o middleware e a página já veem a sessão.
        window.location.href = afterAuth();
      } else {
        const result = await panelRegister({
          name: name.trim(),
          email: email.trim(),
          password,
          whatsapp: whatsapp.trim() || undefined,
        });
        if (!result.ok) {
          setError(result.error ?? "Não foi possível criar a conta.");
          return;
        }
        ensureDefaultProfile(name.trim());
        window.location.href = afterAuth();
      }
    } catch {
      // Antes não havia catch: se o fetch falhasse (rede, timeout), nada
      // aparecia na tela e o botão só voltava ao normal.
      setError("Não foi possível entrar. Confira sua conexão e tente novamente.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#07080f] px-4 py-10">
      <Link href={appUrl("/")} aria-label="CinePlus home">
        <Wordmark className="text-[34px] md:text-[40px]" />
      </Link>
      <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/40">
        You&apos;re watching · CinePlus
      </p>

      <div className="mt-8 w-full max-w-md rounded-xl border border-white/10 bg-[#0f1220] p-6 shadow-2xl md:p-8">
        {planFromSite && (
          <div className="mb-6 rounded-md border border-[#e50914]/40 bg-[#e50914]/10 px-4 py-3 text-center text-[14px] leading-relaxed text-white/90">
            Plano escolhido: <b>{planFromSite}</b>
            <span className="block text-[12px] text-white/60">Crie sua conta para continuar e pagar via Pix.</span>
          </div>
        )}
        {/* abas Entrar / Criar conta */}
        <div className="grid grid-cols-2 rounded-md bg-white/5 p-1">
          {(
            [
              { id: "login", label: "Entrar" },
              { id: "register", label: "Criar conta" },
            ] as Array<{ id: Mode; label: string }>
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setMode(tab.id);
                setError(null);
                setForgot(false);
              }}
              aria-pressed={mode === tab.id}
              className={
                mode === tab.id
                  ? "rounded-md btn-neon px-3 py-2 text-sm font-bold"
                  : "rounded-md px-3 py-2 text-sm font-semibold text-white/60 transition hover:text-white"
              }
            >
              {tab.label}
            </button>
          ))}
        </div>

        {sessionNotice && (
          <div className="mt-6 rounded-md border border-[#e50914]/40 bg-[#e50914]/10 px-4 py-3 text-[13px] leading-relaxed text-white/85">
            Sua sessão foi encerrada porque você entrou em outro aparelho. Entre
            novamente para continuar assistindo.
          </div>
        )}

        <form onSubmit={submit} className="mt-6 space-y-4">
          {mode === "register" && (
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-white/50">
                Nome
              </span>
              <input
                type="text"
                required
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Seu nome"
                className="mt-1.5 w-full rounded-md border border-white/15 bg-black/60 px-3.5 py-2.5 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#e50914]"
              />
            </label>
          )}

          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-white/50">
              E-mail
            </span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@email.com"
              className="mt-1.5 w-full rounded-md border border-white/15 bg-black/60 px-3.5 py-2.5 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#e50914]"
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-white/50">
              Senha
            </span>
            <input
              type="password"
              required
              minLength={4}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="mt-1.5 w-full rounded-md border border-white/15 bg-black/60 px-3.5 py-2.5 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#e50914]"
            />
          </label>

          {mode === "register" && (
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-white/50">
                WhatsApp <span className="normal-case text-white/35">(opcional)</span>
              </span>
              <input
                type="tel"
                autoComplete="tel"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                placeholder="(00) 00000-0000"
                className="mt-1.5 w-full rounded-md border border-white/15 bg-black/60 px-3.5 py-2.5 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#e50914]"
              />
            </label>
          )}

          {error && (
            <p role="alert" className="rounded-md border border-[#e50914]/40 bg-[#e50914]/10 px-3 py-2 text-sm text-[#ff9ecf]">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md btn-neon py-3 text-sm font-bold transition disabled:opacity-60"
          >
            {busy ? "Aguarde…" : mode === "login" ? "Entrar e assistir" : "Criar conta e assistir"}
          </button>
        </form>

        {mode === "login" && (
          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={() => {
                setForgot(true);
                setError(null);
              }}
              className="text-sm text-white/60 underline-offset-2 transition hover:text-white hover:underline"
            >
              Esqueci minha senha
            </button>
            {forgot && (
              <p className="mt-2 rounded-md bg-white/5 px-3 py-2 text-[13px] leading-relaxed text-white/70">
                Para recuperar sua senha, fale com o suporte informando o e-mail da conta.
                A recuperação por e-mail ainda não está ativa.
              </p>
            )}
          </div>
        )}

        <p className="mt-6 text-center text-xs leading-relaxed text-white/35">
          Ao entrar, você concorda com os termos de uso da CinePlus.
        </p>
      </div>
    </main>
  );
}
