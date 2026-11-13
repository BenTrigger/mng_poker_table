-- Admin control: delete a night (open or closed), back to sign-up, sign-up
-- settings, delete a whole table.
\set ON_ERROR_STOP 1
begin;

select tests.make_user('owner', 'Owner');
select tests.make_user('pa', 'PA');
select tests.make_user('pb', 'PB');

select tests.login('owner');
select tests.put('table', (public.create_table('Admin table')).id);
select tests.put('m_owner', (select id from table_members where table_id = tests.id('table') and user_id = tests.id('owner')));
reset role;
select code as table_code from poker_tables where id = tests.id('table') \gset
select tests.login('pa');
select public.join_table(:'table_code');
reset role;
select tests.login('pb');
select public.join_table(:'table_code');
reset role;

select tests.login('owner');
select tests.put('m_pa', (select id from table_members where table_id = tests.id('table') and user_id = tests.id('pa')));
select tests.put('m_pb', (select id from table_members where table_id = tests.id('table') and user_id = tests.id('pb')));
with x as (insert into chip_sets (table_id, name, chips) values (tests.id('table'), 'ערכה', '[{"color":"לבן","hex":"#fff","value":5}]') returning id)
select tests.put('chipset', id) from x;

-- ---------------------------------------------------------------- sign-up settings
with x as (insert into signups (table_id, starts_at, seats, created_by, settings)
  values (tests.id('table'), now() + interval '1 day', 9, tests.id('owner'),
          jsonb_build_object('cashier_member_id', tests.id('m_pa'), 'chips_per_buyin', 500, 'money_per_buyin', 50)) returning id)
select tests.put('signup', id) from x;
select tests.eq((public.get_signup(tests.id('signup'))->'signup'->'settings'->>'chips_per_buyin'), '500', 'sign-up carries the night settings');
select tests.eq(tests.affected(format($$ update signups set settings = settings || '{"money_per_buyin": 80}' where id = %L $$, tests.id('signup'))), 1, 'admin edits the sign-up settings');
reset role;
select tests.login('pa');
select tests.eq(tests.affected(format($$ update signups set settings = '{}' where id = %L $$, tests.id('signup'))), 0, 'a player cannot change the sign-up settings');
select public.claim_seat(tests.id('signup'), 1);
reset role;
select tests.login('pb');
select public.claim_seat(tests.id('signup'), 2);
reset role;

-- ---------------------------------------------------------------- night opened from the sign-up, then back to sign-up
select tests.login('owner');
with x as (insert into game_nights (table_id, name, chip_set_id, chips_per_buyin, money_per_buyin, cashier_member_id, created_by, food_fee, host_member_id)
  values (tests.id('table'), 'השישי ה-13', tests.id('chipset'), 500, 80, tests.id('m_pa'), tests.id('owner'), 40, tests.id('m_owner')) returning id) select tests.put('night1', id) from x;
insert into night_players (night_id, member_id, seat) values
  (tests.id('night1'), tests.id('m_pa'), 0), (tests.id('night1'), tests.id('m_pb'), 1), (tests.id('night1'), tests.id('m_owner'), 2);
update signups set status = 'started', night_id = tests.id('night1') where id = tests.id('signup');
-- a request still waiting does not block going back
insert into chip_requests (night_id, member_id, requested_by, mode, chips) values (tests.id('night1'), tests.id('m_pb'), tests.id('owner'), 'chips', 500);
reset role;

select tests.login('pa');
select tests.throws(format($$ select public.night_back_to_signup(%L) $$, tests.id('night1')), '%admin only%', 'only the admin takes a night back to sign-up');
select tests.throws(format($$ select public.delete_night(%L) $$, tests.id('night1')), '%admin only%', 'only the admin deletes a night');
reset role;

select tests.login('owner');
select tests.eq(public.night_back_to_signup(tests.id('night1')), tests.id('signup'), 'back to sign-up reopens the sign-up the night came from');
select tests.eq((select count(*)::int from game_nights where id = tests.id('night1')), 0, 'the running night is gone');
select tests.eq((select status from signups where id = tests.id('signup')), 'open', 'sign-up is open again');
select tests.eq((select night_id from signups where id = tests.id('signup')), null::uuid, 'sign-up no longer points at a night');
select tests.eq((select count(*)::int from signup_seats where signup_id = tests.id('signup') and seat is not null), 3, 'everyone from the night has a seat, also the one added at the table');
select tests.eq((select seat from signup_seats where signup_id = tests.id('signup') and member_id = tests.id('m_pa')), 1, 'players keep the seat they signed up for');
select tests.eq((select name from signups where id = tests.id('signup')), 'השישי ה-13', 'the night name goes back to the sign-up');
select tests.eq((select settings->>'food_fee' from signups where id = tests.id('signup')), '40', 'the night settings are kept on the sign-up');
select tests.eq((select settings->>'cashier_member_id' from signups where id = tests.id('signup'))::uuid, tests.id('m_pa'), 'the cashier is kept on the sign-up');

-- a night opened directly: back to sign-up creates a new one
with x as (insert into game_nights (table_id, chip_set_id, chips_per_buyin, money_per_buyin, cashier_member_id, created_by)
  values (tests.id('table'), tests.id('chipset'), 1000, 100, tests.id('m_pa'), tests.id('owner')) returning id) select tests.put('night2', id) from x;
