# SHUSH Trivia

SHUSH Trivia is a browser-based, mobile-friendly multiplayer trivia game. Players join the same room from their phones, choose a name and avatar, vote on a category, ready up, then answer a configurable set of family-friendly multiple-choice questions in real time.

## Features

- Room codes and direct join links such as `/room/ABCD`
- Real-time lobby, ready status, category votes, questions, answers, reveals, and leaderboard with Socket.IO
- In-memory room state for a simple reliable MVP
- 15-question rounds by default, configurable with `QUESTION_COUNT`
- 20-second question timer, configurable with `QUESTION_TIMER_SECONDS`
- Correct answers award 5 points; fastest correct answer earns 1 bonus point
- Duplicate answer prevention and locked answers
- Reconnect support through a saved browser player id
- Host controls for manual start, reveal, advance, reset, and kicking offline players
- AI question generation with validation and built-in fallback question banks for every category

## Tech Stack

- React + TypeScript + Vite
- Express + Socket.IO
- Framer Motion for subtle UI animations
- Zod for AI response validation
- In-memory room store

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create an environment file:

   ```bash
   cp .env.example .env
   ```

3. Optional: add an OpenAI API key to `.env`:

   ```bash
   OPENAI_API_KEY=your_key_here
   OPENAI_MODEL=gpt-4o-mini
   QUESTION_TIMER_SECONDS=20
   QUESTION_COUNT=15
   PORT=3001
   ```

   If `OPENAI_API_KEY` is not set, SHUSH Trivia automatically uses the built-in family-friendly fallback questions.

4. Run locally:

   ```bash
   npm run dev
   ```

5. Open the app:

   ```text
   http://localhost:5173
   ```

Phones on the same network can join if your dev machine is reachable by LAN IP, for example `http://192.168.1.20:5173/room/ABCD`.

## How The Game Works

1. A host creates a room and shares the room code or link.
2. Players join from their phones, enter a display name, pick an avatar, vote for a category, and press `Ready to Play`.
3. Once every joined player is ready, the server counts votes and starts a round.
4. The server generates or falls back to the configured number of validated questions.
5. Each player gets one answer per question. Late answers and duplicate answers are ignored.
6. When all connected players answer, or the timer expires, the answer is revealed and scores are awarded.
7. After the final question, the leaderboard appears.

## Deployment Notes

This MVP uses persistent WebSockets, so deploy it to a service that supports long-running Node servers and socket connections, such as:

- Render
- Railway
- Fly.io
- A VPS or container host

Vercel is excellent for static and serverless apps, but this Socket.IO server is better suited to a persistent Node process unless you replace the real-time layer with a hosted realtime provider.

For production:

```bash
npm run build
npm start
```

Set the same environment variables on your host:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `QUESTION_TIMER_SECONDS`
- `PORT`

## Future Improvements

- Persist room state in Redis, Supabase, Firebase, or Postgres
- Add a spectator host screen for a TV
- Add QR code sharing
- Add per-room custom settings for timer and question count
- Add stronger anti-cheat controls by sending each player only their current question payload
