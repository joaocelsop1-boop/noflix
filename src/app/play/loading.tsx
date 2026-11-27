/* tudo26: esqueleto da página de detalhe/play — antes, navegar para o
   detalhe mostrava tela preta durante a ida ao servidor (resolver TMDB).
   O esqueleto ocupa o lugar do conteúdo até a página chegar. */
export default function PlayLoading() {
  return (
    <main className="min-h-screen bg-[#07080f]">
      <div className="relative h-[56vw] max-h-[70vh] w-full animate-pulse bg-gradient-to-b from-[#0d1526] via-[#101a30] to-[#07080f]">
        <div className="absolute inset-0 grid place-items-center">
          <span className="h-10 w-10 animate-spin rounded-full border-2 border-white/25 border-t-[#e50914]" />
        </div>
      </div>
      <div className="mx-auto max-w-5xl px-4 py-6">
        <div className="h-8 w-2/3 animate-pulse rounded bg-white/10" />
        <div className="mt-3 h-4 w-1/2 animate-pulse rounded bg-white/10" />
        <div className="mt-4 h-4 w-1/3 animate-pulse rounded bg-white/10" />
      </div>
    </main>
  );
}
