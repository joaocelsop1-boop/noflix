import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Política de privacidade — MineTV",
  description:
    "A MineTV não hospeda arquivos de vídeo. O que guardamos e o que não guardamos, quem serve a reprodução e como apagar tudo.",
};

export default function Page() {
  return (
    <LegalPage eyebrow="Legal" title="Política de privacidade" updated="6 de novembro de 2026">
      <p className="rounded-xl border border-white/15 bg-white/[0.04] p-4 text-[13.5px] leading-relaxed text-white/80">
        <strong className="text-white">Não hospedamos nada.</strong> A MineTV não guarda arquivos de vídeo,
        áudio, imagens nem mídia adulta de nenhum tipo. É uma interface: pôsteres e descrições
        são puxados de APIs públicas de metadados, e cada quadro que você assiste é entregue por um
        provedor independente direto para o seu navegador. Nada passa pelos nossos servidores, e não
        há upload, download, cache nem repositório de mídia por trás deste site.
      </p>

      <h2>O que isso significa na prática</h2>
      <ul>
        <li>Não há armazenamento de mídia nesta implantação — sem bucket, sem origem de CDN, sem sistema de arquivos com vídeos.</li>
        <li>As requisições de reprodução vão do <em>seu</em> navegador para o provedor. Nunca ficamos no meio, então não vemos o que você assiste e não guardamos registro disso.</li>
        <li>Só metadados (títulos, artes, sinopses, listas de episódios, avaliações) são buscados pelo servidor e guardados brevemente na memória.</li>
        <li>Se um provedor remove algo, o link aqui para de funcionar. Não podemos restaurar, porque nunca tivemos uma cópia.</li>
      </ul>

      <h2>O que guardamos</h2>
      <p>Tudo abaixo fica no seu navegador, não num servidor, em chaves do <code>localStorage</code> começando com <code>nf.</code>:</p>
      <ul>
        <li><strong>Perfis</strong> — o nome, o personagem, a cor e o nível de classificação que você escolhe.</li>
        <li><strong>Minha Lista</strong> — os títulos que você salvou.</li>
        <li><strong>Progresso de exibição</strong> — a temporada, o episódio e a posição que você alcançou.</li>
        <li><strong>Preferências</strong> — cor de destaque, densidade, servidor, qualidade, idioma e interruptores.</li>
      </ul>
      <p>Limpar os dados do site remove tudo completamente.</p>

      <h2>Sincronização opcional na nuvem</h2>
      <p>
        Se a implantação estiver configurada com um projeto Supabase, as mesmas preferências são espelhadas
        para uma única linha identificada por um identificador aleatório de aparelho gerado no seu navegador.
        Essa linha é protegida por segurança em nível de linha, então só o seu id de aparelho pode lê-la ou
        escrevê-la. Não há e-mail, nem nome além do rótulo de perfil que você digitou, e não há como vincular
        a linha a uma pessoa real. Apagar seus dados (Configurações → Privacidade e dados) esvazia a cópia local.
      </p>

      <h2>Cookies</h2>
      <p>
        A MineTV não define nenhum cookie — nem para rastreamento, nem para sessões, nem para preferências.
        Tudo que ela lembra fica no <code>localStorage</code> e permanece no seu aparelho.
      </p>

      <h2>Terceiros</h2>
      <ul>
        <li><strong>TMDB</strong> — metadados, artes e ids de trailers.</li>
        <li><strong>TVMaze</strong> e <strong>Jikan (MyAnimeList)</strong> — dados de episódios e animes.</li>
        <li><strong>YouTube</strong> — trailers tocam num player incorporado com privacidade aprimorada no primeiro clique.</li>
        <li><strong>frameXTV, CineLite, RiveStream</strong> — players incorporados para o catálogo principal. Seu navegador carrega o conteúdo deles diretamente, então eles podem ver seu endereço IP e definir seu próprio armazenamento. Valem as políticas deles, não as nossas.</li>
        <li><strong>Vercel</strong> — hospedagem e registros padrão de requisição, guardados por pouco tempo.</li>
      </ul>
      <p>
        Não vendemos, compartilhamos nem trocamos nada, porque não há nada pessoal para vender: sem
        conta, sem e-mail, sem identificador de publicidade, sem perfil da sua exibição.
      </p>

      <h2>Seus direitos</h2>
      <p>
        Como os dados nunca saem do seu aparelho a menos que você ative a sincronização, você pode exercer
        todos os direitos sozinho: exportar, editar ou apagar em <strong>Configurações → Privacidade e dados</strong>.
        O que guardamos se limita ao que seu navegador armazena — então limpar os dados do site é um
        apagamento completo, e não há cópia no servidor para solicitar.
      </p>

      <h2>Crianças</h2>
      <p>
        Perfis infantis escondem títulos adultos em todas as prateleiras, grades e resultados de busca, e
        nada neste site é voltado para crianças. Nenhuma informação pessoal é solicitada de ninguém, de
        nenhuma idade.
      </p>

      <h2>Alterações</h2>
      <p>
        Mudanças relevantes nesta política serão anotadas nesta página com uma nova data. Dúvidas podem
        ser levantadas como issue no repositório do GitHub.
      </p>
    </LegalPage>
  );
}
