const https = require('https');

function kvRequest(method, url, token, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function kvGet(key, url, token) {
  const result = await kvRequest('GET',
    `${url}/get/${encodeURIComponent(key)}`, token);
  return result.result ? JSON.parse(result.result) : null;
}

async function kvSet(key, value, url, token) {
  await kvRequest('POST',
    `${url}/set/${encodeURIComponent(key)}`,
    token, { value: JSON.stringify(value) });
}

async function kvLPush(key, value, url, token) {
  await kvRequest('POST',
    `${url}/lpush/${encodeURIComponent(key)}`,
    token, { value: JSON.stringify(value) });
}

function callAnthropic(apiKey, systemPrompt, userMessage) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 1000,
      stream: false,
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
        } catch (e) { reject(new Error('Failed to parse response')); }
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
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { systemPrompt, userMessage, saveDebate } = req.body || {};

  if (saveDebate) {
    const kvUrl = process.env.KV_REST_API_URL;
    const kvToken = process.env.KV_REST_API_TOKEN;
    if (kvUrl && kvToken) {
      const { id, topic, forAgents, againstAgents,
              arguments: args, timestamp } = saveDebate;
      const debate = { id, topic, forAgents, againstAgents,
                       arguments: args, timestamp,
                       status: 'live' };
      await kvSet(`debate:${id}`, debate, kvUrl, kvToken);
      await kvLPush('debate:index', id, kvUrl, kvToken);
    }
    res.status(200).json({ saved: true });
    return;
  }

  if (!systemPrompt || !userMessage) {
    res.status(400).json({ error: 'Missing systemPrompt or userMessage' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'API key not configured' });
    return;
  }

  try {
    const text = await callAnthropic(apiKey, systemPrompt, userMessage);
    res.status(200).json({ text });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed' });
  }
};
