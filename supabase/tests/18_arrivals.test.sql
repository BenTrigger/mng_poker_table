-- Arrival check: a player confirms they arrived, or the admin/cashier marks
-- them; a chip request also counts as arrived.
\set ON_ERROR_STOP 1
begin;

select tests.make_user('admin', 'Admin');
select tests.make_user('p1', 'P1');
select tests.make_user('p2', 'P2');

select tests.login('admin');
select tests.put('table', (public.create_table('Arrivals table')).id);
select tests.put('m_admin', (select id from table_members where table_id = tests.id('table') and user_id = tests.id('admin')));
reset role;
select code as table_code from poker_tables where id = tests.id('table') \gset

select tests.login('p1');
select public.join_table(:'table_code');
reset role;
select tests.login('p2');
select public.join_table(:'table_code');
reset role;
select tests.put('m_p1', (select id from table_members where table_id = tests.id('table') and user_id = tests.id('p1')));
select tests.put('m_p2', (select id from table_members where table_id = tests.id('table') and user_id = tests.id('p2')));

select tests.login('admin');
with x as (insert into game_nights (table_id, chips_per_buyin, money_per_buyin, created_by, cashier_member_id)
  values (tests.id('table'), 1000, 100, tests.id('admin'), tests.id('m_admin')) returning id) select tests.put('night', id) from x;
with x as (insert into table_members (table_id, display_name) values (tests.id('table'), 'אורח') returning id) select tests.put('guest', id) from x;
insert into night_players (night_id, member_id, seat) values
  (tests.id('night'), tests.id('m_admin'), 0), (tests.id('night'), tests.id('m_p1'), 1),
  (tests.id('night'), tests.id('m_p2'), 2), (tests.id('night'), tests.id('guest'), 3);
select tests.put('np1', (select id from night_players where night_id = tests.id('night') and member_id = tests.id('m_p1')));
select tests.put('np2', (select id from night_players where night_id = tests.id('night') and member_id = tests.id('m_p2')));
select tests.put('npg', (select id from night_players where night_id = tests.id('night') and member_id = tests.id('guest')));
reset role;

select tests.login('p1');
select tests.ok((select arrived_at is null from night_players_view where id = tests.id('np1')), 'a player starts as not arrived');
select public.set_arrived(tests.id('np1'));
select tests.ok((select arrived_at is not null from night_players_view where id = tests.id('np1')), 'a player confirms their own arrival');
select tests.throws(format($$ select public.set_arrived(%L) $$, tests.id('np2')), '%only the admin or the cashier%', 'a player cannot mark someone else');
select tests.throws(format($$ select public.set_arrived(%L, false) $$, tests.id('np1')), '%only the admin or the cashier%', 'a player cannot undo an arrival');
select tests.ok((select count(*) = 1 from night_events where night_id = tests.id('night') and kind = 'arrived'), 'the arrival is logged');
reset role;

select tests.login('admin');
select public.set_arrived(tests.id('npg'));
select tests.ok((select arrived_at is not null from night_players where id = tests.id('npg')), 'the admin marks a guest as arrived');
select public.set_arrived(tests.id('npg'), false);
select tests.ok((select arrived_at is null from night_players where id = tests.id('npg')), 'the admin undoes an arrival');
reset role;

select tests.login('p2');
insert into chip_requests (night_id, member_id, requested_by, mode, chips) values (tests.id('night'), tests.id('m_p2'), tests.id('p2'), 'chips', 1000);
reset role;
select tests.ok((select arrived_at is not null from night_players where id = tests.id('np2')), 'a chip request counts as arrived');

select tests.login('admin');
select tests.throws(format($$ select public.set_arrived(%L, false) $$, tests.id('np2')), '%already has chips%', 'no undo once a player asked for chips');
-- the cashier can mark too
update game_nights set cashier_member_id = tests.id('m_p1') where id = tests.id('night');
reset role;
select tests.login('p1');
select public.set_arrived(tests.id('npg'));
select tests.ok((select arrived_at is not null from night_players where id = tests.id('npg')), 'the cashier marks a guest as arrived');
reset role;

rollback;
