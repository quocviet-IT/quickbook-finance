-- ============================================================================
-- Sales tax rates belong to a state.
--
-- A company selling into a dozen states keeps a rate per state, and a list of
-- codes with no jurisdiction on it cannot be worked with: nothing says which
-- rate belongs to which state, and the liability cannot be split the way a
-- return is filed. This adds the jurisdiction to the tax code and a reference
-- list of states for the picker.
--
-- No rate is seeded. Rates change by legislature and vary below the state line
-- (county, city, district); a number this product invented would be wrong
-- somewhere and would be trusted anyway. The accountant enters the rates they
-- are registered to collect.
-- ============================================================================

create table if not exists acc_us_state (
  code text primary key check (code ~ '^[A-Z]{2}$'),
  name text not null
);

alter table acc_us_state enable row level security;
create policy acc_us_state_read on acc_us_state
  for select using (acc_current_role() is not null);

insert into acc_us_state (code, name) values
  ('AL', 'Alabama'), ('AK', 'Alaska'), ('AZ', 'Arizona'), ('AR', 'Arkansas'),
  ('CA', 'California'), ('CO', 'Colorado'), ('CT', 'Connecticut'), ('DE', 'Delaware'),
  ('DC', 'District of Columbia'), ('FL', 'Florida'), ('GA', 'Georgia'), ('HI', 'Hawaii'),
  ('ID', 'Idaho'), ('IL', 'Illinois'), ('IN', 'Indiana'), ('IA', 'Iowa'),
  ('KS', 'Kansas'), ('KY', 'Kentucky'), ('LA', 'Louisiana'), ('ME', 'Maine'),
  ('MD', 'Maryland'), ('MA', 'Massachusetts'), ('MI', 'Michigan'), ('MN', 'Minnesota'),
  ('MS', 'Mississippi'), ('MO', 'Missouri'), ('MT', 'Montana'), ('NE', 'Nebraska'),
  ('NV', 'Nevada'), ('NH', 'New Hampshire'), ('NJ', 'New Jersey'), ('NM', 'New Mexico'),
  ('NY', 'New York'), ('NC', 'North Carolina'), ('ND', 'North Dakota'), ('OH', 'Ohio'),
  ('OK', 'Oklahoma'), ('OR', 'Oregon'), ('PA', 'Pennsylvania'), ('PR', 'Puerto Rico'),
  ('RI', 'Rhode Island'), ('SC', 'South Carolina'), ('SD', 'South Dakota'), ('TN', 'Tennessee'),
  ('TX', 'Texas'), ('UT', 'Utah'), ('VT', 'Vermont'), ('VA', 'Virginia'),
  ('WA', 'Washington'), ('WV', 'West Virginia'), ('WI', 'Wisconsin'), ('WY', 'Wyoming')
on conflict (code) do update set name = excluded.name;

-- Null means the code is not tied to one state — a use-tax or exempt code, or
-- a rate that has not been classified yet. It stays valid; the rates list
-- groups those under "No state".
alter table acc_tax_code
  add column if not exists state_code text references acc_us_state (code);

create index if not exists acc_tax_code_state_idx on acc_tax_code (state_code);
