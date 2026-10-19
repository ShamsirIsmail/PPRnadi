import fs from 'node:fs';

if (fs.existsSync('.env.local')) {
  process.loadEnvFile('.env.local');
}

const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.AI_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
console.log('Testing model:', model);

const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;

async function run() {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Ping. Output {"status":"ok"}' }] }],
        generationConfig: {
          temperature: 0.0,
          maxOutputTokens: 200,
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });
    console.log('Status:', res.status, res.statusText);
    const text = await res.text();
    console.log('Response body:', text);
  } catch (err) {
    console.error('Fetch error:', err);
  }
}

run();