insert into night_players (night_id, member_id, seat) values (tests.id('night2'), tests.id('m_pa'), 0), (tests.id('night2'), tests.id('m_pb'), 1);
select tests.put('signup2', public.night_back_to_signup(tests.id('night2')));
select tests.ok(tests.id('signup2') <> tests.id('signup'), 'a night opened without sign-up gets a new sign-up');
select tests.eq((select count(*)::int from signup_seats where signup_id = tests.id('signup2') and seat is not null), 2, 'its players are seated in the new sign-up');
select tests.eq((select settings->>'chips_per_buyin' from signups where id = tests.id('signup2')), '1000', 'new sign-up keeps the buy-in');

-- after chips were handed out there is no way back
with x as (insert into game_nights (table_id, chip_set_id, chips_per_buyin, money_per_buyin, cashier_member_id, created_by)
  values (tests.id('table'), tests.id('chipset'), 1000, 100, tests.id('m_pa'), tests.id('owner')) returning id) select tests.put('night3', id) from x;
insert into night_players (night_id, member_id, seat) values (tests.id('night3'), tests.id('m_pa'), 0), (tests.id('night3'), tests.id('m_pb'), 1);
with x as (insert into chip_requests (night_id, member_id, requested_by, mode, chips) values (tests.id('night3'), tests.id('m_pb'), tests.id('owner'), 'chips', 1000) returning id)
select tests.put('req3', id) from x;
update chip_requests set status = 'approved', given_chips = 1000, approved_by = tests.id('owner'), approved_at = now() where id = tests.id('req3');
select tests.throws(format($$ select public.night_back_to_signup(%L) $$, tests.id('night3')), '%chips already handed out%', 'no back to sign-up once chips were handed out');

select tests.eq(tests.affected(format($$ update game_nights set name = 'החמישי הראשון' where id = %L $$, tests.id('night3'))), 1, 'admin names a night');
reset role;
select tests.login('pb');
select tests.eq(tests.affected(format($$ update game_nights set name = 'x' where id = %L $$, tests.id('night3'))), 0, 'a player cannot rename a night');
reset role;
select tests.login('owner');

-- ---------------------------------------------------------------- delete an open night
select tests.eq(public.delete_night(tests.id('night3')), tests.id('table'), 'admin deletes a running night');
select tests.eq((select count(*)::int from chip_requests where night_id = tests.id('night3')), 0, 'its chip requests go with it');

-- ---------------------------------------------------------------- delete a closed night with settlements
with x as (insert into game_nights (table_id, chip_set_id, chips_per_buyin, money_per_buyin, cashier_member_id, created_by)
  values (tests.id('table'), tests.id('chipset'), 1000, 100, tests.id('m_pa'), tests.id('owner')) returning id) select tests.put('night4', id) from x;
insert into night_players (night_id, member_id, seat) values (tests.id('night4'), tests.id('m_pa'), 0), (tests.id('night4'), tests.id('m_pb'), 1);
reset role;
-- closing is done by the app; here the night is simply marked closed with a debt
update game_nights set status = 'closed', closed_at = now() where id = tests.id('night4');
insert into settlements (night_id, from_member, to_member, amount) values (tests.id('night4'), tests.id('m_pb'), tests.id('m_pa'), 100);
update signups set status = 'started', night_id = tests.id('night4') where id = tests.id('signup2');
select tests.login('owner');
select public.delete_night(tests.id('night4'));
select tests.eq((select count(*)::int from game_nights where id = tests.id('night4')), 0, 'admin deletes a closed night');
select tests.eq((select count(*)::int from settlements where night_id = tests.id('night4')), 0, 'its debts go with it');
select tests.eq((select status from signups where id = tests.id('signup2')), 'cancelled', 'the sign-up of a deleted night is marked cancelled');

-- ---------------------------------------------------------------- delete the table
reset role;
update table_members set role = 'admin' where id = tests.id('m_pa');
select tests.login('pa');
select tests.throws(format($$ select public.delete_table(%L) $$, tests.id('table')), '%owner only%', 'another admin cannot delete the table');
reset role;
-- give the table some history first
select tests.login('owner');
with x as (insert into game_nights (table_id, chip_set_id, chips_per_buyin, money_per_buyin, cashier_member_id, created_by)
  values (tests.id('table'), tests.id('chipset'), 1000, 100, tests.id('m_pa'), tests.id('owner')) returning id) select tests.put('night5', id) from x;
insert into night_players (night_id, member_id, seat) values (tests.id('night5'), tests.id('m_pa'), 0), (tests.id('night5'), tests.id('m_pb'), 1);
select public.delete_table(tests.id('table'));
reset role;
select tests.eq((select count(*)::int from poker_tables where id = tests.id('table')), 0, 'the owner deletes the table');
select tests.eq((select count(*)::int from table_members where table_id = tests.id('table')), 0, 'its members go');
select tests.eq((select count(*)::int from game_nights where table_id = tests.id('table')), 0, 'its nights go');
select tests.eq((select count(*)::int from signups where table_id = tests.id('table')), 0, 'its sign-ups go');
select tests.eq((select count(*)::int from chip_sets where table_id = tests.id('table')), 0, 'its chip sets go');

rollback;
