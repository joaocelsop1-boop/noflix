<?php
/**
 * MineTV - Painel Administrativo Completo
 */
require_once __DIR__ . '/config.php';

// CORRIGIDO: sem sessão demo automática — só entra quem logar em admin_login.php
require_admin();

// Testa um servidor de painel (player_api.php) e devolve o resultado.
// Usado pelo save_settings e pelo clear_cache: nunca trocar o servidor nem
// apagar o catálogo sem antes confirmar que o painel responde. O detalhe do
// erro distingue DNS/timeout (getaddrinfo) de HTTP 404 (sem painel instalado).
// $base já é a base pronta: o proxy (quando configurado) ou a URL do painel
// normalizada. O proxy preserva o caminho, então /player_api.php chega ao painel.
function test_panel_server($base, $user, $pass) {
    $testUrl = rtrim($base, '/') . "/player_api.php?username=" . urlencode($user) . "&password=" . urlencode($pass);
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $testUrl);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_USERAGENT, 'MineTV-WebPlayer/1.0');
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, false);
    $resp = curl_exec($ch);
    $http = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $cerr = curl_error($ch);
    curl_close($ch);
    $ok = false;
    if ($resp !== false && $http === 200) {
        $d = json_decode($resp, true);
        $ok = is_array($d) && !empty($d['user_info']['auth']);
    }
    if ($ok) return ['ok' => true, 'http' => $http, 'error' => ''];
    if ($http === 404) {
        $detail = 'Painel respondeu HTTP 404 — não há painel instalado nesse endereço (player_api.php não existe).';
    } elseif ($http > 0) {
        $detail = 'Painel respondeu HTTP ' . $http . '.';
    } elseif ($cerr !== '') {
        $detail = 'Falha ao conectar: ' . $cerr;
    } else {
        $detail = 'Sem conexão com o painel.';
    }
    return ['ok' => false, 'http' => $http, 'error' => $detail];
}

$msg = '';
$msgType = 'success';

$settings = get_settings($pdo);

