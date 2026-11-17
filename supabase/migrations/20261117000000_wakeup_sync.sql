-- WakeUp: timetable, tasks and settings synced across a user's devices.
-- One row per planner entity (class, one-off change, task, the semester). Last write wins per row,
-- judged by the server clock; deletes are tombstones so offline devices learn about them.
create table public.wakeup_planner_items (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('class', 'change', 'task', 'semester')),
  id text not null check (char_length(id) between 1 and 64),
  data jsonb not null default '{}'::jsonb check (pg_column_size(data) < 65536),
  deleted boolean not null default false,
  device text check (char_length(device) <= 64),
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, id)
);
comment on table public.wakeup_planner_items is 'WakeUp app: per-user timetable/task entities, last-write-wins by updated_at.';
create index wakeup_planner_items_user_updated on public.wakeup_planner_items (user_id, updated_at);

create table public.wakeup_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb check (pg_column_size(data) < 262144),
  device text check (char_length(device) <= 64),
  updated_at timestamptz not null default now()
);
comment on table public.wakeup_settings is 'WakeUp app: the portable part of a user''s settings.';

-- server clock decides freshness, so a device with a wrong clock can't win every conflict
create function public.wakeup_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger wakeup_planner_items_touch before insert or update on public.wakeup_planner_items
  for each row execute function public.wakeup_touch();
create trigger wakeup_settings_touch before insert or update on public.wakeup_settings
  for each row execute function public.wakeup_touch();

alter table public.wakeup_planner_items enable row level security;
alter table public.wakeup_settings enable row level security;

create policy "own planner items: read" on public.wakeup_planner_items for select to authenticated using (user_id = (select auth.uid()));
create policy "own planner items: add" on public.wakeup_planner_items for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own planner items: change" on public.wakeup_planner_items for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own planner items: remove" on public.wakeup_planner_items for delete to authenticated using (user_id = (select auth.uid()));

create policy "own settings: read" on public.wakeup_settings for select to authenticated using (user_id = (select auth.uid()));
create policy "own settings: add" on public.wakeup_settings for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own settings: change" on public.wakeup_settings for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own settings: remove" on public.wakeup_settings for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.wakeup_planner_items, public.wakeup_settings from anon;
grant select, insert, update, delete on public.wakeup_planner_items, public.wakeup_settings to authenticated;

alter publication supabase_realtime add table public.wakeup_planner_items, public.wakeup_settings;
