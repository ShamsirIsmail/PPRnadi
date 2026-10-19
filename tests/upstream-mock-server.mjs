import http from 'node:http';

const PORT = 3928;

let stats = {
  transcriptionRequestCount: 0,
  draftRequestCount: 0,
  lastReceivedAudioBytes: 0,
  audioPayloadHistory: [],
};

export function startUpstreamMockServer() {
  const server = http.createServer((req, res) => {
    // Enable CORS just in case
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url?.includes('/health')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    // Diagnostics endpoint returning granular call statistics
    if (req.url?.includes('/mock-stats') || req.url?.includes('/last-audio-stats')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...stats }));
      return;
    }

    // Reset endpoint for deterministic per-scenario baseline tracking
    if (req.url?.includes('/mock-reset')) {
      stats = {
        transcriptionRequestCount: 0,
        draftRequestCount: 0,
        lastReceivedAudioBytes: 0,
        audioPayloadHistory: [],
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, reset: true }));
      return;
    }

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });

    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');

      try {
        const payload = JSON.parse(body || '{}');
        const contents = payload.contents || [];
        const parts = contents[0]?.parts || [];

        // Check if this is an audio transcription request (has inlineData)
        const isAudio = parts.some((p) => p.inlineData);

        if (isAudio) {
          stats.transcriptionRequestCount++;
          const audioPart = parts.find((p) => p.inlineData);
          if (audioPart?.inlineData?.data) {
            const byteLen = Buffer.from(audioPart.inlineData.data, 'base64').length;
            stats.lastReceivedAudioBytes = byteLen;
            stats.audioPayloadHistory.push(byteLen);
          }
          const response = {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: 'Bahagian koridor basah lecun air paip melimpah',
                    },
                  ],
                },
              },
            ],
          };
          res.writeHead(200);
          res.end(JSON.stringify(response));
          return;
        }

        // Otherwise this is an AI report drafting request
        stats.draftRequestCount++;
        const systemPrompt = parts[0]?.text || '';
        const userTranscript = parts[1]?.text || parts.map((p) => p.text || '').join(' ');

        // Extract first valid zone ID from system prompt if present
        const zoneMatch = systemPrompt.match(/- ID:\s*"([^"]+)"/);
        const dynamicZoneId = zoneMatch ? zoneMatch[1] : null;

        let draftData;
        if (userTranscript.includes('Blok C')) {
          draftData = {
            title: 'Lif Rosak Blok C',
            description: 'Lif di Blok C rosak teruk pintu tidak boleh tutup.',
            category: 'lift',
            matched_zone_id: null,
            mentioned_block: 'C',
            mentioned_floor: null,
            missing_fields: [],
          };
        } else if (userTranscript.includes('tiada aras')) {
          draftData = {
            title: 'Kerosakan Am',
            description: 'Kerosakan am tiada aras tertentu.',
            category: null,
            matched_zone_id: null,
            mentioned_block: 'A',
            mentioned_floor: null,
            missing_fields: ['Kategori kerosakan belum dapat dikenal pasti.'],
          };
        } else {
          // Default: Tingkat 1 Blok A with valid zone ID
          draftData = {
            title: 'Paip Air Pecah Tingkat 1',
            description: 'Paip air di Tingkat 1 pecah melimpah ke tangga. Perlu tindakan segera.',
            category: 'water_supply',
            matched_zone_id: dynamicZoneId,
            mentioned_block: 'A',
            mentioned_floor: 1,
            missing_fields: [],
          };
        }

        const response = {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify(draftData),
                  },
                ],
              },
            },
          ],
        };

        res.writeHead(200);
        res.end(JSON.stringify(response));
      } catch (err) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.listen(PORT, '127.0.0.1', () => {
      resolve(server);
    });
    server.on('error', reject);
  });
}

// Standalone execution support
if (process.argv[1]?.endsWith('upstream-mock-server.mjs')) {
  startUpstreamMockServer().then(() => {
    console.log(`[Upstream Mock Server] Listening on http://127.0.0.1:${PORT}`);
  });
}
