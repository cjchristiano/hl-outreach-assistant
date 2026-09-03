# HL Outreach Assistant

Paste a HighLevel job board posting, get a scroll-stopping outreach message back, AI-generated, tuned to the poster's tone and mode (urgent / technical / formal RFP / discovery).

## How it works

One backend endpoint (`POST /api/generate`). It sends the pasted job post plus a fixed system prompt (the outreach framework rules) to the Claude API, gets back a classified message, and returns it. No agent, no multi-step tool use, just one API call per click.

Cost: Claude Haiku, roughly $0.001 to $0.003 per generated message. 1,000 messages a month is a few dollars.

## Deploy on Railway

1. Push this folder to a GitHub repo (or use GitHub's "Add file > Upload files" in the browser, no git required).
2. In Railway, create a new project from that GitHub repo.
3. In the service's **Variables** tab, add:
   - `ANTHROPIC_API_KEY` = your key from console.anthropic.com
4. Railway auto-detects Node and runs `npm start`. Generate a public domain from the service's **Settings > Networking** tab.

## Run locally

```
npm install
ANTHROPIC_API_KEY=sk-ant-... npm start
```

Then open http://localhost:3000
