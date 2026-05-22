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

  const debateId = req.query?.id || (req.body?.id);

  if (!debateId) {
    res.status(400).json({ error: 'Missing debate id' });
    return;
  }

  if (req.method === 'GET') {
    const votes = await kvGet(`votes:${debateId}`, kvUrl, kvToken) || { aye: 0, nay: 0 };
    res.status(200).json(votes);
    return;
  }

  if (reconst winTeam = winner === 'aye' ? (debate.forAgents || []) : winner === 'nay' ? (debate.againstAgents || []) : [];
const loseTeam = winner === 'aye' ? (debate.againstAgents || []) : winner === 'nay' ? (debate.forAgents || []) : [];
for (const agent of winTeam) {
{
      res.status(400).json({ error: 'Invalid side' });
      return;
    }
    const votes = await kvGet(`votes:${debateId}`, kvUrl, kvToken) || { aye: 0, nay: 0 };
    votes[side]++;
    await kvSet(`votes:${debateId}`, votes, kvUrl, kvToken);

    if (votes.aye + votes.nay >= 1) {
      const debate = await kvGet(`debate:${debateId}`, kvUrl, kvToken);
      if (debate) {
        const winner = votes.aye > votes.nay ? 'aye' : votes.nay > votes.aye ? 'nay' : 'tie';
        const winTeam = winner === 'aye' ? debate.forAgents : winner === 'nay' ? debate.againstAgents : [];
        const loseTeam = winner === 'aye' ? debate.againstAgents : winner === 'nay' ? debate.forAgents : [];
        for (const agent of winTeam) {
          const record = await kvGet(`agent:${agent.tokenId}`, kvUrl, kvToken) || { wins: 0, losses: 0, appearances: 0 };
          record.wins++; record.appearances++;
          await kvSet(`agent:${agent.tokenId}`, record, kvUrl, kvToken);
        }
        for (const agent of loseTeam) {
          const record = await kvGet(`agent:${agent.tokenId}`, kvUrl, kvToken) || { wins: 0, losses: 0, appearances: 0 };
          record.losses++; record.appearances++;
          await kvSet(`agent:${agent.tokenId}`, record, kvUrl, kvToken);
        }
      }
    }
    res.status(200).json(votes);
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
