-- ============================================================================
-- 0190  Abacus keeps each person's conversations
--
-- The in-app assistant (Abacus, formerly "Ask AI") used to keep its thread in
-- the browser, so a conversation vanished with the tab and could not follow
-- someone to another device. This migration keeps it under the account.
--
-- 1. onebook.ai_conversation (global): one row per thread, owned by the person
--    who started it and tied to the company that was open.
-- 2. onebook.ai_message (global): one row per question and its answer, with the
--    source the answer cited and a thumbs up or down.
-- 3. Row-level security: a person reads and deletes only their own threads, and
--    may change only the rating of their own messages. Nothing can insert a row
--    directly; the browser never supplies the company, the owner or a thread.
-- 4. onebook.save_ai_exchange writes a question and its answer, checks that the
--    person belongs to the company and owns the thread, and keeps only the 20
--    most recently updated threads per person per company.
-- ============================================================================
set search_path = public;

-- ----------------------------------------------------------------------------
-- 1. Conversations.
-- ----------------------------------------------------------------------------
create table if not exists onebook.ai_conversation (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  company_id uuid not null references onebook.company (id) on delete cascade,
  route      text not null default '/' check (length(route) <= 200),
  title      text not null check (length(title) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ai_conversation_user_company_updated_idx
  on onebook.ai_conversation (user_id, company_id, updated_at desc);

-- ----------------------------------------------------------------------------
-- 2. Messages.
-- ----------------------------------------------------------------------------
create table if not exists onebook.ai_message (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references onebook.ai_conversation (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  question        text not null check (length(question) between 1 and 1000),
  answer          text not null check (length(answer) <= 20000),
  source          text check (source is null or length(source) <= 120),
  route           text not null default '/' check (length(route) <= 200),
  rating          smallint check (rating is null or rating in (-1, 1)),
  asked_at        timestamptz not null default now()
);
create index if not exists ai_message_conversation_asked_idx
  on onebook.ai_message (conversation_id, asked_at);

-- ----------------------------------------------------------------------------
-- 3. Row-level security.
-- ----------------------------------------------------------------------------
alter table onebook.ai_conversation enable row level security;
alter table onebook.ai_message enable row level security;

revoke all on onebook.ai_conversation from public, anon, authenticated;
revoke all on onebook.ai_message from public, anon, authenticated;
grant select, delete on onebook.ai_conversation to authenticated;
grant select on onebook.ai_message to authenticated;
grant update (rating) on onebook.ai_message to authenticated;
grant all on onebook.ai_conversation to service_role;
grant all on onebook.ai_message to service_role;

drop policy if exists ai_conversation_select on onebook.ai_conversation;
create policy ai_conversation_select on onebook.ai_conversation
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists ai_conversation_delete on onebook.ai_conversation;
create policy ai_conversation_delete on onebook.ai_conversation
  for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists ai_message_select on onebook.ai_message;
create policy ai_message_select on onebook.ai_message
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists ai_message_update on onebook.ai_message;
create policy ai_message_update on onebook.ai_message
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- 4. Saving an exchange.
-- ----------------------------------------------------------------------------
-- Saves one question and its answer for the person asking, in a thread they
-- own (or a new one), and returns the ids. The company must be one the person
-- belongs to. After saving, only the person's 20 most recently updated threads
-- in that company are kept.
create or replace function onebook.save_ai_exchange(
  p_conversation uuid,
  p_company uuid,
  p_route text,
  p_question text,
  p_answer text,
  p_source text
)
returns jsonb
language plpgsql security definer set search_path = onebook, public as $$
declare
  v_user uuid := auth.uid();
  v_conversation uuid;
  v_message uuid;
  v_asked timestamptz;
begin
  if v_user is null then
    raise exception 'Sign in to save a conversation' using errcode = '42501';
  end if;
  if not exists (
    select 1 from onebook.company_member
    where company_id = p_company and user_id = v_user
  ) then
    raise exception 'Not a member of this company' using errcode = '42501';
  end if;

  if p_conversation is null then
    insert into onebook.ai_conversation (user_id, company_id, route, title)
    values (
      v_user,
      p_company,
      left(coalesce(p_route, '/'), 200),
      left(btrim(p_question), 200)
    )
    returning id into v_conversation;
  else
    update onebook.ai_conversation
       set updated_at = now()
     where id = p_conversation and user_id = v_user and company_id = p_company
    returning id into v_conversation;
    if v_conversation is null then
      raise exception 'That conversation is not yours' using errcode = '42501';
    end if;
  end if;

  insert into onebook.ai_message (conversation_id, user_id, question, answer, source, route)
  values (
    v_conversation,
    v_user,
    left(p_question, 1000),
    left(p_answer, 20000),
    left(p_source, 120),
    left(coalesce(p_route, '/'), 200)
  )
  returning id, asked_at into v_message, v_asked;

  delete from onebook.ai_conversation
  where user_id = v_user
    and company_id = p_company
    and id not in (
      select id from onebook.ai_conversation
      where user_id = v_user and company_id = p_company
      order by updated_at desc, id desc
      limit 20
    );

  return jsonb_build_object(
    'conversation_id', v_conversation,
    'message_id', v_message,
    'asked_at', v_asked
  );
end;
$$;

revoke all on function onebook.save_ai_exchange(uuid, uuid, text, text, text, text) from public, anon;
grant execute on function onebook.save_ai_exchange(uuid, uuid, text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
