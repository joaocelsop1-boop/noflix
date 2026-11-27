<?php
/**
 * MineTV - API Bridge para o Painel Sigma (Xtream Codes API)
 * CORRIGIDO:
 * - sem CORS aberto
 * - catálogo exige login; test_connection exige admin
 * - a ação que devolvia a URL direta foi REMOVIDA (o player usa stream.php, que nunca expõe a senha do painel)
 * - test_connection usa SÓ o que está salvo em settings (nada de URL/usuário/senha por POST)
 * - cache em arquivo cache/ (TTL 3600s) nas listas grandes; se o painel falhar,
 *   devolve o cache antigo, senão array vazio (nunca erro fatal)
 * - create_order: pedido pendente + Pix via Mercado Pago (se houver token)
 *   ou pagamento manual (pix_key do admin)
 * - rate / my_rating: avaliações "SUA NOTA" (1 a 5)
 * - save_pix_key: chave Pix do usuário (Indique e Ganhe)
 * - adult_unlock: libera conteúdo adulto na sessão com a senha da conta
 */
require_once __DIR__ . '/config.php';

header('Content-Type: application/json; charset=utf-8');

function api_error($msg, $code = 403) {
    http_response_code($code);
    echo json_encode(['error' => true, 'message' => $msg]);
    exit;
}

function api_require_login() {
    if (!is_logged_in()) api_error('Login necessário.', 401);
}

