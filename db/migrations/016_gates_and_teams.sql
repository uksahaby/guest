-- Gates gain a location and an on/off switch; staff gain teams; the day
-- gains a place to record what went wrong.
--
-- Three things the screen needs and the schema had no room for.
--
-- entrances.location   "Front of Venue", "Left Side". Free text, because
--                      every venue describes itself differently and an
--                      enum would need a migration per wedding.
-- entrances.is_active  An emergency exit exists but admits nobody. Deleting
--                      it would lose the record that it is there.
--
-- teams                A named group with a lead and a role. Ushers are
--                      already staff_assignments; a team is the grouping an
--                      organiser actually thinks in — "Team Bravo is on the
--                      VIP gate" — and it is what they brief.
--
-- incidents            A guest argument, a code that would not scan. These
--                      happen at every gate and are currently written on
--                      somebody's hand. Recording them is the difference
--                      between "the VIP gate was a mess" and knowing why.

alter table entrances
  add column if not exists location  text,
  add column if not exists is_active boolean not null default true;

create table if not exists teams (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references events(id) on delete cascade,
  name         text not null,
  description  text,
  -- gate_staff | support | security. Text, not an enum: the third wedding
  -- will want "Protocol" and that should not need a deploy.
  role         text not null default 'gate_staff',
  lead_user_id uuid references users(id) on delete set null,
  entrance_id  uuid references entrances(id) on delete set null,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (event_id, name)
);

create index if not exists teams_event_idx on teams (event_id);

-- Which team a person is on. Null means assigned to a gate but not to any
-- team, which is the ordinary case for a single-gate wedding and must
-- stay valid.
alter table staff_assignments
  add column if not exists team_id uuid references teams(id) on delete set null;

create index if not exists staff_team_idx on staff_assignments (team_id);

create table if not exists incidents (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references events(id) on delete cascade,
  entrance_id  uuid references entrances(id) on delete set null,
  reported_by  uuid references users(id) on delete set null,
  kind         text not null default 'other',
  note         text not null,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists incidents_event_idx
  on incidents (event_id, created_at desc);

-- RLS. Both new tables belong to whoever manages the event; an usher has
-- no business reading the team roster or the incident log, and app_public
-- must never see either.
alter table teams enable row level security;
alter table incidents enable row level security;

grant select, insert, update, delete on teams to app_rw;
grant select, insert, update on incidents to app_rw;

create policy team_manage on teams for all to app_rw
  using (app_manages_event(event_id))
  with check (app_manages_event(event_id));

create policy incident_manage on incidents for all to app_rw
  using (app_manages_event(event_id))
  with check (app_manages_event(event_id));

-- entrances is table-level granted in 003_rls.sql, so location and
-- is_active need no grant of their own. Checked rather than assumed:
-- events is the one table here with column-level grants.
