import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Termos de uso — MineTV",
  description: "As regras de uso da MineTV, o front-end de streaming.",
};

export default function Page() {
  return (
    <LegalPage eyebrow="Legal" title="Termos de uso" updated="7 de novembro de 2026">
      <p>
        Ao usar a MineTV você concorda com estes termos. Se não concordar, feche a aba — nada
        é guardado até você criar um perfil.
      </p>

      <h2>O que é a MineTV</h2>
      <p>
        A MineTV é uma demonstração de interface sem fins comerciais. Ela indexa metadados disponíveis
        publicamente e incorpora players operados por terceiros. Não hospeda, envia, transcodifica nem
        distribui nenhum conteúdo audiovisual.
      </p>

      <h2>Uso aceitável</h2>
      <ul>
        <li>Não use o site para infringir a lei da sua jurisdição.</li>
        <li>Não tente sobrecarregar, raspar de forma abusiva ou atacar o serviço nem seus provedores.</li>
        <li>Não use perfis infantis para burlar as configurações de classificação.</li>
        <li>Não redistribua o site como se fosse seu próprio produto.</li>
      </ul>

      <h2>Sem garantia</h2>
      <p>
        O serviço é fornecido &ldquo;como está&rdquo;. Os servidores de stream são de terceiros e podem cair,
        mudar de domínio ou parar de funcionar sem aviso; a MineTV tenta servidores alternativos
        automaticamente, mas não garante disponibilidade, qualidade nem legendas.
      </p>

      <h2>Limitação de responsabilidade</h2>
      <p>
        Na maior medida permitida por lei, os mantenedores não se responsabilizam por qualquer perda
        decorrente do uso do site, incluindo conteúdo fornecido por players de terceiros.
      </p>

      <h2>Propriedade intelectual</h2>
      <p>
        Títulos, artes, trailers e vídeos pertencem aos seus donos. A MineTV e o código da sua interface
        são liberados sob a licença do repositório. Veja a página de direitos autorais para informações
        de remoção.
      </p>

      <h2>Alterações</h2>
      <p>Estes termos podem ser atualizados; a data acima sempre reflete a versão atual.</p>
    </LegalPage>
  );
}
