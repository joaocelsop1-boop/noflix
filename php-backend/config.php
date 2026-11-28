<?php
/**
 * CinePlus - Configurações Gerais e Conexão com Banco de Dados
 * CORRIGIDO: helpers de login, plano ativo e limpeza do cache do catálogo.
 */
if (session_status() === PHP_SESSION_NONE) {
    // Cookie de sessão endurecido: HttpOnly (o JS não lê o cookie) e
    // SameSite=Lax (o navegador não envia o cookie em POST de outro site —
    // isso protege as ações AJAX de api.php, que não carregam token CSRF).
    ini_set('session.cookie_httponly', '1');
    ini_set('session.cookie_samesite', 'Lax');
    session_start();
}

// Configurações do Banco de Dados MySQL
// NOFLIX/Docker: lidas de variáveis de ambiente (docker-compose.yml),
// com fallback para os valores locais originais quando não definidas.
// No compose o serviço de banco se chama `db` — defina DB_HOST=db lá.
define('DB_HOST', getenv('DB_HOST') ?: 'localhost');
define('DB_NAME', getenv('DB_NAME') ?: 'minetv');
define('DB_USER', getenv('DB_USER') ?: 'root');
define('DB_PASS', getenv('DB_PASS') !== false ? getenv('DB_PASS') : '');

try {
    $pdo = new PDO("mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=utf8mb4", DB_USER, DB_PASS, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false
    ]);
} catch (PDOException $e) {
    error_log('DB connect failed: ' . $e->getMessage());
    die("Erro de conexão com o banco de dados. Verifique as credenciais no config.php.");
}

// Função para buscar configurações do Sigma e gerais
// (mescla com os padrões: se o banco ainda for o antigo, sem as colunas
// mp_access_token/pix_key, elas voltam vazias em vez de quebrar)
function get_settings($pdo) {
    $defaults = [
        'sigma_url' => 'http://seuservidor.com:8080',
        'sigma_username' => '',
        'sigma_password' => '',
        'panel_proxy' => '',
        'site_name' => 'CinePlus',
        'affiliate_percent' => 10,
        'trial_hours' => 3,
        // Pagamentos: gateway selecionado + credenciais (todas vazias por
        // padrão; o admin preenche na aba Pagamentos).
        'payment_gateway' => 'mp',
        'mp_access_token' => '',
        'pix_key' => '',
        'pix_fixed_code' => '',
        'pix_fixed_qr' => '',
        'pix_beneficiary' => '',
        'lynx_api_key' => '',
        'lynx_webhook_secret' => '',
        'efi_client_id' => '',
        'efi_client_secret' => '',
        'efi_cert_path' => '',
        'efi_sandbox' => 0,
        'asaas_api_key' => '',
        'asaas_sandbox' => 0,
        // Suporte: contato mostrado no botão "Suporte" do app (menu da
        // conta e rodapé). Vazios = botão não aparece. O admin preenche
        // na aba Servidor Sigma, seção Suporte.
        'support_whatsapp' => '',
        'support_telegram' => '',
        // Notificações Telegram (tudo29): quando um título não toca, o
        // cliente avisa e o dono recebe no Telegram. Vazios = recurso
        // desligado (o botão "Avisar que não funcionou" não aparece no
        // app). O admin preenche na aba Servidor Sigma, seção
        // Notificações Telegram. O token é segredo: nunca sai do servidor.
        'telegram_notify_token' => '',
        'telegram_notify_chat_id' => '',
    ];
    ensure_payment_columns($pdo);
    ensure_user_columns($pdo);
    $stmt = $pdo->query("SELECT * FROM settings WHERE id = 1 LIMIT 1");
    $row = $stmt->fetch();
    if (!$row) return $defaults;
    return array_merge($defaults, $row);
}