// 1. Ações POST do Painel ADM
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_check();
    $action = $_POST['form_action'] ?? '';

    // Salvar configurações do Servidor Sigma
    if ($action === 'save_settings') {
        // A URL é normalizada: colar a URL completa do M3U (com /get.php?...),
        // com /player_api.php ou sem esquema não quebra mais as chamadas.
        $newUrl = normalize_panel_url(trim($_POST['sigma_url']));
        $newUser = trim($_POST['sigma_username']);
        $newPass = trim($_POST['sigma_password']);
        // Proxy do painel (opcional): quando o painel bloqueia o IP da Oracle,
        // as chamadas passam pelo proxy no cPanel (que o painel aceita).
        // A base do teste é o proxy (se preenchido) ou a URL do painel.
        $newProxy = trim($_POST['panel_proxy'] ?? '');
        $testBase = $newProxy !== '' ? rtrim($newProxy, '/') : $newUrl;
        // Garante a coluna panel_proxy no banco antigo (o CREATE TABLE novo já
        // a inclui; banco criado antes da coluna precisa deste ALTER).
        $col = $pdo->query("SHOW COLUMNS FROM settings LIKE 'panel_proxy'")->fetch();
        if (!$col) {
            $pdo->exec("ALTER TABLE settings ADD COLUMN panel_proxy VARCHAR(255) NOT NULL DEFAULT ''");
        }
        // Testa o servidor NOVO ANTES de salvar: se ele não responder, NADA
        // é salvo (nem a URL) e o catálogo antigo é mantido. Antes o UPDATE
        // rodava primeiro e a URL ruim sobrescrevia a boa — depois disso o
        // catálogo não tinha mais como reconstruir.
        $test = test_panel_server($testBase, $newUser, $newPass);
        if ($test['ok']) {
            $stmt = $pdo->prepare("UPDATE settings SET sigma_url = ?, sigma_username = ?, sigma_password = ?, panel_proxy = ?, affiliate_percent = ?, trial_hours = ?, mp_access_token = ?, pix_key = ? WHERE id = 1");
            $stmt->execute([
                $newUrl,
                $newUser,
                $newPass,
                $newProxy,
                intval($_POST['affiliate_percent']),
                intval($_POST['trial_hours']),
                trim($_POST['mp_access_token'] ?? ''),
                trim($_POST['pix_key'] ?? '')
            ]);
            clear_catalog_cache(); // trocar de servidor invalida o catálogo em cache
            $msg = "Configurações do servidor Sigma atualizadas com sucesso!";
            if ($newUrl !== trim($_POST['sigma_url'])) {
                $msg .= ' (URL do painel corrigida para ' . $newUrl . '.)';
            }
        } else {
            $msgType = 'error';
            $msg = 'Servidor novo NÃO respondeu (' . $test['error'] . '). NADA foi salvo e o catálogo antigo foi mantido — confira a URL, o usuário e a senha do painel.';
        }
    }

    // Limpar cache do catálogo (força puxar tudo de novo do painel) — SÓ
    // apaga se o painel responder. Antes apagava sem checar: com o painel
    // fora do ar, o catálogo sumia e não tinha como reconstruir.
    elseif ($action === 'clear_cache') {
        $cur = get_settings($pdo);
        $test = test_panel_server(panel_base_url($cur), $cur['sigma_username'], $cur['sigma_password']);
        if ($test['ok']) {
            clear_catalog_cache();
            $msg = "Cache do catálogo limpo! Recarregue o player para puxar tudo de novo do painel.";
        } else {
            $msgType = 'error';
            $msg = 'Painel não respondeu (' . $test['error'] . '). O cache antigo foi MANTIDO para o catálogo não sumir — verifique a URL/usuário/senha do painel e tente de novo.';
        }
    }

    // Criar novo cliente
    elseif ($action === 'create_client') {
        $name = trim($_POST['name']);
        $email = trim($_POST['email']);
        $pass = password_hash($_POST['password'], PASSWORD_DEFAULT);
        $whatsapp = trim($_POST['whatsapp']);
        $planId = !empty($_POST['plan_id']) ? intval($_POST['plan_id']) : null;
        $status = $_POST['status'] ?? 'active';
        if (!in_array($status, ['active', 'trial', 'blocked', 'expired'], true)) $status = 'active';
        // Duração do plano escolhido (o formulário não envia duration_days):
        // sem isso todo cliente criado aqui ganhava 30 dias, mesmo no Anual.
        $days = 30;
        if ($planId) {
            $pStmt = $pdo->prepare("SELECT duration_days FROM plans WHERE id = ? LIMIT 1");
            $pStmt->execute([$planId]);
            $planDays = $pStmt->fetchColumn();
            if ($planDays) $days = intval($planDays);
        }
        $expiresAt = date('Y-m-d H:i:s', strtotime("+$days days"));
        // código de indicação único (o rand() puro podia colidir com um existente)
        do {
            $refCode = 'MINE' . rand(1000, 9999);
            $chk = $pdo->prepare("SELECT id FROM users WHERE referral_code = ? LIMIT 1");
            $chk->execute([$refCode]);
        } while ($chk->fetch());

        try {
            $stmt = $pdo->prepare("INSERT INTO users (name, email, password, whatsapp, plan_id, expires_at, status, referral_code, role) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'client')");
            $stmt->execute([$name, $email, $pass, $whatsapp, $planId, $expiresAt, $status, $refCode]);
            $msg = "Cliente cadastrado com sucesso!";
        } catch (PDOException $e) {
            $msg = "Erro ao cadastrar cliente: e-mail já existente.";
            $msgType = "error";
        }
    }

    // Renovar cliente (+30 dias)
    elseif ($action === 'renew_client') {
        $id = intval($_POST['user_id']);
        $days = max(1, min(3650, intval($_POST['days'] ?? 30)));
        $stmt = $pdo->prepare("UPDATE users SET expires_at = DATE_ADD(GREATEST(NOW(), COALESCE(expires_at, NOW())), INTERVAL ? DAY), status = 'active' WHERE id = ?");
        $stmt->execute([$days, $id]);
        $msg = "Cliente renovado por mais $days dias com sucesso!";
    }

    // Bloquear / Desbloquear cliente
    elseif ($action === 'toggle_client_status') {
        $id = intval($_POST['user_id']);
        $current = $_POST['current_status'];
        $newStatus = ($current === 'blocked') ? 'active' : 'blocked';
        $stmt = $pdo->prepare("UPDATE users SET status = ? WHERE id = ?");
        $stmt->execute([$newStatus, $id]);
        $msg = "Status do cliente alterado para $newStatus!";
    }

    // Editar cliente (nome, e-mail, WhatsApp, plano, status, vencimento;
    // senha só muda se preencher uma nova)
    elseif ($action === 'edit_client') {
        $id = intval($_POST['user_id']);
        $name = trim($_POST['name']);
        $email = trim($_POST['email']);
        $whatsapp = trim($_POST['whatsapp']);
        $planId = !empty($_POST['plan_id']) ? intval($_POST['plan_id']) : null;
        $status = $_POST['status'] ?? 'active';
        if (!in_array($status, ['active', 'trial', 'blocked', 'expired'], true)) $status = 'active';
        $expiresAt = trim($_POST['expires_at'] ?? '');
        // Só edita cliente (nunca admin) e só aceita data válida.
        $role = $pdo->prepare("SELECT role FROM users WHERE id = ? LIMIT 1");
        $role->execute([$id]);
        if ($role->fetchColumn() !== 'client') {
            $msg = "Só é possível editar clientes.";
            $msgType = "error";
        } elseif ($expiresAt !== '' && strtotime($expiresAt) === false) {
            $msg = "Data de vencimento inválida.";
            $msgType = "error";
        } else {
            try {
                $sql = "UPDATE users SET name = ?, email = ?, whatsapp = ?, plan_id = ?, status = ?, expires_at = ? WHERE id = ? AND role = 'client'";
                $params = [$name, $email, $whatsapp, $planId, $status, ($expiresAt !== '' ? date('Y-m-d H:i:s', strtotime($expiresAt)) : null), $id];
                if (!empty($_POST['password'])) {
                    $sql = "UPDATE users SET name = ?, email = ?, whatsapp = ?, plan_id = ?, status = ?, expires_at = ?, password = ? WHERE id = ? AND role = 'client'";
                    $params = [$name, $email, $whatsapp, $planId, $status, ($expiresAt !== '' ? date('Y-m-d H:i:s', strtotime($expiresAt)) : null), password_hash($_POST['password'], PASSWORD_DEFAULT), $id];
                }
                $stmt = $pdo->prepare($sql);
                $stmt->execute($params);
                $msg = "Cliente atualizado com sucesso!";
            } catch (PDOException $e) {
                $msg = "Erro ao atualizar cliente: e-mail já existente.";
                $msgType = "error";
            }
        }
    }

    // Excluir cliente (pedidos, perfis, avaliações e comissões dele somem
    // junto pelo ON DELETE CASCADE do banco; admin nunca é excluído aqui)
    elseif ($action === 'delete_client') {
        $id = intval($_POST['user_id']);
        $stmt = $pdo->prepare("DELETE FROM users WHERE id = ? AND role = 'client'");
        $stmt->execute([$id]);
        if ($stmt->rowCount() > 0) {
            $msg = "Cliente excluído com sucesso!";
        } else {
            $msg = "Cliente não encontrado ou é um administrador.";
            $msgType = "error";
        }
    }

    // Atualizar Plano
    elseif ($action === 'update_plan') {
        $planId = intval($_POST['plan_id']);
        $price = max(0, floatval($_POST['price']));
        $days = max(1, intval($_POST['duration_days']));
        $active = isset($_POST['active']) ? 1 : 0;
        $stmt = $pdo->prepare("UPDATE plans SET price = ?, duration_days = ?, active = ? WHERE id = ?");
        $stmt->execute([$price, $days, $active, $planId]);
        $msg = "Plano atualizado com sucesso!";
    }

    // Aprovar Pagamento Pix Manualmente
    elseif ($action === 'approve_order') {
        $orderId = intval($_POST['order_id']);
        $stmt = $pdo->prepare("SELECT o.*, p.duration_days FROM orders o JOIN plans p ON p.id = o.plan_id WHERE o.id = ?");
        $stmt->execute([$orderId]);
        $order = $stmt->fetch();

        if ($order && $order['status'] === 'pending') {
            $pdo->prepare("UPDATE orders SET status = 'approved', approved_at = NOW() WHERE id = ?")->execute([$orderId]);
            $days = $order['duration_days'];
            $pdo->prepare("UPDATE users SET status = 'active', expires_at = DATE_ADD(GREATEST(NOW(), COALESCE(expires_at, NOW())), INTERVAL ? DAY) WHERE id = ?")->execute([$days, $order['user_id']]);
            
            // Comissão de afiliado (% configurado em Servidor Sigma)
            $userStmt = $pdo->prepare("SELECT referred_by FROM users WHERE id = ?");
            $userStmt->execute([$order['user_id']]);
            $referrerId = $userStmt->fetchColumn();

            if ($referrerId) {
                $pct = floatval($settings['affiliate_percent'] ?? 10);
                $commission = $order['amount'] * ($pct / 100);
                $pdo->prepare("INSERT INTO commissions (order_id, affiliate_id, referred_id, amount, status) VALUES (?, ?, ?, ?, 'pending')")->execute([$orderId, $referrerId, $order['user_id'], $commission]);
            }
            $msg = "Pagamento Pix aprovado e cliente ativado!";
        }
    }

    // Marcar Comissão como Paga
    elseif ($action === 'pay_commission') {
        $commId = intval($_POST['commission_id']);
        $pdo->prepare("UPDATE commissions SET status = 'paid' WHERE id = ?")->execute([$commId]);
        $msg = "Comissão marcada como paga!";
    }

    // Criar Novo Administrador
    elseif ($action === 'create_admin') {
        $name = trim($_POST['admin_name']);
        $email = trim($_POST['admin_email']);
        $pass = password_hash($_POST['admin_password'], PASSWORD_DEFAULT);
        try {
            $pdo->prepare("INSERT INTO users (name, email, password, role, status) VALUES (?, ?, ?, 'admin', 'active')")->execute([$name, $email, $pass]);
            $msg = "Novo administrador cadastrado!";
        } catch (PDOException $e) {
            $msg = "Erro ao cadastrar administrador: e-mail já existe.";
            $msgType = "error";
        }
    }

    // Trocar a própria senha do admin logado
    elseif ($action === 'change_password') {
        $current = $_POST['current_password'] ?? '';
        $new = $_POST['new_password'] ?? '';
        $stmt = $pdo->prepare("SELECT password FROM users WHERE id = ? AND role = 'admin' LIMIT 1");
        $stmt->execute([intval($_SESSION['user_id'])]);
        $hash = $stmt->fetchColumn();
        if (!$hash || !password_verify($current, $hash)) {
            $msg = "Senha atual incorreta.";
            $msgType = "error";
        } elseif (strlen($new) < 6) {
            $msg = "A nova senha precisa ter no mínimo 6 caracteres.";
            $msgType = "error";
        } else {
            $pdo->prepare("UPDATE users SET password = ? WHERE id = ?")->execute([password_hash($new, PASSWORD_DEFAULT), intval($_SESSION['user_id'])]);
            $msg = "Senha alterada com sucesso!";
        }
    }
}

