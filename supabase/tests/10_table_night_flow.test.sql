-- Full life of a table and a game night, done the way the app does it,
-- as the right user each time. Runs in a transaction and rolls back.
\set ON_ERROR_STOP 1
begin;

select tests.make_user('ben', 'Ben');        -- creates the table (admin)
select tests.make_user('dana', 'Dana');      -- joins by code, becomes cashier
select tests.make_user('yossi', 'Yossi');    -- claims a guest seat via personal link
select tests.make_user('stranger', 'Stranger');

-- ---------------------------------------------------------------- sign up
select tests.eq((select display_name from profiles where id = tests.id('ben')), 'Ben', 'new Google user gets a profile with their name');
select tests.eq((select avatar_url from profiles where id = tests.id('ben')), 'https://x/ben.png', 'profile keeps the Google avatar');

-- ---------------------------------------------------------------- create table
select tests.anon();
select tests.throws($$ select public.create_table('x') $$, '%permission denied%', 'signed-out visitor cannot create a table');
reset role;

select tests.login('ben');
select tests.put('table', (public.create_table('  חמישי שמח  ')).id);
select tests.eq((select name from poker_tables where id = tests.id('table')), 'חמישי שמח', 'create_table trims the name');
select tests.ok((select code ~ '^[A-HJKMNP-Z2-9]{6}$' from poker_tables where id = tests.id('table')), 'table code is 6 unambiguous characters');
select tests.eq((select role from table_members where table_id = tests.id('table') and user_id = tests.id('ben')), 'admin', 'creator is the admin');
select tests.eq((select display_name from table_members where table_id = tests.id('table') and user_id = tests.id('ben')), 'Ben', 'admin member uses the profile name');
select tests.throws($$ select public.create_table('   ') $$, '%name required%', 'empty table name is refused');
-- many tables -> unique codes
select tests.eq((select count(distinct (public.create_table('t' || g)).code)::int from generate_series(1, 40) g), 40, '40 new tables get 40 different codes');
reset role;
select code as table_code from poker_tables where id = tests.id('table') \gset

-- ---------------------------------------------------------------- join
select tests.login('stranger');
select tests.eq((select count(*)::int from poker_tables where id = tests.id('table')), 0, 'non-member cannot see the table');
select tests.eq((select count(*)::int from public.peek_table(:'table_code')), 1, 'anyone signed in can peek a table name by code');
select tests.eq((select count(*)::int from public.peek_table(lower(:'table_code'))), 1, 'peek works with a lower-case code');
reset role;

select tests.login('dana');
select tests.eq(public.join_table(:'table_code'), 'pending', 'joining by code creates a pending request');
select tests.eq(public.join_table(:'table_code'), 'pending', 'joining twice is harmless');
select tests.eq((select count(*)::int from poker_tables where id = tests.id('table')), 0, 'pending member cannot see the table yet');
select tests.throws($$ select public.join_table('NOPE99') $$, '%table not found%', 'unknown code is refused');
reset role;

select tests.login('ben');
select tests.eq((select count(*)::int from table_members where table_id = tests.id('table') and status = 'pending'), 1, 'admin sees the pending request');
update table_members set status = 'active' where table_id = tests.id('table') and user_id = tests.id('dana');
select tests.put('m_ben', (select id from table_members where table_id = tests.id('table') and user_id = tests.id('ben')));
select tests.put('m_dana', (select id from table_members where table_id = tests.id('table') and user_id = tests.id('dana')));
-- admin adds a guest (no account yet)
with x as (insert into table_members (table_id, display_name) values (tests.id('table'), 'יוסי') returning id) select tests.put('m_yossi', id) from x;
reset role;

select tests.login('dana');
select tests.eq((select count(*)::int from poker_tables where id = tests.id('table')), 1, 'approved member sees the table');
select tests.eq((select count(*)::int from table_members where table_id = tests.id('table')), 3, 'member sees everyone at the table');
select tests.eq(tests.affected(format($$ update table_members set role = 'admin' where id = %L $$, tests.id('m_dana'))), 0, 'player cannot make themself admin');
select tests.throws(format($$ insert into table_members (table_id, display_name) values (%L, 'x') $$, tests.id('table')), '%row-level security%', 'player cannot add members');
reset role;

