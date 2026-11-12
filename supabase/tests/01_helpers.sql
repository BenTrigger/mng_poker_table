-- Test helpers. Assertions run as the *current* role (security invoker), so
-- RLS and grants apply exactly as they would for the app.
create schema if not exists tests;
grant usage on schema tests to anon, authenticated;

create table if not exists tests.ids (k text primary key, v uuid);
grant all on tests.ids to anon, authenticated;

create or replace function tests.id(p_k text) returns uuid language sql stable as $$
  select v from tests.ids where k = p_k
$$;
create or replace function tests.put(p_k text, p_v uuid) returns uuid language sql as $$
  insert into tests.ids values (p_k, p_v) on conflict (k) do update set v = excluded.v returning v
$$;

create or replace function tests.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'FAIL: %', p_msg; end if;
  raise notice 'ok - %', p_msg;
end $$;

create or replace function tests.eq(p_got anyelement, p_want anyelement, p_msg text) returns void language plpgsql as $$
begin
  if p_got is distinct from p_want then raise exception 'FAIL: % (got %, want %)', p_msg, p_got, p_want; end if;
  raise notice 'ok - %', p_msg;
end $$;

-- Runs p_sql and expects it to fail with a message matching p_pattern (ILIKE).
create or replace function tests.throws(p_sql text, p_pattern text, p_msg text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm ilike p_pattern then
      raise notice 'ok - % (%)', p_msg, sqlerrm;
      return;
    end if;
    raise exception 'FAIL: % (wrong error: %)', p_msg, sqlerrm;
  end;
  raise exception 'FAIL: % (no error raised)', p_msg;
end $$;

-- Runs p_sql (an UPDATE/DELETE) and returns how many rows it touched.
create or replace function tests.affected(p_sql text) returns int language plpgsql as $$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;

-- Create a fake Google user (fires the real profile trigger).
create or replace function tests.make_user(p_key text, p_name text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (v, p_key || '@test.local', jsonb_build_object('full_name', p_name, 'avatar_url', 'https://x/' || p_key || '.png'));
  perform tests.put(p_key, v);
  return v;
end $$;

grant execute on all functions in schema tests to anon, authenticated;

-- Become a signed-in user (call as postgres; switch back with RESET ROLE).
create or replace function tests.login(p_key text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', tests.id(p_key), 'role', 'authenticated')::text, false);
  perform set_config('role', 'authenticated', false);
end $$;

create or replace function tests.anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', false);
  perform set_config('role', 'anon', false);
end $$;