// Garante as colunas de pagamento em bancos criados antes delas (mesmo
// padrão do panel_proxy no admin): sem isso, o UPDATE do admin quebra com
// "Unknown column" e NADA é salvo. Roda a cada get_settings — SHOW COLUMNS
// é só metadado, barato. A tabela orders também ganha `gateway` (qual
// gateway gerou o QR), usado para reaproveitar o pedido certo.
function ensure_payment_columns($pdo) {
    static $done = false;
    if ($done) return;
    $done = true;
    $settingsCols = [
        'payment_gateway' => "VARCHAR(20) NOT NULL DEFAULT 'mp'",
        'pix_fixed_code' => "TEXT NOT NULL",
        'pix_fixed_qr' => "TEXT NOT NULL",
        'pix_beneficiary' => "VARCHAR(120) NOT NULL DEFAULT ''",
        'lynx_api_key' => "VARCHAR(255) NOT NULL DEFAULT ''",
        'lynx_webhook_secret' => "VARCHAR(255) NOT NULL DEFAULT ''",
        'efi_client_id' => "VARCHAR(255) NOT NULL DEFAULT ''",
        'efi_client_secret' => "VARCHAR(255) NOT NULL DEFAULT ''",
        'efi_cert_path' => "VARCHAR(255) NOT NULL DEFAULT ''",
        'efi_sandbox' => "TINYINT(1) NOT NULL DEFAULT 0",
        'asaas_api_key' => "VARCHAR(255) NOT NULL DEFAULT ''",
        'asaas_sandbox' => "TINYINT(1) NOT NULL DEFAULT 0",
        'support_whatsapp' => "VARCHAR(30) NOT NULL DEFAULT ''",
        'support_telegram' => "VARCHAR(100) NOT NULL DEFAULT ''",
        // tudo29: bot do Telegram que avisa o dono quando um título não
        // toca + o chat que recebe a notificação (ID do usuário/grupo).
        'telegram_notify_token' => "VARCHAR(255) NOT NULL DEFAULT ''",
        'telegram_notify_chat_id' => "VARCHAR(100) NOT NULL DEFAULT ''",
    ];
    try {
        foreach ($settingsCols as $col => $def) {
            $exists = $pdo->query("SHOW COLUMNS FROM settings LIKE '" . $col . "'")->fetch();
            if (!$exists) $pdo->exec("ALTER TABLE settings ADD COLUMN " . $col . " " . $def);
        }
        $gw = $pdo->query("SHOW COLUMNS FROM orders LIKE 'gateway'")->fetch();
        if (!$gw) $pdo->exec("ALTER TABLE orders ADD COLUMN gateway VARCHAR(20) NOT NULL DEFAULT ''");
    } catch (Throwable $e) {
        error_log('ensure_payment_columns: ' . $e->getMessage());
    }
}

// Sessão única (tudo20 — um acesso por vez): a coluna session_token
// guarda o token da sessão ATUAL do usuário. O login grava um token novo;
// qualquer sessão antiga (outro aparelho) deixa de bater e é desconectada.
// Mesmo padrão de auto-ALTER do ensure_payment_columns.
function ensure_user_columns($pdo) {
    static $done = false;
    if ($done) return;
    $done = true;
    try {
        $exists = $pdo->query("SHOW COLUMNS FROM users LIKE 'session_token'")->fetch();
        if (!$exists) $pdo->exec("ALTER TABLE users ADD COLUMN session_token VARCHAR(64) NOT NULL DEFAULT ''");
    } catch (Throwable $e) {
        error_log('ensure_user_columns: ' . $e->getMessage());
    }
}

// Gera um token novo, grava na conta e devolve. Chamado no login.
function mint_session_token($pdo, $userId) {
    $token = bin2hex(random_bytes(32));
    try {
        $pdo->prepare("UPDATE users SET session_token = ? WHERE id = ?")->execute([$token, intval($userId)]);
    } catch (Throwable $e) {
        error_log('mint_session_token: ' . $e->getMessage());
    }
    return $token;
}

// Normaliza a URL do painel: aceita o que o usuário colar (URL completa do
// M3U, URL com /player_api.php, sem esquema, com barra no fim) e devolve só
// esquema://host:porta — que é o que o player_api.php e o stream precisam.
// Sem isso, colar a URL completa do M3U quebra TODAS as chamadas (404),
// enquanto outros painéis cadastrados como URL limpa funcionam.
function normalize_panel_url($url) {
    $url = trim((string)$url);
    if ($url === '') return '';
    $url = trim($url, " \t\n\r\0\x0B\"'");
    if (!preg_match('#^https?://#i', $url)) {
        $url = 'http://' . $url;
    }
    $parsed = parse_url($url);
    if (empty($parsed['host'])) return $url;
    $scheme = strtolower($parsed['scheme'] ?? 'http');
    if (!in_array($scheme, ['http', 'https'], true)) $scheme = 'http';
    $host = $parsed['host'];
    $port = isset($parsed['port']) ? ':' . intval($parsed['port']) : '';
    return $scheme . '://' . $host . $port;
}