select tests.login('yossi');
select tests.eq(public.join_table(:'table_code', tests.id('m_yossi')), 'active', 'personal invite link claims the guest seat');
select tests.eq((select user_id from table_members where id = tests.id('m_yossi')), tests.id('yossi'), 'guest seat now belongs to the user');
select tests.eq((select display_name from table_members where id = tests.id('m_yossi')), 'יוסי', 'claimed guest keeps the name the admin gave');
reset role;

select tests.login('stranger');
select tests.eq(public.join_table(:'table_code', tests.id('m_yossi')), 'pending', 'an already claimed invite cannot be claimed again');
reset role;

-- ---------------------------------------------------------------- chip set + night
select tests.login('ben');
with x as (insert into chip_sets (table_id, name, chips) values (tests.id('table'), 'רגילה',
  '[{"color":"לבן","hex":"#fff","value":5},{"color":"אדום","hex":"#d33","value":25},{"color":"שחור","hex":"#111","value":100}]') returning id) select tests.put('chipset', id) from x;
with x as (insert into game_nights (table_id, chip_set_id, chips_per_buyin, money_per_buyin, cashier_member_id, created_by)
  values (tests.id('table'), tests.id('chipset'), 1000, 100, tests.id('m_dana'), tests.id('ben')) returning id) select tests.put('night', id) from x;
insert into night_players (night_id, member_id, seat) values
  (tests.id('night'), tests.id('m_ben'), 0), (tests.id('night'), tests.id('m_dana'), 1), (tests.id('night'), tests.id('m_yossi'), 2);
update poker_tables set last_settings = last_settings || jsonb_build_object('chip_set_id', tests.id('chipset'), 'chips_per_buyin', 1000) where id = tests.id('table');
select tests.eq((select last_settings->>'chips_per_buyin' from poker_tables where id = tests.id('table')), '1000', 'admin saves last-night settings');
insert into night_events (night_id, actor_id, kind, payload) values (tests.id('night'), tests.id('ben'), 'night_opened', '{}');
reset role;

select tests.login('yossi');
select tests.throws(format($$ insert into game_nights (table_id, chips_per_buyin, money_per_buyin) values (%L, 1, 1) $$, tests.id('table')), '%row-level security%', 'player cannot open a night');
select tests.throws(format($$ insert into chip_sets (table_id, name, chips) values (%L, 'x', '[]') $$, tests.id('table')), '%row-level security%', 'player cannot add a chip set');
select tests.eq(tests.affected(format($$ update poker_tables set name = 'hacked' where id = %L $$, tests.id('table'))), 0, 'player cannot rename the table');
select tests.eq((select count(*)::int from night_players where night_id = tests.id('night')), 3, 'player sees the seated players');
reset role;

select tests.login('stranger');
select tests.eq((select count(*)::int from game_nights where id = tests.id('night')), 0, 'outsider cannot see the night');
select tests.eq((select count(*)::int from night_players where night_id = tests.id('night')), 0, 'outsider cannot see the players');
reset role;

-- ---------------------------------------------------------------- chip requests
select tests.login('yossi');
with x as (insert into chip_requests (night_id, member_id, requested_by, mode, chips)
  values (tests.id('night'), tests.id('m_yossi'), tests.id('yossi'), 'chips', 1000) returning id) select tests.put('req1', id) from x;
with x as (insert into chip_requests (night_id, member_id, requested_by, mode, chips)
  values (tests.id('night'), tests.id('m_yossi'), tests.id('yossi'), 'money', 500) returning id) select tests.put('req2', id) from x;
select tests.throws(format($$ insert into chip_requests (night_id, member_id, requested_by, mode, chips) values (%L, %L, %L, 'chips', 1000) $$,
  tests.id('night'), tests.id('m_ben'), tests.id('yossi')), '%row-level security%', 'player cannot request chips for someone else');
select tests.eq(tests.affected(format($$ update chip_requests set status = 'approved' where id = %L $$, tests.id('req1'))), 0, 'player cannot approve their own request');
select tests.eq(tests.affected(format($$ delete from chip_requests where id = %L $$, tests.id('req2'))), 1, 'player can cancel their own pending request');
insert into night_events (night_id, actor_id, kind, payload) values (tests.id('night'), tests.id('yossi'), 'request', '{}');
select tests.throws(format($$ insert into night_events (night_id, actor_id, kind) values (%L, %L, 'fake') $$, tests.id('night'), tests.id('ben')),
  '%row-level security%', 'nobody can log an event in someone else''s name');
