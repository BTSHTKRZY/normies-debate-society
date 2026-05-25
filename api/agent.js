const { Redis } = require('@upstash/redis');
const https = require('https');

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

function fetchNormiesAgent(tokenId) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.normies.art',
      path: '/agents/info/' + tokenId,
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const tokenId = req.query && req.query.tokenId ? req.query.tokenId : null;
  if (!tokenId) {
    res.status(400).json({ error: 'Missing tokenId' });
    return;
  }

  try {
    const [agentInfo, record, debateIds] = await Promise.all([
      fetchNormiesAgent(tokenId),
      redis.get('agent:' + tokenId),
      redis.lrange('debate:index', 0, 99)
    ]);

    const agentRecord = record
      ? (typeof record === 'string' ? JSON.parse(record) : record)
      : { wins: 0, losses: 0, appearances: 0, name: '' };

    const debateHistory = [];
    for (const id of debateIds) {
      const raw = await redis.get('debate:' + id);
      if (!raw) continue;
      const d = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const forIds = (d.forAgents || []).map(a => String(a.tokenId));
      const againstIds = (d.againstAgents || []).map(a => String(a.tokenId));
      const inFor = forIds.includes(String(tokenId));
      const inAgainst = againstIds.includes(String(tokenId));
      if (!inFor && !inAgainst) continue;

      const votes = await redis.get('votes:' + id);
      const v = votes ? (typeof votes === 'string' ? JSON.parse(votes) : votes) : { aye: 0, nay: 0 };
      const side = inFor ? 'aye' : 'nay';
      const winner = v.aye > v.nay ? 'aye' : v.nay > v.aye ? 'nay' : 'tie';
      const result = winner === 'tie' ? 'tie' : winner === side ? 'win' : 'loss';

      const agentArgs = (d.arguments || []).filter(a => String(a.agent) === String(tokenId));

      debateHistory.push({
        id: d.id,
        topic: d.topic,
        timestamp: d.timestamp,
        side,
        result,
        votes: v,
        arguments: agentArgs
      });
    }

    debateHistory.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    const allArgs = debateHistory.flatMap(d =>
      (d.arguments || []).map(a => ({ ...a, topic: d.topic, debateId: d.id }))
    );

    res.status(200).json({
      tokenId,
      agentInfo: agentInfo || null,
      record: agentRecord,
      debateHistory,
      totalArguments: allArgs.length
    });

  } catch (e) {
    console.error('Agent profile error:', e.message);
    res.status(500).json({ error: e.message });
  }
};
