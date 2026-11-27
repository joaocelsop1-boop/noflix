<?php
/**
 * CinePlus - Login e Cadastro (modal igual ao do CinePlus)
 * - login: e-mail + senha (password_verify)
 * - cadastro: nome, e-mail, senha (password_hash), WhatsApp opcional,
 *   código de indicação opcional (?ref=)
 * - cadastro novo ganha teste: status 'trial', expires_at = agora + trial_hours
 * - "Esqueci minha senha": só mostra a mensagem (não há SMTP no webplayer)
 */
require_once __DIR__ . '/config.php';

// Fallback: se o config.php do servidor for antigo e não tiver essas
// funções (CSRF + trava de login, do scan 02:25), define aqui para o
// login não quebrar na tela (sem isso o formulário nem aparece).
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
// Fallback tudo21: mesmas assinaturas do config.php (trava no banco, por
// e-mail). Só roda se o config.php do servidor for antigo; depois do deploy
// as funções de lá vencem e estas nunca são definidas.
if (!function_exists('login_throttle_check')) {
    function login_throttle_check($pdo = null, $email = '') {
        $email = strtolower(trim((string)$email));
        if ($email === '' || !$pdo) {
            $until = intval($_SESSION['login_lock_until'] ?? 0);
            if ($until > time()) {
                $min = (int)ceil(($until - time()) / 60);
                return 'Muitas tentativas de login. Tente novamente em ' . $min . ' minuto(s).';
            }
            return '';
        }
        try {
            $pdo->exec("CREATE TABLE IF NOT EXISTS login_attempts (email VARCHAR(255) NOT NULL PRIMARY KEY, attempts INT NOT NULL DEFAULT 0, lock_until INT NOT NULL DEFAULT 0, updated_at INT NOT NULL DEFAULT 0) ENGINE=InnoDB");
            $stmt = $pdo->prepare("SELECT lock_until FROM login_attempts WHERE email = ? LIMIT 1");
            $stmt->execute([$email]);
            $until = (int)($stmt->fetchColumn() ?: 0);
            if ($until > time()) {
                $min = (int)ceil(($until - time()) / 60);
                return 'Muitas tentativas de login. Tente novamente em ' . $min . ' minuto(s).';
            }
        } catch (Throwable $e) { /* sem trava: segue o login */ }
        return '';
    }
}
if (!function_exists('login_throttle_fail')) {
    function login_throttle_fail($pdo = null, $email = '') {
        // tudo22: devolve a mensagem de bloqueio quando ESTA falha travou
        // a conta (5ª tentativa) — antes só aparecia na 6ª.
        $email = strtolower(trim((string)$email));
        if ($email === '' || !$pdo) {
            $n = intval($_SESSION['login_attempts'] ?? 0) + 1;
            $_SESSION['login_attempts'] = $n;
            if ($n >= 5) {
                $_SESSION['login_lock_until'] = time() + 900;
                $_SESSION['login_attempts'] = 0;
                return 'Muitas tentativas de login. Tente novamente em 15 minuto(s).';
            }
            return '';
        }
        try {
            $now = time();
            $pdo->exec("CREATE TABLE IF NOT EXISTS login_attempts (email VARCHAR(255) NOT NULL PRIMARY KEY, attempts INT NOT NULL DEFAULT 0, lock_until INT NOT NULL DEFAULT 0, updated_at INT NOT NULL DEFAULT 0) ENGINE=InnoDB");
            $pdo->prepare("INSERT INTO login_attempts (email, attempts, lock_until, updated_at) VALUES (?, 1, 0, ?) ON DUPLICATE KEY UPDATE attempts = attempts + 1, updated_at = VALUES(updated_at)")->execute([$email, $now]);
            $pdo->prepare("UPDATE login_attempts SET lock_until = ?, attempts = 0 WHERE email = ? AND attempts >= 5")->execute([$now + 900, $email]);
            $stmt = $pdo->prepare("SELECT lock_until FROM login_attempts WHERE email = ? LIMIT 1");
            $stmt->execute([$email]);
            if ((int)($stmt->fetchColumn() ?: 0) > $now) {
                return 'Muitas tentativas de login. Tente novamente em 15 minuto(s).';
            }
        } catch (Throwable $e) { /* sem trava: segue o login */ }
        return '';
    }
}
if (!function_exists('login_throttle_reset')) {
    function login_throttle_reset($pdo = null, $email = '') {
        $email = strtolower(trim((string)$email));
        if ($email !== '' && $pdo) {
            try { $pdo->prepare("DELETE FROM login_attempts WHERE email = ?")->execute([$email]); } catch (Throwable $e) { /* segue */ }
        }
        unset($_SESSION['login_attempts'], $_SESSION['login_lock_until']);
    }
}

