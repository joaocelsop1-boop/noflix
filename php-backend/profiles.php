<?php
/**
 * MineTV - Seletor de perfis (máximo 4 por usuário)
 * Depois do login, o usuário escolhe (ou cria) um perfil antes de entrar.
 * O perfil kids esconde o conteúdo adulto. O perfil fica na sessão.
 */
require_once __DIR__ . '/config.php';

// Fallback: se o config.php do servidor for antigo e não tiver CSRF,
// define aqui para a página não quebrar (mesmo motivo do login.php).
if (!function_exists('csrf_token')) {
    function csrf_token() {
        if (empty($_SESSION['csrf_token'])) {
            $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
        }
        return $_SESSION['csrf_token'];
    }
}
if (!function_exists('csrf_check')) {
    function csrf_check() {
        $sent = $_POST['csrf_token'] ?? '';
        if (!is_string($sent) || $sent === '' || !hash_equals($_SESSION['csrf_token'] ?? '', $sent)) {
            http_response_code(403);
            die('Sessao expirada ou requisicao invalida. Recarregue a pagina e tente novamente.');
        }
    }
}
require_login();

$user = current_user($pdo);
if (!$user) { header('Location: login.php'); exit; }

$erro = '';

// Selecionar perfil
if (isset($_GET['select'])) {
    $pid = intval($_GET['select']);
    $stmt = $pdo->prepare("SELECT * FROM profiles WHERE id = ? AND user_id = ? LIMIT 1");
    $stmt->execute([$pid, $user['id']]);
    $p = $stmt->fetch();
    if ($p) {
        $_SESSION['profile_id'] = (int)$p['id'];
        $_SESSION['profile_name'] = $p['name'];
        $_SESSION['profile_kids'] = (int)$p['is_kids'];
        unset($_SESSION['adult_ok']);
        header('Location: index.php');
        exit;
    }
    $erro = 'Perfil não encontrado.';
}

// Excluir perfil (POST + CSRF — antes era GET e qualquer link/imagem podia apagar)
if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['acao'] ?? '') === 'delete') {
    csrf_check();
    $pid = intval($_POST['profile_id'] ?? 0);
    $pdo->prepare("DELETE FROM profiles WHERE id = ? AND user_id = ?")->execute([$pid, $user['id']]);
    if ((int)($_SESSION['profile_id'] ?? 0) === $pid) {
        unset($_SESSION['profile_id'], $_SESSION['profile_name'], $_SESSION['profile_kids'], $_SESSION['adult_ok']);
    }
    header('Location: profiles.php');
    exit;
}

// Criar perfil
if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['acao'] ?? '') === 'create') {
    csrf_check();
    $name = trim($_POST['name'] ?? '');
    $isKids = isset($_POST['is_kids']) ? 1 : 0;
    $count = $pdo->prepare("SELECT COUNT(*) FROM profiles WHERE user_id = ?");
    $count->execute([$user['id']]);
    if ($name === '') {
        $erro = 'Dê um nome para o perfil.';
    } elseif ((int)$count->fetchColumn() >= 4) {
        $erro = 'Limite de 4 perfis atingido.';
    } else {
        $pdo->prepare("INSERT INTO profiles (user_id, name, is_kids) VALUES (?, ?, ?)")->execute([$user['id'], $name, $isKids]);
        header('Location: profiles.php');
        exit;
    }
}

$stmt = $pdo->prepare("SELECT * FROM profiles WHERE user_id = ? ORDER BY id ASC");
$stmt->execute([$user['id']]);
$profiles = $stmt->fetchAll();
?>
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MineTV — Quem está assistindo?</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Silkscreen:wght@400;700&family=Manrope:wght@400..800&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Manrope', 'Segoe UI', system-ui, sans-serif; background-color: #080d14; color: #f0efd6; }
    .font-pixel { font-family: 'Silkscreen', 'Courier New', monospace; }
    .font-hud { font-family: 'Press Start 2P', 'Silkscreen', monospace; }
    .red-brand { color: #ff454b; }
    .bg-red-brand { background-color: #ff454b; }
    .bg-red-brand:hover { background-color: #e93640; }
  </style>
</head>
<body class="min-h-screen flex flex-col items-center justify-center p-4">
  <h1 class="font-pixel text-lg text-white tracking-widest mb-1">Quem está assistindo?</h1>
  <p class="text-xs text-[#8d8a99] mb-6">Conta de <?= htmlspecialchars($user['name']) ?> — escolha um perfil para continuar.</p>

  <?php if ($erro): ?>
    <div class="max-w-lg w-full mb-4 p-3 rounded-lg bg-[#6d1418]/40 border border-[#ff454b]/50 text-[#ffb3b5] text-xs"><?= htmlspecialchars($erro) ?></div>
  <?php endif; ?>

  <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-lg w-full">
    <?php foreach ($profiles as $p): ?>
      <div class="relative bg-[#111a24] border border-[#34404c] rounded-xl p-4 text-center hover:border-[#ff454b] transition">
        <a href="profiles.php?select=<?= $p['id'] ?>" class="block">
          <div class="w-14 h-14 mx-auto rounded-full <?= $p['is_kids'] ? 'bg-[#f1c66d]/15 border-[#f1c66d]' : 'bg-[#ff454b]/15 border-[#ff454b]' ?> border flex items-center justify-center text-xl font-bold text-white"><?= htmlspecialchars(mb_strtoupper(mb_substr($p['name'], 0, 1))) ?></div>
          <div class="text-xs text-white font-semibold mt-2 truncate"><?= htmlspecialchars($p['name']) ?></div>
          <?php if ($p['is_kids']): ?><div class="text-[10px] text-[#f1c66d]">Infantil</div><?php endif; ?>
        </a>
        <form method="POST" class="absolute top-2 right-2" onsubmit="return confirm('Excluir este perfil?')">
          <input type="hidden" name="csrf_token" value="<?= htmlspecialchars(csrf_token()) ?>">
          <input type="hidden" name="acao" value="delete">
          <input type="hidden" name="profile_id" value="<?= $p['id'] ?>">
          <button type="submit" class="text-[#8d8a99] hover:text-[#ff454b] text-xs">✕</button>
        </form>
      </div>
    <?php endforeach; ?>

    <?php if (count($profiles) < 4): ?>
      <div class="bg-[#111a24] border border-dashed border-[#34404c] rounded-xl p-4">
        <form method="POST" class="space-y-2">
          <input type="hidden" name="acao" value="create">
          <input type="hidden" name="csrf_token" value="<?= htmlspecialchars(csrf_token()) ?>">
          <input type="text" name="name" required maxlength="50" placeholder="Nome do perfil" class="w-full bg-[#080d14] border border-[#34404c] rounded px-2 py-1.5 text-white text-xs focus:border-[#ff454b] focus:outline-none">
          <label class="flex items-center gap-1 text-[11px] text-[#a7b0bb]">
            <input type="checkbox" name="is_kids" class="rounded bg-[#080d14] border-[#34404c] text-[#ff454b]"> Perfil infantil
          </label>
          <button type="submit" class="w-full py-1.5 bg-red-brand text-white font-bold rounded text-[11px]">+ Adicionar perfil</button>
          <div class="text-[10px] text-[#8d8a99] text-center"><?= count($profiles) ?> de 4 perfis</div>
        </form>
      </div>
    <?php endif; ?>
  </div>

  <a href="logout.php" class="text-xs text-[#8d8a99] hover:text-white mt-8">Sair da conta</a>
</body>
</html>
