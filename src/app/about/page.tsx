import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Sobre a MineTV — o front-end de streaming",
  description:
    "MineTV é um front-end de streaming aberto construído com Next.js e TMDB. Sem contas, sem rastreadores, funciona em qualquer navegador.",
};

export default function Page() {
  return (
    <LegalPage eyebrow="Sobre" title="Um front-end de streaming, feito para o navegador" updated="Novembro de 2026">
      <p>
        MineTV é uma experiência de assistir estilo Netflix para a web aberta. Ela puxa arte e metadados
        do <a href="https://www.themoviedb.org/" target="_blank" rel="noreferrer">TMDB</a> e
        episódios do TVMaze e do MyAnimeList, e entrega a reprodução para players independentes.
        Nada é hospedado aqui.
      </p>

      <h2>O que tem dentro</h2>
      <ul>
        <li><strong>Milhares de títulos</strong> — um catálogo embutido para navegar na hora, mais um catálogo ao vivo do TMDB que vai carregando conforme você rola.</li>
        <li><strong>Perfis</strong> — doze personagens em vetor, sua própria cor e níveis de classificação reais. Perfis infantis só veem títulos seguros para a família.</li>
        <li><strong>Minha Lista &amp; Continuar assistindo</strong> — salvo por perfil, no aparelho, com sincronização opcional para o seu próprio projeto Supabase.</li>
        <li><strong>Três servidores de stream</strong> — frameXTV como padrão, CineLite como reserva, RiveStream como última opção, com troca automática em caso de falha.</li>
        <li><strong>Configurações que importam</strong> — cor de destaque, densidade dos cartões, movimento, economia de dados, servidor padrão, qualidade e idioma.</li>
        <li><strong>Um painel de desenvolvedor</strong> — status ao vivo de cada API e servidor de stream, direto do seu navegador.</li>
      </ul>

      <h2>Como foi construído</h2>
      <p>
        Next.js 15 (App Router), React 19, Tailwind CSS 4 e Framer Motion, publicado na Vercel.
        Perfis, listas e progresso ficam no <code>localStorage</code>; quando há variáveis de ambiente
        do Supabase, eles são espelhados para uma única linha por aparelho, protegida por segurança
        em nível de linha.
      </p>

      <h2>Experimente</h2>
      <ul>
        <li><Link href="/">Abrir a página inicial</Link></li>
        <li><Link href="/browse">Navegar pelo catálogo completo</Link></li>
        <li><Link href="/settings">Abrir as configurações</Link></li>
        <li><a href="https://github.com/sdlksdsf/Movie" target="_blank" rel="noreferrer">Código no GitHub</a></li>
      </ul>

      <h2>Créditos &amp; aviso</h2>
      <p>
        Todos os títulos, artes, trailers e vídeos pertencem aos seus respectivos donos. Este projeto é uma
        demonstração técnica de uma interface de streaming; ele não hospeda, envia ou guarda nenhum conteúdo
        de vídeo, e não tem vínculo com a Netflix nem com nenhum estúdio. Se gostar de algo que encontrar
        aqui, assista no serviço que o produziu.
      </p>
      <p>
        Metadados por cortesia do TMDB. Este produto usa a API do TMDB, mas não é endossado nem certificado
        pelo TMDB.
      </p>
    </LegalPage>
  );
}
