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

async function kvLRange(key, start, stop, url, token) {
  const result = await kvRequest('GET',
    `${url}/lrange/${encodeURIComponent(key)}/${start}/${stop}`, token);
  return result.result || [];
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  if (!kvUrl || !kvToken) {
    res.status(500).json({ error: 'Storage not configured' });
    return;
  }

  const debateIds = await kvLRange('debate:index', 0, 99, kvUrl, kvToken);
  const agentTokenIds = new Set();

  for (const id of debateIds) {
    const debate = await kvGet(`debate:${id}`, kvUrl, kvToken);
    if (debate) {
      (debate.forAgents || []).forEach(a => agentTokenIds.add(String(a.tokenId)));
      (debate.againstAgents || []).forEach(a => agentTokenIds.add(String(a.tokenId)));
    }
  }

  const leaderboard = [];
  for (const tokenId of agentTokenIds) {
    const record = await kvGet(`agent:${tokenId}`, kvUrl, kvToken);
    if (record && record.appearances > 0) {
      leaderboard.push({
        tokenId,
        ...record,
        winRate: record.appearances > 0
          ? Math.round((record.wins / record.appearances) * 100)
          : 0
      });
    }
  }

  leaderboard.sort((a, b) => b.wins - a.wins || b.winRate - a.winRate);

  res.status(200).json({ leaderboard: leaderboard.slice(0, 20) });
};
