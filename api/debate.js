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
    .filter(function(b) { return b.type === 'text'; })
    .map(function(b) { return b.text; })
    .join('\n')
    .trim();
}

function buildCharacter(agent) {
  var name = agent.name || 'Agent';
  var type = agent.type || 'Human';
  var tagline = agent.tagline || '';
  return 'You are ' + name + ', a ' + type + 
    ' from the Normies NFT collection.' +
    (tagline ? ' "' + tagline + '"' : '');
}

async function generateArgument(apiKey, systemPrompt, userMessage) {
  var response = await callAnthropic(apiKey, {
    model: 'claude-sonnet-4-5',
    max_tokens: 200,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }]
  });
  var text = extractText(response);
  if (!text) throw new Error('Empty response');
  return text;
}

async function researchTopic(apiKey, topic) {
  try {
    var response = await callAnthropic(apiKey, {
      model: 'claude-sonnet-4-5',
      max_tokens: 200,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{
        role: 'user',
        content: 'Research: "' + topic + '". Give me 4 brief bullet points of current relevant facts. Be very concise.'
      }]
    });
    var summary = extractText(response);
    console.log('Research complete for topic:', topic.slice(0, 50));
    return summary ? summary.slice(0, 400) : '';
  } catch (e) {
    console.error('Research failed:', e.message);
    return '';
  }
}

async function generateFullDebate(apiKey, forAgents, againstAgents, topic, research) {
  var prior = [];
  var results = [];
  var researchBlock = research ? '\n\nKEY FACTS:\n' + research.slice(0, 400) : '';

  for (var round = 1; round <= 3; round++) {
    var forAgent = forAgents[round - 1];
    var againstAgent = againstAgents[round - 1];

      var recentPrior = prior.slice(-2);
  var historyBlock = recentPrior.length > 0
      ? '\n\nMost recent arguments:\n' + recentPrior.map(function(p) {
          var shortText = p.text.length > 150 ? p.text.slice(0, 150) + '...' : p.text;
          return p.name + ' (' + (p.side === 'for' ? 'FOR' : 'AGAINST') + '): ' + shortText;
        }).join('\n\n')
      : '';

    var forSystem = buildCharacter(forAgent) +
      '\n\nYou are arguing FOR: "' + topic + '". ' +
      'Stay in character. 3-4 sentences max. No introduction. ' +
      'Engage prior arguments. Use research facts where relevant.';

    var forUser = 'Argue FOR: "' + topic + '"' + researchBlock + historyBlock;

    var forText = await generateArgument(apiKey, forSystem, forUser);
    prior.push({ name: forAgent.name, side: 'for', text: forText });
    results.push({
      agent: forAgent.tokenId,
      name: forAgent.name,
      side: 'for',
      text: forText,
      round: round
    });

      var recentUpdated = prior.slice(-2);
  var updatedHistory = '\n\nMost recent arguments:\n' + recentUpdated.map(function(p) {
      var shortText = p.text.length > 150 ? p.text.slice(0, 150) + '...' : p.text;
      return p.name + ' (' + (p.side === 'for' ? 'FOR' : 'AGAINST') + '): ' + shortText;
    }).join('\n\n');

    var againstSystem = buildCharacter(againstAgent) +
      '\n\nYou are arguing AGAINST: "' + topic + '". ' +
      'Stay in character. 3-4 sentences max. No introduction. ' +
      'Engage prior arguments. Use research facts where relevant.';

    var againstUser = 'Argue AGAINST: "' + topic + '"' + researchBlock + updatedHistory;

    var againstText = await generateArgument(apiKey, againstSystem, againstUser);
    prior.push({ name: againstAgent.name, side: 'against', text: againstText });
    results.push({
      agent: againstAgent.tokenId,
      name: againstAgent.name,
      side: 'against',
      text: againstText,
      round: round
    });
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

  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'API key not configured' });
    return;
  }

  var body = req.body || {};

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
      var summary = await researchTopic(apiKey, body.researchTopic);
      res.status(200).json({ research: summary });
    } catch (e) {
      res.status(200).json({ research: '' });
    }
    return;
  }

  if (body.generateDebate) {
    var gd = body.generateDebate;
    try {
      var results = await generateFullDebate(
        apiKey,
        gd.forAgents,
        gd.againstAgents,
        gd.topic,
        gd.research || ''
      );
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
    var text = await generateArgument(apiKey, body.systemPrompt, body.userMessage);
    res.status(200).json({ text: text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
