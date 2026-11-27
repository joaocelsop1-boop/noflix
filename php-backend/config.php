<?php
/**
 * MineTV - Configurações Gerais e Conexão com Banco de Dados
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
        'site_name' => 'MineTV',
        'affiliate_percent' => 10,
        'trial_hours' => 3,
        'mp_access_token' => '',
        'pix_key' => '',
    ];
    $stmt = $pdo->query("SELECT * FROM settings WHERE id = 1 LIMIT 1");
    $row = $stmt->fetch();
    if (!$row) return $defaults;
    return array_merge($defaults, $row);
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

// Usuário logado (cliente ou admin) — retorna a linha da tabela users ou null
function current_user($pdo) {
    if (empty($_SESSION['user_id'])) return null;
    $stmt = $pdo->prepare("SELECT * FROM users WHERE id = ? LIMIT 1");
    $stmt->execute([intval($_SESSION['user_id'])]);
    return $stmt->fetch() ?: null;
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
    if (!is_admin()) {
        header("Location: admin_login.php");
        exit;
    }
}

function require_login() {
    if (!is_logged_in()) {
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
function login_throttle_check() {
    $until = intval($_SESSION['login_lock_until'] ?? 0);
    if ($until > time()) {
        $min = (int)ceil(($until - time()) / 60);
        return 'Muitas tentativas de login. Tente novamente em ' . $min . ' minuto(s).';
    }
    return '';
}
function login_throttle_fail() {
    $n = intval($_SESSION['login_attempts'] ?? 0) + 1;
    $_SESSION['login_attempts'] = $n;
    if ($n >= 5) {
        $_SESSION['login_lock_until'] = time() + 900;
        $_SESSION['login_attempts'] = 0;
    }
}
function login_throttle_reset() {
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
