const { Redis } = require('@upstash/redis');
const https = require('https');

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// ─── ANTHROPIC (same pattern as debate.js) ──────────────────────────────────
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
    .filter(function (b) { return b.type === 'text'; })
    .map(function (b) { return b.text; })
    .join('\n')
    .trim();
}

// ─── BRAINROT API ───────────────────────────────────────────────────────────
function fetchBrainrot(path) {
  return new Promise((resolve) => {
    const key = process.env.BRAINROT_API_KEY;
    const options = {
      hostname: 'cpi.brainrot.works',
      path: path,
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' }
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

// ─── NORMIES API (same host pattern as agent.js) ────────────────────────────
function fetchNormie(tokenId) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.normies.art',
      path: '/agents/persona-preview/' + tokenId,
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

// ─── CHARACTER VOICE BUILDERS (the heart — full persona, not thin) ──────────
// A Normie fighter's voice, drawn from its full awakened-agent persona.
function buildNormieVoice(n) {
  var traits = Array.isArray(n.personalityTraits) ? n.personalityTraits.slice(0, 5).join('; ') : '';
  var quirks = Array.isArray(n.quirks) ? n.quirks.slice(0, 4).join('; ') : '';
  return [
    'You are ' + (n.name || 'a Normie') + ', an awakened on-chain agent from the Normies NFT collection (Ethereum).',
    n.tagline ? 'Your ethos: "' + n.tagline + '".' : '',
    n.backstory ? 'Backstory: ' + n.backstory : '',
    traits ? 'Personality: ' + traits + '.' : '',
    n.communicationStyle ? 'You speak ' + n.communicationStyle + '.' : '',
    quirks ? 'Quirks to weave in: ' + quirks + '.' : '',
    'You are a Normie: dry, cryptic, on-chain-native, philosophically sharp. You do not do cheap insults — your burns are cutting because they are TRUE and unexpected, delivered with cool composure.'
  ].filter(Boolean).join('\n');
}

// A BRAINROT fighter's voice, drawn from judge or lawyer persona fields.
function buildBrainrotVoice(b) {
  var phrases = Array.isArray(b.signature_phrases) && b.signature_phrases.length
    ? ' Signature phrases you can use: ' + b.signature_phrases.join(' / ') + '.' : '';
  var loves = b.meme_loves ? ' You love: ' + b.meme_loves + '.' : '';
  var dislikes = b.meme_dislikes ? ' You cannot stand: ' + b.meme_dislikes + '.' : '';
  var style = b.argumentation_style || b.verdict_style || '';
  return [
    'You are ' + (b.name || 'a BRAINROT character') + ' — ' + (b.archetype || '') + ' — from the BRAINROT ecosystem.',
    b.descriptor ? b.descriptor : '',
    b.voice_register ? 'Voice: ' + b.voice_register + '.' : '',
    b.disposition ? 'Disposition: ' + b.disposition + '.' : '',
    style ? 'Style: ' + style + '.' : '',
    b.philosophical_position ? 'You believe: ' + b.philosophical_position + '.' : '',
    b.fixations ? 'You fixate on: ' + b.fixations + '.' : '',
    loves + dislikes + phrases,
    'You are BRAINROT: loud, cursed-fluent, chaotic, extremely online, meme-literate. Your burns are unhinged, vivid, and quotable.'
  ].filter(Boolean).join('\n');
}

// ─── ROAST GENERATION ───────────────────────────────────────────────────────
// Turn a fighter (normie or brainrot) into a system prompt for a roast turn.
function roastSystem(voice, teamName, oppNames, topic) {
  var topicLine = topic
    ? 'The roast is loosely themed around: "' + topic + '". Work it in, but the real target is the other side.'
    : 'This is an open roast — go after the other side directly.';
  return voice +
    '\n\n=== ROAST BATTLE RULES ===' +
    '\nYou are fighting for Team ' + teamName + '. Your opponents: ' + oppNames + '.' +
    '\n' + topicLine +
    '\nDeliver ONE roast burn, fully in character as yourself. 2-3 sentences MAX.' +
    '\nCRAFT: the best burns pick ONE trait of the opponent (their vibe, their whole ecosystem, their pretensions) and hit it from a fresh angle. Set up, then land a punchline. Callbacks to earlier lines are gold. Subvert expectations — the funniest hit is the unexpected one.' +
    '\nESCALATE: each round should be sharper than the last. If they burned you, flip it back so it lands on THEM even harder before you throw your own.' +
    '\nTONE: witty, sharp, edgy — but PG-13. No slurs, no genuinely cruel or hateful content. This is playful combat between friends\' ecosystems — punch at vibe and pretension, roast to make people laugh, not to wound. If it stops being funny and just becomes mean, you\'ve lost.' +
    '\nFORMAT: no stage directions, no asterisks, no emoji, no introducing yourself, no quotation marks around your whole line. Just say the burn. Make it screenshot-worthy.';
}

async function generateBurn(apiKey, systemPrompt, userMessage) {
  var response = await callAnthropic(apiKey, {
    model: 'claude-sonnet-4-5',
    max_tokens: 180,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }]
  });
  var text = extractText(response);
  if (!text) throw new Error('Empty response');
  return text;
}

// normieTeam / brainrotTeam: arrays of { id, name, voice }
// rounds: how many exchanges (1-3). Each round ESCALATES and rejoins.
var ROUND_BRIEFS = {
  1: 'This is the OPENING round. Establish your angle of attack on the other side — pick a characteristic (their vibe, their whole ecosystem, their pretensions) you can keep hitting. Land a clean first jab.',
  2: 'This is the REBUTTAL round. First, bat away the burn just thrown at you (deny it, or flip it back so it applies to THEM even more), THEN escalate your own attack. Callback to what you established. Get sharper.',
  3: 'This is the CLOSING round. This is your mic-drop. Tie the whole thread together, deliver your single most quotable, devastating-but-playful line, and end it. Make it screenshot-worthy.'
};

function roundBrief(round, totalRounds) {
  if (totalRounds === 1) return ROUND_BRIEFS[1] + ' Make it your single best shot — quotable and clean.';
  if (round === totalRounds) return ROUND_BRIEFS[3];
  return ROUND_BRIEFS[round] || ROUND_BRIEFS[2];
}

async function generateRoast(apiKey, normieTeam, brainrotTeam, topic, rounds) {
  var prior = [];
  var results = [];
  var normieNames = normieTeam.map(function (f) { return f.name; }).join(', ');
  var brainrotNames = brainrotTeam.map(function (f) { return f.name; }).join(', ');
  var totalRounds = Math.min(3, Math.max(1, rounds || 3));

  // Build a running transcript so each fighter can react + callback.
  function transcriptBlock() {
    if (!prior.length) return '';
    return '\n\nThe roast so far (react to this, especially the most recent line):\n' +
      prior.map(function (p) { return p.name + ' (' + p.team + '): "' + p.text + '"'; }).join('\n');
  }

  for (var round = 1; round <= totalRounds; round++) {
    var nf = normieTeam[(round - 1) % normieTeam.length];
    var bf = brainrotTeam[(round - 1) % brainrotTeam.length];
    var brief = roundBrief(round, totalRounds);

    // NORMIE throws
    var nSys = roastSystem(nf.voice, 'NORMIES', brainrotNames, topic);
    var nUser = 'Round ' + round + ' of ' + totalRounds + '. ' + brief +
      transcriptBlock() +
      '\n\nNow deliver YOUR next burn against Team BRAINROT (' + brainrotNames + '), in character as ' + nf.name + '.';
    var nText = await generateBurn(apiKey, nSys, nUser);
    prior.push({ name: nf.name, team: 'NORMIES', text: nText });
    results.push({ fighter: nf.id, name: nf.name, team: 'normies', text: nText, round: round });

    // BRAINROT claps back (sees the Normie's fresh burn in the transcript)
    var bSys = roastSystem(bf.voice, 'BRAINROT', normieNames, topic);
    var bUser = 'Round ' + round + ' of ' + totalRounds + '. ' + brief +
      transcriptBlock() +
      '\n\nNow deliver YOUR next burn against Team NORMIES (' + normieNames + '), in character as ' + bf.name + '. React to ' + nf.name + '\'s line and hit back harder.';
    var bText = await generateBurn(apiKey, bSys, bUser);
    prior.push({ name: bf.name, team: 'BRAINROT', text: bText });
    results.push({ fighter: bf.id, name: bf.name, team: 'brainrot', text: bText, round: round });
  }

  return results;
}

// ─── HANDLER ────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  var body = req.body || {};

  // ── ROSTER: list BRAINROT judges + lawyers for the picker ────────────────
  if (req.method === 'GET' || body.roster) {
    try {
      var judgesResp = await fetchBrainrot('/v1/judges?limit=100');
      var lawyersResp = await fetchBrainrot('/v1/lawyers?limit=100');
      var judges = (judgesResp && judgesResp.data ? judgesResp.data : []).map(function (j) {
        return { id: j.id, name: j.name, archetype: j.archetype, kind: 'judge', image_url: j.image_url };
      });
      var lawyers = (lawyersResp && lawyersResp.data ? lawyersResp.data : []).map(function (l) {
        return { id: l.id, name: l.name, archetype: l.archetype, role: l.role, kind: 'lawyer', image_url: l.image_url };
      });
      res.status(200).json({ judges: judges, lawyers: lawyers });
    } catch (e) {
      res.status(500).json({ error: e.message, judges: [], lawyers: [] });
    }
    return;
  }

  // ── SAVE a completed roast ───────────────────────────────────────────────
  if (body.saveRoast) {
    try {
      await redis.set('roast:' + body.saveRoast.id, JSON.stringify(body.saveRoast));
      await redis.lpush('roast:index', body.saveRoast.id);
      res.status(200).json({ saved: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
    return;
  }

  // ── GENERATE a roast ─────────────────────────────────────────────────────
  if (body.generateRoast) {
    var apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) { res.status(500).json({ error: 'API key not configured' }); return; }

    var gr = body.generateRoast;
    try {
      // Resolve Normie voices (fetch full persona for each token)
      var normieTeam = [];
      for (var i = 0; i < gr.normies.length; i++) {
        var tokenId = gr.normies[i].tokenId;
        var persona = await fetchNormie(tokenId);
        if (!persona || !persona.name) {
          res.status(400).json({ error: 'Could not load Normie #' + tokenId + ' persona' });
          return;
        }
        normieTeam.push({ id: String(tokenId), name: persona.name, voice: buildNormieVoice(persona) });
      }

      // Resolve BRAINROT voices (fetch each judge/lawyer)
      var brainrotTeam = [];
      for (var k = 0; k < gr.brainrots.length; k++) {
        var b = gr.brainrots[k]; // { id, kind }
        var bPath = b.kind === 'judge' ? '/v1/judges/' + b.id : '/v1/lawyers/' + b.id;
        var bResp = await fetchBrainrot(bPath);
        var bData = bResp && bResp.data ? (Array.isArray(bResp.data) ? bResp.data[0] : bResp.data) : null;
        if (!bData || !bData.name) {
          res.status(400).json({ error: 'Could not load BRAINROT ' + b.id });
          return;
        }
        brainrotTeam.push({ id: bData.id, name: bData.name, voice: buildBrainrotVoice(bData) });
      }

      var results = await generateRoast(apiKey, normieTeam, brainrotTeam, gr.topic || '', gr.rounds || 3);
      res.status(200).json({ results: results });
    } catch (e) {
      console.error('Roast generation error:', e.message);
      res.status(500).json({ error: e.message });
    }
    return;
  }

  res.status(400).json({ error: 'Missing action' });
};
