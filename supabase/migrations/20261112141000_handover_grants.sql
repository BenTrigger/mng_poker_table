-- handover_cashier is for signed-in users only
revoke execute on function public.handover_cashier(uuid, uuid, numeric, numeric, jsonb, numeric, text, jsonb, text) from public, anon;
