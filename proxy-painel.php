<?php
/**
 * proxy-painel.php — Proxy do painel Xtream para o NOFLIX (CinePlus)
 *
 * POR QUE EXISTE:
 * O painel (brblack.site:80) só responde à API (player_api.php / get.php /
 * streams) para IPs liberados. O IP do cPanel está liberado, o da Oracle
 * (onde roda o NOFLIX) NÃO está — de lá o painel devolve 404 em tudo.
 * Este arquivo fica NO CPANEL (que o painel aceita) e encaminha as chamadas
 * do NOFLIX para o painel, devolvendo a resposta.
 *
 * COMO FUNCIONA:
 *   NOFLIX (Oracle) chama:  https://<seu-cpanel>/proxy-painel.php/player_api.php?username=..&password=..&action=..
 *   Este arquivo chama:     http://brblack.site:80/player_api.php?username=..&password=..&action=..
 *   e devolve a resposta (JSON ou binário) para o NOFLIX.
 * O mesmo vale para os streams: /live/usuario/senha/123.m3u8, /movie/..., .ts etc.
 *
 * STREAMING (importante):
 * A resposta é repassada em BLOCOS, à medida que chega do painel — o arquivo
 * NUNCA é carregado inteiro na memória. Sem isso, um filme (centenas de MB)
 * estourava a memória do PHP e o player ficava travado. O cabeçalho Range
 * (para pular/adiantar o vídeo) também é repassado ao painel.
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
// $PANEL_BASE é o padrão (reserva). O NOFLIX normalmente manda a URL do
// painel em cada chamada (?panel=http://...), que vem do campo "URL do
// Servidor" do admin — trocou lá, o proxy passa a usar a nova URL sozinho,
// sem precisar editar este arquivo. Só edite aqui se quiser outro padrão.
$PANEL_BASE = 'http://brblack.site:80';   // painel Xtream (sem barra no fim)
$ALLOWED_IP = '129.146.127.7';            // IP público da Oracle (onde roda o NOFLIX)

// ---- só o NOFLIX (Oracle) pode usar o proxy ----
$remote = $_SERVER['REMOTE_ADDR'] ?? '';
if ($remote !== $ALLOWED_IP) {
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    die('Acesso negado.');
}

// ---- URL do painel: vem do admin (?panel=...) ou do padrão acima ----
// O NOFLIX manda ?panel=<url do campo "URL do Servidor" do admin> em cada
// chamada. Validamos (http/https + host) e usamos; se vier inválida ou
// ausente, cai no $PANEL_BASE. O parâmetro é REMOVIDO antes de encaminhar,
// para o painel não receber um parâmetro estranho.
$query = $_SERVER['QUERY_STRING'] ?? '';
$panelBase = $PANEL_BASE;
if ($query !== '') {
    parse_str($query, $qs);
    if (!empty($qs['panel']) && is_string($qs['panel'])) {
        $cand = trim($qs['panel']);
        $p = parse_url($cand);
        if ($p !== false && isset($p['scheme'], $p['host'])
            && ($p['scheme'] === 'http' || $p['scheme'] === 'https')
            && $p['host'] !== '') {
            $panelBase = rtrim($cand, '/');
        }
        unset($qs['panel']);
        $query = http_build_query($qs);
    }
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

// ($query já veio lá de cima, sem o parâmetro panel.)
$target = $panelBase . $path . ($query !== '' ? '?' . $query : '');

// ---- encaminha para o painel, repassando em blocos (streaming) ----
$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $target);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, false);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_MAXREDIRS, 5);
curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10);
// Sem limite de tempo: um filme pode levar horas para tocar; o limite é
// do servidor web, não daqui. (Antes era 60s e o filme morria no meio.)
curl_setopt($ch, CURLOPT_TIMEOUT, 0);
curl_setopt($ch, CURLOPT_USERAGENT, 'CinePlus-WebPlayer/1.0');
// tudo12/tudo14/tudo15: fail fast se o painel travar num STREAM (video) — uma
// conexao pendurada espera para sempre (pior que fechar: fechada, o navegador
// retoma com um novo Range; pendurada, so gira). 1 KB/s por 60 s: o painel
// pode levar ~30 s só para mandar o primeiro byte de um filme grande — com
// 30 s o limite cortava um stream que estava para começar.
// tudo14: NAO vale para chamadas de API (player_api.php): o painel leva tempo
// para GERAR listas grandes (get_vod_streams = 20 mil filmes) antes de mandar
// o primeiro byte, e abortar apos 30 s de silencio matava o catalogo de filmes.
// API ja tem timeout proprio (call_sigma/phpApi).
if (strpos($path, 'player_api.php') === false) {
    curl_setopt($ch, CURLOPT_LOW_SPEED_LIMIT, 1024);
    curl_setopt($ch, CURLOPT_LOW_SPEED_TIME, 60);
}
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, false);
// Repassa o cabeçalho Range (pular/adiantar o vídeo) e o método/corpo.
$headers = [];
if (!empty($_SERVER['HTTP_RANGE'])) {
    $headers[] = 'Range: ' . $_SERVER['HTTP_RANGE'];
}
$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
if ($method === 'POST') {
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, file_get_contents('php://input'));
} elseif ($method !== 'GET') {
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
}
if ($headers) {
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
}
// Repassa o status e os cabeçalhos do painel para o navegador.
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
// Escreve cada bloco assim que chega — nada fica na memória.
curl_setopt($ch, CURLOPT_WRITEFUNCTION, function ($ch, $data) {
    echo $data;
    flush();
    return strlen($data);
});

set_time_limit(0);
// Tipo padrão caso o painel não envie Content-Type.
if (substr($path, -5) === '.m3u8') {
    header('Content-Type: application/vnd.apple.mpegurl');
} elseif (substr($path, -3) === '.ts') {
    header('Content-Type: video/MP2T');
} elseif (substr($path, -4) === '.mp4') {
    header('Content-Type: video/mp4');
}
header('Accept-Ranges: bytes');

$ok = curl_exec($ch);
$err = curl_error($ch);
curl_close($ch);
if ($ok === false) {
    // A conexão com o painel falhou antes de qualquer byte: 502.
    // (Se já saiu algum byte, o status já foi enviado e não dá para trocar.)
    if (!headers_sent()) {
        http_response_code(502);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error' => true, 'message' => 'Falha ao conectar ao painel: ' . $err]);
    }
}
