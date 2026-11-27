import { redirect } from "next/navigation";
import { appUrl } from "@/lib/paths";

/**
 * A página de detalhe TMDB não existe mais no fluxo do usuário: todo o
 * conteúdo vem do painel e o play abre direto em /play/0?panel=1. Um link
 * antigo para /title/... cai no Navegar (catálogo do painel).
 */
export default function TitlePage() {
  redirect(appUrl("/browse"));
}