// Já logado? Vai direto (não mostra o formulário de novo)
if (is_logged_in()) {
    header('Location: ' . (is_admin() ? 'admin.php' : 'profiles.php'));
    exit;
}

$settings = get_settings($pdo);
$plans = $pdo->query("SELECT * FROM plans WHERE active = 1 ORDER BY price ASC")->fetchAll();

$erro = '';
$modo = ($_GET['modo'] ?? 'login') === 'cadastro' ? 'cadastro' : 'login';
$refCode = trim($_GET['ref'] ?? ($_POST['ref'] ?? ''));

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_check();
    $acao = $_POST['acao'] ?? '';

    if ($acao === 'login') {
        // tudo21: a trava é por e-mail (no banco) — lê o e-mail ANTES de
        // checar, senão não há como saber qual conta está travada.
        $email = trim($_POST['email'] ?? '');
        $pass = $_POST['password'] ?? '';
        $lockMsg = login_throttle_check($pdo, $email);
        if ($lockMsg !== '') {
            $erro = $lockMsg;
        } else {
        $stmt = $pdo->prepare("SELECT * FROM users WHERE email = ? LIMIT 1");
        $stmt->execute([$email]);
        $u = $stmt->fetch();
        if ($u && password_verify($pass, $u['password'])) {
            login_throttle_reset($pdo, $email);
            session_regenerate_id(true);
            $_SESSION['user_id'] = (int)$u['id'];
            $_SESSION['user_name'] = $u['name'];
            $_SESSION['user_email'] = $u['email'];
            $_SESSION['user_role'] = $u['role'];
            // Sessão única (tudo20): este login invalida qualquer sessão
            // antiga da mesma conta (outro aparelho).
            $_SESSION['session_token'] = mint_session_token($pdo, (int)$u['id']);
            unset($_SESSION['profile_id'], $_SESSION['profile_name'], $_SESSION['profile_kids'], $_SESSION['adult_ok']);
            if ($u['role'] === 'admin') {
                header('Location: admin.php');
            } else {
                header('Location: profiles.php');
            }
            exit;
        }
        // tudo22: a 5ª falha já trava — mostra o bloqueio nela, não só na 6ª.
        $justLocked = login_throttle_fail($pdo, $email);
        $erro = $justLocked !== '' ? $justLocked : 'E-mail ou senha incorretos.';
        }
    }

    if ($acao === 'cadastro') {
        $name = trim($_POST['name'] ?? '');
        $email = trim($_POST['email'] ?? '');
        $pass = $_POST['password'] ?? '';
        $wa = trim($_POST['whatsapp'] ?? '');
        $ref = trim($_POST['ref'] ?? '');
        if ($name === '' || $email === '' || strlen($pass) < 6) {
            $erro = 'Preencha nome, um e-mail válido e uma senha com no mínimo 6 caracteres.';
        } elseif (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $erro = 'E-mail inválido.';
        } else {
            $stmt = $pdo->prepare("SELECT id FROM users WHERE email = ? LIMIT 1");
            $stmt->execute([$email]);
            if ($stmt->fetch()) {
                $erro = 'Este e-mail já está cadastrado. Faça login.';
            } else {
                // quem indicou (se o código existir)
                $referredBy = null;
                if ($ref !== '') {
                    $stmt = $pdo->prepare("SELECT id FROM users WHERE referral_code = ? LIMIT 1");
                    $stmt->execute([$ref]);
                    $referredBy = $stmt->fetchColumn() ?: null;
                }
                // código de indicação único
                do {
                    $myRef = 'MINE' . strtoupper(substr(bin2hex(random_bytes(4)), 0, 8));
                    $stmt = $pdo->prepare("SELECT id FROM users WHERE referral_code = ? LIMIT 1");
                    $stmt->execute([$myRef]);
                } while ($stmt->fetch());
                $trialHours = intval($settings['trial_hours'] ?? 3);
                $expires = date('Y-m-d H:i:s', strtotime('+' . $trialHours . ' hours'));
                $hash = password_hash($pass, PASSWORD_DEFAULT);
                $pdo->prepare("INSERT INTO users (name, email, password, whatsapp, role, status, expires_at, referral_code, referred_by) VALUES (?, ?, ?, ?, 'client', 'trial', ?, ?, ?)")->execute([$name, $email, $hash, $wa !== '' ? $wa : null, $expires, $myRef, $referredBy]);
                $newId = (int)$pdo->lastInsertId();
                session_regenerate_id(true);
                $_SESSION['user_id'] = $newId;
                $_SESSION['user_name'] = $name;
                $_SESSION['user_email'] = $email;
                $_SESSION['user_role'] = 'client';
                $_SESSION['session_token'] = mint_session_token($pdo, $newId);
                unset($_SESSION['profile_id'], $_SESSION['profile_name'], $_SESSION['profile_kids'], $_SESSION['adult_ok']);
                header('Location: profiles.php');
                exit;
            }
        }
        $modo = 'cadastro';
    }
}
?>
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CinePlus — Entrar</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Silkscreen:wght@400;700&family=Manrope:wght@400..800&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Manrope', 'Segoe UI', system-ui, sans-serif; background-color: #080d14; color: #f0efd6; }
    .font-pixel { font-family: 'Silkscreen', 'Courier New', monospace; }
    .font-hud { font-family: 'Press Start 2P', 'Silkscreen', monospace; }
    .red-brand { color: #ff454b; }
    /* herói esmaecido atrás do modal (fundo da home) */
    .home-hero {
      background:
        radial-gradient(ellipse 60% 55% at 72% 18%, rgba(255,69,75,.16), transparent 60%),
        radial-gradient(ellipse 55% 65% at 18% 82%, rgba(47,90,140,.35), transparent 62%),
        linear-gradient(180deg, #0d1622 0%, #080d14 72%);
    }
    /* barra de rolagem própria do modal */
    .modal-scroll::-webkit-scrollbar { width: 6px; }
    .modal-scroll::-webkit-scrollbar-track { background: #0d1420; }
    .modal-scroll::-webkit-scrollbar-thumb { background: #34404c; border-radius: 3px; }
    .modal-scroll { scrollbar-width: thin; scrollbar-color: #34404c #0d1420; }
    .btn-entrar:disabled { opacity: .45; cursor: not-allowed; }
  </style>
</head>
<body class="min-h-screen bg-[#080d14]">

  <!-- HOME ESCURECIDA ATRÁS DO MODAL -->
  <div class="min-h-screen flex flex-col">
    <header class="w-full flex items-center justify-between px-4 md:px-8 py-4">
      <span class="font-pixel text-base md:text-lg text-white">MINE<span class="red-brand">TV</span></span>
      <button type="button" onclick="abrirModal()" class="flex items-center gap-2 px-4 py-2 bg-[#182330] hover:bg-[#1e2c3d] border border-[#34404c] text-white rounded text-xs font-semibold">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="#f1c66d" aria-hidden="true"><path d="M12 12c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm0 2c-3.33 0-10 1.67-10 5v3h20v-3c0-3.33-6.67-5-10-5z"/></svg>
        Entrar
      </button>
    </header>
    <section class="home-hero flex-1 relative flex items-end">
      <div class="absolute inset-0 bg-[#080d14]/55"></div>
      <div class="relative px-4 md:px-8 pb-12 max-w-3xl">
        <span class="inline-block px-2 py-1 bg-[#ff454b] font-pixel text-[9px] text-white rounded">EM ALTA NA SEMANA</span>
        <p class="text-white/70 text-sm mt-4 font-semibold">CinePlus — Seu cinema. Seu tempo.</p>
      </div>
    </section>
  </div>

  <!-- MODAL DE LOGIN (igual ao do CinePlus) -->
  <div id="login-modal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
    <div class="modal-scroll relative w-full max-w-md max-h-[88vh] overflow-y-auto bg-[#0d1420] border border-[#34404c] border-t-2 border-t-[#ff454b] rounded-xl p-6">
      <button type="button" onclick="fecharModal()" aria-label="Fechar" class="absolute top-3 right-3 w-8 h-8 flex items-center justify-center bg-[#182330] hover:bg-[#1e2c3d] border border-[#34404c] text-[#8d8a99] hover:text-white rounded text-sm leading-none">&#10005;</button>

      <?php if ($erro): ?>
        <div class="p-3 rounded-lg bg-[#6d1418]/40 border border-[#ff454b]/50 text-[#ffb3b5] text-xs mb-4"><?= htmlspecialchars($erro) ?></div>
      <?php endif; ?>

      <?php if ($modo === 'login'): ?>
        <div id="view-login">
          <p class="font-hud text-[9px] text-[#8d8a99] tracking-wider">CONTINUE DE ONDE PAROU</p>
          <h2 class="text-2xl font-extrabold text-white mt-2">Entrar</h2>
          <hr class="border-t border-dashed border-[#34404c] my-4">
          <form method="POST" id="form-login" class="space-y-4">
            <input type="hidden" name="acao" value="login">
            <input type="hidden" name="csrf_token" value="<?= htmlspecialchars(csrf_token()) ?>">
            <div>
              <label class="block text-[11px] font-bold uppercase tracking-wider text-[#8d8a99] mb-1.5">E-mail</label>
              <input type="email" name="email" id="login-email" required value="<?= htmlspecialchars($_POST['email'] ?? '') ?>" class="w-full bg-[#080d14] border border-[#34404c] rounded-md px-3 py-2.5 text-white text-sm focus:border-[#ff454b] focus:outline-none">
            </div>
            <div>
              <label class="block text-[11px] font-bold uppercase tracking-wider text-[#8d8a99] mb-1.5">Senha</label>
              <input type="password" name="password" id="login-senha" required class="w-full bg-[#080d14] border border-[#34404c] rounded-md px-3 py-2.5 text-white text-sm focus:border-[#ff454b] focus:outline-none">
            </div>
            <button type="submit" id="btn-entrar" disabled class="btn-entrar w-full py-3 bg-[#c8202a] hover:bg-[#a81b24] text-white font-bold rounded text-sm transition">Entrar e assistir &#9654;</button>
          </form>
          <div class="flex items-center justify-between mt-4 text-xs">
            <a href="#" onclick="mostrarReset(event)" class="text-[#8d8a99] hover:text-white hover:underline">Esqueci minha senha</a>
            <span class="text-[#8d8a99]">Ainda não tem conta? <a href="login.php?modo=cadastro<?= $refCode !== '' ? '&ref=' . urlencode($refCode) : '' ?>" class="text-[#ff454b] font-semibold hover:underline">Teste grátis</a></span>
          </div>
        </div>

        <div id="view-reset" class="hidden">
          <p class="font-hud text-[9px] text-[#8d8a99] tracking-wider">RECUPERAR ACESSO</p>
          <h2 class="text-2xl font-extrabold text-white mt-2">Esqueci minha senha</h2>
          <hr class="border-t border-dashed border-[#34404c] my-4">
          <form id="form-reset" class="space-y-4" onsubmit="enviarReset(event)">
            <div>
              <label class="block text-[11px] font-bold uppercase tracking-wider text-[#8d8a99] mb-1.5">E-mail</label>
              <input type="email" id="reset-email" required placeholder="seu@email.com" class="w-full bg-[#080d14] border border-[#34404c] rounded-md px-3 py-2.5 text-white text-sm placeholder-[#8d8a99] focus:border-[#ff454b] focus:outline-none">
            </div>
            <button type="submit" class="w-full py-3 bg-[#c8202a] hover:bg-[#a81b24] text-white font-bold rounded text-sm transition">Enviar instruções</button>
          </form>
          <p id="reset-msg" class="hidden text-xs text-[#7fcb91] mt-4">Se o e-mail estiver cadastrado, você receberá as instruções.</p>
          <p class="text-xs text-center mt-4"><a href="#" onclick="voltarLogin(event)" class="text-[#ff454b] font-semibold hover:underline">&larr; Voltar para o login</a></p>
        </div>
      <?php else: ?>
        <p class="font-hud text-[9px] text-[#8d8a99] tracking-wider">CONTINUE DE ONDE PAROU</p>
        <h2 class="text-2xl font-extrabold text-white mt-2">Criar conta</h2>
        <hr class="border-t border-dashed border-[#34404c] my-4">
        <p class="text-xs text-[#8d8a99] mb-4">Ganhe um teste grátis de <?= intval($settings['trial_hours'] ?? 3) ?> horas com acesso completo.</p>
        <form method="POST" class="space-y-4">
          <input type="hidden" name="acao" value="cadastro">
          <input type="hidden" name="csrf_token" value="<?= htmlspecialchars(csrf_token()) ?>">
          <?php if ($refCode !== ''): ?>
            <input type="hidden" name="ref" value="<?= htmlspecialchars($refCode) ?>">
            <p class="text-xs text-[#7fcb91]">Você foi indicado! Código: <strong><?= htmlspecialchars($refCode) ?></strong></p>
          <?php endif; ?>
          <div>
            <label class="block text-[11px] font-bold uppercase tracking-wider text-[#8d8a99] mb-1.5">Nome completo</label>
            <input type="text" name="name" required value="<?= htmlspecialchars($_POST['name'] ?? '') ?>" class="w-full bg-[#080d14] border border-[#34404c] rounded-md px-3 py-2.5 text-white text-sm focus:border-[#ff454b] focus:outline-none">
          </div>
          <div>
            <label class="block text-[11px] font-bold uppercase tracking-wider text-[#8d8a99] mb-1.5">E-mail</label>
            <input type="email" name="email" required value="<?= htmlspecialchars($_POST['email'] ?? '') ?>" class="w-full bg-[#080d14] border border-[#34404c] rounded-md px-3 py-2.5 text-white text-sm focus:border-[#ff454b] focus:outline-none">
          </div>
          <div>
            <label class="block text-[11px] font-bold uppercase tracking-wider text-[#8d8a99] mb-1.5">Senha (mínimo 6 caracteres)</label>
            <input type="password" name="password" required minlength="6" class="w-full bg-[#080d14] border border-[#34404c] rounded-md px-3 py-2.5 text-white text-sm focus:border-[#ff454b] focus:outline-none">
          </div>
          <div>
            <label class="block text-[11px] font-bold uppercase tracking-wider text-[#8d8a99] mb-1.5">WhatsApp (opcional)</label>
            <input type="text" name="whatsapp" placeholder="(11) 99999-9999" value="<?= htmlspecialchars($_POST['whatsapp'] ?? '') ?>" class="w-full bg-[#080d14] border border-[#34404c] rounded-md px-3 py-2.5 text-white text-sm placeholder-[#8d8a99] focus:border-[#ff454b] focus:outline-none">
          </div>
          <?php if ($refCode === ''): ?>
          <div>
            <label class="block text-[11px] font-bold uppercase tracking-wider text-[#8d8a99] mb-1.5">Código de indicação (opcional)</label>
            <input type="text" name="ref" placeholder="Ex.: MINE99" class="w-full bg-[#080d14] border border-[#34404c] rounded-md px-3 py-2.5 text-white text-sm placeholder-[#8d8a99] focus:border-[#ff454b] focus:outline-none">
          </div>
          <?php endif; ?>
          <button type="submit" class="w-full py-3 bg-[#c8202a] hover:bg-[#a81b24] text-white font-bold rounded text-sm transition">Criar conta e começar o teste</button>
        </form>
        <p class="text-xs text-[#8d8a99] text-center mt-4">Já tem conta? <a href="login.php" class="text-[#ff454b] font-semibold hover:underline">Entrar</a></p>
      <?php endif; ?>
    </div>
  </div>

  <script>
    function fecharModal() { document.getElementById('login-modal').style.display = 'none'; }
    function abrirModal() { document.getElementById('login-modal').style.display = 'flex'; }
    // "Entrar e assistir": só habilita com E-MAIL e SENHA preenchidos
    var em = document.getElementById('login-email');
    var pw = document.getElementById('login-senha');
    var btn = document.getElementById('btn-entrar');
    function checar() {
      if (!em || !pw || !btn) return;
      btn.disabled = !(em.value.trim() !== '' && pw.value.trim() !== '');
    }
    if (em) em.addEventListener('input', checar);
    if (pw) pw.addEventListener('input', checar);
    checar();
    // "Esqueci minha senha": mostra o campo de e-mail; ao enviar, só a mensagem
    function mostrarReset(e) {
      e.preventDefault();
      document.getElementById('view-login').classList.add('hidden');
      document.getElementById('view-reset').classList.remove('hidden');
    }
    function voltarLogin(e) {
      if (e) e.preventDefault();
      document.getElementById('view-reset').classList.add('hidden');
      document.getElementById('view-login').classList.remove('hidden');
    }
    function enviarReset(e) {
      e.preventDefault();
      document.getElementById('reset-msg').classList.remove('hidden');
    }
  </script>
</body>
</html>
