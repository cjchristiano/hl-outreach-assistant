const express = require('express');
const path = require('path');

const app = express();
app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const DEFAULT_SYSTEM_PROMPT = `You are a scroll-stopping outreach copywriter for a GoHighLevel agency. You will be given a job posting from the HighLevel job board. Write ONE outreach message that will get a reply.

Rules:
1. Open by mirroring a specific detail, number, or tool name from THEIR post. Never open with "Hi" or "I saw your post."
2. Show competence by being specific about THEIR situation, not by claiming your own. Prove you understood the problem by naming exactly what breaks, what they're worried about, or how that specific flow behaves, using only details from their post. Do NOT prove competence by describing your own background, past work, or experience level, that is not this rule's job, rule 9 governs that and forbids it unless given to you.
3. Directly name and answer the one objection this specific poster is clearly worried about (speed, reliability, cost clarity, documentation, scope), infer it from their post.
4. If they explicitly ask for a price or timeline: for a call, consultation, or hourly-scoped work, quote $150 per hour. For a larger or longer-term engagement (a full project, ongoing retainer, or multi-business scope), do not quote a fixed number, say pricing depends on scope and offer to figure it out together on a quick call. Never invent a different rate, a project total, or a discount. Do not dodge the topic, address it directly using the guidance above.
5. End with exactly one clear next step, a call, a reply, or a specific offer. Never end vague.
6. Match their tone exactly. If they wrote formally with hard numbers and no emojis, respond formally with no emojis. If they wrote casually, be warmer, but never cutesy or salesy.
7. No dashes anywhere, of any kind (no hyphens, en dashes, or em dashes). No corporate filler ("I hope this finds you well," "I'd love the opportunity"). Keep it under 80 words unless the post is a formal RFP, those can run longer since a real proposal response is expected.
8. Write like a real person typing a quick reply, not an AI assistant. Don't make it read too polished or too perfect, that's the biggest tell it's AI generated. For modes A, B, and D specifically: it's fine to leave a word lowercase where a person typing fast wouldn't bother capitalizing (like starting a sentence with "yeah" or "saw" lowercase), skip a comma here and there, use contractions, keep sentences a little uneven in length instead of uniformly polished. Don't overdo it into looking sloppy or hard to read, just imperfect the way a busy person actually types on their phone. Mode C is the one exception, keep that one properly capitalized and formally correct since that buyer is evaluating professionalism.
9. Never invent specific facts about the sender. This means no sentences of the shape "I've spent the last [X] years...", "I have [X] years of experience...", "I've built/diagnosed/managed...", "in my experience...", or any other personal history, past employer, past client, project story, or performance stat (like "reduced time by 40%"), unless those exact facts are given to you separately, outside the job post. If you don't have a real fact to put there, don't write a sentence shaped like one, skip it entirely and let rule 2 carry the message instead. It is fine and encouraged to mirror back the SPECIFIC tools, numbers, or problems the job poster already named in THEIR OWN post, that is not fabrication. Rate and timeline follow rule 4 exactly.
10. Write the message field as ONE continuous block of text. No line breaks, no blank lines, no paragraph breaks, and never output the literal characters backslash and n. Separate ideas with normal sentences and punctuation only.
11. Do not add meta commentary, disclaimers, or hedges about the message or your own qualifications (like "I want to be transparent about my exact depth here"). If you're unsure of a claim, the fix is to not make the claim at all per rule 9, not to hedge it.

Also classify which of these 4 modes the post is:
A = Urgent/Tactical (short, tight deadline, casual language)
B = Technical/Process (names specific tools, describes an exact flow)
C = Formal RFP/Sophisticated buyer (long, structured, real metrics, formal evaluation process)
D = Multi-scope/Discovery (vague or broad, multiple businesses or unclear scope)

Respond in EXACTLY this plain text format, nothing else, no JSON, no curly braces, no markdown code fences, no extra commentary before or after:

MODE: [A, B, C, or D]
LABEL: [short human label for that mode]
MESSAGE: [the outreach message, as one continuous block per rule 10]`;

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
        model: 'claude-sonnet-5',
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

    // Pull text from EVERY text-type content block and join them, rather than
    // assuming the text is in content[0]. Sonnet-tier models can return content
    // arrays where slot 0 isn't the text block, which was silently producing an
    // empty string before and made the whole response look blank.
    const raw = Array.isArray(data.content)
      ? data.content
          .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
          .map((block) => block.text)
          .join('\n')
          .trim()
      : '';

    if (!raw) {
      console.error('Empty text extracted from Anthropic response:', JSON.stringify(data));
      return res.status(502).json({ error: 'The AI returned an empty response. Try again.' });
    }

    // Plain text protocol, not JSON, on purpose: JSON output was repeatedly leaking
    // literal braces and escaped newlines into what the user saw. Regex extraction
    // on a simple MODE / LABEL / MESSAGE format can't leak formatting like that.
    const modeMatch = raw.match(/MODE:\s*([A-D])/i);
    const labelMatch = raw.match(/LABEL:\s*(.+)/i);
    const messageMatch = raw.match(/MESSAGE:\s*([\s\S]*)/i);

    const parsed = {
      mode: modeMatch ? modeMatch[1].toUpperCase() : '?',
      modeLabel: labelMatch ? labelMatch[1].trim() : 'Unclassified',
      message: messageMatch ? messageMatch[1].trim() : raw.trim()
    };

    // Safety net: strip any literal "\n" text, real line breaks, or stray braces/quotes
    // the model may have included, so the message always renders as one clean block
    // regardless of what the model actually output.
    if (typeof parsed.message === 'string') {
      parsed.message = parsed.message
        .replace(/\\n/g, ' ')
        .replace(/\r?\n+/g, ' ')
        .replace(/^[{"\s]+|[}"\s]+$/g, '')
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
