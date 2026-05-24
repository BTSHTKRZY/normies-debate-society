const { Redis } = require('@upstash/redis');
const https = require('https');

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

function callAnthropic(apiKey, systemPrompt, userMessage) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }]
    });
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) reject(new Error(parsed.error.message));
          else resolve(parsed.content?.[0]?.text || '');
        } catch (e) { reject(new Error('Parse failed')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(25000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(payload);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { systemPrompt, userMessage, saveDebate } = req.body || {};

  if (saveDebate) {
    try {
      console.log('Saving debate:', saveDebate.id);
      await redis.set(`debate:${saveDebate.id}`, JSON.stringify(saveDebate));
      await redis.lpush('debate:index', saveDebate.id);
      console.log('Debate saved successfully:', saveDebate.id);
      res.status(200).json({ saved: true });
    } catch (e) {
      console.error('Save error:', e.message);
      res.status(500).json({ error: e.message });
    }
    return;
  }

  if (!systemPrompt || !userMessage) {
    res.status(400).json({ error: 'Missing fields' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { res.status(500).json({ error: 'API key not configured' }); return; }

  try {
    const text = await callAnthropic(apiKey, systemPrompt, userMessage);
    res.status(200).json({ text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