-- chip photo upload into the night folder
insert into storage.objects (bucket_id, name) values ('chip-photos', tests.id('night') || '/req-1.jpg');
select tests.ok(true, 'player can upload a chip photo to the night folder');
reset role;

-- a member of ANOTHER table must not add debt to this night
select tests.login('stranger');
select tests.put('other_table', (public.create_table('Other')).id);
select tests.put('m_stranger_other', (select id from table_members where table_id = tests.id('other_table') and user_id = tests.id('stranger')));
select tests.throws(format($$ insert into chip_requests (night_id, member_id, requested_by, mode, chips) values (%L, %L, %L, 'chips', 1000) $$,
  tests.id('night'), tests.id('m_stranger_other'), tests.id('stranger')), '%row-level security%', 'member of another table cannot add requests to this night');
reset role;

select tests.login('stranger');
select tests.throws(format($$ insert into chip_requests (night_id, member_id, mode, chips) values (%L, %L, 'chips', 1) $$, tests.id('night'), tests.id('m_yossi')),
  '%row-level security%', 'outsider cannot request chips');
select tests.throws(format($$ insert into storage.objects (bucket_id, name) values ('chip-photos', %L) $$, tests.id('night') || '/x.jpg'),
  '%row-level security%', 'outsider cannot upload photos to the night');
select tests.eq((select count(*)::int from storage.objects where name like tests.id('night') || '/%'), 0, 'outsider cannot see the night photos');
reset role;

select tests.login('dana'); -- cashier, not admin
select tests.eq(tests.affected(format($$ update chip_requests set status = 'approved', given_chips = 1000, approved_by = %L, approved_at = now() where id = %L $$,
  tests.id('dana'), tests.id('req1'))), 1, 'cashier approves a request after handing the chips');
with x as (insert into chip_requests (night_id, member_id, requested_by, mode, chips, status, given_chips, detected_chips)
  values (tests.id('night'), tests.id('m_ben'), tests.id('dana'), 'chips', 1000, 'flagged', 1000, 975) returning id) select tests.put('req3', id) from x;
select tests.ok(true, 'cashier can request on behalf of another player (photo mismatch flagged)');
insert into chip_requests (night_id, member_id, requested_by, mode, chips, status, given_chips)
  values (tests.id('night'), tests.id('m_dana'), tests.id('dana'), 'chips', 1000, 'approved', 1000);
select tests.eq((select count(*)::int from storage.objects where name like tests.id('night') || '/%'), 1, 'cashier sees the night photos');
reset role;

select tests.login('ben');
select tests.eq(tests.affected(format($$ update chip_requests set status = 'approved' where id = %L $$, tests.id('req3'))), 1, 'admin approves a flagged request');
reset role;

-- ---------------------------------------------------------------- player leaves (cash out)
select tests.login('dana');
update night_players set status = 'out', final_chips = 0, bought_money = 100, net = -100, left_at = now()
 where night_id = tests.id('night') and member_id = tests.id('m_yossi');
select tests.eq((select status from night_players where night_id = tests.id('night') and member_id = tests.id('m_yossi')), 'out', 'cashier cashes out a player who leaves');
reset role;

-- ---------------------------------------------------------------- cashier handover
select tests.login('yossi');
select tests.throws(format($$ select public.handover_cashier(%L, %L, 3000, 3000, '[]') $$, tests.id('night'), tests.id('m_yossi')),
  '%only the admin or the cashier%', 'a regular player cannot take over the bank');
reset role;

select tests.login('dana');
select tests.throws(format($$ select public.handover_cashier(%L, %L, 3000, 3000, '[]') $$, tests.id('night'), tests.id('m_dana')),
  '%someone else%', 'cannot hand the bank to yourself');
