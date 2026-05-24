const https = require('https');

function kvRequest(method, urlStr, token, bodyArr) {
  return new Promise((resolve, reject) => {
    const payload = bodyArr ? JSON.stringify(bodyArr) : null;
    const urlObj = new URL(urlStr);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method,
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({}); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function upstashCommand(url, token, ...args) {
  try {
    const r = await kvRequest('POST', url, token, args);
    return r.result !== undefined ? r.result : null;
  } catch (e) {
    console.error('Upstash command error:', e.message);
    return null;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  if (!kvUrl || !kvToken) {
    res.status(500).json({ error: 'Storage not configured' });
    return;
  }

  if (req.method === 'GET') {
    const id = req.query && req.query.id ? req.query.id : null;

    if (id) {
      const debateRaw = await upstashCommand(kvUrl, kvToken, 'GET', `debate:${id}`);
      const votesRaw = await upstashCommand(kvUrl, kvToken, 'GET', `votes:${id}`);
      if (!debateRaw) { res.status(404).json({ error: 'Not found' }); return; }
      const debate = typeof debateRaw === 'string' ? JSON.parse(debateRaw) : debateRaw;
      const votes = votesRaw ? (typeof votesRaw === 'string' ? JSON.parse(votesRaw) : votesRaw) : { aye: 0, nay: 0 };
      res.status(200).json({ ...debate, votes });
      return;
    }

    // Use SCAN to find all debate keys
    const scanResult = await upstashCommand(kvUrl, kvToken, 'SCAN', '0', 'MATCH', 'debate:*', 'COUNT', '100');
    console.log('SCAN result:', JSON.stringify(scanResult));

    const keys = Array.isArray(scanResult) && Array.isArray(scanResult[1])
      ? scanResult[1].filter(k => k !== 'debate:index')
      : [];

    console.log('debate keys found:', keys.length);

    const debates = [];
    for (const key of keys) {
      const debateRaw = await upstashCommand(kvUrl, kvToken, 'GET', key);
      if (!debateRaw) continue;
      const d = typeof debateRaw === 'string' ? JSON.parse(debateRaw) : debateRaw;
      const debateId = key.replace('debate:', '');
      const votesRaw = await upstashCommand(kvUrl, kvToken, 'GET', `votes:${debateId}`);
      const v = votesRaw ? (typeof votesRaw === 'string' ? JSON.parse(votesRaw) : votesRaw) : { aye: 0, nay: 0 };
      if (d && d.topic) debates.push({ ...d, votes: v });
    }

    debates.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    res.status(200).json({ debates });
    return;
  }

  if (req.method === 'POST') {
    const debate = req.body;
    if (!debate || !debate.id) {
      res.status(400).json({ error: 'Missing debate data' });
      return;
    }
    const saved = await upstashCommand(kvUrl, kvToken, 'SET', `debate:${debate.id}`, JSON.stringify(debate));
    console.log('debate saved:', saved, 'id:', debate.id);
    res.status(200).json({ saved: true });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
