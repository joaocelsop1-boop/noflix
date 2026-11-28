<?php
/**
 * CinePlus - API Bridge para o Painel Sigma (Xtream Codes API)
 * CORRIGIDO:
 * - sem CORS aberto
 * - catálogo exige login; test_connection exige admin
 * - a ação que devolvia a URL direta foi REMOVIDA (o player usa stream.php, que nunca expõe a senha do painel)
 * - test_connection exige admin e usa os valores digitados no formulário
 *   (POST) quando presentes — a URL testada é a digitada, não só a salva
 * - cache em arquivo cache/ (TTL 3600s) nas listas grandes; se o painel falhar,
 *   devolve o cache antigo, senão array vazio (nunca erro fatal)
 * - stale-while-revalidate: cache velho (até 24h) é servido NA HORA e a
 *   atualização roda em 2º plano (refresh_catalog) — o usuário nunca mais
 *   espera 30-60s pelo painel só porque o cache venceu
 * - create_order: pedido pendente + Pix pelo gateway selecionado no admin
 *   (Mercado Pago, LynxPix, Efí, Asaas) ou Pix fixo manual; o erro do
 *   gateway volta legível ({ok:false, error}) e o pedido falho é cancelado
 * - test_gateway: testa as credenciais do gateway (digitadas ou salvas)
 *   sem criar cobrança — o admin confere a chave antes de qualquer cliente
 * - rate / my_rating: avaliações "SUA NOTA" (1 a 5)
 * - save_pix_key: chave Pix do usuário (Indique e Ganhe)
 * - adult_unlock: libera conteúdo adulto na sessão com a senha da conta
 */
require_once __DIR__ . '/config.php';

header('Content-Type: application/json; charset=utf-8');

function api_error($msg, $code = 403) {
    http_response_code($code);
    // Mesmo formato das actions novas ({ok:false, error:"..."}): o front
    // extrai `error` como string — com boolean `true` o React não renderiza
    // nada e a tela ficava com a barra de erro vazia. Nenhum fluxo checa
    // `error === true` (verificado: admin.php, src/lib, middleware só usam
    // `error` como string ou `ok`).
    echo json_encode(['ok' => false, 'error' => $msg, 'message' => $msg]);
    exit;
}

function api_require_login() {
    // Sessão única (tudo20): current_user() já invalida a sessão quando
    // outro aparelho entrou depois — uma sessão encerrada não passa aqui.
    global $pdo;
    if (!current_user($pdo)) api_error('Login necessário.', 401);
}

function api_require_admin() {
    global $pdo;
    $u = current_user($pdo);
    if (!$u || ($u['role'] ?? '') !== 'admin') api_error('Acesso restrito ao administrador.', 403);
}

// ---------- helpers das actions NOFLIX (me / login / logout / plans / register) ----------
// Payload público do usuário: nunca inclui senha/hash nem dados internos.
function api_public_user($pdo, $user) {
    $planName = null;
    if (!empty($user['plan_id'])) {
        $stmt = $pdo->prepare("SELECT name FROM plans WHERE id = ? LIMIT 1");
        $stmt->execute([(int)$user['plan_id']]);
        $planName = $stmt->fetchColumn() ?: null;
    }
    return [
        'id' => (int)$user['id'],
        'name' => $user['name'],
        'email' => $user['email'],
        'plan_id' => $user['plan_id'] !== null ? (int)$user['plan_id'] : null,
        'plan_name' => $planName,
        'expires_at' => $user['expires_at'] ?? null,
        'status' => $user['status'] ?? null,
    ];
}

// Lê um campo POST aceitando form-urlencoded/multipart ($_POST) OU JSON
// (o front Next.js pode enviar fetch com JSON). Só usado pelas actions novas.
function api_post_field($key, $default = '') {
    if (isset($_POST[$key])) return $_POST[$key];
    static $json = null;
    if ($json === null) {
        $json = [];
        $raw = file_get_contents('php://input');
        if ($raw !== false && $raw !== '') {
            $decoded = json_decode($raw, true);
            if (is_array($decoded)) $json = $decoded;
        }
    }
    return $json[$key] ?? $default;
}

// Erro JSON no formato das actions novas ({ok:false, error:"..."}).
function api_auth_error($msg, $code = 400) {
    http_response_code($code);
    echo json_encode(['ok' => false, 'error' => $msg]);
}

$settings = get_settings($pdo);

$action = $_GET['action'] ?? ($_POST['action'] ?? '');

// Libera a trava da sessão ANTES das chamadas lentas ao painel: o PHP trava
// o arquivo da sessão enquanto a requisição roda, e sem isso as 6 chamadas do
// catálogo ficam numa fila, uma esperando a outra — é isso que deixa o site
// lento e o logout demorando. Depois daqui o $_SESSION continua legível, só
// não dá para gravar nele (adult_unlock reabre a sessão para gravar).
session_write_close();

// ---------- cache em arquivo ----------
define('CATALOG_CACHE_DIR', __DIR__ . '/cache');
define('CATALOG_CACHE_TTL', 3600);
// Velho (até 24h): ainda serve na hora, e a atualização roda em 2º plano.
// O catálogo do painel muda pouco (títulos novos entram de vez em quando) —
// servir a lista de ontem por alguns minutos é melhor que travar a tela
// por 30-60s esperando o painel gerar 20 mil filmes de novo.
define('CATALOG_CACHE_STALE_TTL', 86400);
define('CATALOG_REFRESH_LOCK', CATALOG_CACHE_DIR . '/refresh.lock');
define('CATALOG_REFRESH_LOCK_TTL', 600); // não dispara outro refresh por 10 min

function catalog_cache_get($key) {
    $file = CATALOG_CACHE_DIR . '/' . $key . '.json';
    if (!file_exists($file)) return null;
    $data = json_decode(@file_get_contents($file), true);
    if ($data === null) return null;
    return ['mtime' => filemtime($file), 'data' => $data];
}

function catalog_cache_put($key, $data) {
    if (!is_dir(CATALOG_CACHE_DIR)) {
        @mkdir(CATALOG_CACHE_DIR, 0777, true);
    }
    @file_put_contents(CATALOG_CACHE_DIR . '/' . $key . '.json', json_encode($data), LOCK_EX);
}

// Dispara a atualização do cache em 2º plano (fire-and-forget): o usuário
// já recebeu a resposta com o cache velho; este pedido só avisa o servidor
// para buscar as listas novas. Trava de 10 min evita disparar um refresh
// por lista velha quando a inicial pede filme+série+ao vivo de uma vez.
// O refresh roda no próprio servidor (127.0.0.1) com o cookie da sessão,
// para passar no login — e continua mesmo depois que este pedido desliga
// (ignore_user_abort no refresh_catalog).
function catalog_trigger_refresh() {
    $lock = CATALOG_REFRESH_LOCK;
    if (file_exists($lock) && (time() - filemtime($lock) < CATALOG_REFRESH_LOCK_TTL)) return;
    if (!is_dir(CATALOG_CACHE_DIR)) @mkdir(CATALOG_CACHE_DIR, 0777, true);
    @touch($lock);
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, 'http://127.0.0.1/api.php?action=refresh_catalog');
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT_MS, 300);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT_MS, 200);
    $cookie = $_SERVER['HTTP_COOKIE'] ?? '';
    if ($cookie !== '') curl_setopt($ch, CURLOPT_COOKIE, $cookie);
    curl_exec($ch);
    curl_close($ch);
}

// ---------- chamada ao painel ----------
function call_sigma($url, $timeout = 20) {
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_USERAGENT, 'CinePlus-WebPlayer/1.0');
    curl_setopt($ch, CURLOPT_TIMEOUT, $timeout);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, false);
    $response = curl_exec($ch);
    $error = curl_error($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($error || $response === false) {
        return ['error' => true, 'message' => $error ?: 'Falha na conexão com o painel'];
    }
    if ($httpCode >= 400) {
        return ['error' => true, 'message' => 'Painel respondeu HTTP ' . $httpCode];
    }
    $data = json_decode($response, true);
    if ($data === null && trim((string)$response) !== '') {
        return ['error' => true, 'message' => 'Resposta inválida do painel'];
    }
    return ['error' => false, 'code' => $httpCode, 'data' => ($data === null ? [] : $data)];
}

