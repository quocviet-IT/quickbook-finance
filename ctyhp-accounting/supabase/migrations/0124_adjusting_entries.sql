-- ============================================================================
-- 0124  Adjusting entries: the middle column of the working trial balance
--
-- From the client's prototype (Accounting-System-v3.html, "working-paper trial
-- balance"): "An entry counts as an adjustment because somebody marked it one -
-- not because of its date or its shape - so the middle column is a decision,
-- which is what makes it worth reviewing."
--
-- The mark lives in a table of its own. Marking or unmarking an entry touches
-- no journal entry and no journal line: it moves the entry between two columns
-- of one report and changes no balance anywhere. The table has a read policy
-- and no write policy; it is written only by the two functions below and by
-- the depreciation trigger.
--
-- Depreciation is an adjusting entry, as the prototype posts it. It is marked
-- by a trigger as the entry is inserted, rather than by redefining
-- acc_post_asset_depreciation, so no posting function changes here.
-- ============================================================================

set search_path = public;

-- on delete cascade: the books never delete an entry, but test cleanup run
-- with the service role does, and a mark must not stand in its way.
create table if not exists acc_adjusting_entry (
  journal_entry_id uuid primary key references acc_journal_entry (id) on delete cascade,
  note             text check (note is null or length(btrim(note)) between 1 and 500),
  marked_by        uuid references auth.users (id),
  marked_at        timestamptz not null default now()
);

alter table acc_adjusting_entry enable row level security;

drop policy if exists acc_adjusting_entry_read on acc_adjusting_entry;
create policy acc_adjusting_entry_read on acc_adjusting_entry
  for select using (acc_current_role() is not null);

-- No insert, update or delete policy: an application session writes this
-- table only through the functions below.
revoke all on table acc_adjusting_entry from public, anon;
grant select on table acc_adjusting_entry to authenticated;
grant all    on table acc_adjusting_entry to service_role;

-- The last day of the closed period a date falls in, or null when it is open.
create or replace function acc_closed_period_end(p_date date) returns date
language sql stable set search_path = public as $$
  select period_end
    from acc_accounting_period
   where p_date between period_start and period_end
     and status = 'closed'
   limit 1;
$$;

revoke all on function acc_closed_period_end(date) from public, anon;
grant execute on function acc_closed_period_end(date) to authenticated;