// Base usada para falar com o painel: se houver um proxy configurado
// (panel_proxy), TODAS as chamadas (API e streams) passam por ele, com o
// caminho preservado. Sem proxy, usa a URL do painel normalizada.
// O proxy existe porque alguns painéis só respondem à API para IPs
// liberados (o cPanel está liberado, a Oracle não). O proxy fica no cPanel
// e encaminha para o painel — ver proxy-painel.php na raiz do projeto.
function panel_base_url($settings) {
    $proxy = trim((string)($settings['panel_proxy'] ?? ''));
    if ($proxy !== '') {
        return rtrim($proxy, '/');
    }
    return normalize_panel_url($settings['sigma_url'] ?? '');
}

// Usuário logado (cliente ou admin) — retorna a linha da tabela users ou null.
// Sessão única (tudo20): se a conta tem um session_token e ele não bate com
// o da sessão atual, ESTA sessão foi encerrada por um login em outro aparelho
// — retorna null (o usuário é tratado como deslogado em tudo: me, stream,
// catálogo, admin). $GLOBALS['session_token_mismatch'] sinaliza o motivo
// para a ação `me` devolver sessionEnded e o app mostrar a mensagem certa.
function current_user($pdo) {
    if (empty($_SESSION['user_id'])) return null;
    // Garante a coluna antes de ler/gravar o token: o stream.php chama
    // current_user() antes de get_settings(), então não dá para depender
    // só do ensure de lá. O static $done faz isso custar 1 consulta por
    // requisição, no máximo.
    ensure_user_columns($pdo);
    $stmt = $pdo->prepare("SELECT * FROM users WHERE id = ? LIMIT 1");
    $stmt->execute([intval($_SESSION['user_id'])]);
    $user = $stmt->fetch() ?: null;
    if (!$user) return null;
    $dbToken = (string)($user['session_token'] ?? '');
    $sessToken = (string)($_SESSION['session_token'] ?? '');
    if ($dbToken === '') {
        // Conta criada antes do tudo20 (sem token): emite um token para
        // esta sessão e segue — o próximo login em outro aparelho a invalida.
        $_SESSION['session_token'] = mint_session_token($pdo, (int)$user['id']);
        return $user;
    }
    if ($sessToken === '' || !hash_equals($dbToken, $sessToken)) {
        $GLOBALS['session_token_mismatch'] = true;
        return null;
    }
    return $user;
}

// O usuário pode assistir? status active ou trial E dentro da validade
function user_can_watch($user) {
    if (!$user) return false;
    // Admin pode assistir (para testar o player com a conta do admin).
    if (($user['role'] ?? '') === 'admin') return true;
    if (!in_array($user['status'], ['active', 'trial'], true)) return false;
    if (empty($user['expires_at'])) return false;
    return strtotime($user['expires_at']) > time();
}

// Helpers de Autenticação
function is_logged_in() {
    return isset($_SESSION['user_id']);
}

function is_admin() {
    return isset($_SESSION['user_role']) && $_SESSION['user_role'] === 'admin';
}

function require_admin() {
    global $pdo;
    $u = current_user($pdo);
    if (!$u || ($u['role'] ?? '') !== 'admin') {
        header("Location: admin_login.php");
        exit;
    }
}

function require_login() {
    global $pdo;
    if (!current_user($pdo)) {
        header("Location: login.php");
        exit;
    }
}

// ---------- protecao CSRF (formularios POST) ----------
function csrf_token() {
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf_token'];
}
function csrf_check() {
    $sent = $_POST['csrf_token'] ?? '';
    if (!is_string($sent) || $sent === '' || !hash_equals($_SESSION['csrf_token'] ?? '', $sent)) {
        http_response_code(403);
        die('Sessao expirada ou requisicao invalida. Recarregue a pagina e tente novamente.');
    }
}