select tests.eq((public.handover_cashier(tests.id('night'), tests.id('m_ben'), 3000, 2950,
  '[{"member_id":"x","chips":1950}]'::jsonb, null, null, '{"final_chips":1000,"bought_money":100,"net":0}'::jsonb, 'הולכת הביתה')).gap_chips, -50::numeric,
  'cashier hands over to the admin and the gap is recorded');
select tests.eq((select status from night_players where night_id = tests.id('night') and member_id = tests.id('m_dana')), 'out', 'outgoing cashier who left is cashed out');
select tests.eq(tests.affected(format($$ update chip_requests set note = 'x' where id = %L $$, tests.id('req1'))), 0, 'former cashier loses cashier rights');
reset role;
select tests.eq((select cashier_member_id from game_nights where id = tests.id('night')), tests.id('m_ben'), 'night now has the new cashier');
select tests.eq((select count(*)::int from night_events where night_id = tests.id('night') and kind = 'cashier_handover'), 1, 'handover is logged');

-- ---------------------------------------------------------------- close the night
select tests.login('ben');
update night_players set final_chips = 1950, bought_money = 100, net = 95 where night_id = tests.id('night') and member_id = tests.id('m_ben');
insert into settlements (night_id, from_member, to_member, amount) values (tests.id('night'), tests.id('m_yossi'), tests.id('m_ben'), 100);
select tests.put('settle', (select id from settlements where night_id = tests.id('night') limit 1));
with x as (insert into settlements (night_id, from_member, to_member, amount) values (tests.id('night'), tests.id('m_ben'), tests.id('m_dana'), 5) returning id)
select tests.put('settle2', id) from x;
update poker_tables set last_settings = last_settings || '{"settle_mode":"cashier"}' where id = tests.id('table');
select tests.eq((select last_settings->>'chips_per_buyin' from poker_tables where id = tests.id('table')), '1000', 'saving settle mode keeps the other remembered settings');
delete from storage.objects where name like tests.id('night') || '/%';
update game_nights set status = 'closed', closed_at = now(), photos_purged = true where id = tests.id('night');
select tests.eq((select status from game_nights where id = tests.id('night')), 'closed', 'admin closes the night');
select tests.eq((select count(*)::int from storage.objects where name like tests.id('night') || '/%'), 0, 'photos are deleted at close');
reset role;

select tests.login('ben');
select tests.throws(format($$ select public.handover_cashier(%L, %L, 0, 0, '[]') $$, tests.id('night'), tests.id('m_yossi')),
  '%night is closed%', 'no handover after the night is closed');
reset role;

-- ---------------------------------------------------------------- debts + stats
select tests.login('yossi');
select tests.eq((select count(*)::int from settlements where night_id = tests.id('night')), 2, 'players see the transfers');
select tests.eq(tests.affected(format($$ update settlements set paid = true where id = %L $$, tests.id('settle'))), 0, 'the debtor cannot mark their own debt as paid');
reset role;
select tests.login('dana');
select tests.throws(format($$ update settlements set amount = 1 where id = %L $$, tests.id('settle2')), '%only the admin%', 'a creditor who is not admin cannot change the amount');
select tests.eq(tests.affected(format($$ update settlements set paid = true, paid_at = now() where id = %L $$, tests.id('settle2'))), 1, 'a creditor who is not admin can mark it paid');
reset role;
select tests.login('yossi');
select tests.eq((select sum(net)::numeric from night_players where night_id = tests.id('night') and net is not null), -5::numeric, 'players can read results for stats');
reset role;

select tests.login('ben');
select tests.eq(tests.affected(format($$ update settlements set paid = true, paid_at = now() where id = %L $$, tests.id('settle'))), 1, 'the creditor marks the debt as paid');
reset role;

-- ---------------------------------------------------------------- remove a player
select tests.login('ben');
update table_members set status = 'removed', role = 'player' where id = tests.id('m_yossi');
reset role;
select tests.login('yossi');
select tests.eq((select count(*)::int from poker_tables where id = tests.id('table')), 0, 'removed player no longer sees the table');
select tests.throws(format($$ select public.join_table(%L) $$, :'table_code'), '%removed from table%', 'removed player cannot rejoin by code');
reset role;
select tests.login('dana');
select tests.eq(tests.affected(format($$ delete from poker_tables where id = %L $$, tests.id('table'))), 0, 'only the owner can delete the table');
reset role;

rollback;
