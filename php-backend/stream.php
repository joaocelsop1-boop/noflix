<?php
/**
 * CinePlus - Proxy de streaming (stream.php)
 * - exige login + plano ativo/não vencido (403 caso contrário)
 * - NUNCA expõe usuário/senha do painel em nenhuma URL, HTML, JS ou log:
 *   o navegador só vê stream.php; o painel é acessado só no servidor
 * - ao vivo: busca a playlist .m3u8 no painel e reescreve TODAS as URLs
 *   do painel (segmentos .ts, playlists aninhadas, chaves) para passarem
 *   por este mesmo stream.php
 * - filme/série: repasse em blocos (chunked) com suporte a Range
 *   (206 + Content-Range) e Content-Type por extensão
 *
 * URLs que o player usa:
 *   stream.php?type=live&id=123            (playlist ao vivo)
 *   stream.php?type=movie&id=123&ext=mp4   (filme)
 *   stream.php?type=series&id=456&ext=mp4  (episódio — id = id do episódio)
 *   stream.php?pl=live%2F123_1.m3u8        (playlist aninhada, reescrita)
 *   stream.php?seg=live%2F123.ts           (segmento .ts / chave)
 */
require_once __DIR__ . '/config.php';

function stream_fail($code, $msg) {
    http_response_code($code);
    header('Content-Type: text/plain; charset=utf-8');
    die($msg);
}

// ---- auth: login + plano ativo/não vencido ----
$user = current_user($pdo);
if (!$user || !user_can_watch($user)) {
    stream_fail(403, 'Plano inativo ou vencido.');
}
// Libera a trava da sessão: sem isso, enquanto um filme toca o PHP segura a
// sessão travada e qualquer outro clique (sair, catálogo) fica esperando.
session_write_close();

$settings = get_settings($pdo);
// panel_base_url: usa o proxy (se configurado) ou a URL do painel.
// O proxy preserva o caminho, então /live/... e /movie/... chegam ao painel.
$panelHost = panel_base_url($settings);
$panelUser = $settings['sigma_username'] ?? '';
$panelPass = $settings['sigma_password'] ?? '';
if ($panelHost === '' || $panelUser === '' || $panelPass === '') {
    stream_fail(503, 'Servidor IPTV nao configurado.');
}

$GLOBALS['panelHost'] = $panelHost;
$GLOBALS['panelUser'] = $panelUser;
$GLOBALS['panelPass'] = $panelPass;
// URL real do painel (do admin) — a reescrita da playlist compara o host
// das URLs do painel com ESTE host (e com o do proxy). Sem isso, a playlist
// .m3u8 que vem do painel traz URLs do painel (glove77) que não batiam com
// o host do proxy e voltavam diretas (credencial exposta + ao vivo falhando).
$GLOBALS['panelRealHost'] = normalize_panel_url($settings['sigma_url'] ?? '');
// Parâmetro que diz ao proxy qual painel usar (vem do admin). Só é usado
// quando há proxy configurado; sem proxy, é vazio.
$GLOBALS['panelParam'] = !empty($settings['panel_proxy'])
    ? '?panel=' . urlencode(normalize_panel_url($settings['sigma_url'] ?? ''))
    : '';

$ALLOWED_TYPES = ['live', 'movie', 'series'];
$ALLOWED_EXTS = ['mp4', 'mkv', 'avi', 'mov', 'webm', 'm3u8', 'ts', 'mpg', 'mpeg', 'mp2t', 'm2ts', 'flv', 'wmv', '3gp', 'm4v', 'f4v', 'vob', 'asf', 'rm', 'rmvb', 'divx', 'ogv'];

function stream_content_type($ext) {
    $map = [
        'm3u8' => 'application/vnd.apple.mpegurl',
        'ts' => 'video/MP2T', 'mp2t' => 'video/MP2T', 'm2ts' => 'video/MP2T',
        'mp4' => 'video/mp4', 'm4v' => 'video/x-m4v', 'f4v' => 'video/mp4',
        'mkv' => 'video/x-matroska', 'avi' => 'video/x-msvideo',
        'mov' => 'video/quicktime', 'webm' => 'video/webm',
        'mpg' => 'video/mpeg', 'mpeg' => 'video/mpeg',
        'flv' => 'video/x-flv', 'wmv' => 'video/x-ms-wmv', 'asf' => 'video/x-ms-asf',
        '3gp' => 'video/3gpp', 'vob' => 'video/mpeg', 'ogv' => 'video/ogg',
        'rm' => 'application/vnd.rn-realmedia', 'rmvb' => 'application/vnd.rn-realmedia',
        'divx' => 'video/divx', 'key' => 'application/octet-stream',
    ];
    return $map[strtolower($ext)] ?? 'application/octet-stream';
}

function panel_stream_url($kind, $rest) {
    global $panelHost, $panelUser, $panelPass;
    // ?panel=... diz ao proxy qual painel usar (URL do admin). O proxy lê,
    // usa como destino e remove o parâmetro antes de encaminhar.
    return $panelHost . '/' . $kind . '/' . rawurlencode($panelUser) . '/' . rawurlencode($panelPass) . '/' . $rest . ($GLOBALS['panelParam'] ?? '');
}

