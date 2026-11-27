import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Direitos autorais e DMCA — CinePlus",
  description: "Informações sobre direitos autorais na CinePlus.",
};

export default function Page() {
  return (
    <LegalPage eyebrow="Legal" title="Direitos autorais e remoção" updated="Novembro de 2026">
      <p>
        Os filmes, séries, programas e marcas exibidos na CinePlus pertencem aos seus
        respectivos detentores de direitos. A CinePlus não é proprietária desse conteúdo.
      </p>

      <h2>Uso do conteúdo</h2>
      <p>
        O conteúdo é disponibilizado apenas para visualização pessoal, dentro do serviço
        e durante a vigência da sua assinatura. É proibido copiar, baixar, gravar,
        distribuir ou retransmitir qualquer título.
      </p>

      <h2>Denunciar um problema</h2>
      <p>
        Se você é titular de direitos autorais e acredita que algum conteúdo da CinePlus
        viola os seus direitos, envie uma notificação ao suporte com: identificação da
        obra, o título e o link dentro da CinePlus, seus dados de contato e uma declaração
        de boa-fé. Analisaremos o pedido e removeremos o conteúdo, se for o caso.
      </p>

      <h2>Boa-fé</h2>
      <p>
        Apresentar uma denúncia falsa sabendo disso pode expor você a responsabilidade.
        Em caso de dúvida, fale primeiro com o titular dos direitos.
      </p>
    </LegalPage>
  );
}
