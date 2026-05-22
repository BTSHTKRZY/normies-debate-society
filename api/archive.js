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
  const result = await kvRequest('GET', `${url}/get/${encodeURIComponent(key)}`, token);
  return result.result ? JSON.parse(result.result) : null;
}

async function kvSet(key, value, url, token) {
  await kvRequest('POST', `${url}/set/${encodeURIComponent(key)}`,
    token, { value: JSON.stringify(value) });
}

async function kvLRange(key, start, stop, url, token) {
  const result = await kvRequest('GET',
    `${url}/lrange/${encodeURIComponent(key)}/${start}/${stop}`, token);
  return result.result || [];
}

async function kvLPush(key, value, url, token) {
  await kvRequest('POST', `${url}/lpush/${encodeURIComponent(key)}`,
    token, { value: JSON.stringify(value) });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  if (!kvUrl || !kvToken) {
    res.status(500).json({ error: 'Storage not configured' });
    return;
  }

  if (req.method === 'GET') {
    const id = req.query?.id;
    if (id) {
      const debate = await kvGet(`debate:${id}`, kvUrl, kvToken);
      const votes = await kvGet(`votes:${id}`, kvUrl, kvToken) || { aye: 0, nay: 0 };
      if (!debate) { res.status(404).json({ error: 'Not found' }); return; }
      res.status(200).json({ ...debate, votes });
      return;
    }
    const ids = await kvLRange('debate:index', 0, 49, kvUrl, kvToken);
    const debates = [];
    for (const did of ids) {
      const d = await kvGet(`debate:${did}`, kvUrl, kvToken);
      const v = await kvGet(`votes:${did}`, kvUrl, kvToken) || { aye: 0, nay: 0 };
      if (d) debates.push({ ...d, votes: v });
    }
    res.status(200).json({ debates });
    return;
  }

  if (req.method === 'POST') {
    const debate = req.body;
    if (!debate || !debate.id) {
      res.status(400).json({ error: 'Missing debate data' });
      return;
    }
    await kvSet(`debate:${debate.id}`, debate, kvUrl, kvToken);
    await kvLPush('debate:index', debate.id, kvUrl, kvToken);
    res.status(200).json({ saved: true });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
