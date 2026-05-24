const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const debateId = req.query?.id || req.body?.id;
  if (!debateId) { res.status(400).json({ error: 'Missing id' }); return; }

  if (req.method === 'GET') {
    try {
      const raw = await redis.get(`votes:${debateId}`);
      const votes = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : { aye: 0, nay: 0 };
      res.status(200).json(votes);
    } catch (e) {
      res.status(200).json({ aye: 0, nay: 0 });
    }
    return;
  }

    if (req.method === 'POST') {
    const side = req.body?.side;
    if (!side || !['aye', 'nay'].includes(side)) {
      res.status(400).json({ error: 'Invalid side' });
      return;
    }
    try {
      const debateRaw = await redis.get(`debate:${debateId}`);
      if (debateRaw) {
        const debate = typeof debateRaw === 'string' ? JSON.parse(debateRaw) : debateRaw;
        const created = new Date(debate.timestamp).getTime();
        const age = Date.now() - created;
        const FORTY_EIGHT_HOURS = 48 * 60 * 60 * 1000;
        if (age > FORTY_EIGHT_HOURS) {
          res.status(403).json({ error: 'Voting closed', closed: true });
          return;
        }
      }
      const raw = await redis.get(`votes:${debateId}`);
    const votes = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : { aye: 0, nay: 0 };
      votes[side]++;
      await redis.set(`votes:${debateId}`, JSON.stringify(votes));

      const debateRaw = await redis.get(`debate:${debateId}`);
      if (debateRaw) {
        const debate = typeof debateRaw === 'string' ? JSON.parse(debateRaw) : debateRaw;
        const winner = votes.aye > votes.nay ? 'aye' : votes.nay > votes.aye ? 'nay' : 'tie';
        const forAgents = Array.isArray(debate.forAgents) ? debate.forAgents : [];
        const againstAgents = Array.isArray(debate.againstAgents) ? debate.againstAgents : [];
        const winTeam = winner === 'aye' ? forAgents : winner === 'nay' ? againstAgents : [];
        const loseTeam = winner === 'aye' ? againstAgents : winner === 'nay' ? forAgents : [];
        for (const agent of winTeam) {
          if (!agent?.tokenId) continue;
          const r = await redis.get(`agent:${agent.tokenId}`);
          const rec = r ? (typeof r === 'string' ? JSON.parse(r) : r) : { wins: 0, losses: 0, appearances: 0, name: '' };
          rec.wins++; rec.appearances++; rec.name = agent.name || rec.name;
          await redis.set(`agent:${agent.tokenId}`, JSON.stringify(rec));
        }
        for (const agent of loseTeam) {
          if (!agent?.tokenId) continue;
          const r = await redis.get(`agent:${agent.tokenId}`);
          const rec = r ? (typeof r === 'string' ? JSON.parse(r) : r) : { wins: 0, losses: 0, appearances: 0, name: '' };
          rec.losses++; rec.appearances++; rec.name = agent.name || rec.name;
          await redis.set(`agent:${agent.tokenId}`, JSON.stringify(rec));
        }
      }
      res.status(200).json(votes);
    } catch (e) {
      console.error('Vote error:', e.message);
      res.status(500).json({ error: e.message });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
