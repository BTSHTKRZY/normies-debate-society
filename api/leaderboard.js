const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
           const timeoutMs = 8000;
    const deadline = Date.now() + timeoutMs;

    const ids = await redis.lrange('debate:index', 0, 9);
    const agentIds = new Set();

    for (const id of ids) {
      if (Date.now() > deadline) break;
      const raw = await redis.get(`debate:${id}`);
      if (!raw) continue;
      const d = typeof raw === 'string' ? JSON.parse(raw) : raw;
      (d.forAgents || []).forEach(a => a?.tokenId && agentIds.add(String(a.tokenId)));
      (d.againstAgents || []).forEach(a => a?.tokenId && agentIds.add(String(a.tokenId)));
    }

    const leaderboard = [];
    for (const tokenId of agentIds) {
      if (Date.now() > deadline) break;
      const raw = await redis.get(`agent:${tokenId}`);
      if (!raw) continue;
      const rec = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (rec.appearances > 0) {
        leaderboard.push({
          tokenId,
          ...rec,
          winRate: Math.round((rec.wins / rec.appearances) * 100)
        });
      }
    }

    leaderboard.sort((a, b) => b.wins - a.wins || b.winRate - a.winRate);
    res.status(200).json({ leaderboard: leaderboard.slice(0, 20) });
  } catch (e) {
    console.error('Leaderboard error:', e.message);
    res.status(500).json({ error: e.message, leaderboard: [] });
  }
};