function sigma_url($settings, $action, $extra = '') {
    // panel_base_url: usa o proxy (se configurado) ou a URL do painel
    // normalizada. O proxy preserva o caminho, então o /player_api.php
    // chega ao painel mesmo quando a Oracle é bloqueada por IP.
    // &panel=<url do admin>: diz ao proxy QUAL painel usar — trocou a
    // "URL do Servidor" no admin, o proxy passa a usar a nova sem precisar
    // editar o proxy-painel.php. O proxy remove o parâmetro antes de
    // encaminhar ao painel.
    $base = panel_base_url($settings);
    $panelParam = '';
    if (!empty($settings['panel_proxy'])) {
        $panelParam = '&panel=' . urlencode(normalize_panel_url($settings['sigma_url'] ?? ''));
    }
    return $base . '/player_api.php?username=' . urlencode($settings['sigma_username']) . '&password=' . urlencode($settings['sigma_password']) . '&action=' . $action . $extra . $panelParam;
}

// ---------- filtro de conteúdo adulto ----------
function is_adult_category($name) {
    return (bool) preg_match('/adult|xxx|porn|erotic|\+?18|rated\s*x/i', (string)$name);
}

function adult_allowed() {
    // perfil kids nunca vê adulto; adulto só com senha confirmada na sessão
    if (!empty($_SESSION['profile_kids'])) return false;
    return !empty($_SESSION['adult_ok']);
}

function category_map($settings, $kind) {
    // $kind: live | vod | series — retorna [category_id => category_name]
    $action = $kind === 'live' ? 'get_live_categories' : ($kind === 'vod' ? 'get_vod_categories' : 'get_series_categories');
    $list = catalog_list($settings, $action, '', 'cat_' . $kind);
    $map = [];
    foreach ((array)$list as $c) {
        if (isset($c['category_id'])) $map[(string)$c['category_id']] = (string)($c['category_name'] ?? '');
    }
    return $map;
}

function filter_adult_items($items, $kind, $settings, $forceHide = false) {
    if (!$forceHide && adult_allowed()) return array_values((array)$items);
    $cats = category_map($settings, $kind);
    $out = [];
    foreach ((array)$items as $it) {
        if (!empty($it['is_adult'])) continue;
        $catId = isset($it['category_id']) ? (string)$it['category_id'] : null;
        if ($catId !== null && isset($cats[$catId]) && is_adult_category($cats[$catId])) continue;
        $out[] = $it;
    }
    return $out;
}

function filter_adult_categories($cats, $forceHide = false) {
    if (!$forceHide && adult_allowed()) return array_values((array)$cats);
    $out = [];
    foreach ((array)$cats as $c) {
        if (is_adult_category($c['category_name'] ?? '')) continue;
        $out[] = $c;
    }
    return $out;
}

// ---------- lista com cache ----------
function catalog_list($settings, $action, $extra, $cacheKey) {
    $cached = catalog_cache_get($cacheKey);
    if ($cached && (time() - $cached['mtime'] < CATALOG_CACHE_TTL)) {
        return $cached['data'];
    }
    // Cache VELHO (até 24h): serve na hora e atualiza em 2º plano. Antes,
    // cache vencido = esperar o painel gerar 20 mil filmes (30-60s) com a
    // tela travada — era isso que deixava cada abertura lenta.
    if ($cached && (time() - $cached['mtime'] < CATALOG_CACHE_STALE_TTL)) {
        catalog_trigger_refresh();
        return $cached['data'];
    }
    // Listas do catalogo sao grandes (20 mil filmes) e o painel via proxy pode
    // levar mais que os 20 s padrao para gerar+enviar — 60 s aqui, senao o
    // catalogo frio nunca popula o cache e os filmes somem.
    $res = call_sigma(sigma_url($settings, $action, $extra), 60);
    if ($res['error']) {
        // painel falhou: devolve o cache antigo se existir, senão vazio
        if ($cached) return $cached['data'];
        return [];
    }
    $data = is_array($res['data']) ? $res['data'] : [];
    // Não grava cache vazio: um retorno vazio seria servido por 1h e o
    // catálogo pareceria incompleto. Sem cache, a próxima carga tenta de novo.
    if (!empty($data)) {
        catalog_cache_put($cacheKey, $data);
    }
    return $data;
}

// ---------- Mercado Pago: criar pagamento Pix ----------
function mp_create_pix($token, $amount, $email, $description, $externalRef) {
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, 'https://api.mercadopago.com/v1/payments');
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 30);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Authorization: Bearer ' . $token,
        'Content-Type: application/json',
        'X-Idempotency-Key: ' . $externalRef
    ]);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode([
        'transaction_amount' => (float)$amount,
        'description' => $description,
        'payment_method_id' => 'pix',
        'payer' => ['email' => $email],
        'external_reference' => $externalRef
    ]));
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($err || $resp === false) {
        return ['error' => true, 'message' => 'Falha ao falar com o Mercado Pago.'];
    }
    $data = json_decode($resp, true);
    if ($code >= 400 || empty($data['point_of_interaction']['transaction_data']['qr_code'])) {
        $msg = $data['message'] ?? ('Mercado Pago respondeu HTTP ' . $code);
        return ['error' => true, 'message' => 'Mercado Pago: ' . $msg];
    }
    return ['error' => false, 'data' => $data['point_of_interaction']['transaction_data']];
}

// ---------- HTTP genérico p/ gateways (LynxPix / Efí / Asaas) ----------
function gw_http($url, $method, $headers, $body = null, $certPath = '') {
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 30);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, is_string($body) ? $body : json_encode($body, JSON_UNESCAPED_UNICODE));
    if ($certPath !== '') {
        // Efí (produção) exige mTLS com o certificado .p12 da conta.
        curl_setopt($ch, CURLOPT_SSLCERT, $certPath);
        curl_setopt($ch, CURLOPT_SSLCERTTYPE, 'P12');
        curl_setopt($ch, CURLOPT_SSLCERTPASSWD, '');
    }
    $resp = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($err || $resp === false) return ['error' => true, 'code' => 0, 'message' => 'Sem resposta do gateway.'];
    $data = json_decode($resp, true);
    return ['error' => false, 'code' => $code, 'data' => is_array($data) ? $data : []];
}

// ---------- LynxPix: criar cobrança Pix ----------
// API https://lynxpix.cc/api/v1 — Bearer <api_key>.
// POST /pixQrCode/create {amountCents, description, expiresIn, metadata}
// → {id, brCode, brCodeBase64, status, expiresAt}
function lynx_create_pix($apiKey, $amount, $description, $metadata) {
    if (trim($apiKey) === '') return ['error' => true, 'message' => 'LynxPix: chave de API não configurada no admin (aba Pagamentos).'];
    $r = gw_http('https://lynxpix.cc/api/v1/pixQrCode/create', 'POST', [
        'Authorization: Bearer ' . trim($apiKey),
        'Content-Type: application/json',
        'Accept: application/json',
    ], ['amountCents' => (int)round($amount * 100), 'description' => mb_substr($description, 0, 140), 'expiresIn' => 3600, 'metadata' => $metadata]);
    if ($r['error']) return ['error' => true, 'message' => 'LynxPix: ' . $r['message']];
    if ($r['code'] === 401) return ['error' => true, 'message' => 'LynxPix: chave de API inválida ou revogada.'];
    if ($r['code'] < 200 || $r['code'] >= 300) {
        $d = $r['data'];
        $m = (string)(($d['error']['message'] ?? $d['error'] ?? $d['message'] ?? ''));
        return ['error' => true, 'message' => 'LynxPix recusou (HTTP ' . $r['code'] . ')' . ($m !== '' ? ': ' . mb_substr($m, 0, 120) : '.')];
    }
    $d = $r['data']['data'] ?? $r['data'];
    if (empty($d['id']) || empty($d['brCode'])) return ['error' => true, 'message' => 'LynxPix não devolveu o QR Code.'];
    $img = (string)($d['brCodeBase64'] ?? '');
    if ($img !== '' && strpos($img, 'data:') !== 0) $img = 'data:image/png;base64,' . $img;
    return ['error' => false, 'data' => ['qr_code' => (string)$d['brCode'], 'qr_code_base64' => $img, 'charge_id' => (string)$d['id']]];
}