// 2. Consulta de Dados Gerais
$clients = $pdo->query("SELECT u.*, p.name as plan_name FROM users u LEFT JOIN plans p ON p.id = u.plan_id WHERE u.role = 'client' ORDER BY u.id DESC")->fetchAll();
$admins = $pdo->query("SELECT * FROM users WHERE role = 'admin' ORDER BY id DESC")->fetchAll();
$plans = $pdo->query("SELECT * FROM plans ORDER BY id ASC")->fetchAll();
$orders = $pdo->query("SELECT o.*, u.name as user_name, u.email as user_email, p.name as plan_name FROM orders o JOIN users u ON u.id = o.user_id JOIN plans p ON p.id = o.plan_id ORDER BY o.id DESC LIMIT 50")->fetchAll();
$commissions = $pdo->query("SELECT c.*, u.name as affiliate_name, u.email as affiliate_email, u.pix_key as affiliate_pix, ref.name as referred_name FROM commissions c JOIN users u ON u.id = c.affiliate_id JOIN users ref ON ref.id = c.referred_id ORDER BY c.id DESC")->fetchAll();

// Estatísticas Rápidas
$totalRevenue = $pdo->query("SELECT COALESCE(SUM(amount), 0) FROM orders WHERE status = 'approved'")->fetchColumn();
$todayRevenue = $pdo->query("SELECT COALESCE(SUM(amount), 0) FROM orders WHERE status = 'approved' AND DATE(approved_at) = CURDATE()")->fetchColumn();
$totalClients = count($clients);
$activeClients = $pdo->query("SELECT COUNT(*) FROM users WHERE role = 'client' AND status = 'active'")->fetchColumn();
$pendingPix = $pdo->query("SELECT COUNT(*) FROM orders WHERE status = 'pending'")->fetchColumn();
$pendingCommissions = $pdo->query("SELECT COALESCE(SUM(amount), 0) FROM commissions WHERE status = 'pending'")->fetchColumn();
?>
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MineTV — Painel Administrativo</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', sans-serif; background-color: #0b0c10; color: #e2e8f0; }
    .font-pixel { font-family: 'Press Start 2P', monospace; }
    .border-red-brand { border-color: #e50914; }
    .bg-red-brand { background-color: #e50914; }
    .bg-red-brand:hover { background-color: #b80710; }
  </style>
</head>
<body class="min-h-screen flex flex-col">

  <!-- Cabeçalho Principal -->
  <header class="bg-[#12141c] border-b border-gray-800 px-6 py-4 flex items-center justify-between sticky top-0 z-30">
    <div class="flex items-center gap-4">
      <h1 class="font-pixel text-xl text-red-500 tracking-wider">MineTV</h1>
      <span class="text-xs px-2 py-1 bg-red-950/80 border border-red-700/50 text-red-400 rounded font-semibold uppercase">Painel ADM</span>
    </div>
    <div class="flex items-center gap-4 text-sm">
      <span class="text-gray-400">Logado como: <strong class="text-white"><?= htmlspecialchars($_SESSION['user_name']) ?></strong></span>
      <a href="index.php" target="_blank" class="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-white rounded text-xs transition">Abrir WebPlayer ↗</a>
      <a href="logout.php?to=admin" class="px-3 py-1.5 bg-gray-800 hover:bg-red-900 text-white rounded text-xs transition">Sair</a>
    </div>
  </header>

  <?php if ($msg): ?>
    <div class="max-w-7xl mx-auto w-full px-6 pt-4">
      <div class="p-4 rounded-lg <?= $msgType === 'success' ? 'bg-emerald-950/80 border border-emerald-700 text-emerald-300' : 'bg-red-950/80 border border-red-700 text-red-300' ?> flex justify-between items-center">
        <span><?= htmlspecialchars($msg) ?></span>
        <button onclick="this.parentElement.remove()" class="text-sm font-bold opacity-70 hover:opacity-100">✕</button>
      </div>
    </div>
  <?php endif; ?>

  <!-- Abas de Navegação -->
  <div class="max-w-7xl mx-auto w-full px-6 pt-6">
    <nav class="flex space-x-2 border-b border-gray-800 pb-2 overflow-x-auto text-sm">
      <button onclick="showTab('tab-dashboard')" id="btn-tab-dashboard" class="tab-btn px-4 py-2 rounded-t font-medium text-red-500 bg-[#161922] border-b-2 border-red-500">Dashboard</button>
      <button onclick="showTab('tab-server')" id="btn-tab-server" class="tab-btn px-4 py-2 rounded-t font-medium text-gray-400 hover:text-white">Servidor Sigma</button>
      <button onclick="showTab('tab-clients')" id="btn-tab-clients" class="tab-btn px-4 py-2 rounded-t font-medium text-gray-400 hover:text-white">Clientes (<?= $totalClients ?>)</button>
      <button onclick="showTab('tab-plans')" id="btn-tab-plans" class="tab-btn px-4 py-2 rounded-t font-medium text-gray-400 hover:text-white">Planos & Preços</button>
      <button onclick="showTab('tab-sales')" id="btn-tab-sales" class="tab-btn px-4 py-2 rounded-t font-medium text-gray-400 hover:text-white">Vendas & Pix (<?= $pendingPix ?> pendentes)</button>
      <button onclick="showTab('tab-affiliates')" id="btn-tab-affiliates" class="tab-btn px-4 py-2 rounded-t font-medium text-gray-400 hover:text-white">Indique & Ganhe (<?= intval($settings['affiliate_percent'] ?? 10) ?>%)</button>
      <button onclick="showTab('tab-admins')" id="btn-tab-admins" class="tab-btn px-4 py-2 rounded-t font-medium text-gray-400 hover:text-white">Administradores</button>
    </nav>
  </div>

  <main class="max-w-7xl mx-auto w-full px-6 py-6 flex-1">
    
    <!-- ABA 1: DASHBOARD -->
    <div id="tab-dashboard" class="tab-content">
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div class="bg-[#12141c] p-5 rounded-xl border border-gray-800">
          <p class="text-xs text-gray-400 uppercase font-semibold">Vendas Hoje</p>
          <h3 class="text-2xl font-bold text-emerald-400 mt-2">R$ <?= number_format($todayRevenue, 2, ',', '.') ?></h3>
          <p class="text-xs text-gray-500 mt-1">Total aprovado hoje</p>
        </div>
        <div class="bg-[#12141c] p-5 rounded-xl border border-gray-800">
          <p class="text-xs text-gray-400 uppercase font-semibold">Total Faturado</p>
          <h3 class="text-2xl font-bold text-white mt-2">R$ <?= number_format($totalRevenue, 2, ',', '.') ?></h3>
          <p class="text-xs text-gray-500 mt-1">Faturamento acumulado</p>
        </div>
        <div class="bg-[#12141c] p-5 rounded-xl border border-gray-800">
          <p class="text-xs text-gray-400 uppercase font-semibold">Clientes Ativos</p>
          <h3 class="text-2xl font-bold text-blue-400 mt-2"><?= $activeClients ?> <span class="text-sm font-normal text-gray-500">/ <?= $totalClients ?></span></h3>
          <p class="text-xs text-gray-500 mt-1">Contas em dia</p>
        </div>
        <div class="bg-[#12141c] p-5 rounded-xl border border-gray-800">
          <p class="text-xs text-gray-400 uppercase font-semibold">Comissões de Afiliados</p>
          <h3 class="text-2xl font-bold text-amber-400 mt-2">R$ <?= number_format($pendingCommissions, 2, ',', '.') ?></h3>
          <p class="text-xs text-gray-500 mt-1">Aguardando pagamento Pix</p>
        </div>
      </div>

      <!-- Resumo do Servidor Sigma -->
      <div class="bg-[#12141c] p-6 rounded-xl border border-gray-800">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold text-white">Status do Servidor Sigma</h3>
          <button onclick="testSigmaConnection()" class="px-3 py-1.5 bg-red-brand text-white text-xs font-semibold rounded hover:bg-red-700 transition">Testar Conexão Agora</button>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div class="p-3 bg-gray-900/50 rounded border border-gray-800">
            <span class="text-gray-500 block text-xs">URL do Servidor:</span>
            <span class="font-mono text-gray-300"><?= htmlspecialchars($settings['sigma_url']) ?></span>
          </div>
          <div class="p-3 bg-gray-900/50 rounded border border-gray-800">
            <span class="text-gray-500 block text-xs">Usuário Master:</span>
            <span class="font-mono text-gray-300"><?= htmlspecialchars($settings['sigma_username'] ?: 'Não definido') ?></span>
          </div>
          <div class="p-3 bg-gray-900/50 rounded border border-gray-800">
            <span class="text-gray-500 block text-xs">Retorno da API:</span>
            <span id="dash-sigma-status" class="text-amber-400 font-medium">Aguardando teste...</span>
          </div>
        </div>
        <?php
          $cacheCount = function ($key) {
            $f = __DIR__ . '/cache/' . $key . '.json';
            if (!file_exists($f)) return null;
            $d = json_decode(@file_get_contents($f), true);
            return is_array($d) ? count($d) : 0;
          };
          $cVod = $cacheCount('vod'); $cSeries = $cacheCount('series'); $cLive = $cacheCount('live');
        ?>
        <div class="mt-4 p-3 bg-gray-900/50 rounded border border-gray-800 flex flex-wrap items-center justify-between gap-3">
          <span class="text-sm text-gray-300">Catálogo em cache: <b class="text-white"><?= $cVod === null ? '—' : $cVod ?> filmes</b> • <b class="text-white"><?= $cSeries === null ? '—' : $cSeries ?> séries</b> • <b class="text-white"><?= $cLive === null ? '—' : $cLive ?> canais ao vivo</b><?php if ($cVod === null && $cSeries === null && $cLive === null): ?> <span class="text-gray-500">(vazio — abra o player para puxar)</span><?php endif; ?></span>
          <form method="POST" class="m-0">
                <input type="hidden" name="csrf_token" value="<?= htmlspecialchars(csrf_token()) ?>">
            <input type="hidden" name="form_action" value="clear_cache">
            <button type="submit" class="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-white text-xs font-semibold rounded transition">Atualizar catálogo (limpar cache)</button>
          </form>
        </div>
      </div>
    </div>

    <!-- ABA 2: SERVIDOR SIGMA -->
    <div id="tab-server" class="tab-content hidden">
      <div class="bg-[#12141c] p-6 rounded-xl border border-gray-800 max-w-3xl">
        <h3 class="text-lg font-semibold text-white mb-2">Conexão com Painel Sigma (Xtream Codes)</h3>
        <p class="text-sm text-gray-400 mb-6">Insira a URL, usuário e senha fornecidos pelo seu servidor Sigma. O sistema se encarrega de puxar categorias, canais, filmes e séries.</p>

        <form method="POST">
                <input type="hidden" name="csrf_token" value="<?= htmlspecialchars(csrf_token()) ?>">
          <input type="hidden" name="form_action" value="save_settings">
          <div class="space-y-4">
            <div>
              <label class="block text-xs uppercase font-semibold text-gray-400 mb-1">URL do Servidor HTTP:</label>
              <input type="text" name="sigma_url" value="<?= htmlspecialchars($settings['sigma_url']) ?>" placeholder="http://seuservidor.com:8080" required class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white font-mono text-sm focus:border-red-500 focus:outline-none">
              <p class="text-[11px] text-gray-500 mt-1">É AQUI que você troca o servidor: mudou a URL aqui e salvou, o site inteiro passa a usar o novo painel — inclusive o proxy. Não precisa editar o arquivo proxy-painel.php no cPanel.</p>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label class="block text-xs uppercase font-semibold text-gray-400 mb-1">Usuário:</label>
                <input type="text" name="sigma_username" value="<?= htmlspecialchars($settings['sigma_username']) ?>" placeholder="usuario_sigma" required class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:border-red-500 focus:outline-none">
              </div>
              <div>
                <label class="block text-xs uppercase font-semibold text-gray-400 mb-1">Senha:</label>
                <input type="password" name="sigma_password" value="<?= htmlspecialchars($settings['sigma_password']) ?>" placeholder="senha_sigma" required class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:border-red-500 focus:outline-none">
              </div>
            </div>

            <div>
              <label class="block text-xs uppercase font-semibold text-gray-400 mb-1">Proxy do painel (opcional):</label>
              <input type="text" name="panel_proxy" value="<?= htmlspecialchars($settings['panel_proxy'] ?? '') ?>" placeholder="https://webplayer.storestreaming.shop/proxy-painel.php" class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white font-mono text-sm focus:border-red-500 focus:outline-none">
              <p class="text-[11px] text-gray-500 mt-1">Só preencha se o painel bloquear o IP da Oracle (o "Testar conexão" dá 404/timeout mesmo com a URL certa). O proxy é o arquivo proxy-painel.php no cPanel — ele encaminha as chamadas para o painel. Com o proxy preenchido, TODAS as chamadas (catálogo e streams) passam por ele. Deixe vazio para falar direto com o painel. <strong class="text-gray-400">O proxy usa a "URL do Servidor" acima como destino — para trocar de painel, basta trocar a URL acima e salvar.</strong></p>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-gray-800">
              <div>
                <label class="block text-xs uppercase font-semibold text-gray-400 mb-1">% Comissão Afiliados (Indique e Ganhe):</label>
                <input type="number" name="affiliate_percent" value="<?= htmlspecialchars($settings['affiliate_percent']) ?>" class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white text-sm">
              </div>
              <div>
                <label class="block text-xs uppercase font-semibold text-gray-400 mb-1">Horas do Teste Grátis:</label>
                <input type="number" name="trial_hours" value="<?= htmlspecialchars($settings['trial_hours']) ?>" class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white text-sm">
              </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-gray-800">
              <div>
                <label class="block text-xs uppercase font-semibold text-gray-400 mb-1">Token do Mercado Pago (Pix automático):</label>
                <input type="password" name="mp_access_token" value="<?= htmlspecialchars($settings['mp_access_token'] ?? '') ?>" placeholder="vazio = Pix manual" autocomplete="off" class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white font-mono text-sm focus:border-red-500 focus:outline-none">
                <p class="text-[11px] text-gray-500 mt-1">Com o token, o checkout gera o QR Pix de verdade. Sem ele, o cliente paga com a chave Pix abaixo e você aprova na aba Vendas &amp; Pix.</p>
              </div>
              <div>
                <label class="block text-xs uppercase font-semibold text-gray-400 mb-1">Sua chave Pix (pagamento manual):</label>
                <input type="text" name="pix_key" value="<?= htmlspecialchars($settings['pix_key'] ?? '') ?>" placeholder="CPF, e-mail, telefone ou chave aleatória" class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:border-red-500 focus:outline-none">
                <p class="text-[11px] text-gray-500 mt-1">Mostrada ao cliente quando não há token do Mercado Pago.</p>
              </div>
            </div>
          </div>

          <div class="mt-6 flex items-center gap-4">
            <button type="submit" class="px-5 py-2.5 bg-red-brand text-white font-semibold rounded text-sm hover:bg-red-700 transition">Salvar Configurações</button>
            <button type="button" onclick="testSigmaConnection()" class="px-4 py-2.5 bg-gray-800 hover:bg-gray-700 text-white rounded text-sm transition">Testar Conexão</button>
          </div>
        </form>

        <div id="test-result-box" class="mt-6 p-4 rounded-lg bg-gray-900 border border-gray-800 hidden text-sm"></div>
      </div>
    </div>

    <!-- ABA 3: CLIENTES -->
    <div id="tab-clients" class="tab-content hidden">
      <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h3 class="text-lg font-semibold text-white">Gerenciamento de Clientes</h3>
          <p class="text-sm text-gray-400">Total de <?= count($clients) ?> clientes registrados.</p>
        </div>
        <button onclick="document.getElementById('modal-new-client').classList.remove('hidden')" class="px-4 py-2 bg-red-brand text-white text-sm font-semibold rounded hover:bg-red-700 transition">+ Novo Cliente</button>
      </div>

      <div class="bg-[#12141c] border border-gray-800 rounded-xl overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead class="bg-gray-900/70 border-b border-gray-800 text-xs uppercase text-gray-400">
            <tr>
              <th class="p-3">ID</th>
              <th class="p-3">Nome / E-mail</th>
              <th class="p-3">WhatsApp</th>
              <th class="p-3">Plano</th>
              <th class="p-3">Vencimento</th>
              <th class="p-3">Status</th>
              <th class="p-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-800/60">
            <?php foreach ($clients as $c): ?>
              <tr class="hover:bg-gray-900/30">
                <td class="p-3 text-gray-500">#<?= $c['id'] ?></td>
                <td class="p-3">
                  <div class="font-semibold text-white"><?= htmlspecialchars($c['name']) ?></div>
                  <div class="text-xs text-gray-400"><?= htmlspecialchars($c['email']) ?></div>
                </td>
                <td class="p-3 text-gray-300"><?= htmlspecialchars($c['whatsapp'] ?: '-') ?></td>
                <td class="p-3">
                  <span class="px-2 py-0.5 bg-gray-800 rounded text-xs text-gray-300"><?= htmlspecialchars($c['plan_name'] ?: 'Sem Plano') ?></span>
                </td>
                <td class="p-3 text-xs text-gray-300">
                  <?= $c['expires_at'] ? date('d/m/Y H:i', strtotime($c['expires_at'])) : 'Sem data' ?>
                </td>
                <td class="p-3">
                  <?php if ($c['status'] === 'active'): ?>
                    <span class="px-2 py-0.5 bg-emerald-950 text-emerald-400 border border-emerald-800 rounded-full text-xs">Ativo</span>
                  <?php elseif ($c['status'] === 'trial'): ?>
                    <span class="px-2 py-0.5 bg-blue-950 text-blue-400 border border-blue-800 rounded-full text-xs">Teste 3h</span>
                  <?php elseif ($c['status'] === 'blocked'): ?>
                    <span class="px-2 py-0.5 bg-red-950 text-red-400 border border-red-800 rounded-full text-xs">Bloqueado</span>
                  <?php else: ?>
                    <span class="px-2 py-0.5 bg-gray-800 text-gray-400 rounded-full text-xs">Expirado</span>
                  <?php endif; ?>
                </td>
                <td class="p-3 text-right">
                  <div class="flex items-center justify-end gap-2">
                    <button type="button" onclick="openEditClient(this)" data-id="<?= $c['id'] ?>" data-name="<?= htmlspecialchars($c['name'], ENT_QUOTES) ?>" data-email="<?= htmlspecialchars($c['email'], ENT_QUOTES) ?>" data-whatsapp="<?= htmlspecialchars($c['whatsapp'] ?? '', ENT_QUOTES) ?>" data-plan="<?= $c['plan_id'] ?? '' ?>" data-status="<?= $c['status'] ?>" data-expires="<?= $c['expires_at'] ? date('Y-m-d\TH:i', strtotime($c['expires_at'])) : '' ?>" class="text-xs px-2 py-1 bg-gray-800 hover:bg-blue-900 text-blue-300 rounded border border-gray-700">Editar</button>
                    <form method="POST" class="inline" onsubmit="return confirm('Excluir o cliente <?= htmlspecialchars(addslashes($c['name'])) ?>? Os pedidos, perfis e avaliações dele também serão apagados. Não dá para desfazer.')">
                <input type="hidden" name="csrf_token" value="<?= htmlspecialchars(csrf_token()) ?>">
                      <input type="hidden" name="form_action" value="delete_client">
                      <input type="hidden" name="user_id" value="<?= $c['id'] ?>">
                      <button type="submit" class="text-xs px-2 py-1 bg-gray-800 hover:bg-red-900 text-red-300 rounded border border-gray-700">Excluir</button>
                    </form>
                    <form method="POST" class="inline">
                <input type="hidden" name="csrf_token" value="<?= htmlspecialchars(csrf_token()) ?>">
                      <input type="hidden" name="form_action" value="renew_client">
                      <input type="hidden" name="user_id" value="<?= $c['id'] ?>">
                      <input type="hidden" name="days" value="30">
                      <button type="submit" class="text-xs px-2 py-1 bg-gray-800 hover:bg-emerald-900 text-emerald-300 rounded border border-gray-700">+30d</button>
                    </form>
                    <form method="POST" class="inline">
                <input type="hidden" name="csrf_token" value="<?= htmlspecialchars(csrf_token()) ?>">
                      <input type="hidden" name="form_action" value="toggle_client_status">
                      <input type="hidden" name="user_id" value="<?= $c['id'] ?>">
                      <input type="hidden" name="current_status" value="<?= $c['status'] ?>">
                      <button type="submit" class="text-xs px-2 py-1 bg-gray-800 hover:bg-red-900 text-red-300 rounded border border-gray-700">
                        <?= $c['status'] === 'blocked' ? 'Desbloquear' : 'Bloquear' ?>
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            <?php endforeach; ?>
            <?php if (empty($clients)): ?>
              <tr><td colspan="7" class="p-6 text-center text-gray-500">Nenhum cliente cadastrado ainda.</td></tr>
            <?php endif; ?>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ABA 4: PLANOS & PREÇOS -->
    <div id="tab-plans" class="tab-content hidden">
      <h3 class="text-lg font-semibold text-white mb-2">Configuração dos Planos</h3>
      <p class="text-sm text-gray-400 mb-6">Ajuste os valores que aparecem no checkout e na página inicial.</p>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <?php foreach ($plans as $p): ?>
          <div class="bg-[#12141c] border <?= $p['is_recommended'] ? 'border-red-600' : 'border-gray-800' ?> rounded-xl p-5 relative">
            <?php if ($p['is_recommended']): ?>
              <span class="absolute -top-3 left-4 bg-red-brand text-white text-[10px] font-bold uppercase px-2 py-0.5 rounded font-pixel">RECOMENDADO</span>
            <?php endif; ?>
            <h4 class="text-base font-bold text-white mb-2"><?= htmlspecialchars($p['name']) ?></h4>
            
            <form method="POST" class="space-y-3">
                <input type="hidden" name="csrf_token" value="<?= htmlspecialchars(csrf_token()) ?>">
              <input type="hidden" name="form_action" value="update_plan">
              <input type="hidden" name="plan_id" value="<?= $p['id'] ?>">
              
              <div>
                <label class="block text-xs text-gray-400 mb-1">Preço (R$):</label>
                <input type="number" step="0.01" name="price" value="<?= $p['price'] ?>" class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-white font-bold">
              </div>

              <div>
                <label class="block text-xs text-gray-400 mb-1">Duração em Dias:</label>
                <input type="number" name="duration_days" value="<?= $p['duration_days'] ?>" class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-white">
              </div>

              <div class="flex items-center gap-2 pt-2">
                <input type="checkbox" name="active" id="active_<?= $p['id'] ?>" <?= $p['active'] ? 'checked' : '' ?> class="rounded bg-gray-900 border-gray-700 text-red-600">
                <label for="active_<?= $p['id'] ?>" class="text-xs text-gray-300">Plano ativo no site</label>
              </div>

              <button type="submit" class="w-full mt-3 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded text-xs font-semibold transition">Salvar Alterações</button>
            </form>
          </div>
        <?php endforeach; ?>
      </div>
    </div>

    <!-- ABA 5: VENDAS & PIX -->
    <div id="tab-sales" class="tab-content hidden">
      <div class="flex justify-between items-center mb-6">
        <div>
          <h3 class="text-lg font-semibold text-white">Transações e Vendas PIX</h3>
          <p class="text-sm text-gray-400">Aprove pedidos pendentes e visualize o histórico financeiro.</p>
        </div>
      </div>

      <div class="bg-[#12141c] border border-gray-800 rounded-xl overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead class="bg-gray-900/70 border-b border-gray-800 text-xs uppercase text-gray-400">
            <tr>
              <th class="p-3">ID Pedido</th>
              <th class="p-3">Cliente</th>
              <th class="p-3">Plano</th>
              <th class="p-3">Valor</th>
              <th class="p-3">Status</th>
              <th class="p-3">Data</th>
              <th class="p-3 text-right">Ação</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-800/60">
            <?php foreach ($orders as $o): ?>
              <tr class="hover:bg-gray-900/30">
                <td class="p-3 font-mono text-gray-500">#<?= $o['id'] ?></td>
                <td class="p-3">
                  <div class="font-medium text-white"><?= htmlspecialchars($o['user_name']) ?></div>
                  <div class="text-xs text-gray-400"><?= htmlspecialchars($o['user_email']) ?></div>
                </td>
                <td class="p-3 text-gray-300"><?= htmlspecialchars($o['plan_name']) ?></td>
                <td class="p-3 font-bold text-white">R$ <?= number_format($o['amount'], 2, ',', '.') ?></td>
                <td class="p-3">
                  <?php if ($o['status'] === 'approved'): ?>
                    <span class="px-2 py-0.5 bg-emerald-950 text-emerald-400 border border-emerald-800 rounded-full text-xs">Aprovado</span>
                  <?php else: ?>
                    <span class="px-2 py-0.5 bg-amber-950 text-amber-400 border border-amber-800 rounded-full text-xs">Pendente</span>
                  <?php endif; ?>
                </td>
                <td class="p-3 text-xs text-gray-400"><?= date('d/m/Y H:i', strtotime($o['created_at'])) ?></td>
                <td class="p-3 text-right">
                  <?php if ($o['status'] === 'pending'): ?>
                    <form method="POST" class="inline">
                <input type="hidden" name="csrf_token" value="<?= htmlspecialchars(csrf_token()) ?>">
                      <input type="hidden" name="form_action" value="approve_order">
                      <input type="hidden" name="order_id" value="<?= $o['id'] ?>">
                      <button type="submit" class="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded">Aprovar PIX</button>
                    </form>
                  <?php else: ?>
                    <span class="text-xs text-gray-500">Concluído</span>
                  <?php endif; ?>
                </td>
              </tr>
            <?php endforeach; ?>
            <?php if (empty($orders)): ?>
              <tr><td colspan="7" class="p-6 text-center text-gray-500">Nenhum pedido gerado até o momento.</td></tr>
            <?php endif; ?>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ABA 6: INDIQUE & GANHE (AFILIADOS) -->
    <div id="tab-affiliates" class="tab-content hidden">
      <div class="flex justify-between items-center mb-6">
        <div>
          <h3 class="text-lg font-semibold text-white">Indique & Ganhe — Comissões de Afiliados (<?= intval($settings['affiliate_percent'] ?? 10) ?>%)</h3>
          <p class="text-sm text-gray-400">Clientes que indicaram novos assinantes e suas chaves Pix para repasse.</p>
        </div>
      </div>

      <div class="bg-[#12141c] border border-gray-800 rounded-xl overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead class="bg-gray-900/70 border-b border-gray-800 text-xs uppercase text-gray-400">
            <tr>
              <th class="p-3">Afiliado</th>
              <th class="p-3">Chave PIX Cadastrada</th>
              <th class="p-3">Novo Assinante Indicado</th>
              <th class="p-3">Comissão (<?= intval($settings['affiliate_percent'] ?? 10) ?>%)</th>
              <th class="p-3">Status</th>
              <th class="p-3 text-right">Ação</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-800/60">
            <?php foreach ($commissions as $comm): ?>
              <tr class="hover:bg-gray-900/30">
                <td class="p-3">
                  <div class="font-medium text-white"><?= htmlspecialchars($comm['affiliate_name']) ?></div>
                  <div class="text-xs text-gray-400"><?= htmlspecialchars($comm['affiliate_email']) ?></div>
                </td>
                <td class="p-3 font-mono text-xs text-emerald-400">
                  <?= htmlspecialchars($comm['affiliate_pix'] ?: 'Não informou chave') ?>
                </td>
                <td class="p-3 text-gray-300"><?= htmlspecialchars($comm['referred_name']) ?></td>
                <td class="p-3 font-bold text-white">R$ <?= number_format($comm['amount'], 2, ',', '.') ?></td>
                <td class="p-3">
                  <?php if ($comm['status'] === 'paid'): ?>
                    <span class="px-2 py-0.5 bg-emerald-950 text-emerald-400 border border-emerald-800 rounded-full text-xs">Pago</span>
                  <?php else: ?>
                    <span class="px-2 py-0.5 bg-amber-950 text-amber-400 border border-amber-800 rounded-full text-xs">Pendente</span>
                  <?php endif; ?>
                </td>
                <td class="p-3 text-right">
                  <?php if ($comm['status'] === 'pending'): ?>
                    <form method="POST" class="inline">
                <input type="hidden" name="csrf_token" value="<?= htmlspecialchars(csrf_token()) ?>">
                      <input type="hidden" name="form_action" value="pay_commission">
                      <input type="hidden" name="commission_id" value="<?= $comm['id'] ?>">
                      <button type="submit" class="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded">Pagar via Pix</button>
                    </form>
                  <?php else: ?>
                    <span class="text-xs text-gray-500">Liquidado</span>
                  <?php endif; ?>
                </td>
              </tr>
            <?php endforeach; ?>
            <?php if (empty($commissions)): ?>
              <tr><td colspan="6" class="p-6 text-center text-gray-500">Nenhuma comissão pendente de afiliados.</td></tr>
            <?php endif; ?>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ABA 7: ADMINISTRADORES -->
    <div id="tab-admins" class="tab-content hidden">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div class="md:col-span-1 space-y-6">
          <div class="bg-[#12141c] p-6 rounded-xl border border-gray-800">
            <h3 class="text-base font-semibold text-white mb-4">Trocar minha senha</h3>
            <form method="POST" class="space-y-4">
                <input type="hidden" name="csrf_token" value="<?= htmlspecialchars(csrf_token()) ?>">
              <input type="hidden" name="form_action" value="change_password">
              <div>
                <label class="block text-xs uppercase text-gray-400 mb-1">Senha atual:</label>
                <input type="password" name="current_password" required class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white text-sm">
              </div>
              <div>
                <label class="block text-xs uppercase text-gray-400 mb-1">Nova senha (mín. 6 caracteres):</label>
                <input type="password" name="new_password" required minlength="6" class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white text-sm">
              </div>
              <button type="submit" class="w-full py-2 bg-red-brand text-white font-semibold rounded text-sm hover:bg-red-700 transition">Alterar senha</button>
            </form>
          </div>
          <div class="bg-[#12141c] p-6 rounded-xl border border-gray-800">
          <h3 class="text-base font-semibold text-white mb-4">+ Cadastrar Novo Administrador</h3>
          <form method="POST" class="space-y-4">
                <input type="hidden" name="csrf_token" value="<?= htmlspecialchars(csrf_token()) ?>">
            <input type="hidden" name="form_action" value="create_admin">
            <div>
              <label class="block text-xs uppercase text-gray-400 mb-1">Nome:</label>
              <input type="text" name="admin_name" required class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white text-sm">
            </div>
            <div>
              <label class="block text-xs uppercase text-gray-400 mb-1">E-mail de Login:</label>
              <input type="email" name="admin_email" required class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white text-sm">
            </div>
            <div>
              <label class="block text-xs uppercase text-gray-400 mb-1">Senha de Acesso:</label>
              <input type="password" name="admin_password" required class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white text-sm">
            </div>
            <button type="submit" class="w-full py-2 bg-red-brand text-white font-semibold rounded text-sm hover:bg-red-700 transition">Salvar Administrador</button>
          </form>
        </div>
        </div>

        <div class="md:col-span-2 bg-[#12141c] border border-gray-800 rounded-xl overflow-hidden">
          <div class="p-4 border-b border-gray-800">
            <h3 class="text-base font-semibold text-white">Administradores com Acesso</h3>
          </div>
          <table class="w-full text-left text-sm">
            <thead class="bg-gray-900/50 text-xs text-gray-400 uppercase">
              <tr>
                <th class="p-3">Nome</th>
                <th class="p-3">E-mail</th>
                <th class="p-3">Data de Cadastro</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-800/60">
              <?php foreach ($admins as $adm): ?>
                <tr>
                  <td class="p-3 font-semibold text-white"><?= htmlspecialchars($adm['name']) ?></td>
                  <td class="p-3 text-gray-300"><?= htmlspecialchars($adm['email']) ?></td>
                  <td class="p-3 text-xs text-gray-400"><?= date('d/m/Y', strtotime($adm['created_at'])) ?></td>
                </tr>
              <?php endforeach; ?>
            </tbody>
          </table>
        </div>
      </div>
    </div>

  </main>

  <!-- MODAL: EDITAR CLIENTE -->
  <div id="modal-edit-client" class="fixed inset-0 bg-black/80 hidden items-center justify-center p-4 z-50">
    <div class="bg-[#161922] border border-gray-700 rounded-xl max-w-md w-full p-6">
      <div class="flex justify-between items-center mb-4">
        <h3 class="text-lg font-bold text-white">Editar Cliente</h3>
        <button onclick="document.getElementById('modal-edit-client').classList.add('hidden')" class="text-gray-400 hover:text-white">✕</button>
      </div>
      <form method="POST" class="space-y-3">
        <input type="hidden" name="csrf_token" value="<?= htmlspecialchars(csrf_token()) ?>">
        <input type="hidden" name="form_action" value="edit_client">
        <input type="hidden" name="user_id" id="edit-user-id" value="">
        <div>
          <label class="block text-xs uppercase text-gray-400 mb-1">Nome Completo:</label>
          <input type="text" name="name" id="edit-name" required class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white text-sm">
        </div>
        <div>
          <label class="block text-xs uppercase text-gray-400 mb-1">E-mail:</label>
          <input type="email" name="email" id="edit-email" required class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white text-sm">
        </div>
        <div>
          <label class="block text-xs uppercase text-gray-400 mb-1">Nova senha (deixe em branco para não trocar):</label>
          <input type="password" name="password" class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white text-sm">
        </div>
        <div>
          <label class="block text-xs uppercase text-gray-400 mb-1">WhatsApp:</label>
          <input type="text" name="whatsapp" id="edit-whatsapp" class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white text-sm">
        </div>
        <div>
          <label class="block text-xs uppercase text-gray-400 mb-1">Plano:</label>
          <select name="plan_id" id="edit-plan" class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white text-sm">
            <option value="">Sem Plano</option>
            <?php foreach ($plans as $p): ?>
              <option value="<?= $p['id'] ?>"><?= htmlspecialchars($p['name']) ?> — R$ <?= number_format($p['price'], 2, ',', '.') ?> (<?= $p['duration_days'] ?> dias)</option>
            <?php endforeach; ?>
          </select>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs uppercase text-gray-400 mb-1">Status:</label>
            <select name="status" id="edit-status" class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white text-sm">
              <option value="active">Ativo</option>
              <option value="trial">Teste 3h</option>
              <option value="blocked">Bloqueado</option>
              <option value="expired">Expirado</option>
            </select>
          </div>
          <div>
            <label class="block text-xs uppercase text-gray-400 mb-1">Vencimento:</label>
            <input type="datetime-local" name="expires_at" id="edit-expires" class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white text-sm">
          </div>
        </div>
        <div class="pt-2 flex justify-end gap-3">
          <button type="button" onclick="document.getElementById('modal-edit-client').classList.add('hidden')" class="px-4 py-2 bg-gray-800 text-gray-300 rounded text-sm">Cancelar</button>
          <button type="submit" class="px-4 py-2 bg-red-brand text-white font-semibold rounded text-sm hover:bg-red-700">Salvar alterações</button>
        </div>
      </form>
    </div>
  </div>

  <!-- MODAL: NOVO CLIENTE -->
  <div id="modal-new-client" class="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 hidden">
    <div class="bg-[#161922] border border-gray-700 rounded-xl max-w-md w-full p-6">
      <div class="flex justify-between items-center mb-4">
        <h3 class="text-lg font-bold text-white">Adicionar Novo Cliente</h3>
        <button onclick="document.getElementById('modal-new-client').classList.add('hidden')" class="text-gray-400 hover:text-white">✕</button>
      </div>
      <form method="POST" class="space-y-3">
                <input type="hidden" name="csrf_token" value="<?= htmlspecialchars(csrf_token()) ?>">
        <input type="hidden" name="form_action" value="create_client">
        <div>
          <label class="block text-xs uppercase text-gray-400 mb-1">Nome Completo:</label>
          <input type="text" name="name" required class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white text-sm">
        </div>
        <div>
          <label class="block text-xs uppercase text-gray-400 mb-1">E-mail:</label>
          <input type="email" name="email" required class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white text-sm">
        </div>
        <div>
          <label class="block text-xs uppercase text-gray-400 mb-1">Senha Provisória:</label>
          <input type="password" name="password" required class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white text-sm">
        </div>
        <div>
          <label class="block text-xs uppercase text-gray-400 mb-1">WhatsApp:</label>
          <input type="text" name="whatsapp" placeholder="(11) 99999-9999" class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white text-sm">
        </div>
        <div>
          <label class="block text-xs uppercase text-gray-400 mb-1">Plano Inicial:</label>
          <select name="plan_id" class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white text-sm">
            <?php foreach ($plans as $p): ?>
              <option value="<?= $p['id'] ?>"><?= htmlspecialchars($p['name']) ?> — R$ <?= number_format($p['price'], 2, ',', '.') ?> (<?= $p['duration_days'] ?> dias)</option>
            <?php endforeach; ?>
          </select>
        </div>
        <div class="pt-2 flex justify-end gap-3">
          <button type="button" onclick="document.getElementById('modal-new-client').classList.add('hidden')" class="px-4 py-2 bg-gray-800 text-gray-300 rounded text-sm">Cancelar</button>
          <button type="submit" class="px-4 py-2 bg-red-brand text-white font-semibold rounded text-sm hover:bg-red-700">Cadastrar Cliente</button>
        </div>
      </form>
    </div>
  </div>

  <script>
    // Abre o modal de edição com os dados do cliente (vindos do botão).
    function openEditClient(btn) {
      var d = btn.dataset;
      document.getElementById('edit-user-id').value = d.id || '';
      document.getElementById('edit-name').value = d.name || '';
      document.getElementById('edit-email').value = d.email || '';
      document.getElementById('edit-whatsapp').value = d.whatsapp || '';
      document.getElementById('edit-plan').value = d.plan || '';
      document.getElementById('edit-status').value = d.status || 'active';
      document.getElementById('edit-expires').value = d.expires || '';
      var m = document.getElementById('modal-edit-client');
      m.classList.remove('hidden');
      m.classList.add('flex');
    }
    function showTab(tabId) {
      document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
      document.querySelectorAll('.tab-btn').forEach(el => {
        el.classList.remove('text-red-500', 'bg-[#161922]', 'border-b-2', 'border-red-500');
        el.classList.add('text-gray-400');
      });
      document.getElementById(tabId).classList.remove('hidden');
      const activeBtn = document.getElementById('btn-' + tabId);
      activeBtn.classList.add('text-red-500', 'bg-[#161922]', 'border-b-2', 'border-red-500');
      activeBtn.classList.remove('text-gray-400');
    }

    async function testSigmaConnection() {
      const statusDash = document.getElementById('dash-sigma-status');
      const box = document.getElementById('test-result-box');
      if (statusDash) statusDash.innerText = 'Testando conexão...';
      if (box) {
        box.classList.remove('hidden');
        box.innerHTML = '<span class="text-amber-400">Consultando API Xtream do servidor Sigma...</span>';
      }

      try {
        const res = await fetch('api.php?action=test_connection', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          const successHtml = `<div class="text-emerald-400 font-bold">✓ ${data.message}</div>
                               <div class="text-xs text-gray-400 mt-1">Status: ${data.status} | Conexões: ${data.active_cons}/${data.max_connections} | Expira em: ${data.exp_date}</div>`;
          if (box) box.innerHTML = successHtml;
          if (statusDash) statusDash.innerHTML = '<span class="text-emerald-400 font-bold">Online ✓</span>';
        } else {
          const errHtml = `<div class="text-red-400 font-bold">✕ Erro: ${data.message}</div>`;
          if (box) box.innerHTML = errHtml;
          if (statusDash) statusDash.innerHTML = '<span class="text-red-400 font-bold">Falhou ✕</span>';
        }
      } catch (e) {
        const err = '<div class="text-red-400">Erro de rede ou servidor não acessível.</div>';
        if (box) box.innerHTML = err;
        if (statusDash) statusDash.innerHTML = '<span class="text-red-400 font-bold">Erro ✕</span>';
      }
    }
  </script>
</body>
</html>