-- Mark an entry adjusting, or change the note of one that already is.
--
-- The prototype's two handlers: ticking "adjusting entry" asks once before it
-- alters a closed period ("allowChange"); typing the note just saves it.
create or replace function acc_mark_adjusting(
  p_entry_id       uuid,
  p_note           text,
  p_confirm_closed boolean default false
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_entry  acc_journal_entry%rowtype;
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_before text;
  v_marked boolean;
  v_closed date;
begin
  if not acc_has_permission('journal.post') then
    raise exception 'permission denied: marking an adjusting entry needs journal.post';
  end if;
  if v_note is not null and length(v_note) > 500 then
    raise exception 'The note is longer than 500 characters';
  end if;

  select * into v_entry from acc_journal_entry where id = p_entry_id;
  if not found then
    raise exception 'That entry is not in the books';
  end if;
  if v_entry.status <> 'posted' then
    raise exception 'Only a posted entry can be marked adjusting; % is %', v_entry.entry_number, v_entry.status;
  end if;

  select true, a.note into v_marked, v_before
    from acc_adjusting_entry a
   where a.journal_entry_id = p_entry_id;
  v_closed := acc_closed_period_end(v_entry.entry_date);

  if coalesce(v_marked, false) then
    update acc_adjusting_entry set note = v_note where journal_entry_id = p_entry_id;
    insert into acc_audit_log (table_name, record_id, action, actor_id, before_json, after_json)
    values ('acc_adjusting_entry', p_entry_id, 'edit_adjusting_note', auth.uid(),
            jsonb_build_object('entry_number', v_entry.entry_number, 'note', v_before),
            jsonb_build_object('entry_number', v_entry.entry_number, 'note', v_note,
                               'closed_period', v_closed is not null));
    return;
  end if;

  if v_closed is not null and not coalesce(p_confirm_closed, false) then
    raise exception 'closed_period:%:%',
      to_char(v_entry.entry_date, 'YYYY-MM-DD'), to_char(v_closed, 'YYYY-MM-DD');
  end if;

  insert into acc_adjusting_entry (journal_entry_id, note, marked_by)
  values (p_entry_id, v_note, auth.uid());
  insert into acc_audit_log (table_name, record_id, action, actor_id, before_json, after_json)
  values ('acc_adjusting_entry', p_entry_id, 'mark_adjusting', auth.uid(), null,
          jsonb_build_object('entry_number', v_entry.entry_number, 'note', v_note,
                             'closed_period', v_closed is not null));
end;
$$;

revoke all on function acc_mark_adjusting(uuid, text, boolean) from public, anon;
grant execute on function acc_mark_adjusting(uuid, text, boolean) to authenticated;

-- Take the mark off, and its note with it, as the prototype's toggle does.
create or replace function acc_unmark_adjusting(
  p_entry_id       uuid,
  p_confirm_closed boolean default false
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_entry  acc_journal_entry%rowtype;
  v_before text;
  v_marked boolean;
  v_closed date;
begin
  if not acc_has_permission('journal.post') then
    raise exception 'permission denied: unmarking an adjusting entry needs journal.post';
  end if;

  select * into v_entry from acc_journal_entry where id = p_entry_id;
  if not found then
    raise exception 'That entry is not in the books';
  end if;

  select true, a.note into v_marked, v_before
    from acc_adjusting_entry a
   where a.journal_entry_id = p_entry_id;
  if not coalesce(v_marked, false) then
    return;
  end if;

  v_closed := acc_closed_period_end(v_entry.entry_date);
  if v_closed is not null and not coalesce(p_confirm_closed, false) then
    raise exception 'closed_period:%:%',
      to_char(v_entry.entry_date, 'YYYY-MM-DD'), to_char(v_closed, 'YYYY-MM-DD');
  end if;

  delete from acc_adjusting_entry where journal_entry_id = p_entry_id;
  insert into acc_audit_log (table_name, record_id, action, actor_id, before_json, after_json)
  values ('acc_adjusting_entry', p_entry_id, 'unmark_adjusting', auth.uid(),
          jsonb_build_object('entry_number', v_entry.entry_number, 'note', v_before,
                             'closed_period', v_closed is not null),
          null);
end;
$$;

revoke all on function acc_unmark_adjusting(uuid, boolean) from public, anon;
grant execute on function acc_unmark_adjusting(uuid, boolean) to authenticated;

-- Depreciation is marked as it posts, from whichever of its three paths - one
-- asset, the batch, the catch-up charge on disposal - and any added later. The
-- note is the entry's own description. Only the insert is watched, so a user
-- may still unmark one.
create or replace function acc_mark_depreciation_adjusting() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into acc_adjusting_entry (journal_entry_id, note, marked_by)
  values (new.id, nullif(left(btrim(coalesce(new.description, '')), 500), ''), null)
  on conflict (journal_entry_id) do nothing;
  return new;
end;
$$;

revoke all on function acc_mark_depreciation_adjusting() from public, anon, authenticated;

drop trigger if exists acc_journal_entry_depreciation_adjusting on acc_journal_entry;
create trigger acc_journal_entry_depreciation_adjusting
  after insert on acc_journal_entry
  for each row when (new.source_type = 'depreciation')
  execute function acc_mark_depreciation_adjusting();

-- Depreciation already in the books was an adjusting entry under the
-- prototype's definition when it was posted.
insert into acc_adjusting_entry (journal_entry_id, note, marked_by)
select e.id, nullif(left(btrim(coalesce(e.description, '')), 500), ''), null
  from acc_journal_entry e
 where e.source_type = 'depreciation'
   and e.status = 'posted'
on conflict (journal_entry_id) do nothing;
