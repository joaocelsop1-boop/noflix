<?php
/**
 * proxy-painel.php — Proxy do painel Xtream para o NOFLIX (MineTV)
 *
 * POR QUE EXISTE:
 * O painel (glove77.site:80) só responde à API (player_api.php / get.php /
 * streams) para IPs liberados. O IP do cPanel está liberado, o da Oracle
 * (onde roda o NOFLIX) NÃO está — de lá o painel devolve 404 em tudo.
 * Este arquivo fica NO CPANEL (que o painel aceita) e encaminha as chamadas
 * do NOFLIX para o painel, devolvendo a resposta.
 *
 * COMO FUNCIONA:
 *   NOFLIX (Oracle) chama:  https://<seu-cpanel>/proxy-painel.php/player_api.php?username=..&password=..&action=..
 *   Este arquivo chama:     http://glove77.site:80/player_api.php?username=..&password=..&action=..
 *   e devolve a resposta (JSON ou binário) para o NOFLIX.
 * O mesmo vale para os streams: /live/usuario/senha/123.m3u8, /movie/..., .ts etc.
 *
 * SEGURANÇA:
 * - Só aceita chamadas vindas do IP da Oracle ($ALLOWED_IP). Qualquer outro
 *   IP recebe 403. Se o IP da Oracle mudar, atualize $ALLOWED_IP abaixo.
 * - Só encaminha para o painel fixo ($PANEL_BASE). Não é um proxy aberto:
 *   não dá para usar este arquivo para chamar outro site.
 * - Nunca grava usuário/senha em log.
 *
 * INSTALAÇÃO:
 * Suba este arquivo para a mesma pasta do webplayer no cPanel (onde fica
 * o index.php do webplayer), de modo que ele responda em:
 *   https://webplayer.storestreaming.shop/proxy-painel.php
 * Depois, no admin do NOFLIX (Configurações / Painel), preencha o campo
 * "Proxy do painel (opcional)" com essa URL e salve.
 */

// ---- configuração (edite aqui se precisar) ----
$PANEL_BASE = 'http://glove77.site:80';   // painel Xtream (sem barra no fim)
$ALLOWED_IP = '129.146.127.7';            // IP público da Oracle (onde roda o NOFLIX)

// ---- só o NOFLIX (Oracle) pode usar o proxy ----
$remote = $_SERVER['REMOTE_ADDR'] ?? '';
if ($remote !== $ALLOWED_IP) {
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    die('Acesso negado.');
}

// ---- caminho pedido: /proxy-painel.php/player_api.php -> /player_api.php ----
$path = $_SERVER['PATH_INFO'] ?? '';
if ($path === '' || $path === '/') {
    $path = '/player_api.php';
}
// Só aceita caminhos do painel (nada de ".." nem caminho estranho).
if (strpos($path, '..') !== false || !preg_match('#^/[A-Za-z0-9_\-./]+$#', $path)) {
    http_response_code(400);
    header('Content-Type: text/plain; charset=utf-8');
    die('Caminho inválido.');
}

$query = $_SERVER['QUERY_STRING'] ?? '';
$target = $PANEL_BASE . $path . ($query !== '' ? '?' . $query : '');

// ---- encaminha para o painel (método GET ou POST, repassa o corpo) ----
$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $target);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_MAXREDIRS, 5);
curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10);
curl_setopt($ch, CURLOPT_TIMEOUT, 60);
curl_setopt($ch, CURLOPT_USERAGENT, 'MineTV-WebPlayer/1.0');
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, false);
// Repassa o método e o corpo (o admin do NOFLIX usa POST em algumas ações).
$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
if ($method === 'POST') {
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, file_get_contents('php://input'));
} elseif ($method !== 'GET') {
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
}

$body = curl_exec($ch);
$http = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
$ctype = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
$err = curl_error($ch);
curl_close($ch);

if ($body === false || $http === 0) {
    http_response_code(502);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => true, 'message' => 'Falha ao conectar ao painel: ' . $err]);
    exit;
}

// ---- devolve a resposta do painel como ela veio ----
http_response_code($http);
if ($ctype) {
    header('Content-Type: ' . $ctype);
} else {
    // Sem Content-Type do painel: adivinha pelo caminho.
    if (substr($path, -5) === '.m3u8') {
        header('Content-Type: application/vnd.apple.mpegurl');
    } elseif (substr($path, -3) === '.ts') {
        header('Content-Type: video/MP2T');
    } elseif (substr($path, -4) === '.mp4') {
        header('Content-Type: video/mp4');
    } else {
        header('Content-Type: application/json; charset=utf-8');
    }
}
echo $body;
