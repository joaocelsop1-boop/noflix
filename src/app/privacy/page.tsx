import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Política de privacidade — CinePlus",
  description: "Como a CinePlus trata os seus dados pessoais.",
};

export default function Page() {
  return (
    <LegalPage eyebrow="Legal" title="Política de privacidade" updated="Novembro de 2026">
      <p>
        A sua privacidade importa. Esta política explica quais dados coletamos, para que
        usamos e como você pode pedir a remoção deles.
      </p>

      <h2>1. Dados que coletamos</h2>
      <ul>
        <li><strong>Conta:</strong> nome, e-mail e senha (armazenada de forma protegida) para criar e acessar a sua conta.</li>
        <li><strong>Assinatura:</strong> plano contratado, datas de início e vencimento e histórico de pagamentos.</li>
        <li><strong>Uso:</strong> o que você assiste, sua lista e o progresso de reprodução, para continuar de onde parou e melhorar as recomendações.</li>
        <li><strong>Suporte:</strong> mensagens que você envia ao suporte.</li>
      </ul>

      <h2>2. Para que usamos</h2>
      <p>
        Usamos os seus dados para prestar o serviço (acesso, cobrança e suporte), para
        lembrar as suas preferências e para melhorar a CinePlus. Não vendemos os seus dados
        a terceiros.
      </p>

      <h2>3. Pagamento</h2>
      <p>
        O pagamento é feito por Pix, processado pelo provedor de pagamentos. Não
        armazenamos dados do seu cartão ou da sua conta bancária.
      </p>

      <h2>4. Cookies e dados no aparelho</h2>
      <p>
        Usamos cookies e armazenamento local para manter você conectado e lembrar as suas
        preferências (perfil, lista e progresso). Você pode apagar esses dados no seu
        navegador, mas precisará entrar novamente.
      </p>

      <h2>5. Seus direitos</h2>
      <p>
        Você pode pedir a correção ou a exclusão dos seus dados pessoais a qualquer
        momento, falando com o suporte. A exclusão da conta encerra o acesso ao serviço.
      </p>

      <h2>6. Contato</h2>
      <p>
        Dúvidas sobre privacidade? Fale com o suporte pelo menu de ajuda dentro do
        aplicativo.
      </p>
    </LegalPage>
  );
}
