import { redirect } from "next/navigation";

/**
 * A página de play TMDB não existe mais no fluxo do usuário: todo o
 * conteúdo vem do painel e o play abre direto em /play/0?panel=1. Um link
 * antigo para /watch/... cai no Navegar (catálogo do painel).
 */
export default function WatchPage() {
  redirect("/browse");
}
