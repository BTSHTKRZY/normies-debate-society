const https = require('https');

function kvRequest(method, urlStr, token, bodyObj) {
  return new Promise((resolve, reject) => {
    const payload = bodyObj ? JSON.stringify(bodyObj) : null;
    const urlObj = new URL(urlStr);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
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

async function kvGet(key, url, token) {
  try {
    const r = await kvRequest('GET', `${url}/get/${encodeURIComponent(key)}`, token);
    return r.result ? JSON.parse(r.result) : null;
  } catch { return null; }
}

async function kvSet(key, value, url, token) {
  try {
    await kvRequest('POST', `${url}/set/${encodeURIComponent(key)}`, token, [JSON.stringify(value)]);
  } catch (e) { console.error('kvSet error:', e.message); }
}

async function kvLPush(key, value, url, token) {
  try {
    const r = await kvRequest('POST', `${url}/lpush/${encodeURIComponent(key)}`, token, [JSON.stringify(value)]);
    console.log('lpush result:', JSON.stringify(r));
  } catch (e) { console.error('lpush error:', e.message); }
}

async function kvLRange(key, start, stop, url, token) {
  try {
    const r = await kvRequest('GET', `${url}/lrange/${encodeURIComponent(key)}/${start}/${stop}`, token);
    console.log('lrange result:', JSON.stringify(r));
    return Array.isArray(r.result) ? r.result : [];
  } catch { return []; }
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
      const debate = await kvGet(`debate:${id}`, kvUrl, kvToken);
      const votes = await kvGet(`votes:${id}`, kvUrl, kvToken) || { aye: 0, nay: 0 };
      if (!debate) { res.status(404).json({ error: 'Not found' }); return; }
      res.status(200).json({ ...debate, votes });
      return;
    }

    const ids = await kvLRange('debate:index', 0, 49, kvUrl, kvToken);
    console.log('debate ids from index:', JSON.stringify(ids));

    const debates = [];
    for (const rawId of ids) {
      let did = rawId;
      try { did = JSON.parse(rawId); } catch { }
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
