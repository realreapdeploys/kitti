-- Kitti — complete schema (Stage 1 + Stage 2).
-- Run this ONCE in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Then enable anonymous sign-ins: Authentication → Sign In / Up → turn ON "Allow anonymous sign-ins".


-- ---------- grants (required: the dashboard does not add them for you) ----------
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant usage, select on sequences to authenticated;

-- ---------- rooms (public lobby + multiplayer) ----------
create table if not exists public.rooms (
  code text primary key check (char_length(code) = 5),
  host_id uuid not null,
  name text not null default 'Kitti table' check (char_length(name) between 1 and 48),
  is_public boolean not null default false,
  starting_chips integer not null default 2000 check (starting_chips between 100 and 1000000),
  boot integer not null default 100 check (boot between 0 and 100000),
  win_condition text not null default 'any_two',
  status text not null default 'open' check (status in ('open','in_game')),
  seats integer not null default 1 check (seats between 1 and 5),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '45 minutes',
  heartbeat_at timestamptz not null default now()
);
alter table public.rooms add column if not exists host_name text;
alter table public.rooms enable row level security;
drop policy if exists "authenticated read rooms" on public.rooms;
create policy "authenticated read rooms" on public.rooms for select to authenticated using (true);
drop policy if exists "host inserts own room" on public.rooms;
create policy "host inserts own room" on public.rooms for insert to authenticated with check (auth.uid() = host_id);
drop policy if exists "host updates own room" on public.rooms;
create policy "host updates own room" on public.rooms for update to authenticated using (auth.uid() = host_id) with check (auth.uid() = host_id);
drop policy if exists "host deletes own room" on public.rooms;
create policy "host deletes own room" on public.rooms for delete to authenticated using (auth.uid() = host_id);
drop policy if exists "sweep expired rooms" on public.rooms;
create policy "sweep expired rooms" on public.rooms for delete to authenticated using (expires_at < now());
create index if not exists rooms_public_idx on public.rooms (is_public, expires_at) where is_public;

-- ---------- room participants (seat ownership; drives Redaction) ----------
create table if not exists public.room_participants (
  room_code text not null references public.rooms(code) on delete cascade,
  seat integer not null check (seat between 0 and 4),
  user_id uuid not null,
  name text not null check (char_length(name) between 1 and 24),
  buy_in integer not null check (buy_in between 100 and 1000000),
  kicked boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (room_code, seat),
  unique (room_code, user_id)
);
alter table public.room_participants enable row level security;
drop policy if exists "authenticated read participants" on public.room_participants;
create policy "authenticated read participants" on public.room_participants for select to authenticated using (true);
drop policy if exists "join as yourself" on public.room_participants;
create policy "join as yourself" on public.room_participants for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "update own participant row" on public.room_participants;
create policy "update own participant row" on public.room_participants for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "host can kick in their room" on public.room_participants;
create policy "host can kick in their room" on public.room_participants for update to authenticated using (exists (select 1 from public.rooms r where r.code = room_code and r.host_id = auth.uid())) with check (exists (select 1 from public.rooms r where r.code = room_code and r.host_id = auth.uid()));
drop policy if exists "leave or be removed by host" on public.room_participants;
create policy "leave or be removed by host" on public.room_participants for delete to authenticated using (auth.uid() = user_id or exists (select 1 from public.rooms r where r.code = room_code and r.host_id = auth.uid()));

