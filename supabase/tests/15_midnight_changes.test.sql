-- Changes during a running night: appoint a cashier, add players (members and
-- brand-new guests), take off a player who never got chips.
\set ON_ERROR_STOP 1
begin;

select tests.make_user('admin', 'Admin');
select tests.make_user('p1', 'P1');

select tests.login('admin');
select tests.put('table', (public.create_table('Midnight table')).id);
select tests.put('m_admin', (select id from table_members where table_id = tests.id('table') and user_id = tests.id('admin')));
reset role;
select code as table_code from poker_tables where id = tests.id('table') \gset

select tests.login('p1');
select public.join_table(:'table_code');
reset role;
select tests.put('m_p1', (select id from table_members where table_id = tests.id('table') and user_id = tests.id('p1')));

select tests.login('admin');
update table_members set status = 'active' where id = tests.id('m_p1');
-- a night that was opened without a cashier
with x as (insert into game_nights (table_id, chips_per_buyin, money_per_buyin, created_by)
  values (tests.id('table'), 1000, 100, tests.id('admin')) returning id) select tests.put('night', id) from x;
insert into night_players (night_id, member_id, seat) values (tests.id('night'), tests.id('m_admin'), 0);

update game_nights set cashier_member_id = tests.id('m_admin') where id = tests.id('night');
select tests.eq((select cashier_member_id from game_nights where id = tests.id('night')), tests.id('m_admin'), 'admin appoints a cashier mid-night');

insert into night_players (night_id, member_id, seat) values (tests.id('night'), tests.id('m_p1'), 1);
select tests.eq((select count(*)::int from night_players where night_id = tests.id('night')), 2, 'admin adds a table member mid-night');

with x as (insert into table_members (table_id, display_name) values (tests.id('table'), 'אורח חדש') returning id) select tests.put('guest', id) from x;
insert into night_players (night_id, member_id, seat) values (tests.id('night'), tests.id('guest'), 2);
select tests.eq((select count(*)::int from night_players where night_id = tests.id('night')), 3, 'admin adds a brand-new guest mid-night');
reset role;

select tests.login('p1');
select tests.eq(tests.affected(format($$ delete from night_players where night_id = %L and member_id = %L $$, tests.id('night'), tests.id('guest'))), 0, 'a player cannot remove others');
select tests.eq(tests.affected(format($$ update game_nights set cashier_member_id = %L where id = %L $$, tests.id('m_p1'), tests.id('night'))), 0, 'a player cannot make themself cashier');
reset role;

select tests.login('admin');
select tests.eq(tests.affected(format($$ delete from night_players where night_id = %L and member_id = %L $$, tests.id('night'), tests.id('guest'))), 1, 'admin removes a player who never got chips');
update game_nights set cashier_member_id = tests.id('m_p1') where id = tests.id('night');
reset role;

select tests.login('p1');
-- the new cashier can now manage players too
insert into night_players (night_id, member_id, seat) values (tests.id('night'), tests.id('guest'), 3);
select tests.eq((select count(*)::int from night_players where night_id = tests.id('night')), 3, 'the appointed cashier can seat a player');
reset role;

rollback;
