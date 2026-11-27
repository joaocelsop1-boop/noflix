"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Wordmark } from "@/components/wordmark";
import { fetchPanelMe, panelLogin, panelRegister } from "@/lib/panel";

type Mode = "login" | "register";

/**
 * Login / cadastro do painel — visual escuro estilo frameXTV/CinePlus.
 * Em sucesso vai para /browse — ou para /planos?plano=<mesmo> quando o
 * cliente veio do site de vendas com um plano escolhido (?plano=<id|nome>).
 * Já logado, nem vê o formulário.
 */
export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [checking, setChecking] = useState(true);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [forgot, setForgot] = useState(false);
  const [busy, setBusy] = useState(false);

  /* destino após entrar: /planos com o plano do site de vendas, ou /browse */
  const afterAuth = () => {
    const plano = new URLSearchParams(window.location.search).get("plano");
    return plano ? `/planos?plano=${encodeURIComponent(plano)}` : "/browse";
  };

  useEffect(() => {
    let alive = true;
    void fetchPanelMe().then((me) => {
      if (!alive) return;
      if (me?.loggedIn) router.replace(afterAuth());
      else setChecking(false);
    });
    return () => {
      alive = false;
    };
  }, [router]);

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

  if (checking) {
    return (
      <main className="grid min-h-screen place-items-center bg-black">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/25 border-t-[#22e6ff]" />
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#07080f] px-4 py-10">
      <Link href="/" aria-label="CinePlus home">
        <Wordmark className="text-[34px] md:text-[40px]" />
      </Link>
      <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/40">
        You&apos;re watching · CinePlus
      </p>

      <div className="mt-8 w-full max-w-md rounded-xl border border-white/10 bg-[#0f1220] p-6 shadow-2xl md:p-8">
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
                className="mt-1.5 w-full rounded-md border border-white/15 bg-black/60 px-3.5 py-2.5 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#22e6ff]"
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
              className="mt-1.5 w-full rounded-md border border-white/15 bg-black/60 px-3.5 py-2.5 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#22e6ff]"
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
              className="mt-1.5 w-full rounded-md border border-white/15 bg-black/60 px-3.5 py-2.5 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#22e6ff]"
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
                className="mt-1.5 w-full rounded-md border border-white/15 bg-black/60 px-3.5 py-2.5 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#22e6ff]"
              />
            </label>
          )}

          {error && (
            <p role="alert" className="rounded-md border border-[#ff2bd6]/40 bg-[#ff2bd6]/10 px-3 py-2 text-sm text-[#ff9ecf]">
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