// ---------- Efí (ex-Gerencianet): cobrança Pix ----------
// OAuth client_id:client_secret → access_token; POST /v2/cob {calendario,
// valor, chave (a chave Pix da conta Efí), solicitacaoPagador}; depois
// GET /v2/loc/{id}/qrcode → {qrcode, imagemQrcode}. Em PRODUÇÃO a Efí
// exige o certificado .p12 (mTLS) no caminho configurado no admin; sem
// ele, a autenticação falha — a mensagem de erro avisa isso.
function efi_create_pix($settings, $amount, $description) {
    $cid = trim($settings['efi_client_id'] ?? '');
    $csec = trim($settings['efi_client_secret'] ?? '');
    if ($cid === '' || $csec === '') return ['error' => true, 'message' => 'Efí: client_id ou client_secret não configurados no admin (aba Pagamentos).'];
    $pixKey = trim($settings['pix_key'] ?? '');
    if ($pixKey === '') return ['error' => true, 'message' => 'Efí: preencha "Sua chave Pix" no admin — é a chave recebedora da conta Efí.'];
    $cert = trim($settings['efi_cert_path'] ?? '');
    $base = 'https://api.efipay.com.br';
    $tok = gw_http($base . '/oauth/token', 'POST', [
        'Authorization: Basic ' . base64_encode($cid . ':' . $csec),
        'Content-Type: application/json',
    ], ['grant_type' => 'client_credentials'], $cert);
    if ($tok['error'] || $tok['code'] >= 400 || empty($tok['data']['access_token'])) {
        $hint = $cert === '' ? ' Em produção a Efí exige o certificado .p12 — preencha o caminho dele no admin.' : ' Confira o certificado .p12 e as credenciais.';
        return ['error' => true, 'message' => 'Efí: falha ao autenticar (HTTP ' . $tok['code'] . ').' . $hint];
    }
    $at = $tok['data']['access_token'];
    $cob = gw_http($base . '/v2/cob', 'POST', [
        'Authorization: Bearer ' . $at,
        'Content-Type: application/json',
    ], [
        'calendario' => ['expiracao' => 3600],
        'valor' => ['original' => number_format((float)$amount, 2, '.', '')],
        'chave' => $pixKey,
        'solicitacaoPagador' => mb_substr($description, 0, 140),
    ], $cert);
    if ($cob['error'] || $cob['code'] >= 400 || empty($cob['data']['loc']['id'])) {
        $d = $cob['data'];
        $m = (string)(($d['mensagem'] ?? $d['message'] ?? ''));
        return ['error' => true, 'message' => 'Efí: não foi possível criar a cobrança (HTTP ' . $cob['code'] . ')' . ($m !== '' ? ': ' . mb_substr($m, 0, 120) : '.')];
    }
    $locId = (int)$cob['data']['loc']['id'];
    $qr = gw_http($base . '/v2/loc/' . $locId . '/qrcode', 'GET', [
        'Authorization: Bearer ' . $at,
        'Content-Type: application/json',
    ], null, $cert);
    if ($qr['error'] || $qr['code'] >= 400 || empty($qr['data']['qrcode'])) {
        return ['error' => true, 'message' => 'Efí: cobrança criada, mas o QR Code não voltou. Tente de novo.'];
    }
    return ['error' => false, 'data' => [
        'qr_code' => (string)$qr['data']['qrcode'],
        'qr_code_base64' => (string)($qr['data']['imagemQrcode'] ?? ''),
        'charge_id' => (string)($cob['data']['txid'] ?? ''),
    ]];
}

// ---------- Asaas: cobrança Pix ----------
// API por token (header access_token). Precisa de um customer: busca por
// e-mail e cria se não existir. POST /v3/payments {customer, billingType
// PIX, value, dueDate, description, externalReference}; depois
// GET /v3/payments/{id}/pixQrCode → {payload, encodedImage}.
function asaas_create_pix($apiKey, $sandbox, $amount, $email, $name, $description, $externalRef) {
    if (trim($apiKey) === '') return ['error' => true, 'message' => 'Asaas: chave de API não configurada no admin (aba Pagamentos).'];
    $base = $sandbox ? 'https://api-sandbox.asaas.com' : 'https://api.asaas.com';
    $h = ['access_token: ' . trim($apiKey), 'Content-Type: application/json'];
    $fail = function ($r, $what) {
        $d = $r['data'];
        $errs = $d['errors'] ?? [];
        $m = '';
        if (is_array($errs) && !empty($errs[0]['description'])) $m = (string)$errs[0]['description'];
        elseif (!empty($d['message'])) $m = (string)$d['message'];
        return ['error' => true, 'message' => 'Asaas: ' . $what . ' (HTTP ' . $r['code'] . ')' . ($m !== '' ? ': ' . mb_substr($m, 0, 140) : '.')];
    };
    $found = gw_http($base . '/v3/customers?email=' . urlencode($email), 'GET', $h);
    if ($found['error'] || $found['code'] >= 400) return $fail($found, 'não foi possível buscar o cliente');
    $cusId = $found['data']['data'][0]['id'] ?? null;
    if (!$cusId) {
        $created = gw_http($base . '/v3/customers', 'POST', $h, ['name' => $name !== '' ? $name : $email, 'email' => $email]);
        if ($created['error'] || $created['code'] >= 400 || empty($created['data']['id'])) return $fail($created, 'não foi possível criar o cliente');
        $cusId = $created['data']['id'];
    }
    $pay = gw_http($base . '/v3/payments', 'POST', $h, [
        'customer' => $cusId,
        'billingType' => 'PIX',
        'value' => (float)$amount,
        'dueDate' => date('Y-m-d', strtotime('+1 day')),
        'description' => mb_substr($description, 0, 140),
        'externalReference' => $externalRef,
    ]);
    if ($pay['error'] || $pay['code'] >= 400 || empty($pay['data']['id'])) return $fail($pay, 'não foi possível criar a cobrança');
    $qr = gw_http($base . '/v3/payments/' . rawurlencode((string)$pay['data']['id']) . '/pixQrCode', 'GET', $h);
    if ($qr['error'] || $qr['code'] >= 400 || empty($qr['data']['payload'])) return $fail($qr, 'cobrança criada, mas o QR Code não voltou');
    $img = (string)($qr['data']['encodedImage'] ?? '');
    if ($img !== '' && strpos($img, 'data:') !== 0) $img = 'data:image/png;base64,' . $img;
    return ['error' => false, 'data' => [
        'qr_code' => (string)$qr['data']['payload'],
        'qr_code_base64' => $img,
        'charge_id' => (string)$pay['data']['id'],
    ]];
}

