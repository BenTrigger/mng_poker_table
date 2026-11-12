-- create_table used gen_random_bytes (pgcrypto), which lives in the
-- "extensions" schema on Supabase and is not on this function's search_path.
-- Build the code from an unambiguous alphabet with core functions instead.
create or replace function public.create_table(p_name text)
returns public.poker_tables language plpgsql security definer set search_path = public as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code text;
  v_table poker_tables;
  v_profile profiles;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'name required'; end if;
  select * into v_profile from profiles where id = auth.uid();
  loop
    select string_agg(substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1), '')
      into v_code from generate_series(1, 6);
    exit when not exists (select 1 from poker_tables where code = v_code);
  end loop;
  insert into poker_tables (code, name, owner_id) values (v_code, trim(p_name), auth.uid()) returning * into v_table;
  insert into table_members (table_id, user_id, display_name, avatar_url, role)
  values (v_table.id, auth.uid(), coalesce(v_profile.display_name, 'Admin'), v_profile.avatar_url, 'admin');
  return v_table;
end $$;

revoke execute on function public.create_table(text) from public, anon;
grant execute on function public.create_table(text) to authenticated;
