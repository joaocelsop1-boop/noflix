"use client";

/**
 * tudo24: limite de erro do login — a página /app/login quebrou 1x na
 * primeira carga ("Application error — A client-side exception has
 * occurred", só funcionou após reload). A causa mais provável é uma
 * corrida de chunk no primeiro carregamento pós-deploy (transitório,
 * sem causa no código da página). Com o limite, em vez da tela de erro
 * genérica do Next.js, o usuário vê uma tela nossa com "Tentar
 * novamente" — que recarrega só o segmento.
 */
export default function LoginError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-[#07080f] px-4">
      <div className="w-full max-w-md rounded-xl border border-white/10 bg-[#0f1220] p-6 text-center shadow-2xl md:p-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#e50914]">
          CinePlus
        </p>
        <h1 className="mt-3 text-xl font-bold text-white">
          Algo deu errado ao carregar o login
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-white/60">
          Isso costuma ser um carregamento incompleto — tente de novo.
        </p>
        <button
          type="button"
          onClick={() => reset()}
          className="mt-6 rounded-md btn-neon px-6 py-3 text-sm font-bold transition"
        >
          Tentar novamente
        </button>
      </div>
    </main>
  );
}