// ---------- ações ----------
switch ($action) {
    case 'test_connection':
        api_require_admin();
        // Valores digitados no formulário do admin (POST) têm prioridade: o
        // teste usa a URL NOVA, não só a salva. Sem POST, usa o salvo.
        // Com proxy configurado, o teste passa pelo proxy com ?panel=<URL
        // digitada> — sem isso o proxy testaria o painel antigo (o fixo dele).
        $tUrl = normalize_panel_url(trim($_POST['sigma_url'] ?? $settings['sigma_url'] ?? ''));
        $tUser = trim($_POST['sigma_username'] ?? $settings['sigma_username'] ?? '');
        $tPass = trim($_POST['sigma_password'] ?? $settings['sigma_password'] ?? '');
        $tProxy = trim($_POST['panel_proxy'] ?? $settings['panel_proxy'] ?? '');
        $testBase = $tProxy !== '' ? rtrim($tProxy, '/') : $tUrl;
        $panelParam = $tProxy !== '' ? '&panel=' . urlencode($tUrl) : '';
        $url = $testBase . "/player_api.php?username=" . urlencode($tUser) . "&password=" . urlencode($tPass) . $panelParam;
        $res = call_sigma($url);
        if ($res['error']) {
            echo json_encode(['success' => false, 'message' => 'Falha ao conectar: ' . $res['message']]);
        } else {
            $data = $res['data'];
            if (isset($data['user_info']['auth']) && $data['user_info']['auth'] == 1) {
                echo json_encode([
                    'success' => true,
                    'message' => 'Conexão bem sucedida com o Sigma!',
                    'status' => $data['user_info']['status'] ?? 'Active',
                    'exp_date' => isset($data['user_info']['exp_date']) ? date('d/m/Y H:i', $data['user_info']['exp_date']) : 'Ilimitado',
                    'active_cons' => $data['user_info']['active_cons'] ?? 0,
                    'max_connections' => $data['user_info']['max_connections'] ?? 1
                ]);
            } else {
                echo json_encode(['success' => false, 'message' => 'Servidor respondeu, mas usuário ou senha inválidos.']);
            }
        }
        break;

    case 'get_live_categories':
        api_require_login();
        echo json_encode(filter_adult_categories(catalog_list($settings, 'get_live_categories', '', 'cat_live')));
        break;

    case 'get_vod_categories':
        api_require_login();
        echo json_encode(filter_adult_categories(catalog_list($settings, 'get_vod_categories', '', 'cat_vod')));
        break;

    case 'get_series_categories':
        api_require_login();
        echo json_encode(filter_adult_categories(catalog_list($settings, 'get_series_categories', '', 'cat_series')));
        break;

    case 'get_live_streams':
        api_require_login();
        $catId = $_GET['category_id'] ?? '';
        $extra = $catId !== '' ? '&category_id=' . urlencode($catId) : '';
        $key = 'live' . ($catId !== '' ? '_' . preg_replace('/[^0-9]/', '', $catId) : '');
        echo json_encode(filter_adult_items(catalog_list($settings, 'get_live_streams', $extra, $key), 'live', $settings));
        break;

    case 'get_vod_streams':
        api_require_login();
        $catId = $_GET['category_id'] ?? '';
        $extra = $catId !== '' ? '&category_id=' . urlencode($catId) : '';
        $key = 'vod' . ($catId !== '' ? '_' . preg_replace('/[^0-9]/', '', $catId) : '');
        echo json_encode(filter_adult_items(catalog_list($settings, 'get_vod_streams', $extra, $key), 'vod', $settings));
        break;

    case 'get_series':
        api_require_login();
        $catId = $_GET['category_id'] ?? '';
        $extra = $catId !== '' ? '&category_id=' . urlencode($catId) : '';
        $key = 'series' . ($catId !== '' ? '_' . preg_replace('/[^0-9]/', '', $catId) : '');
        echo json_encode(filter_adult_items(catalog_list($settings, 'get_series', $extra, $key), 'series', $settings));
        break;

    case 'refresh_catalog':
        // Atualização do cache em 2º plano (stale-while-revalidate): chamado
        // pelo catalog_list quando o cache está velho. Quem chamou já
        // respondeu com o cache velho — este pedido só regrava os arquivos.
        // Roda até o fim mesmo se quem disparou desligar (ignore_user_abort);
        // cada lista leva até 60s no painel, 6 listas no pior caso.
        api_require_login();
        ignore_user_abort(true);
        set_time_limit(0);
        $refreshMap = [
            'vod' => ['get_vod_streams', ''],
            'series' => ['get_series', ''],
            'live' => ['get_live_streams', ''],
            'cat_vod' => ['get_vod_categories', ''],
            'cat_series' => ['get_series_categories', ''],
            'cat_live' => ['get_live_categories', ''],
        ];
        foreach ($refreshMap as $refreshKey => $spec) {
            [$refreshAction, $refreshExtra] = $spec;
            $refreshRes = call_sigma(sigma_url($settings, $refreshAction, $refreshExtra), 60);
            if (!$refreshRes['error'] && !empty($refreshRes['data']) && is_array($refreshRes['data'])) {
                catalog_cache_put($refreshKey, $refreshRes['data']);
            }
        }
        @unlink(CATALOG_CACHE_DIR . '/refresh.lock');
        echo json_encode(['ok' => true]);
        break;

    case 'get_vod_info':
        api_require_login();
        $vodId = $_GET['vod_id'] ?? '';
        if (!ctype_digit((string)$vodId)) api_error('vod_id inválido.', 400);
        $res = call_sigma(sigma_url($settings, 'get_vod_info', '&vod_id=' . urlencode($vodId)));
        if ($res['error']) {
            echo json_encode(['error' => true, 'message' => 'Não foi possível carregar os detalhes.']);
        } else {
            echo json_encode($res['data']);
        }
        break;

    case 'get_series_info':
        api_require_login();
        $seriesId = $_GET['series_id'] ?? '';
        if (!ctype_digit((string)$seriesId)) api_error('series_id inválido.', 400);
        $res = call_sigma(sigma_url($settings, 'get_series_info', '&series_id=' . urlencode($seriesId)));
        if ($res['error']) {
            echo json_encode(['error' => true, 'message' => 'Não foi possível carregar os episódios.']);
        } else {
            echo json_encode($res['data']);
        }
        break;

    case 'create_order':
        api_require_login();
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') api_error('Método inválido.', 405);
        $user = current_user($pdo);
        if (!$user) api_error('Login necessário.', 401);
        $planId = intval(api_post_field('plan_id', 0));
        $stmt = $pdo->prepare("SELECT * FROM plans WHERE id = ? AND active = 1 LIMIT 1");
        $stmt->execute([$planId]);
        $plan = $stmt->fetch();
        if (!$plan) api_error('Plano inválido.', 400);
        // WhatsApp opcional do checkout
        $wa = trim((string)api_post_field('whatsapp', ''));
        if ($wa !== '' && $wa !== ($user['whatsapp'] ?? '')) {
            $pdo->prepare("UPDATE users SET whatsapp = ? WHERE id = ?")->execute([$wa, $user['id']]);
        }
        // Gateway selecionado no admin (aba Pagamentos). 'mp' sem token cai
        // para manual (comportamento antigo); os outros sem credencial
        // devolvem erro legível — nunca caem em silêncio para o manual.
        $gw = (string)($settings['payment_gateway'] ?? 'mp');
        if (!in_array($gw, ['mp', 'lynx', 'efi', 'asaas', 'manual'], true)) $gw = 'mp';
        if ($gw === 'mp' && empty($settings['mp_access_token'])) $gw = 'manual';
        // "Gerar novo Pix": o usuário pediu um QR novo — pula o reaproveitamento
        // do pedido pendente e chama o gateway de novo (sem isso o botão
        // devolvia o QR antigo, que podia ser de outra configuração).
        $forceNew = !empty(api_post_field('force_new', ''));
        // Reaproveita pedido pendente recente do MESMO plano e MESMO
        // gateway (evita duplicar QR). Pedido manual não tem QR, então
        // não entra aqui — cada clique gera um pedido novo p/ aprovar.
        $stmt = $pdo->prepare("SELECT * FROM orders WHERE user_id = ? AND plan_id = ? AND status = 'pending' AND gateway = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 30 MINUTE) ORDER BY id DESC LIMIT 1");
        $stmt->execute([$user['id'], $planId, $gw]);
        $existing = $stmt->fetch();
        if (!$forceNew && $existing && !empty($existing['pix_code'])) {
            echo json_encode([
                'success' => true, 'ok' => true, 'mode' => $gw, 'order_id' => (int)$existing['id'],
                'amount' => (float)$existing['amount'], 'plan_name' => $plan['name'],
                'qr_code' => $existing['pix_code'], 'qr_code_base64' => $existing['pix_qr_url'] ?: null,
                'pix_code' => $existing['pix_code'], 'pix_qr_url' => $existing['pix_qr_url'] ?: null,
                'pix_key' => ($settings['pix_key'] ?? '') ?: null,
                'pix_fixed_code' => ($settings['pix_fixed_code'] ?? '') ?: null,
                'pix_fixed_qr' => ($settings['pix_fixed_qr'] ?? '') ?: null,
                'pix_beneficiary' => ($settings['pix_beneficiary'] ?? '') ?: null,
            ]);
            break;
        }
        $pdo->prepare("INSERT INTO orders (user_id, plan_id, amount, status, gateway) VALUES (?, ?, ?, 'pending', ?)")->execute([$user['id'], $planId, $plan['price'], $gw]);
        $orderId = (int)$pdo->lastInsertId();
        if ($gw === 'manual') {
            // Pix fixo: o cliente paga com o QR/copia-e-cola do admin e o
            // admin aprova na aba Vendas & Pix.
            echo json_encode([
                'success' => true, 'ok' => true, 'mode' => 'manual', 'order_id' => $orderId,
                'amount' => (float)$plan['price'], 'plan_name' => $plan['name'],
                'qr_code' => null, 'qr_code_base64' => null,
                'pix_code' => null, 'pix_qr_url' => null,
                'pix_key' => ($settings['pix_key'] ?? '') ?: null,
                'pix_fixed_code' => ($settings['pix_fixed_code'] ?? '') ?: null,
                'pix_fixed_qr' => ($settings['pix_fixed_qr'] ?? '') ?: null,
                'pix_beneficiary' => ($settings['pix_beneficiary'] ?? '') ?: null,
            ]);
            break;
        }
        $desc = 'CinePlus - Plano ' . $plan['name'];
        $extRef = 'cineplus-order-' . $orderId;
        if ($gw === 'mp') {
            $res = mp_create_pix(($settings['mp_access_token'] ?? ''), (float)$plan['price'], $user['email'], $desc, $extRef);
        } elseif ($gw === 'lynx') {
            $res = lynx_create_pix(($settings['lynx_api_key'] ?? ''), (float)$plan['price'], $desc, ['order_id' => $orderId, 'user_id' => (int)$user['id']]);
        } elseif ($gw === 'efi') {
            $res = efi_create_pix($settings, (float)$plan['price'], $desc);
        } else { // asaas
            $res = asaas_create_pix(($settings['asaas_api_key'] ?? ''), !empty($settings['asaas_sandbox']), (float)$plan['price'], $user['email'], (string)($user['name'] ?? ''), $desc, $extRef);
        }
        if ($res['error']) {
            // O pedido falho é cancelado: sem isso ele ficava 'pending'
            // para sempre e o cliente achava que o pagamento estava a caminho.
            $pdo->prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?")->execute([$orderId]);
            echo json_encode(['success' => false, 'ok' => false, 'message' => $res['message'], 'error' => $res['message']]);
            break;
        }
        $qrCode = $res['data']['qr_code'] ?? '';
        $qrB64 = $res['data']['qr_code_base64'] ?? '';
        $pdo->prepare("UPDATE orders SET pix_code = ?, pix_qr_url = ? WHERE id = ?")->execute([$qrCode, $qrB64, $orderId]);
        echo json_encode([
            'success' => true, 'ok' => true, 'mode' => $gw, 'order_id' => $orderId,
            'amount' => (float)$plan['price'], 'plan_name' => $plan['name'],
            'qr_code' => $qrCode, 'qr_code_base64' => $qrB64 ?: null,
            'pix_code' => $qrCode, 'pix_qr_url' => $qrB64 ?: null,
            'pix_key' => null,
            'pix_fixed_code' => null, 'pix_fixed_qr' => null, 'pix_beneficiary' => null,
        ]);
        break;

    case 'test_gateway':
        // Admin testa as credenciais do gateway selecionado SEM criar
        // cobrança (o usuário colou o token e o Pix "não saiu" — aqui ele
        // vê na hora se a chave é válida ou não, antes de qualquer cliente).
        api_require_admin();
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') api_error('Método inválido.', 405);
        $gwT = trim((string)api_post_field('gateway', (string)($settings['payment_gateway'] ?? 'mp')));
        if (!in_array($gwT, ['mp', 'lynx', 'efi', 'asaas', 'manual'], true)) $gwT = 'mp';
        // Permite testar os valores DIGITADOS no formulário (ainda não
        // salvos): o admin cola a chave, testa, e só depois salva.
        $tok = function ($key) use ($settings) {
            $v = trim((string)api_post_field($key, ''));
            return $v !== '' ? $v : trim((string)($settings[$key] ?? ''));
        };
        if ($gwT === 'manual') {
            $hasKey = trim((string)api_post_field('pix_key', (string)($settings['pix_key'] ?? ''))) !== ''
                || trim((string)api_post_field('pix_fixed_code', (string)($settings['pix_fixed_code'] ?? ''))) !== ''
                || trim((string)api_post_field('pix_fixed_qr', (string)($settings['pix_fixed_qr'] ?? ''))) !== '';
            echo json_encode($hasKey
                ? ['ok' => true, 'message' => 'Pix fixo configurado: o cliente verá o QR/código e a chave na tela de planos.']
                : ['ok' => false, 'error' => 'Nada configurado: preencha a chave Pix, o copia e cola ou a imagem do QR fixo.']);
            break;
        }
        if ($gwT === 'mp') {
            $t = $tok('mp_access_token');
            if ($t === '') { echo json_encode(['ok' => false, 'error' => 'Cole o token de acesso do Mercado Pago.']); break; }
            $r = gw_http('https://api.mercadopago.com/v1/payments/search?limit=1', 'GET', ['Authorization: Bearer ' . $t, 'Content-Type: application/json']);
            if ($r['error']) { echo json_encode(['ok' => false, 'error' => 'Mercado Pago sem resposta.']); break; }
            echo json_encode($r['code'] === 401
                ? ['ok' => false, 'error' => 'Token inválido ou expirado. Gere um novo em Mercado Pago → Suas integrações → Credenciais.']
                : (['ok' => true, 'message' => 'Token do Mercado Pago válido. O Pix vai gerar o QR de verdade.']));
            break;
        }
        if ($gwT === 'lynx') {
            $t = $tok('lynx_api_key');
            if ($t === '') { echo json_encode(['ok' => false, 'error' => 'Cole a chave de API da LynxPix.']); break; }
            $r = gw_http('https://lynxpix.cc/api/v1/pixQrCode/check?id=' . rawurlencode('lynx_teste_chave'), 'GET', ['Authorization: Bearer ' . $t, 'Content-Type: application/json', 'Accept: application/json']);
            if ($r['error']) { echo json_encode(['ok' => false, 'error' => 'LynxPix sem resposta.']); break; }
            echo json_encode($r['code'] === 401
                ? ['ok' => false, 'error' => 'Chave de API inválida ou revogada.']
                : (['ok' => true, 'message' => 'Chave da LynxPix válida. O cliente verá como recebedor o nome da empresa agregadora.']));
            break;
        }
        if ($gwT === 'efi') {
            $cid = $tok('efi_client_id');
            $csec = $tok('efi_client_secret');
            if ($cid === '' || $csec === '') { echo json_encode(['ok' => false, 'error' => 'Preencha o client_id e o client_secret da Efí.']); break; }
            $cert = trim((string)api_post_field('efi_cert_path', (string)($settings['efi_cert_path'] ?? '')));
            $r = gw_http('https://api.efipay.com.br/oauth/token', 'POST', [
                'Authorization: Basic ' . base64_encode($cid . ':' . $csec),
                'Content-Type: application/json',
            ], ['grant_type' => 'client_credentials'], $cert);
            if ($r['error'] || $r['code'] >= 400 || empty($r['data']['access_token'])) {
                $hint = $cert === '' ? ' Em produção a Efí exige o certificado .p12 — preencha o caminho dele.' : ' Confira o certificado .p12 e as credenciais.';
                echo json_encode(['ok' => false, 'error' => 'Efí não autenticou (HTTP ' . $r['code'] . ').' . $hint]);
                break;
            }
            echo json_encode(['ok' => true, 'message' => 'Credenciais da Efí válidas.']);
            break;
        }
        // asaas
        $t = $tok('asaas_api_key');
        if ($t === '') { echo json_encode(['ok' => false, 'error' => 'Cole a chave de API do Asaas.']); break; }
        $sandbox = api_post_field('asaas_sandbox', '') !== '' ? (bool)api_post_field('asaas_sandbox') : !empty($settings['asaas_sandbox']);
        $base = $sandbox ? 'https://api-sandbox.asaas.com' : 'https://api.asaas.com';
        $r = gw_http($base . '/v3/customers?limit=1', 'GET', ['access_token: ' . $t, 'Content-Type: application/json']);
        if ($r['error']) { echo json_encode(['ok' => false, 'error' => 'Asaas sem resposta.']); break; }
        if ($r['code'] === 401) { echo json_encode(['ok' => false, 'error' => 'Chave de API inválida. Confira se a chave é do ambiente certo (produção x sandbox).']); break; }
        echo json_encode(['ok' => true, 'message' => 'Chave do Asaas válida (' . ($sandbox ? 'sandbox' : 'produção') . ').']);
        break;

    case 'rate':
        api_require_login();
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') api_error('Método inválido.', 405);
        $user = current_user($pdo);
        $rateType = (string)api_post_field('type', '');
        $type = in_array($rateType, ['movie', 'series', 'live'], true) ? $rateType : 'movie';
        $streamId = intval(api_post_field('stream_id', 0));
        $rating = intval(api_post_field('rating', 0));
        if ($streamId <= 0 || $rating < 1 || $rating > 5) api_error('Avaliação inválida.', 400);
        $pdo->prepare("INSERT INTO user_ratings (user_id, stream_type, stream_id, rating) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE rating = VALUES(rating)")->execute([$user['id'], $type, $streamId, $rating]);
        echo json_encode(['success' => true, 'rating' => $rating]);
        break;

    case 'my_rating':
        api_require_login();
        $user = current_user($pdo);
        $type = in_array($_GET['type'] ?? '', ['movie', 'series', 'live'], true) ? $_GET['type'] : 'movie';
        $streamId = intval($_GET['stream_id'] ?? 0);
        $stmt = $pdo->prepare("SELECT rating FROM user_ratings WHERE user_id = ? AND stream_type = ? AND stream_id = ? LIMIT 1");
        $stmt->execute([$user['id'], $type, $streamId]);
        $r = $stmt->fetchColumn();
        echo json_encode(['success' => true, 'rating' => $r === false ? 0 : (int)$r]);
        break;

    case 'save_pix_key':
        api_require_login();
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') api_error('Método inválido.', 405);
        $user = current_user($pdo);
        $pixKey = trim((string)api_post_field('pix_key', ''));
        $pdo->prepare("UPDATE users SET pix_key = ? WHERE id = ?")->execute([$pixKey, $user['id']]);
        echo json_encode(['success' => true]);
        break;

    case 'adult_unlock':
        api_require_login();
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') api_error('Método inválido.', 405);
        if (!empty($_SESSION['profile_kids'])) {
            echo json_encode(['success' => false, 'message' => 'Conteúdo adulto indisponível no perfil infantil.']);
            break;
        }
        $user = current_user($pdo);
        $pass = (string)api_post_field('password', '');
        if ($user && password_verify($pass, $user['password'])) {
            session_start();
            $_SESSION['adult_ok'] = 1;
            session_write_close();
            echo json_encode(['success' => true]);
        } else {
            echo json_encode(['success' => false, 'message' => 'Senha incorreta.']);
        }
        break;

    case 'public_catalog':
        // Catálogo público (como o da CinePlus): sem login, sem conteúdo adulto,
        // só campos de exibição — nunca URLs de stream nem credenciais.
        $pubMovies = filter_adult_items(catalog_list($settings, 'get_vod_streams', '', 'vod'), 'vod', $settings, true);
        $pubSeries = filter_adult_items(catalog_list($settings, 'get_series', '', 'series'), 'series', $settings, true);
        $pubLive = filter_adult_items(catalog_list($settings, 'get_live_streams', '', 'live'), 'live', $settings, true);
        $pubMap = function ($items, $kind, $max) {
            $out = [];
            foreach ((array)$items as $it) {
                if (count($out) >= $max) break;
                if ($kind === 'movie') {
                    $out[] = ['id' => $it['stream_id'] ?? null, 'title' => $it['name'] ?? '', 'img' => $it['stream_icon'] ?? '', 'year' => $it['year'] ?? '', 'rating' => $it['rating_5based'] ?? $it['rating'] ?? ''];
                } elseif ($kind === 'series') {
                    $yr = isset($it['releaseDate']) ? substr((string)$it['releaseDate'], 0, 4) : ($it['year'] ?? '');
                    $out[] = ['id' => $it['series_id'] ?? null, 'title' => $it['name'] ?? '', 'img' => $it['cover'] ?? '', 'year' => $yr, 'rating' => $it['rating_5based'] ?? $it['rating'] ?? ''];
                } else {
                    $out[] = ['id' => $it['stream_id'] ?? null, 'title' => $it['name'] ?? '', 'img' => $it['stream_icon'] ?? ''];
                }
            }
            return $out;
        };
        echo json_encode([
            'movies' => $pubMap($pubMovies, 'movie', 300),
            'series' => $pubMap($pubSeries, 'series', 150),
            'live' => $pubMap($pubLive, 'live', 100)
        ]);
        break;

    case 'get_epg':
        // Guia de programação do canal (Xtream get_short_epg): programa atual + próximo.
        api_require_login();
        $streamId = $_GET['stream_id'] ?? '';
        if (!ctype_digit((string)$streamId)) api_error('stream_id inválido.', 400);
        $res = call_sigma(sigma_url($settings, 'get_short_epg', '&stream_id=' . urlencode($streamId) . '&limit=3'));
        if ($res['error']) {
            echo json_encode(['success' => false, 'message' => 'Programação indisponível.']);
            break;
        }
        $list = $res['data']['epg_listings'] ?? [];
        $now = time();
        $cur = null;
        $next = null;
        foreach ((array)$list as $e) {
            $start = intval($e['start_timestamp'] ?? 0);
            $stop = intval($e['stop_timestamp'] ?? 0);
            // O Xtream devolve título e descrição em base64 — mas só usa o
            // decodificado se for texto UTF-8 legível: um título em texto puro
            // pode ser um base64 válido por acaso (ex.: "Cine") e virar lixo.
            $title = trim((string)($e['title'] ?? ''));
            $dec = base64_decode($title, true);
            if ($dec !== false && $dec !== '' && preg_match('//u', $dec) && !preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', $dec)) $title = $dec;
            $desc = trim((string)($e['description'] ?? ''));
            $decD = base64_decode($desc, true);
            if ($decD !== false && $decD !== '' && preg_match('//u', $decD) && !preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', $decD)) $desc = $decD;
            $item = ['title' => $title, 'description' => $desc, 'start' => $start, 'stop' => $stop];
            if ($start && $stop && $start <= $now && $now < $stop) $cur = $item;
            elseif ($start > $now && !$next) $next = $item;
        }
        echo json_encode(['success' => true, 'now' => $cur, 'next' => $next]);
        break;

    case 'referral_stats':
        api_require_login();
        $user = current_user($pdo);
        if (!$user) api_error('Login necessário.', 401);
        $stmt = $pdo->prepare("SELECT COUNT(*) FROM users WHERE referred_by = ?");
        $stmt->execute([$user['id']]);
        $indicated = (int)$stmt->fetchColumn();
        $stmt = $pdo->prepare("SELECT COALESCE(SUM(amount), 0) FROM commissions WHERE affiliate_id = ? AND status = 'pending'");
        $stmt->execute([$user['id']]);
        $pending = (float)$stmt->fetchColumn();
        $stmt = $pdo->prepare("SELECT COALESCE(SUM(amount), 0) FROM commissions WHERE affiliate_id = ? AND status = 'paid'");
        $stmt->execute([$user['id']]);
        $paid = (float)$stmt->fetchColumn();
        echo json_encode(['success' => true, 'indicated' => $indicated, 'pending' => $pending, 'paid' => $paid]);
        break;

    case 'order_status':
        api_require_login();
        $user = current_user($pdo);
        if (!$user) api_error('Login necessário.', 401);
        $orderId = intval($_GET['order_id'] ?? 0);
        $stmt = $pdo->prepare("SELECT status FROM orders WHERE id = ? AND user_id = ? LIMIT 1");
        $stmt->execute([$orderId, $user['id']]);
        $st = $stmt->fetchColumn();
        echo json_encode(['success' => true, 'status' => $st ?: 'not_found']);
        break;

    // ---------- actions NOFLIX (JSON; não alteram as actions existentes) ----------
    case 'me':
        // GET, sem login obrigatório.
        $meUser = current_user($pdo);
        echo json_encode([
            'loggedIn' => $meUser !== null,
            // Sessão única (tudo20): a sessão tinha user_id mas o token não
            // bateu com o do banco — outro aparelho entrou depois e esta
            // sessão foi encerrada. O app mostra a mensagem e volta ao login.
            'sessionEnded' => !empty($GLOBALS['session_token_mismatch']),
            'user' => $meUser ? api_public_user($pdo, $meUser) : null,
            'canWatch' => user_can_watch($meUser),
            // Suporte (contato do admin): público, é o botão "Suporte" do app.
            'support' => [
                'whatsapp' => trim((string)($settings['support_whatsapp'] ?? '')),
                'telegram' => trim((string)($settings['support_telegram'] ?? '')),
            ],
            // Notificação de título quebrado (tudo29): SÓ um booleano — o
            // token do bot NUNCA sai do servidor. O app mostra o botão
            // "Avisar que não funcionou" na tela de erro de reprodução só
            // quando o dono configurou token + chat ID no admin.
            'reportBroken' => trim((string)($settings['telegram_notify_token'] ?? '')) !== '' && trim((string)($settings['telegram_notify_chat_id'] ?? '')) !== '',
        ]);
        break;

    case 'report_broken':
        // POST — cliente logado avisa que um título não tocou; o dono
        // recebe no Telegram (token + chat ID do admin, aba Servidor
        // Sigma, seção Notificações Telegram).
        // Segurança: o token NUNCA aparece na resposta nem no log; só
        // usuário logado passa; 1 aviso por título por sessão (a chave
        // fica na $_SESSION — a sessão foi fechada no topo do arquivo,
        // por isso ela é reaberta aqui, como o adult_unlock faz).
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            api_auth_error('Método inválido.', 405);
            break;
        }
        api_require_login();
        $repUser = current_user($pdo);
        if (!$repUser) api_error('Login necessário.', 401);
        $repToken = trim((string)($settings['telegram_notify_token'] ?? ''));
        $repChat = trim((string)($settings['telegram_notify_chat_id'] ?? ''));
        if ($repToken === '' || $repChat === '') {
            echo json_encode(['ok' => false, 'error' => 'not_configured']);
            break;
        }
        $repTitle = trim((string)api_post_field('title', ''));
        $repKind = api_post_field('kind', 'movie') === 'series' ? 'series' : 'movie';
        $repYear = intval(api_post_field('year', 0));
        $repPanelId = intval(api_post_field('panel_id', 0));
        $repSeason = intval(api_post_field('season', 0));
        $repEpisode = intval(api_post_field('episode', 0));
        if ($repTitle === '') {
            api_auth_error('Título não informado.', 400);
            break;
        }
        $repKey = $repKind . ':' . ($repPanelId > 0 ? (string)$repPanelId : md5($repTitle . '|' . $repYear)) . ($repKind === 'series' && $repSeason > 0 ? ':S' . $repSeason . 'E' . $repEpisode : '');
        if (session_status() !== PHP_SESSION_ACTIVE) session_start();
        if (!isset($_SESSION['reported_broken']) || !is_array($_SESSION['reported_broken'])) $_SESSION['reported_broken'] = [];
        if (!empty($_SESSION['reported_broken'][$repKey])) {
            session_write_close();
            echo json_encode(['ok' => true, 'already' => true]);
            break;
        }
        // Mensagem para o dono: nome do título, tipo, ano, quem reportou
        // (perfil + e-mail da conta logada) e a data/hora do aviso.
        $repLabel = $repKind === 'series' ? 'série' : 'filme';
        $repWhat = $repTitle . ($repYear > 0 ? ' (' . $repYear . ', ' . $repLabel . ')' : ' (' . $repLabel . ')');
        if ($repKind === 'series' && $repSeason > 0 && $repEpisode > 0) {
            $repWhat = $repTitle . ' — S' . $repSeason . ' E' . $repEpisode . ($repYear > 0 ? ' (' . $repYear . ', série)' : ' (série)');
        }
        $repName = trim((string)($repUser['name'] ?? ''));
        $repEmail = trim((string)($repUser['email'] ?? ''));
        $repText = "🎬 Título não funcionou: " . $repWhat . "\n👤 Reportado por: " . ($repName !== '' ? $repName : 'cliente') . " (" . $repEmail . ")\n🕐 " . date('d/m/Y H:i');
        // tudo35: envio IGUAL ao bot de notificações do dono (bot.py,
        // enviar_telegram_notificacao): mesmo endpoint, POST form-encoded,
        // parse_mode=HTML + disable_web_page_preview. O texto é escapado
        // para HTML — título/nome podem ter "&" ou "<", e sem escape o
        // Telegram devolve 400 com parse_mode=HTML.
        $repTextHtml = htmlspecialchars($repText, ENT_QUOTES, 'UTF-8');
        // Envio pela API do Telegram (10s de timeout). O token vai só na
        // URL da chamada servidor→Telegram — nunca em resposta, log ou front.
        $repCh = curl_init();
        curl_setopt($repCh, CURLOPT_URL, 'https://api.telegram.org/bot' . $repToken . '/sendMessage');
        curl_setopt($repCh, CURLOPT_POST, true);
        curl_setopt($repCh, CURLOPT_POSTFIELDS, http_build_query(['chat_id' => $repChat, 'text' => $repTextHtml, 'parse_mode' => 'HTML', 'disable_web_page_preview' => 'true']));
        curl_setopt($repCh, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($repCh, CURLOPT_TIMEOUT, 10);
        curl_setopt($repCh, CURLOPT_CONNECTTIMEOUT, 5);
        $repResp = curl_exec($repCh);
        $repHttp = (int)curl_getinfo($repCh, CURLINFO_RESPONSE_CODE);
        $repErr = curl_error($repCh);
        curl_close($repCh);
        $repSent = $repResp !== false && $repHttp === 200;
        if ($repSent) {
            $repDecoded = json_decode((string)$repResp, true);
            $repSent = !empty($repDecoded['ok']);
        }
        if ($repSent) {
            // Só marca como enviado quando o Telegram confirmou — se a
            // entrega falhar, o cliente pode tentar de novo (a notificação
            // nunca chegou ao dono).
            $_SESSION['reported_broken'][$repKey] = time();
            session_write_close();
            echo json_encode(['ok' => true]);
        } else {
            session_write_close();
            // tudo35: registra o motivo do Telegram (só a descrição do
            // erro — nunca o token) para o diagnóstico não ficar no escuro.
            $repDetail = '';
            if ($repResp !== false && $repResp !== '') {
                $repDecodedErr = json_decode((string)$repResp, true);
                if (is_array($repDecodedErr) && !empty($repDecodedErr['description'])) {
                    $repDetail = (string)$repDecodedErr['description'];
                }
            }
            // Sem o token e sem o chat ID no log: só o código HTTP/erro cURL.
            error_log('report_broken: falha ao enviar para o Telegram (HTTP ' . $repHttp . ($repErr !== '' ? ', cURL: ' . $repErr : '') . ($repDetail !== '' ? ', Telegram: ' . $repDetail : '') . ')');
            echo json_encode(['ok' => false, 'error' => 'send_failed']);
        }
        break;

    case 'login':
        // POST email + password. Mensagem genérica: nunca revela se o
        // e-mail existe. A sessão foi fechada (session_write_close) antes
        // das chamadas lentas ao painel, por isso ela é reaberta aqui
        // para a trava de login e para gravar $_SESSION.
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            api_auth_error('Método inválido.', 405);
            break;
        }
        if (session_status() !== PHP_SESSION_ACTIVE) session_start();
        // tudo21: a trava é por e-mail (no banco) — lê o e-mail ANTES de
        // checar, senão não há como saber qual conta está travada.
        $loginEmail = trim((string)api_post_field('email'));
        $loginPass = (string)api_post_field('password');
        $lockMsg = login_throttle_check($pdo, $loginEmail);
        if ($lockMsg !== '') {
            session_write_close();
            api_auth_error($lockMsg, 429);
            break;
        }
        $loginUser = null;
        if ($loginEmail !== '' && $loginPass !== '') {
            $stmt = $pdo->prepare("SELECT * FROM users WHERE email = ? LIMIT 1");
            $stmt->execute([$loginEmail]);
            $loginUser = $stmt->fetch() ?: null;
        }
        if ($loginUser && password_verify($loginPass, $loginUser['password'])) {
            login_throttle_reset($pdo, $loginEmail);
            session_regenerate_id(true);
            $_SESSION['user_id'] = (int)$loginUser['id'];
            $_SESSION['user_name'] = $loginUser['name'];
            $_SESSION['user_email'] = $loginUser['email'];
            $_SESSION['user_role'] = $loginUser['role'];
            // Sessão única (tudo20): este login invalida qualquer sessão
            // antiga da mesma conta (outro aparelho).
            $_SESSION['session_token'] = mint_session_token($pdo, (int)$loginUser['id']);
            unset($_SESSION['profile_id'], $_SESSION['profile_name'], $_SESSION['profile_kids'], $_SESSION['adult_ok']);
            $loginPayload = api_public_user($pdo, $loginUser);
            $loginCanWatch = user_can_watch($loginUser);
            session_write_close();
            echo json_encode(['ok' => true, 'user' => $loginPayload, 'canWatch' => $loginCanWatch]);
        } else {
            // tudo22: a 5ª falha já trava — devolve a mensagem de bloqueio
            // nela, não só na 6ª tentativa.
            $justLocked = login_throttle_fail($pdo, $loginEmail);
            session_write_close();
            if ($justLocked !== '') {
                api_auth_error($justLocked, 429);
            } else {
                api_auth_error('E-mail ou senha inválidos.', 401);
            }
        }
        break;

    case 'logout':
        // POST: destrói a sessão e o cookie de sessão.
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            api_auth_error('Método inválido.', 405);
            break;
        }
        if (session_status() !== PHP_SESSION_ACTIVE) session_start();
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();
            setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'], $params['secure'], $params['httponly']);
        }
        session_destroy();
        echo json_encode(['ok' => true]);
        break;

    case 'plans':
        // GET, público: planos ativos ordenados por preço.
        $planStmt = $pdo->query("SELECT id, name, price, duration_days, is_recommended FROM plans WHERE active = 1 ORDER BY price ASC");
        $planList = [];
        foreach ($planStmt->fetchAll() as $p) {
            $planList[] = [
                'id' => (int)$p['id'],
                'name' => $p['name'],
                'price' => (float)$p['price'],
                'duration_days' => (int)$p['duration_days'],
                'is_recommended' => (bool)$p['is_recommended'],
            ];
        }
        echo json_encode(['plans' => $planList]);
        break;

    case 'register':
        // POST name + email + password (+ whatsapp opcional, ref opcional).
        // Mesmo comportamento do cadastro de login.php: status 'trial',
        // expires_at = agora + trial_hours (de settings), referral_code
        // único ('MINE' + 8 hex) e sessão iniciada em caso de sucesso.
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            api_auth_error('Método inválido.', 405);
            break;
        }
        $regName = trim((string)api_post_field('name'));
        $regEmail = trim((string)api_post_field('email'));
        $regPass = (string)api_post_field('password');
        $regWa = trim((string)api_post_field('whatsapp'));
        $regRef = trim((string)api_post_field('ref'));
        if ($regName === '' || $regEmail === '' || strlen($regPass) < 6) {
            api_auth_error('Preencha nome, um e-mail válido e uma senha com no mínimo 6 caracteres.', 400);
            break;
        }
        if (!filter_var($regEmail, FILTER_VALIDATE_EMAIL)) {
            api_auth_error('E-mail inválido.', 400);
            break;
        }
        $stmt = $pdo->prepare("SELECT id FROM users WHERE email = ? LIMIT 1");
        $stmt->execute([$regEmail]);
        if ($stmt->fetch()) {
            api_auth_error('Este e-mail já está cadastrado. Faça login.', 400);
            break;
        }
        $referredBy = null;
        if ($regRef !== '') {
            $stmt = $pdo->prepare("SELECT id FROM users WHERE referral_code = ? LIMIT 1");
            $stmt->execute([$regRef]);
            $referredBy = $stmt->fetchColumn() ?: null;
        }
        do {
            $myRef = 'MINE' . strtoupper(substr(bin2hex(random_bytes(4)), 0, 8));
            $stmt = $pdo->prepare("SELECT id FROM users WHERE referral_code = ? LIMIT 1");
            $stmt->execute([$myRef]);
        } while ($stmt->fetch());
        $trialHours = intval($settings['trial_hours'] ?? 3);
        $regExpires = date('Y-m-d H:i:s', strtotime('+' . $trialHours . ' hours'));
        $regHash = password_hash($regPass, PASSWORD_DEFAULT);
        $pdo->prepare("INSERT INTO users (name, email, password, whatsapp, role, status, expires_at, referral_code, referred_by) VALUES (?, ?, ?, ?, 'client', 'trial', ?, ?, ?)")->execute([$regName, $regEmail, $regHash, $regWa !== '' ? $regWa : null, $regExpires, $myRef, $referredBy]);
        $newId = (int)$pdo->lastInsertId();
        $stmt = $pdo->prepare("SELECT * FROM users WHERE id = ? LIMIT 1");
        $stmt->execute([$newId]);
        $newUser = $stmt->fetch();
        if (session_status() !== PHP_SESSION_ACTIVE) session_start();
        session_regenerate_id(true);
        $_SESSION['user_id'] = $newId;
        $_SESSION['user_name'] = $regName;
        $_SESSION['user_email'] = $regEmail;
        $_SESSION['user_role'] = 'client';
        $_SESSION['session_token'] = mint_session_token($pdo, (int)$newId);
        unset($_SESSION['profile_id'], $_SESSION['profile_name'], $_SESSION['profile_kids'], $_SESSION['adult_ok']);
        $regPayload = api_public_user($pdo, $newUser);
        $regCanWatch = user_can_watch($newUser);
        session_write_close();
        echo json_encode(['ok' => true, 'user' => $regPayload, 'canWatch' => $regCanWatch]);
        break;

    default:
        echo json_encode(['error' => true, 'message' => 'Ação não informada ou inválida.']);
        break;
}
?>