function api_require_admin() {
    if (!is_admin()) api_error('Acesso restrito ao administrador.', 403);
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

// ---------- chamada ao painel ----------
function call_sigma($url) {
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_USERAGENT, 'MineTV-WebPlayer/1.0');
    curl_setopt($ch, CURLOPT_TIMEOUT, 20);
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
    $base = panel_base_url($settings);
    return $base . '/player_api.php?username=' . urlencode($settings['sigma_username']) . '&password=' . urlencode($settings['sigma_password']) . '&action=' . $action . $extra;
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
    $res = call_sigma(sigma_url($settings, $action, $extra));
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

// ---------- ações ----------
switch ($action) {
    case 'test_connection':
        api_require_admin();
        // usa SÓ o que está salvo em settings — nada de URL/usuário/senha por POST.
        // panel_base_url: passa pelo proxy quando configurado.
        $url = panel_base_url($settings) . "/player_api.php?username=" . urlencode($settings['sigma_username']) . "&password=" . urlencode($settings['sigma_password']);
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
        $planId = intval($_POST['plan_id'] ?? 0);
        $stmt = $pdo->prepare("SELECT * FROM plans WHERE id = ? AND active = 1 LIMIT 1");
        $stmt->execute([$planId]);
        $plan = $stmt->fetch();
        if (!$plan) api_error('Plano inválido.', 400);
        // WhatsApp opcional do checkout
        $wa = trim($_POST['whatsapp'] ?? '');
        if ($wa !== '' && $wa !== ($user['whatsapp'] ?? '')) {
            $pdo->prepare("UPDATE users SET whatsapp = ? WHERE id = ?")->execute([$wa, $user['id']]);
        }
        // Reaproveita pedido pendente recente do mesmo plano (evita duplicar QR)
        $stmt = $pdo->prepare("SELECT * FROM orders WHERE user_id = ? AND plan_id = ? AND status = 'pending' AND created_at >= DATE_SUB(NOW(), INTERVAL 30 MINUTE) ORDER BY id DESC LIMIT 1");
        $stmt->execute([$user['id'], $planId]);
        $existing = $stmt->fetch();
        if ($existing && !empty($existing['pix_code'])) {
            // O pedido já tem QR do Mercado Pago: o modo é 'mp' pelo pedido,
            // não pelo token atual (o token pode ter sido removido depois).
            $mode = 'mp';
            echo json_encode([
                'success' => true, 'mode' => $mode, 'order_id' => (int)$existing['id'],
                'amount' => (float)$existing['amount'], 'plan_name' => $plan['name'],
                'qr_code' => $existing['pix_code'], 'qr_code_base64' => $existing['pix_qr_url'] ?: null,
                'pix_key' => ($settings['pix_key'] ?? '') ?: null
            ]);
            break;
        }
        $pdo->prepare("INSERT INTO orders (user_id, plan_id, amount, status) VALUES (?, ?, ?, 'pending')")->execute([$user['id'], $planId, $plan['price']]);
        $orderId = (int)$pdo->lastInsertId();
        if (!empty($settings['mp_access_token'])) {
            $mp = mp_create_pix(($settings['mp_access_token'] ?? ''), (float)$plan['price'], $user['email'], 'MineTV - Plano ' . $plan['name'], 'minetv-order-' . $orderId);
            if ($mp['error']) {
                echo json_encode(['success' => false, 'message' => $mp['message']]);
                break;
            }
            $qrCode = $mp['data']['qr_code'] ?? '';
            $qrB64 = $mp['data']['qr_code_base64'] ?? '';
            $pdo->prepare("UPDATE orders SET pix_code = ?, pix_qr_url = ? WHERE id = ?")->execute([$qrCode, $qrB64, $orderId]);
            echo json_encode([
                'success' => true, 'mode' => 'mp', 'order_id' => $orderId,
                'amount' => (float)$plan['price'], 'plan_name' => $plan['name'],
                'qr_code' => $qrCode, 'qr_code_base64' => $qrB64 ?: null,
                'pix_key' => null
            ]);
        } else {
            // Sem token do Mercado Pago: pagamento manual com a chave Pix do admin
            echo json_encode([
                'success' => true, 'mode' => 'manual', 'order_id' => $orderId,
                'amount' => (float)$plan['price'], 'plan_name' => $plan['name'],
                'qr_code' => null, 'qr_code_base64' => null,
                'pix_key' => ($settings['pix_key'] ?? '') ?: null
            ]);
        }
        break;

    case 'rate':
        api_require_login();
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') api_error('Método inválido.', 405);
        $user = current_user($pdo);
        $type = in_array($_POST['type'] ?? '', ['movie', 'series', 'live'], true) ? $_POST['type'] : 'movie';
        $streamId = intval($_POST['stream_id'] ?? 0);
        $rating = intval($_POST['rating'] ?? 0);
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
        $pixKey = trim($_POST['pix_key'] ?? '');
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
        $pass = $_POST['password'] ?? '';
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
        // Catálogo público (como o da MineTV): sem login, sem conteúdo adulto,
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
            'user' => $meUser ? api_public_user($pdo, $meUser) : null,
            'canWatch' => user_can_watch($meUser),
        ]);
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
        $lockMsg = login_throttle_check();
        if ($lockMsg !== '') {
            session_write_close();
            api_auth_error($lockMsg, 429);
            break;
        }
        $loginEmail = trim((string)api_post_field('email'));
        $loginPass = (string)api_post_field('password');
        $loginUser = null;
        if ($loginEmail !== '' && $loginPass !== '') {
            $stmt = $pdo->prepare("SELECT * FROM users WHERE email = ? LIMIT 1");
            $stmt->execute([$loginEmail]);
            $loginUser = $stmt->fetch() ?: null;
        }
        if ($loginUser && password_verify($loginPass, $loginUser['password'])) {
            login_throttle_reset();
            session_regenerate_id(true);
            $_SESSION['user_id'] = (int)$loginUser['id'];
            $_SESSION['user_name'] = $loginUser['name'];
            $_SESSION['user_email'] = $loginUser['email'];
            $_SESSION['user_role'] = $loginUser['role'];
            unset($_SESSION['profile_id'], $_SESSION['profile_name'], $_SESSION['profile_kids'], $_SESSION['adult_ok']);
            $loginPayload = api_public_user($pdo, $loginUser);
            $loginCanWatch = user_can_watch($loginUser);
            session_write_close();
            echo json_encode(['ok' => true, 'user' => $loginPayload, 'canWatch' => $loginCanWatch]);
        } else {
            login_throttle_fail();
            session_write_close();
            api_auth_error('E-mail ou senha inválidos.', 401);
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
