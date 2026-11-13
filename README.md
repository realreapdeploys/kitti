# KITTI — Nau Patti
Nine Card Brag for the table: nine cards, three hands, one loser.

- **Play vs bots** or open **Multiplayer** to host/join an online table with a room code (private), or list a public room. The host's browser runs the game; friends join by code on any device.
- **The Tab** tracks real-money IOUs between players (integer cents, append-only log, undoable, CSV export) — it never moves actual money.
- Works offline in your browser once loaded. `docs/` is the built site published to GitHub Pages.
- Local dev: `npm install && npm run dev`. Build for Pages: `vite build --base=/kitti/`.
