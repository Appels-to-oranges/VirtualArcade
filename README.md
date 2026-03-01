# Texas Hold'em Poker

A room-based multiplayer Texas Hold'em poker game using Node.js and WebSockets. Uses card assets from the `cards` folder on your Desktop.

## Setup

```bash
npm install
npm start
```

Open http://localhost:3000 in your browser.

## How to Play

1. Enter a **room key** (e.g. `poker-night`) and your **nickname**
2. Share the same room key with friends
3. Once 2+ players are in, click **Start Game**
4. Play Texas Hold'em: fold, check, call, bet, or raise

## Card Assets

The game looks for cards in `public/cards` (for deployment) or `../cards` (Desktop, for local dev). Expected structure:

- `hearts/`, `diamonds/`, `clubs/`, `spades/` — each with `2.png` through `10.png`, `A.png`, `J.png`, `Q.png`, `K.png`
- `backs/blue.png` — card back for hidden cards

**For Railway/deployment:** Copy your `Desktop/cards` folder into `Poker/public/cards` and commit it so cards are bundled.

## URL Parameters

Add `?room=my-room` to pre-fill the room key.
