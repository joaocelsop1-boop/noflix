<?php
/**
 * CinePlus - Login do administrador
 * (o admin.php antigo criava sozinho uma sessão de Super Admin — removido.
 *  Agora só entra quem tiver e-mail/senha de admin no banco.)
 */
require_once __DIR__ . '/config.php';

// Já logado como admin? Vai direto ao painel
if (is_admin()) {
    header('Location: admin.php');
    exit;
}

$erro = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_check();
    $lockMsg = login_throttle_check();
    if ($lockMsg !== '') {
        $erro = $lockMsg;
    } else {
    $email = trim($_POST['email'] ?? '');
    $pass = $_POST['password'] ?? '';
    $stmt = $pdo->prepare("SELECT * FROM users WHERE email = ? AND role = 'admin' LIMIT 1");
    $stmt->execute([$email]);
    $u = $stmt->fetch();
    if ($u && password_verify($pass, $u['password'])) {
        login_throttle_reset();
        session_regenerate_id(true);
        $_SESSION['user_id'] = (int)$u['id'];
        $_SESSION['user_name'] = $u['name'];
        $_SESSION['user_email'] = $u['email'];
        $_SESSION['user_role'] = 'admin';
        $_SESSION['session_token'] = mint_session_token($pdo, (int)$u['id']);
        unset($_SESSION['profile_id'], $_SESSION['profile_name'], $_SESSION['profile_kids'], $_SESSION['adult_ok']);
        header('Location: admin.php');
        exit;
    }
    login_throttle_fail();
    $erro = 'E-mail ou senha de administrador incorretos.';
    }
}
?>
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CinePlus — Acesso do Administrador</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', sans-serif; background-color: #0b0c10; color: #f1f5f9; }
    .font-pixel { font-family: 'Press Start 2P', monospace; }
    .red-brand { color: #22e6ff; }
    .bg-red-brand { background-color: #ff2bd6; }
    .bg-red-brand:hover { background-color: #d11aae; }
  </style>
</head>
<body class="min-h-screen flex flex-col items-center justify-center p-4">
  <h1 class="font-pixel text-xl text-white tracking-widest mb-1"><span style="background:linear-gradient(90deg,#22e6ff,#ff2bd6);-webkit-background-clip:text;background-clip:text;color:transparent">CinePlus</span></h1>
  <p class="text-xs text-gray-400 mb-6">Painel Administrativo</p>

  <div class="bg-[#141620] border border-gray-700 rounded-2xl max-w-sm w-full p-6 space-y-4">
    <?php if ($erro): ?>
      <div class="p-3 rounded-lg bg-red-950/80 border border-red-700 text-red-300 text-xs"><?= htmlspecialchars($erro) ?></div>
    <?php endif; ?>
    <h2 class="font-pixel text-sm text-white">Acesso do administrador</h2>
    <form method="POST" class="space-y-3">
      <input type="hidden" name="csrf_token" value="<?= htmlspecialchars(csrf_token()) ?>">
      <div>
        <label class="block text-xs text-gray-400 mb-1">E-mail</label>
        <input type="email" name="email" required class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:border-cyan-400 focus:outline-none">
      </div>
      <div>
        <label class="block text-xs text-gray-400 mb-1">Senha</label>
        <input type="password" name="password" required class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white text-sm focus:border-cyan-400 focus:outline-none">
      </div>
      <button type="submit" class="w-full py-3 bg-red-brand text-white font-bold rounded-lg text-xs transition">Entrar no painel</button>
    </form>
    <p class="text-[11px] text-gray-500 text-center">Use o e-mail e a senha do administrador. Troque a senha assim que entrar (aba Administradores &gt; Trocar minha senha).</p>
    <p class="text-xs text-gray-400 text-center"><a href="login.php" class="text-red-400 hover:underline">Voltar ao player</a></p>
  </div>
</body>
</html>
