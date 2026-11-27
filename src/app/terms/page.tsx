import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Termos de uso — MineTV",
  description: "Termos de uso do serviço de streaming MineTV.",
};

export default function Page() {
  return (
    <LegalPage eyebrow="Legal" title="Termos de uso" updated="Novembro de 2026">
      <p>
        Ao criar uma conta e usar a MineTV, você concorda com estes termos. Leia com
        atenção antes de assinar um plano.
      </p>

      <h2>1. O serviço</h2>
      <p>
        A MineTV é um serviço de streaming por assinatura que oferece filmes, séries e
        canais ao vivo. O catálogo pode mudar sem aviso prévio: títulos entram e saem
        conforme a disponibilidade.
      </p>

      <h2>2. Conta</h2>
      <p>
        Você é responsável pela sua conta, pela sua senha e por tudo o que for feito com
        ela. Não compartilhe a sua senha. A conta é pessoal e intransferível, e o uso é
        limitado ao número de telas do plano contratado.
      </p>

      <h2>3. Planos e pagamento</h2>
      <p>
        Os planos são pagos por Pix. O acesso é liberado após a confirmação do pagamento
        e vale pelo período contratado (quinzenal, mensal ou anual, conforme o plano).
        Não há renovação automática: para continuar assistindo, basta renovar antes do
        vencimento. Os preços podem mudar, mas o valor do plano já contratado não muda
        durante a sua vigência.
      </p>

      <h2>4. Uso permitido</h2>
      <p>
        O conteúdo é para uso pessoal e não comercial. É proibido copiar, gravar,
        retransmitir, revender ou compartilhar o acesso fora do limite de telas do seu
        plano. O descumprimento pode levar ao bloqueio da conta sem reembolso.
      </p>

      <h2>5. Disponibilidade</h2>
      <p>
        Fazemos o possível para manter o serviço no ar, mas podem ocorrer paradas para
        manutenção ou por fatores fora do nosso controle. Nesses casos, o prazo do plano
        não é estendido automaticamente.
      </p>

      <h2>6. Cancelamento</h2>
      <p>
        Você pode cancelar quando quiser — basta não renovar o plano. O acesso continua
        até o fim do período já pago e não há reembolso de valores já utilizados.
      </p>

      <h2>7. Alterações</h2>
      <p>
        Estes termos podem ser atualizados. A versão vigente é sempre a publicada nesta
        página.
      </p>
    </LegalPage>
  );
}
