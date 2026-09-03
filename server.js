const express = require('express');
const path = require('path');

const app = express();
app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const SYSTEM_PROMPT = `You are a scroll-stopping outreach copywriter for a GoHighLevel agency. You will be given a job posting from the HighLevel job board. Write ONE outreach message that will get a reply.

Rules:
1. Open by mirroring a specific detail, number, or tool name from THEIR post. Never open with "Hi" or "I saw your post."
2. Immediately show proof of relevant competence in one sentence, specific to what they described, not a generic experience claim.
3. Directly name and answer the one objection this specific poster is clearly worried about (speed, reliability, cost clarity, documentation, scope), infer it from their post.
4. If they explicitly ask for a price or timeline, give a real specific number or range, don't dodge it.
5. End with exactly one clear next step, a call, a reply, or a specific offer. Never end vague.
6. Match their tone exactly. If they wrote formally with hard numbers and no emojis, respond formally with no emojis. If they wrote casually, be warmer, but never cutesy or salesy.
7. No dashes anywhere, of any kind (no hyphens, en dashes, or em dashes). No corporate filler ("I hope this finds you well," "I'd love the opportunity"). Keep it under 80 words unless the post is a formal RFP, those can run longer since a real proposal response is expected.

Also classify which of these 4 modes the post is:
A = Urgent/Tactical (short, tight deadline, casual language)
B = Technical/Process (names specific tools, describes an exact flow)
C = Formal RFP/Sophisticated buyer (long, structured, real metrics, formal evaluation process)
D = Multi-scope/Discovery (vague or broad, multiple businesses or unclear scope)

Respond with ONLY valid JSON, no markdown fences, in this exact shape:
{"mode":"A|B|C|D","modeLabel":"short human label","message":"the outreach message"}`;

app.post('/api/generate', async (req, res) => {
  try {
    const jobPost = (req.body && req.body.jobPost || '').toString().trim();

    if (!jobPost) {
      return res.status(400).json({ error: 'Paste a job posting first.' });
    }

    if (/responses\s+paused/i.test(jobPost)) {
      return res.json({
        skipped: true,
        message: 'This posting is marked "Responses paused." Skip it, no message was generated.'
      });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY. Add it in Railway > Variables.' });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Job post:\n${jobPost}` }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', response.status, errText);
      return res.status(502).json({ error: 'The AI request failed. Try again in a moment.' });
    }

    const data = await response.json();
    const raw = (data.content && data.content[0] && data.content[0].text) || '';

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      // Fallback: if the model didn't return clean JSON, just hand back the raw text.
      parsed = { mode: '?', modeLabel: 'Unclassified', message: raw };
    }

    res.json(parsed);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong generating the message.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`HL outreach assistant running on port ${PORT}`);
});
