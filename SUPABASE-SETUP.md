# Kitti — Supabase migration state (resume notes)

Last updated into repo after deploy 07e8b6f.

## What's in the repo
- `supabase/schema.sql` — run ONCE in the Supabase dashboard (SQL Editor → New query → paste → Run). Creates: `rooms`, `room_participants`, `presence`, `global_messages`, `room_messages`, `room_seat_state`, `room_actions`, all with RLS + realtime publications + a unique case-insensitive name index per room.
- `.env` not used. URL + anon/publishable key are embedded in `src/net/supabase.ts` (publishable key, safe by design — RLS is the guard).
- `archive/` — Nostr-era backups kept for reference (not compiled).

## Project facts
- Project URL: https://rzbujszafrvvuzghcrrh.supabase.co
- Region: ap-southeast-2 (Sydney) — asked for when creating
- Anon key: sb_publishable_R_GVnnGER-b9hJYwD5wS5g__d2keKtF (publishable, client-safe)
- NEVER put the service_role / secret key here.
- Required dashboard toggle (NOT set by SQL): Authentication → Sign In / Up → enable "Allow anonymous sign-ins".

## What works after SQL + toggle are done
- Global lobby chat + presence count (`src/chat/globalChat.ts`, realtime `postgres_changes` on `global_messages`; presence via `presence` table, heartbeat 25 s, 2-min TTL, unique `name_key` index enforces one-claim-per-name).
- Public room list (`src/net/lobby.ts`) — `rooms` table, `is_public`, `expires_at`, `seats`, `heartbeat_at`; host heartbeats every 10 min / on change.

## Multiplayer rooms: FULLY ON SUPABASE (Stage 2, migrated)
- Host-authoritative engine unchanged (still the single engine in the host's browser). Only the transport moved: per-seat redacted snapshots ride `room_seat_state` (upserted by host, RLS: seat owner + host read), guest actions ride `room_actions` (RLS: only the seat's owner can insert; only host reads/deletes), room chat rides `room_messages` (participant insert own from_seat / host-only system), roster rides `room_participants`. Presence via supabase presence channel; re-sync every 30 s + full re-fetch on every (re)subscribe, so sleep/wake self-heals.
- Rejoin: a guest with an existing participant row retakes their seat (lobby or playing).
- Heartbeat: host heartbeats `rooms` every 60 s; listing expires after 45 min silence.
- Kick: host sets kicked=true → guest sees "The host removed you from the room" → row deleted 400 ms later → seat freed. Kick is lobby moderation, not a ban; a kicked player can re-join fresh afterwards.
- PeerJS/WebRTC fully removed (archived: archive/multiplayer.peerjs-backup.ts).

## Backups
- Nostr backups: archive/globalChat.nostr-backup.ts, archive/lobby.nostr-backup.ts (reference only)
- Local mirror emergency rebuild: clone github.com/realreapdeploys/kitti, npm install, npm run build

## Current state
- main app: https://realreapdeploys.github.io/kitti/
- tests: 97/97 green, typecheck clean, build clean
- Stage 1 deployed (lobby + global chat). Stage 2 deployed (rooms fully on Supabase).
- Known limits: global chat is anonymous/public (no moderation, rate-limited client-side only); kick is not a ban; presence counts can briefly overcount stale claims (2-min TTL); guest rejoin is supported; if the host's machine dies, the room closes for guests (rows expire in 45 min).
