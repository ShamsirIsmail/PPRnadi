import http from 'node:http';

const req = http.request(
  'http://127.0.0.1:3000/management/inbox',
  {
    headers: {
      Cookie: 'ppr_demo_role=management',
    },
  },
  (res) => {
    let data = '';
    res.on('data', (chunk) => (data += chunk));
    res.on('end', () => {
      console.log('STATUS:', res.statusCode);
      console.log('HTML snippet contains "priority-explainer":', data.includes('priority-explainer'));
      console.log('HTML snippet contains "Tiada Laporan":', data.includes('Tiada Laporan'));
      console.log('HTML snippet contains "Lif Blok A":', data.includes('Lif Blok A'));
      console.log('HTML length:', data.length);
      if (!data.includes('priority-explainer')) {
        console.log('First 500 chars:', data.substring(0, 500));
      }
    });
  }
);
req.end();
