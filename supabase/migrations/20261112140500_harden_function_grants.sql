-- Only signed-in users may call the app's RPCs/helpers; the trigger function is not callable at all.
revoke execute on function public.create_table(text), public.join_table(text, uuid), public.peek_table(text),
  public.is_member(uuid), public.is_admin(uuid), public.is_cashier(uuid), public.night_table(uuid)
  from public, anon;
grant execute on function public.create_table(text), public.join_table(text, uuid), public.peek_table(text),
  public.is_member(uuid), public.is_admin(uuid), public.is_cashier(uuid), public.night_table(uuid)
  to authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