// Valida o caminho reescrito (tipo/resto) — nunca aceita ".." nem caracteres estranhos
function valid_rest($target) {
    if (!preg_match('#^(live|movie|series)/(.+)$#', $target, $m)) return null;
    $rest = $m[2];
    if (strpos($rest, '..') !== false) return null;
    // Ponto codificado (%2e%2e) também é ".." — o painel decodificaria e
    // permitiria sair do diretório de streams.
    if (preg_match('/%2e%2e/i', $rest)) return null;
    if (!preg_match('#^[A-Za-z0-9_\-./?=&%]+$#', $rest)) return null;
    return [$m[1], $rest];
}

// ---------- busca no painel (corpo inteiro, p/ playlist) ----------
function panel_fetch($url, $timeout = 25) {
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_MAXREDIRS, 5);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10);
    curl_setopt($ch, CURLOPT_USERAGENT, 'CinePlus-WebPlayer/1.0');
    curl_setopt($ch, CURLOPT_TIMEOUT, $timeout);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, false);
    $body = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $finalUrl = curl_getinfo($ch, CURLINFO_EFFECTIVE_URL);
    $err = curl_error($ch);
    curl_close($ch);
    if ($body === false || $err !== '') return ['error' => true];
    if ($code >= 400) return ['error' => true];
    return ['error' => false, 'body' => $body, 'url' => $finalUrl];
}

// ---------- reescrita da playlist ----------
function resolve_url($uri, $base) {
    if (preg_match('#^https?://#i', $uri)) return $uri;
    $b = parse_url($base);
    $scheme = $b['scheme'] ?? 'http';
    $host = $b['host'] ?? '';
    $port = isset($b['port']) ? ':' . $b['port'] : '';
    if (strpos($uri, '/') === 0) {
        return $scheme . '://' . $host . $port . $uri;
    }
    $dir = rtrim(dirname($b['path'] ?? '/'), '/');
    return $scheme . '://' . $host . $port . $dir . '/' . $uri;
}

function rewrite_panel_uri($uri, $playlistUrl) {
    $abs = resolve_url($uri, $playlistUrl);
    $p = parse_url($abs);
    // A URL do segmento pode ter o host do PROXY ou o host REAL do painel
    // (a playlist vem do painel e traz URLs do painel). Aceita os dois —
    // senão a URL voltava direta, com a senha exposta e o ao vivo falhando.
    $hosts = [];
    foreach ([$GLOBALS['panelHost'] ?? '', $GLOBALS['panelRealHost'] ?? ''] as $h) {
        $hp = parse_url($h);
        if (!empty($hp['host'])) {
            $hosts[] = [
                strtolower($hp['host']),
                (int)($hp['port'] ?? (($hp['scheme'] ?? 'http') === 'https' ? 443 : 80)),
            ];
        }
    }
    $pPort = $p['port'] ?? (($p['scheme'] ?? 'http') === 'https' ? 443 : 80);
    $match = false;
    foreach ($hosts as [$hh, $pp]) {
        if (strtolower($p['host'] ?? '') === $hh && (int)$pPort === $pp) { $match = true; break; }
    }
    if (!$match) return $abs; // URL externa (CDN etc.): deixa como está
    $path = $p['path'] ?? '';
    // tira /tipo/usuario/senha/ do começo — a senha nunca volta p/ o navegador
    if (!preg_match('#^/(live|movie|series)/[^/]+/[^/]+/(.+)$#', $path, $m)) {
        return $abs;
    }
    $kind = $m[1];
    $rest = $m[2];
    if (!empty($p['query'])) $rest .= '?' . $p['query'];
    $target = $kind . '/' . $rest;
    $ext = strtolower(pathinfo(parse_url($target, PHP_URL_PATH), PATHINFO_EXTENSION));
    if ($ext === 'm3u8') {
        return 'stream.php?pl=' . rawurlencode($target);
    }
    return 'stream.php?seg=' . rawurlencode($target);
}

function rewrite_playlist($text, $playlistUrl) {
    $lines = explode("\n", $text);
    $out = [];
    foreach ($lines as $line) {
        $line = rtrim($line, "\r");
        if ($line === '') { $out[] = $line; continue; }
        if ($line[0] === '#') {
            // tags com URI="..." (#EXT-X-KEY, #EXT-X-MAP, #EXT-X-STREAM-INF)
            $line = preg_replace_callback('/URI="([^"]+)"/', function ($m) use ($playlistUrl) {
                return 'URI="' . rewrite_panel_uri($m[1], $playlistUrl) . '"';
            }, $line);
            $out[] = $line;
        } else {
            $out[] = rewrite_panel_uri($line, $playlistUrl);
        }
    }
    return implode("\n", $out);
}

