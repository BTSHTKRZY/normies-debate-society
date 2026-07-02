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

  const roastId = req.query?.id || req.body?.id;
  if (!roastId) { res.status(400).json({ error: 'Missing id' }); return; }

  if (req.method === 'GET') {
    try {
      const raw = await redis.get(`roastvotes:${roastId}`);
      const votes = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : { normies: 0, brainrot: 0 };
      res.status(200).json(votes);
    } catch (e) {
      res.status(200).json({ normies: 0, brainrot: 0 });
    }
    return;
  }

  if (req.method === 'POST') {
    const side = req.body?.side;
    if (!side || !['normies', 'brainrot'].includes(side)) {
      res.status(400).json({ error: 'Invalid side' });
      return;
    }
    try {
      const raw = await redis.get(`roastvotes:${roastId}`);
      const votes = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : { normies: 0, brainrot: 0 };
      votes[side]++;
      await redis.set(`roastvotes:${roastId}`, JSON.stringify(votes));
      res.status(200).json(votes);
    } catch (e) {
      console.error('Roast vote error:', e.message);
      res.status(500).json({ error: e.message });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
