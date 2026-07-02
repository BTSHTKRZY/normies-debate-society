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
    // Total count = full length of the index (usage metric).
    const total = await redis.llen('roast:index');
    // Hydrate the most recent 50 for the browsable list.
    const ids = await redis.lrange('roast:index', 0, 49);
    const roasts = [];
    for (const id of ids) {
      const raw = await redis.get(`roast:${id}`);
      if (!raw) continue;
      const r = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (r && Array.isArray(r.results)) roasts.push(r);
    }
    res.status(200).json({ total: total || roasts.length, roasts });
  } catch (e) {
    console.error('Roast archive error:', e.message);
    res.status(500).json({ error: e.message, total: 0, roasts: [] });
  }
};
