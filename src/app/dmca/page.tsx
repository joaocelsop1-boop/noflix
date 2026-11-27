import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Direitos autorais e DMCA — MineTV",
  description: "Como denunciar material com direitos autorais referenciado pela MineTV.",
};

export default function Page() {
  return (
    <LegalPage eyebrow="Legal" title="Direitos autorais e remoção" updated="6 de novembro de 2026">
      <p>
        A MineTV não hospeda arquivos de vídeo. Tudo que pode ser assistido é servido por provedores
        independentes de incorporação; a MineTV só aponta para eles e exibe metadados de APIs públicas.
      </p>

      <h2>Denunciar um problema</h2>
      <p>
        Se uma página de título aponta para conteúdo que é seu e você quer o link removido, abra uma issue
        no repositório com:
      </p>
      <ul>
        <li>o título e a URL neste site,</li>
        <li>o material específico que é seu,</li>
        <li>seus dados de contato e uma declaração de que você está autorizado a agir pelo titular dos direitos.</li>
      </ul>
      <p>
        Solicitações válidas são atendidas removendo a entrada do catálogo ou do provedor de incorporação
        afetado. Solicitações voltadas ao provedor de hospedagem também devem ser enviadas diretamente a
        esse provedor — veja o servidor de stream listado no player de cada título.
      </p>

      <h2>Metadados</h2>
      <p>
        Artes, sinopses e identificadores de trailers vêm do TMDB, TVMaze e MyAnimeList. Correções ou
        remoções na fonte são refletidas na próxima vez que o catálogo atualizar.
      </p>

      <h2>Boa-fé</h2>
      <p>
        Apresentar uma denúncia falsa sabendo disso pode expor você a responsabilidade. Em caso de dúvida,
        fale primeiro com o titular dos direitos ou com o provedor de incorporação.
      </p>
    </LegalPage>
  );
}
