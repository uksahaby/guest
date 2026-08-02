-- Tables gain a kind, an active flag, and a place on the floor.
--
-- kind        the label under the name — "Family Table", "Vendors". It is
--             free text, not an enum: every wedding invents its own words
--             for who sits where, and an enum would need a migration each
--             time somebody wanted "Elders".
--
-- is_active   a table that exists but is not being used. Removing it
--             instead would lose its name and its number, and the
--             organiser wants "Table 11, not this year", not a gap.
--
-- pos_x/pos_y where it sits on the floor plan, as a percentage of the
--             room, 0-100. Percentages rather than pixels so the plan
--             survives being drawn at any size — a laptop, a phone, a
--             projector at the venue.
--
-- Null position means "not placed yet". The plan lays those out in a grid
-- rather than stacking them all at 0,0, so a new table is visible and
-- draggable the moment it is created.

alter table seating_tables
  add column if not exists kind      text,
  add column if not exists is_active boolean not null default true,
  add column if not exists pos_x     numeric(5,2) check (pos_x between 0 and 100),
  add column if not exists pos_y     numeric(5,2) check (pos_y between 0 and 100);

comment on column seating_tables.kind is
  'Free-text label: Family Table, Friends, Vendors.';
comment on column seating_tables.is_active is
  'False keeps the table and its name without seating anyone at it.';

-- seating_tables is granted table-level in 003_rls.sql
-- (`grant select, insert, update, delete on seating_tables to app_rw`),
-- so the new columns need no grant. Checked, not assumed: events is the
-- one table here with column-level grants.
create index if not exists seating_tables_active_idx
  on seating_tables (leg_id, is_active);
