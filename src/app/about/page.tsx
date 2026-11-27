import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Sobre a CinePlus",
  description:
    "CinePlus é um serviço de streaming com filmes, séries e canais ao vivo. Assista onde quiser, com a sua conta e o seu plano.",
};

export default function Page() {
  return (
    <LegalPage eyebrow="Sobre" title="Filmes, séries e canais ao vivo" updated="Novembro de 2026">
      <p>
        A CinePlus é um serviço de streaming: filmes, séries e canais ao vivo em um só lugar,
        para assistir no celular, no computador ou na TV. Você cria a sua conta, escolhe um
        plano e assiste na hora.
      </p>

      <h2>O que tem dentro</h2>
      <ul>
        <li><strong>Filmes e séries</strong> — catálogo completo, com lançamentos e clássicos, organizado por categoria.</li>
        <li><strong>Canais ao vivo</strong> — TV ao vivo com programação e guia de canais.</li>
        <li><strong>Perfis</strong> — crie perfis para cada pessoa da casa. Perfis infantis só veem conteúdo adequado para a família.</li>
        <li><strong>Minha Lista &amp; Continuar assistindo</strong> — salve o que quer ver e continue de onde parou, em qualquer aparelho.</li>
        <li><strong>Pagamento por Pix</strong> — assine um plano e o acesso é liberado na hora, sem mensalidade de cartão.</li>
      </ul>

      <h2>Como funciona</h2>
      <p>
        Crie a sua conta com e-mail e senha, escolha um plano e pague com Pix. Assim que o
        pagamento é confirmado, o seu acesso é liberado. Você pode assistir em vários
        aparelhos, conforme o limite de telas do seu plano.
      </p>

      <h2>Suporte</h2>
      <p>
        Precisa de ajuda? Fale com o suporte pelo menu de ajuda dentro do aplicativo.
      </p>

      <h2>Comece agora</h2>
      <ul>
        <li><Link href="/">Abrir a página inicial</Link></li>
        <li><Link href="/browse">Navegar pelo catálogo completo</Link></li>
        <li><Link href="/settings">Abrir as configurações</Link></li>
      </ul>
    </LegalPage>
  );
}
