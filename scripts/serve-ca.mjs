import http from 'http';
import fs from 'fs';

const PORT = 3001;
const CA_PATH = 'C:/Users/shams/AppData/Local/mkcert/rootCA.pem';

if (!fs.existsSync(CA_PATH)) {
  console.error('rootCA.pem not found at:', CA_PATH);
  process.exit(1);
}

const caBuffer = fs.readFileSync(CA_PATH);

const server = http.createServer((req, res) => {
  if (req.url === '/ca.crt' || req.url === '/ca.pem' || req.url === '/download') {
    res.writeHead(200, {
      'Content-Type': 'application/x-x509-ca-cert',
      'Content-Disposition': 'attachment; filename="mkcert-rootCA.crt"',
      'Content-Length': caBuffer.length,
      'Access-Control-Allow-Origin': '*'
    });
    res.end(caBuffer);
    console.log('[CA Server] CA certificate downloaded by client:', req.socket.remoteAddress);
    return;
  }

  // HTML Instruction Page
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html>
<html lang="ms">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pemasangan Sijil SSL PPR NADI untuk iPhone</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #F8FAFC; color: #0F172A; padding: 24px; max-width: 480px; margin: 0 auto; line-height: 1.5; }
    .card { background: white; border-radius: 20px; padding: 24px; box-shadow: 0 4px 20px rgba(0,0,0,0.06); border: 1px solid #E2E8F0; }
    h1 { font-size: 20px; font-weight: 800; color: #1554AD; margin-bottom: 12px; }
    p { font-size: 15px; color: #475569; margin-bottom: 16px; }
    .btn { display: block; width: 100%; text-align: center; background: #1554AD; color: white; padding: 16px; border-radius: 14px; font-weight: 700; font-size: 16px; text-decoration: none; box-sizing: border-box; margin: 20px 0; }
    .steps { background: #F1F5F9; border-radius: 14px; padding: 16px 20px; margin-top: 20px; }
    .steps ol { padding-left: 20px; margin: 0; }
    .steps li { font-size: 14px; color: #334155; margin-bottom: 10px; }
    .steps strong { color: #0F172A; }
    .badge { display: inline-block; background: #DCFCE7; color: #166534; font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 20px; margin-bottom: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <span class="badge">Sijil Tempatan Selamat</span>
    <h1>Pasang Sijil CA untuk iPhone</h1>
    <p>Muat turun profil sijil ini supaya iPhone mempercayai pelayan HTTPS tempatan tanpa amaran keselamatan.</p>
    
    <a href="/ca.crt" class="btn">📲 1. Tekan untuk Muat Turun Sijil</a>

    <div class="steps">
      <h3 style="font-size: 14px; font-weight: 700; margin-bottom: 8px;">Langkah Pemasangan di iPhone:</h3>
      <ol>
        <li>Tekan butang biru di atas. Pilih <strong>Allow (Benarkan)</strong> apabila ditanya untuk muat turun profil.</li>
        <li>Buka aplikasi <strong>Settings (Tetapan)</strong> iPhone &rarr; tekan <strong>Profile Downloaded (Profil Dimuat Turun)</strong> di bahagian paling atas &rarr; tekan <strong>Install (Pasang)</strong> &rarr; masukkan passcode anda.</li>
        <li>Pergi ke <strong>Settings &rarr; General &rarr; About &rarr; Certificate Trust Settings</strong> (bahagian paling bawah). Hidupkan suis <strong>Full Trust</strong> untuk <em>mkcert development CA</em>.</li>
        <li>Buka Safari dan layari: <br><strong style="color: #1554AD;">https://192.168.0.115:3000</strong></li>
      </ol>
    </div>
  </div>
</body>
</html>`);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[CA Server] Running on http://192.168.0.115:${PORT}`);
  console.log(`[CA Server] Download link for iPhone: http://192.168.0.115:${PORT}/ca.crt`);
});