// ---------- trava de login (forca bruta: 5 erros = 15 min) ----------
// tudo21: ANTES era só $_SESSION — limpar o cookie zerava o contador e a
// trava nunca pegava de verdade (bastava abrir anônimo ou limpar o cookie).
// Agora fica NO BANCO, por e-mail: 5 senhas erradas travam aquele e-mail
// por 15 min, em qualquer navegador, aba ou aparelho. A mensagem continua
// genérica (não revela se o e-mail existe).
// Por IP não dá: o PHP só vê o IP interno do Next.js (todos os clientes
// chegam pelo mesmo IP atrás do proxy) — a chave tem que ser o e-mail.
function ensure_login_attempts_table($pdo) {
    static $done = false;
    if ($done) return;
    $done = true;
    try {
        $pdo->exec("CREATE TABLE IF NOT EXISTS login_attempts (email VARCHAR(255) NOT NULL PRIMARY KEY, attempts INT NOT NULL DEFAULT 0, lock_until INT NOT NULL DEFAULT 0, updated_at INT NOT NULL DEFAULT 0) ENGINE=InnoDB");
    } catch (Throwable $e) {
        error_log('ensure_login_attempts_table: ' . $e->getMessage());
    }
}
function login_throttle_check($pdo, $email) {
    $email = strtolower(trim((string)$email));
    if ($email === '') return '';
    try {
        ensure_login_attempts_table($pdo);
        $stmt = $pdo->prepare("SELECT lock_until FROM login_attempts WHERE email = ? LIMIT 1");
        $stmt->execute([$email]);
        $until = (int)($stmt->fetchColumn() ?: 0);
        if ($until > time()) {
            $min = (int)ceil(($until - time()) / 60);
            return 'Muitas tentativas de login. Tente novamente em ' . $min . ' minuto(s).';
        }
    } catch (Throwable $e) {
        // Banco indisponível para a trava: usa a sessão como reserva.
        $until = intval($_SESSION['login_lock_until'] ?? 0);
        if ($until > time()) {
            $min = (int)ceil(($until - time()) / 60);
            return 'Muitas tentativas de login. Tente novamente em ' . $min . ' minuto(s).';
        }
    }
    return '';
}
// tudo22: devolve a mensagem de bloqueio quando ESTA falha travou a conta
// (5ª tentativa). Antes a função só gravava o bloqueio e o login respondia
// "inválidos" na 5ª, então o bloqueio só aparecia na 6ª tentativa.
function login_throttle_fail($pdo, $email) {
    $email = strtolower(trim((string)$email));
    if ($email === '') return '';
    try {
        ensure_login_attempts_table($pdo);
        $now = time();
        $pdo->prepare("INSERT INTO login_attempts (email, attempts, lock_until, updated_at) VALUES (?, 1, 0, ?) ON DUPLICATE KEY UPDATE attempts = attempts + 1, updated_at = VALUES(updated_at)")->execute([$email, $now]);
        $pdo->prepare("UPDATE login_attempts SET lock_until = ?, attempts = 0 WHERE email = ? AND attempts >= 5")->execute([$now + 900, $email]);
        $stmt = $pdo->prepare("SELECT lock_until FROM login_attempts WHERE email = ? LIMIT 1");
        $stmt->execute([$email]);
        if ((int)($stmt->fetchColumn() ?: 0) > $now) {
            return 'Muitas tentativas de login. Tente novamente em 15 minuto(s).';
        }
    } catch (Throwable $e) {
        $n = intval($_SESSION['login_attempts'] ?? 0) + 1;
        $_SESSION['login_attempts'] = $n;
        if ($n >= 5) {
            $_SESSION['login_lock_until'] = time() + 900;
            $_SESSION['login_attempts'] = 0;
            return 'Muitas tentativas de login. Tente novamente em 15 minuto(s).';
        }
    }
    return '';
}
function login_throttle_reset($pdo, $email) {
    $email = strtolower(trim((string)$email));
    if ($email === '') return;
    try {
        ensure_login_attempts_table($pdo);
        $pdo->prepare("DELETE FROM login_attempts WHERE email = ?")->execute([$email]);
    } catch (Throwable $e) {
        // nada a fazer — a linha some sozinha quando o lock expira
    }
    unset($_SESSION['login_attempts'], $_SESSION['login_lock_until']);
}

// Limpa o cache do catálogo (chamado ao salvar as settings no admin)
function clear_catalog_cache() {
    $dir = __DIR__ . '/cache';
    if (!is_dir($dir)) return;
    foreach (glob($dir . '/*.json') as $f) {
        @unlink($f);
    }
}
?>
