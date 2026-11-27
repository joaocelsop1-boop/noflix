<?php
/**
 * CinePlus - Sair (logout)
 */
session_start();
$_SESSION = [];
if (ini_get('session.use_cookies')) {
    $params = session_get_cookie_params();
    setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'], $params['secure'], $params['httponly']);
}
session_destroy();
$to = ($_GET['to'] ?? '') === 'admin' ? 'admin_login.php' : 'login.php';
header('Location: ' . $to);
exit;
