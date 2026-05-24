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
    const ids = await redis.lrange('debate:index', 0, 49);
    console.log('debate ids:', ids);

    const debates = [];
    for (const id of ids) {
      const raw = await redis.get(`debate:${id}`);
      if (!raw) continue;
      const d = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const votesRaw = await redis.get(`votes:${id}`);
      const v = votesRaw ? (typeof votesRaw === 'string' ? JSON.parse(votesRaw) : votesRaw) : { aye: 0, nay: 0 };
      if (d && d.topic) debates.push({ ...d, votes: v });
    }

    res.status(200).json({ debates });
  } catch (e) {
    console.error('Archive error:', e.message);
    res.status(500).json({ error: e.message, debates: [] });
  }
};