function serve_playlist($url) {
    $res = panel_fetch($url, 25);
    if ($res['error']) stream_fail(502, 'Playlist indisponivel.');
    header('Content-Type: application/vnd.apple.mpegurl');
    header('Cache-Control: no-cache');
    echo rewrite_playlist($res['body'], $res['url']);
    exit;
}

// ---------- repasse em blocos com Range ----------
function serve_passthrough($url, $ext) {
    // SEM pre-checagem por HEAD: muitos painéis/nós não respondem HEAD no
    // endereço do stream (404/405/403) embora o GET toque normal — o HEAD
    // derrubava filmes que funcionariam. Vai direto ao GET e o status do
    // painel é repassado ao navegador pela HEADERFUNCTION.
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, false);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_MAXREDIRS, 5);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10);
    curl_setopt($ch, CURLOPT_USERAGENT, 'CinePlus-WebPlayer/1.0');
    curl_setopt($ch, CURLOPT_TIMEOUT, 0);
    /* tudo12/tudo15: fail fast se o upstream travar — sem isso uma conexao
       pendurada espera para sempre (pior que fechar: fechada, o navegador
       retoma com um novo Range; pendurada, so gira). 1 KB/s por 60 s:
       o painel pode levar ~30 s só para mandar o primeiro byte de um
       filme grande — com 30 s o limite cortava um stream que estava para
       começar. 60 s ainda fecha um travado de verdade. */
    curl_setopt($ch, CURLOPT_LOW_SPEED_LIMIT, 1024);
    curl_setopt($ch, CURLOPT_LOW_SPEED_TIME, 60);
    /* tudo20: buffer de leitura maior (256 KB em vez do padrão de 16 KB) —
       menos chamadas de rede por segundo e mais vazão do painel para o
       navegador, o que ajuda o buffer do player a não esvaziar no meio. */
    curl_setopt($ch, CURLOPT_BUFFERSIZE, 262144);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, false);
    $rangeHeaders = [];
    if (!empty($_SERVER['HTTP_RANGE'])) {
        $rangeHeaders[] = 'Range: ' . $_SERVER['HTTP_RANGE'];
    }
    if ($rangeHeaders) curl_setopt($ch, CURLOPT_HTTPHEADER, $rangeHeaders);
    curl_setopt($ch, CURLOPT_HEADERFUNCTION, function ($ch, $header) {
        $len = strlen($header);
        if (preg_match('/^HTTP\/\d+(?:\.\d+)?\s+(\d+)/i', $header, $m)) {
            http_response_code((int)$m[1]);
            return $len;
        }
        if (preg_match('/^(Content-Type|Content-Length|Content-Range|Accept-Ranges):/i', $header)) {
            header(trim($header));
        }
        return $len;
    });
    curl_setopt($ch, CURLOPT_WRITEFUNCTION, function ($ch, $data) {
        echo $data;
        flush();
        return strlen($data);
    });
    set_time_limit(0);
    // Tipo padrão caso o painel não envie Content-Type
    header('Content-Type: ' . stream_content_type($ext));
    header('Accept-Ranges: bytes');
    curl_exec($ch);
    curl_close($ch);
    exit;
}

// ---------- roteamento ----------
if (isset($_GET['pl'])) {
    $v = valid_rest($_GET['pl']);
    if (!$v) stream_fail(400, 'Parametro invalido.');
    list($kind, $rest) = $v;
    serve_playlist(panel_stream_url($kind, $rest));
}

if (isset($_GET['seg'])) {
    $v = valid_rest($_GET['seg']);
    if (!$v) stream_fail(400, 'Parametro invalido.');
    list($kind, $rest) = $v;
    $ext = strtolower(pathinfo(parse_url($rest, PHP_URL_PATH), PATHINFO_EXTENSION));
    serve_passthrough(panel_stream_url($kind, $rest), $ext);
}

$type = $_GET['type'] ?? '';
$id = $_GET['id'] ?? '';
$ext = strtolower($_GET['ext'] ?? '');

if (!in_array($type, $ALLOWED_TYPES, true) || !ctype_digit((string)$id)) {
    stream_fail(400, 'Parametro invalido.');
}

if ($type === 'live') {
    serve_playlist(panel_stream_url('live', $id . '.m3u8'));
}

if (!in_array($ext, $ALLOWED_EXTS, true)) $ext = 'mp4';
/* tudo18: VOD em HLS — a playlist .m3u8 tem que passar por serve_playlist
   (busca + REESCREVE as URLs dos segmentos para stream.php?seg=), senão a
   playlist chegaria crua ao navegador com as URLs do painel (usuário/senha
   expostos) e os segmentos iriam diretos. O serve_passthrough NÃO reescreve
   nada — ele só repassa o corpo. Vale para filme e série (o ao vivo já ia
   por serve_playlist acima). */
if ($ext === 'm3u8') {
    serve_playlist(panel_stream_url($type, $id . '.m3u8'));
}
serve_passthrough(panel_stream_url($type, $id . '.' . $ext), $ext);
