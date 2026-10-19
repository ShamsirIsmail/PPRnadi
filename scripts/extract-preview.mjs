import fs from 'node:fs';

const src = 'C:/Users/shams/.codex/visualizations/2026/10/16/01a144be-7469-76d0-8d47-b2da7e722c7f/nadi-login-preview.html';
const content = fs.readFileSync(src, 'utf8');

// Replace base64 image strings with small tokens
const sanitized = content.replace(/data:image\/[^;]+;base64,[^"']+/g, '[IMG]');

fs.writeFileSync('preview-sanitized.html', sanitized);
console.log('Saved preview-sanitized.html');
