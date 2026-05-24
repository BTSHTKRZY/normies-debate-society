const { Redis } = require('@upstash/redis');
const https = require('https');

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

function callAnthropic(apiKey, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05',
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) reject(new Error(parsed.error.message));
          else resolve(parsed);
        } catch (e) { reject(new Error('Parse failed')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(25000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(payload);
    req.end();
  });
}

function extractText(response) {
  if (!response || !response.content) return '';
  return response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();
}

async function generateArgument(apiKey, systemPrompt, userMessage) {
  const response = await callAnthropic(apiKey, {
    model: 'claude-sonnet-4-5',
    max_tokens: 1000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }]
  });
  const text = extractText(response);
  if (!text) throw new Error('Empty response');
  return text;
}

async function researchTopic(apiKey, topic) {
  try {
    const response = await callAnthropic(apiKey, {
      model: 'claude-sonnet-4-5',
      max_tokens: 1000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{
        role: 'user',
        content: 'Research the current state of this debate topic: "' + topic + '". Find 4-5 relevant recent facts, statistics, or news items that debaters on both sides could use. Be concise. Return only a brief bullet-point summary.'
      }]
    });
    const summary = extractText(response);
    console.log('Research complete for topic:', topic.slice(0, 50));
    return summary || '';
  } catch (e) {
    console.error('Research failed:', e.message);
    return '';
  }
}

async function generateFullDebate(apiKey, forAgents, againstAgents, topic, research) {
  const prior = [];
  const results = [];
  const researchBlock = research ? '\n\nCURRENT RESEARCH about this topic:\n' + research : '';

  for (let round = 1; round <= 3; round++) {
    const forAgent = forAgents[round - 1];
    const againstAgent = againstAgents[round - 1];

    const historyBlock = prior.length
      ? '\n\nDebate so far:\n' + prior.map(function(p) {
          return p.name + ' (' + (p.side === 'for' ? 'FOR' : 'AGAINST') + '): ' + p.text;
        }).join('\n\n')
      : '';

    const forSystem = forAgent.systemPrompt +
      '\n\nYou are a member of The Normies Debate Society, arguing FOR the motion: "' + topic + '". ' +
      'Stay completely in character. Be sharp, specific, and direct. 3 to 5 sentences maximum. ' +
      'Do not introduce yourself. Engage with prior arguments when they exist. ' +
      'Use current facts from the research provided where relevant.';

    const forUser = 'Make your argument FOR the motion: "' + topic + '"' + researchBlock + historyBlock;

    const forText = await generateArgument(apiKey, forSystem, forUser);
    prior.push({ name: forAgent.name, side: 'for', text: forText });
    results.push({ agent: forAgent.tokenId, name: forAgent.name, side: 'for', text: forText, round: round });

    const updatedHistory = '\n\nDebate so far:\n' + prior.map(function(p) {
      return p.name + ' (' + (p.side === 'for' ? 'FOR' : 'AGAINST') + '): ' + p.text;
    }).join('\n\n');

    const againstSystem = againstAgent.systemPrompt +
      '\n\nYou are a member of The Normies Debate Society, arguing AGAINST the motion: "' + topic + '". ' +
      'Stay completely in character. Be sharp, specific, and direct. 3 to 5 sentences maximum. ' +
      'Do not introduce yourself. Engage with prior arguments when they exist. ' +
      'Use current facts from the research provided where relevant.';

    const againstUser = 'Make your argument AGAINST the motion: "' + topic + '"' + researchBlock + updatedHistory;

    const againstText = await generateArgument(apiKey, againstSystem, againstUser);
    prior.push({ name: againstAgent.name, side: 'against', text: againstText });
    results.push({ agent: againstAgent.tokenId, name: againstAgent.name, side: 'against', text: againstText, round: round });
  }

  return results;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'API key not configured' });
    return;
  }

  const body = req.body || {};

  if (body.saveDebate) {
    try {
      console.log('Saving debate:', body.saveDebate.id);
      await redis.set('debate:' + body.saveDebate.id, JSON.stringify(body.saveDebate));
      await redis.lpush('debate:index', body.saveDebate.id);
      console.log('Debate saved successfully:', body.saveDebate.id);
      res.status(200).json({ saved: true });
    } catch (e) {
      console.error('Save error:', e.message);
      res.status(500).json({ error: e.message });
    }
    return;
  }

  if (body.researchTopic) {
    try {
      const summary = await researchTopic(apiKey, body.researchTopic);
      res.status(200).json({ research: summary });
    } catch (e) {
      res.status(200).json({ research: '' });
    }
    return;
  }

  if (body.generateDebate) {
    const { forAgents, againstAgents, topic, research } = body.generateDebate;
    try {
      const results = await generateFullDebate(apiKey, forAgents, againstAgents, topic, research);
      res.status(200).json({ results: results });
    } catch (e) {
      console.error('Debate generation error:', e.message);
      res.status(500).json({ error: e.message });
    }
    return;
  }

  if (!body.systemPrompt || !body.userMessage) {
    res.status(400).json({ error: 'Missing fields' });
    return;
  }

  try {
    const text = await generateArgument(apiKey, body.systemPrompt, body.userMessage);
    res.status(200).json({ text: text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
