-- Adults and children in an RSVP.
--
-- The RSVP screen shows the split, and caterers ask for it before they
-- ask for anything else: children eat differently, sit differently, and
-- are often charged differently. rsvp_count alone cannot answer it.
--
-- Nullable rather than defaulted to zero. A household that replied before
-- this column existed said "four of us", not "four adults and no
-- children", and inventing the second half of that sentence would put a
-- number in front of a caterer that nobody ever typed.
--
-- adults + children is not constrained to equal rsvp_count on purpose:
-- rsvp_count is what the household confirmed, and the split arrives
-- later, sometimes from a different conversation.

alter table invitation_legs
  add column if not exists adults   int check (adults   >= 0),
  add column if not exists children int check (children >= 0);

comment on column invitation_legs.adults is
  'Adults in the confirmed party. Null means never stated.';
comment on column invitation_legs.children is
  'Children in the confirmed party. Null means never stated.';

-- No new grants needed: 003_rls.sql gives app_rw and app_public
-- table-level rights on invitation_legs rather than column lists, so both
-- reach these columns already. Checked rather than assumed — events is
-- the table with column-level grants, and that difference is exactly the
-- kind of thing a migration gets wrong at 2am.