-- ---------- room_state (full engine state, host-only read, for host takeover) ----------
create table if not exists public.room_state (
  room_code text primary key references public.rooms(code) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.room_state enable row level security;
drop policy if exists "current host reads state" on public.room_state;
create policy "current host reads state" on public.room_state for select to authenticated
  using (exists (select 1 from public.rooms r where r.code = room_code and r.host_id = auth.uid()));
drop policy if exists "current host writes state" on public.room_state;
create policy "current host writes state" on public.room_state for insert to authenticated
  with check (exists (select 1 from public.rooms r where r.code = room_code and r.host_id = auth.uid()));
drop policy if exists "current host updates state" on public.room_state;
create policy "current host updates state" on public.room_state for update to authenticated
  using (exists (select 1 from public.rooms r where r.code = room_code and r.host_id = auth.uid()))
  with check (exists (select 1 from public.rooms r where r.code = room_code and r.host_id = auth.uid()));

-- ---------- host promotion (security definer: transfers host_id when the seat-0 player vanishes) ----------
-- A hosted room never becomes unusable when its host disappears. Participants call this once when
-- they notice seat 0 is missing; the function is idempotent (returns the current host, or re-randomizes
-- only when the current host is no longer seated).
create or replace function public.promote_next_host(p_code text) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_old uuid;
  v_new uuid;
  v_hb timestamptz;
begin
  select host_id, heartbeat_at into v_old, v_hb from public.rooms where code = p_code for update;
  if v_old is null then
    return null;
  end if;
  if not exists (select 1 from public.room_participants where room_code = p_code and user_id = auth.uid()) then
    raise exception 'not a participant of room %', p_code;
  end if;
  -- stable: host still seated AND heartbeat fresh -> nothing to do
  if exists (select 1 from public.room_participants where room_code = p_code and user_id = v_old)
     and (v_hb is null or now() - v_hb < interval '45 seconds') then
    return v_old;
  end if;
  -- host is gone or its heartbeat died (abrupt kill): evict the ghost seat-0 row so officials can move
  delete from public.room_participants where room_code = p_code and user_id = v_old;
  select user_id into v_new from public.room_participants where room_code = p_code order by random() limit 1;
  if v_new is null then
    delete from public.rooms where code = p_code;
    return null;
  end if;
  update public.rooms set host_id = v_new, heartbeat_at = now() where code = p_code;
  return v_new;
end $$;
grant execute on function public.promote_next_host(text) to authenticated;

-- ---------- empty-room garbage collection ----------
-- Fires on every participant DELETE: if nobody is left in the room, the room row disappears
-- immediately (cascades to snapshots/actions/messages). Runs as definer so it bypasses RLS.
create or replace function public.rooms_gc() returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.rooms r
  where r.code = old.room_code
    and not exists (select 1 from public.room_participants p where p.room_code = old.room_code);
  return old;
end $$;
drop trigger if exists rooms_gc_after_delete on public.room_participants;
create trigger rooms_gc_after_delete after delete on public.room_participants for each row execute function public.rooms_gc();

-- ---------- presence / live name claims ----------
create table if not exists public.presence (
  user_id uuid primary key,
  name_key text not null unique,               -- normalized (lower+trim) name — one live claim per name
  name text not null check (char_length(name) between 1 and 24),
  claimed_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '2 minutes'
);
alter table public.presence enable row level security;
drop policy if exists "authenticated read presence" on public.presence;
create policy "authenticated read presence" on public.presence for select to authenticated using (true);
drop policy if exists "claim as yourself" on public.presence;
create policy "claim as yourself" on public.presence for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "renew own claim" on public.presence;
create policy "renew own claim" on public.presence for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "release own claim" on public.presence;
create policy "release own claim" on public.presence for delete to authenticated using (auth.uid() = user_id);
drop policy if exists "sweep expired presence" on public.presence;
create policy "sweep expired presence" on public.presence for delete to authenticated using (expires_at < now());
create index if not exists presence_expiry_idx on public.presence (expires_at);

-- ---------- global chat ----------
create table if not exists public.global_messages (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 24),
  body text not null check (char_length(body) between 1 and 280),
  created_at timestamptz not null default now()
);
alter table public.global_messages enable row level security;
drop policy if exists "authenticated read global chat" on public.global_messages;
create policy "authenticated read global chat" on public.global_messages for select to authenticated using (true);
drop policy if exists "post as yourself" on public.global_messages;
create policy "post as yourself" on public.global_messages for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "delete own messages" on public.global_messages;
create policy "delete own messages" on public.global_messages for delete to authenticated using (auth.uid() = user_id);
create index if not exists global_messages_created_idx on public.global_messages (created_at desc);

