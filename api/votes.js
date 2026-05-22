const https = require('https');

function kvRequest(method, urlStr, token, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(urlStr);
    const payload = body ? JSON.stringify(body) : null;
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
        catch { resolve(data); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function kvGet(key, url, token) {
  try {
    const result = await kvRequest('GET', url + '/get/' + encodeURIComponent(key), token);
    return result.result ? JSON.parse(result.result) : null;
  } catch (e) { return null; }
}

async function kvSet(key, value, url, token) {
  try {
    await kvRequest('POST', url + '/set/' + encodeURIComponent(key), token, { value: JSON.stringify(value) });
  } catch (e) { console.error('kvSet error:', e.message); }
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

  const debateId = req.query && req.query.id ? req.query.id : (req.body && req.body.id ? req.body.id : null);

  if (!debateId) {
    res.status(400).json({ error: 'Missing debate id' });
    return;
  }

  if (req.method === 'GET') {
    const votes = await kvGet('votes:' + debateId, kvUrl, kvToken) || { aye: 0, nay: 0 };
    res.status(200).json(votes);
    return;
  }

  if (req.method === 'POST') {
    const side = req.body && req.body.side ? req.body.side : null;
    if (!side || (side !== 'aye' && side !== 'nay')) {
      res.status(400).json({ error: 'Invalid side' });
      return;
    }

    const votes = await kvGet('votes:' + debateId, kvUrl, kvToken) || { aye: 0, nay: 0 };
    votes[side]++;
    await kvSet('votes:' + debateId, votes, kvUrl, kvToken);

    try {
      const debate = await kvGet('debate:' + debateId, kvUrl, kvToken);
      if (debate) {
        const total = votes.aye + votes.nay;
        const winner = votes.aye > votes.nay ? 'aye' : votes.nay > votes.aye ? 'nay' : 'tie';
        const forAgents = Array.isArray(debate.forAgents) ? debate.forAgents : [];
        const againstAgents = Array.isArray(debate.againstAgents) ? debate.againstAgents : [];
        const winTeam = winner === 'aye' ? forAgents : winner === 'nay' ? againstAgents : [];
        const loseTeam = winner === 'aye' ? againstAgents : winner === 'nay' ? forAgents : [];

        for (const agent of winTeam) {
          if (!agent || !agent.tokenId) continue;
          const record = await kvGet('agent:' + agent.tokenId, kvUrl, kvToken) || { wins: 0, losses: 0, appearances: 0, name: agent.name || '' };
          record.wins++;
          record.appearances++;
          record.name = agent.name || record.name;
          await kvSet('agent:' + agent.tokenId, record, kvUrl, kvToken);
        }

        for (const agent of loseTeam) {
          if (!agent || !agent.tokenId) continue;
          const record = await kvGet('agent:' + agent.tokenId, kvUrl, kvToken) || { wins: 0, losses: 0, appearances: 0, name: agent.name || '' };
          record.losses++;
          record.appearances++;
          record.name = agent.name || record.name;
          await kvSet('agent:' + agent.tokenId, record, kvUrl, kvToken);
        }
      }
    } catch (e) {
      console.error('Record update error:', e.message);
    }

    res.status(200).json(votes);
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
