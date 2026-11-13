-- One-off data correction for the 12.11 game night, approved by Ben on
-- 2026-11-13 (the corrections screen came later, in 1.17.0):
--   Itzik Dahan: a 3,000-chip purchase was never recorded (bought ₪600, net +50).
--   Haim Dahan: exit count 12,000, not 11,000 (net 0).
--   The "Haim -> Itzik ₪33.33" transfer goes away.
-- Every statement targets fixed ids and checks the old value, so on any other
-- database (CI, local) and on a second run it changes nothing. The before
-- values are kept in the night log. No trigger here sends notifications.
insert into public.night_events (night_id, actor_id, kind, payload)
select g.id, null, 'results_corrected', jsonb_build_object(
  'reason', 'תיקון אחרי הערב באישור בן: קנייה של 3,000 ליצחק שלא נרשמה, ספירת Haim 12,000',
  'changes', jsonb_build_array(
    jsonb_build_object('member_id', '48aa5450-5e34-4d22-ab97-9847ea60af13', 'request_id', '12fec211-5e61-48aa-b8bb-65e6c98e5d68',
      'given_before', 3000, 'given_after', 6000, 'bought_before', 500, 'bought_after', 600, 'net_before', 150, 'net_after', 50),
    jsonb_build_object('member_id', '65f6373e-64c6-4306-ae17-cc2b4af18741', 'chips_before', 11000, 'chips_after', 12000, 'net_before', -33.33, 'net_after', 0)),
  'removed_settlement', jsonb_build_object('id', '9a3a768c-01ba-4058-94ae-4d5cc0ad85b1', 'from', '65f6373e-64c6-4306-ae17-cc2b4af18741',
    'to', '48aa5450-5e34-4d22-ab97-9847ea60af13', 'amount', 33.33, 'paid', true))
  from public.game_nights g
 where g.id = '0407b6b9-6615-4b0d-b181-461e470f5cc6'
   and exists (select 1 from public.night_players where id = '43a355f0-fccd-44de-96ab-0b39acfee060' and final_chips = 11000)
   and not exists (select 1 from public.night_events where night_id = g.id and kind = 'results_corrected');

update public.chip_requests set given_chips = 6000, note = 'תיקון אחרי הערב: נוספה קנייה של 3,000 שלא נרשמה'
 where id = '12fec211-5e61-48aa-b8bb-65e6c98e5d68' and given_chips = 3000;
update public.night_players set bought_money = 600, net = 50
 where id = 'a1eff11b-5f4c-48a2-98c5-65d915df4453' and net = 150 and bought_money = 500;
update public.night_players set final_chips = 12000, net = 0
 where id = '43a355f0-fccd-44de-96ab-0b39acfee060' and final_chips = 11000;
delete from public.settlements
 where id = '9a3a768c-01ba-4058-94ae-4d5cc0ad85b1' and amount = 33.33;