-- ---------- room chat ----------
create table if not exists public.room_messages (
  id bigint generated always as identity primary key,
  room_code text not null references public.rooms(code) on delete cascade,
  from_seat integer not null,                  -- -1 = system message (host only)
  name text not null,
  body text not null check (char_length(body) between 1 and 280),
  kind text not null default 'user' check (kind in ('user','system')),
  created_at timestamptz not null default now()
);
alter table public.room_messages enable row level security;
drop policy if exists "participants read room chat" on public.room_messages;
create policy "participants read room chat" on public.room_messages for select to authenticated
  using (exists (select 1 from public.room_participants p where p.room_code = room_messages.room_code and (p.user_id = auth.uid() or p.seat = 0 and p.user_id = auth.uid())) or exists (select 1 from public.rooms r where r.code = room_messages.room_code and r.host_id = auth.uid()));
drop policy if exists "participant posts in their seat" on public.room_messages;
create policy "participant posts in their seat" on public.room_messages for insert to authenticated
  with check (kind = 'user' and exists (select 1 from public.room_participants p where p.room_code = room_messages.room_code and p.seat = from_seat and p.user_id = auth.uid()));
drop policy if exists "host posts system messages" on public.room_messages;
create policy "host posts system messages" on public.room_messages for insert to authenticated
  with check (kind = 'system' and exists (select 1 from public.rooms r where r.code = room_messages.room_code and r.host_id = auth.uid()));
create index if not exists room_messages_idx on public.room_messages (room_code, created_at);

-- hard guarantee: no two participants sharing a name (case/space-insensitive) in the same room
create unique index if not exists room_participant_name_unique on public.room_participants (room_code, (lower(btrim(name))));

-- ---------- per-seat state snapshots (Stage 2 transport) ----------
create table if not exists public.room_seat_state (
  room_code text not null references public.rooms(code) on delete cascade,
  seat integer not null check (seat between 0 and 4),
  snapshot jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (room_code, seat)
);
alter table public.room_seat_state enable row level security;
drop policy if exists "seat owner and host read seat state" on public.room_seat_state;
create policy "seat owner and host read seat state" on public.room_seat_state for select to authenticated
  using (exists (select 1 from public.room_participants p where p.room_code = room_seat_state.room_code and p.seat = room_seat_state.seat and (p.user_id = auth.uid() or p.seat = 0)) or exists (select 1 from public.rooms r where r.code = room_seat_state.room_code and r.host_id = auth.uid()));
drop policy if exists "host writes seat state" on public.room_seat_state;
create policy "host writes seat state" on public.room_seat_state for insert to authenticated with check (exists (select 1 from public.rooms r where r.code = room_seat_state.room_code and r.host_id = auth.uid()));
drop policy if exists "host updates seat state" on public.room_seat_state;
create policy "host updates seat state" on public.room_seat_state for update to authenticated using (exists (select 1 from public.rooms r where r.code = room_seat_state.room_code and r.host_id = auth.uid())) with check (exists (select 1 from public.rooms r where r.code = room_seat_state.room_code and r.host_id = auth.uid()));

-- ---------- guest -> host action mailbox (Stage 2 transport) ----------
create table if not exists public.room_actions (
  id bigint generated always as identity primary key,
  room_code text not null references public.rooms(code) on delete cascade,
  seat integer not null,
  type text not null check (type in ('lock_in','next_round','chat','rebuy','leave','ping')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.room_actions enable row level security;
drop policy if exists "host reads actions for their room" on public.room_actions;
create policy "host reads actions for their room" on public.room_actions for select to authenticated
  using (exists (select 1 from public.rooms r where r.code = room_actions.room_code and r.host_id = auth.uid()));
drop policy if exists "participant sends action from their seat" on public.room_actions;
create policy "participant sends action from their seat" on public.room_actions for insert to authenticated
  with check (exists (select 1 from public.room_participants p where p.room_code = room_actions.room_code and p.seat = room_actions.seat and p.user_id = auth.uid()));
drop policy if exists "host consumes actions" on public.room_actions;
create policy "host consumes actions" on public.room_actions for delete to authenticated
  using (exists (select 1 from public.rooms r where r.code = room_actions.room_code and r.host_id = auth.uid()));
create index if not exists room_actions_idx on public.room_actions (room_code, id);

-- ---------- realtime publications ----------
do $$
begin
  begin alter publication supabase_realtime add table public.global_messages; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.rooms; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.room_messages; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.room_seat_state; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.room_actions; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.room_participants; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.presence; exception when duplicate_object then null; end;
end $$;
