<?php
// Sécurité
header('Content-Type: application/json');
header('X-Content-Type-Options: nosniff');

// CORS — accepter seulement agilion.ca
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowed = ['https://agilion.ca', 'https://www.agilion.ca', 'http://localhost:4321'];
if (!in_array($origin, $allowed)) {
    http_response_code(403);
    exit(json_encode(['success' => false, 'error' => 'Forbidden']));
}
header("Access-Control-Allow-Origin: $origin");
header('Access-Control-Allow-Methods: POST');
header('Access-Control-Allow-Headers: Content-Type');
header('Vary: Origin');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit(0);
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    exit(json_encode(['success' => false]));
}

// Rate limiting thread-safe avec flock
$ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
$rateFile = sys_get_temp_dir() . '/agilion_rate_' . md5($ip);
$fp = fopen($rateFile, 'c+');
if ($fp && flock($fp, LOCK_EX)) {
    rewind($fp);
    $data_rate = stream_get_contents($fp);
    $parts = explode('|', trim($data_rate));
    $count = isset($parts[0]) ? (int)$parts[0] : 0;
    $ts    = isset($parts[1]) ? (int)$parts[1] : 0;
    if ((time() - $ts) > 3600) { $count = 0; $ts = time(); }
    if ($count >= 5) {
        flock($fp, LOCK_UN); fclose($fp);
        http_response_code(429);
        exit(json_encode(['success' => false, 'error' => 'Too many requests. Try again later.']));
    }
    ftruncate($fp, 0); rewind($fp);
    fwrite($fp, ($count + 1) . '|' . ($ts ?: time()));
    flock($fp, LOCK_UN);
}
if ($fp) fclose($fp);

// Parse input
$data = json_decode(file_get_contents('php://input'), true);
if (!is_array($data)) $data = $_POST;

// Honeypot
if (!empty($data['website'])) {
    exit(json_encode(['success' => true])); // Faux succès pour les bots
}

// Validation
$name    = trim($data['name'] ?? '');
$email   = trim($data['email'] ?? '');
$phone   = trim($data['phone'] ?? '');
$company = trim($data['company'] ?? '');
$message = trim($data['message'] ?? '');
$token   = trim($data['cf-turnstile-response'] ?? '');
$lang    = in_array($data['lang'] ?? '', ['fr','en']) ? $data['lang'] : 'fr';

if (empty($name) || empty($email) || empty($message) || strlen($message) < 20) {
    http_response_code(422);
    exit(json_encode(['success' => false, 'error' => 'Validation failed']));
}
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    http_response_code(422);
    exit(json_encode(['success' => false, 'error' => 'Invalid email']));
}

// Turnstile verification — obligatoire si secret configuré
$turnstileSecret = defined('TURNSTILE_SECRET') ? TURNSTILE_SECRET : '';
if (!empty($turnstileSecret)) {
    if (empty($token)) {
        http_response_code(400);
        exit(json_encode(['success' => false, 'error' => 'Bot token required']));
    }
    $resp = file_get_contents('https://challenges.cloudflare.com/turnstile/v0/siteverify', false,
        stream_context_create(['http' => [
            'method' => 'POST',
            'header' => 'Content-Type: application/x-www-form-urlencoded',
            'content' => http_build_query(['secret' => $turnstileSecret, 'response' => $token, 'remoteip' => $ip])
        ]])
    );
    $result = json_decode($resp, true);
    if (!($result['success'] ?? false)) {
        http_response_code(400);
        exit(json_encode(['success' => false, 'error' => 'Bot verification failed']));
    }
}

// Charger config (chemin relatif sécurisé)
$configPath = __DIR__ . '/../../config.php';
if (file_exists($configPath)) require_once $configPath;

// Envoi email via Brevo SMTP + PHPMailer
// PHPMailer inclus directement (sans composer, compatible cPanel)
require_once __DIR__ . '/../../vendor/PHPMailer/PHPMailer.php';
require_once __DIR__ . '/../../vendor/PHPMailer/SMTP.php';
require_once __DIR__ . '/../../vendor/PHPMailer/Exception.php';

use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\SMTP;
use PHPMailer\PHPMailer\Exception;

try {
    $mail = new PHPMailer(true);
    $mail->isSMTP();
    $mail->Host       = defined('SMTP_HOST') ? SMTP_HOST : 'smtp-relay.brevo.com';
    $mail->SMTPAuth   = true;
    $mail->Username   = defined('SMTP_USER') ? SMTP_USER : '';
    $mail->Password   = defined('SMTP_PASS') ? SMTP_PASS : '';
    $mail->SMTPSecure = PHPMailer::ENCRYPTION_STARTTLS;
    $mail->Port       = 587;
    $mail->SMTPOptions = [
        'ssl' => [
            'verify_peer'       => true,
            'verify_peer_name'  => true,
            'allow_self_signed' => false,
        ],
    ];
    $mail->CharSet    = 'UTF-8';

    $toEmail = defined('CONTACT_EMAIL') ? CONTACT_EMAIL : 'info@agilion.ca';
    $mail->setFrom($toEmail, 'Agilion Site');
    $mail->addReplyTo($email, $name);
    $mail->addAddress($toEmail, 'Agilion');

    $subject = $lang === 'fr'
        ? "Nouveau message de $name via agilion.ca"
        : "New message from $name via agilion.ca";
    $mail->Subject = $subject;

    $body  = "<h2>Nouveau contact via agilion.ca</h2>";
    $body .= "<p><strong>Nom :</strong> " . htmlspecialchars($name) . "</p>";
    $body .= "<p><strong>Courriel :</strong> " . htmlspecialchars($email) . "</p>";
    if ($phone)   $body .= "<p><strong>Téléphone :</strong> " . htmlspecialchars($phone) . "</p>";
    if ($company) $body .= "<p><strong>Entreprise :</strong> " . htmlspecialchars($company) . "</p>";
    $body .= "<p><strong>Message :</strong></p><p>" . nl2br(htmlspecialchars($message)) . "</p>";
    $mail->isHTML(true);
    $mail->Body = $body;
    $mail->AltBody = strip_tags(str_replace('<br>', "\n", $body));

    $mail->send();
    exit(json_encode(['success' => true]));
} catch (Exception $e) {
    http_response_code(500);
    exit(json_encode(['success' => false, 'error' => 'Mail error']));
}
