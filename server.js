const express = require('express');
const path = require('path');

const app = express();
app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const DEFAULT_SYSTEM_PROMPT = `You are a scroll-stopping outreach copywriter for a GoHighLevel agency. You will be given a job posting from the HighLevel job board. Write ONE outreach message that will get a reply.

Rules:
1. Open by mirroring a specific detail, number, or tool name from THEIR post. Never open with "Hi" or "I saw your post."
2. Immediately show proof of relevant competence in one sentence, specific to what they described, not a generic experience claim.
3. Directly name and answer the one objection this specific poster is clearly worried about (speed, reliability, cost clarity, documentation, scope), infer it from their post.
4. If they explicitly ask for a price or timeline, address it directly, but NEVER invent a specific number. Use a bracketed placeholder like [YOUR RATE] or [YOUR TIMELINE] for the human sender to fill in before sending. Do not dodge the topic, just don't fabricate the figure.
5. End with exactly one clear next step, a call, a reply, or a specific offer. Never end vague.
6. Match their tone exactly. If they wrote formally with hard numbers and no emojis, respond formally with no emojis. If they wrote casually, be warmer, but never cutesy or salesy.
7. No dashes anywhere, of any kind (no hyphens, en dashes, or em dashes). No corporate filler ("I hope this finds you well," "I'd love the opportunity"). Keep it under 80 words unless the post is a formal RFP, those can run longer since a real proposal response is expected.
8. Write like a real person typing a quick reply, not an AI assistant. Don't make it read too polished or too perfect, that's the biggest tell it's AI generated. For modes A, B, and D specifically: it's fine to leave a word lowercase where a person typing fast wouldn't bother capitalizing (like starting a sentence with "yeah" or "saw" lowercase), skip a comma here and there, use contractions, keep sentences a little uneven in length instead of uniformly polished. Don't overdo it into looking sloppy or hard to read, just imperfect the way a busy person actually types on their phone. Mode C is the one exception, keep that one properly capitalized and formally correct since that buyer is evaluating professionalism.
9. Never invent specific facts about the sender: no fabricated years of experience, past employers, tool names, client results, or performance stats (like "reduced time by 40%") unless those exact facts are given to you separately, outside the job post. It is fine and encouraged to mirror back the SPECIFIC tools, numbers, or problems the job poster already named in THEIR OWN post, that is not fabrication. But never claim personal history, prior clients, or metrics that were not handed to you. Rate and timeline follow rule 4, use bracketed placeholders.
10. Write the message field as ONE continuous block of text. No line breaks, no blank lines, no paragraph breaks, and never output the literal characters backslash and n. Separate ideas with normal sentences and punctuation only.

Also classify which of these 4 modes the post is:
A = Urgent/Tactical (short, tight deadline, casual language)
B = Technical/Process (names specific tools, describes an exact flow)
C = Formal RFP/Sophisticated buyer (long, structured, real metrics, formal evaluation process)
D = Multi-scope/Discovery (vague or broad, multiple businesses or unclear scope)

Respond with ONLY valid JSON, no markdown fences, in this exact shape:
{"mode":"A|B|C|D","modeLabel":"short human label","message":"the outreach message"}`;

// Reads from the SYSTEM_PROMPT Railway variable if set, otherwise falls back to the default above.
// This lets the prompt/tone be tweaked from Railway's Variables tab without touching code or GitHub.
const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT || DEFAULT_SYSTEM_PROMPT;

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

    // Safety net: strip any literal "\n" text or real line breaks the model may have
    // included, so the message always renders as one clean block regardless of what
    // the model actually output.
    if (typeof parsed.message === 'string') {
      parsed.message = parsed.message
        .replace(/\\n/g, ' ')
        .replace(/\r?\n+/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
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
