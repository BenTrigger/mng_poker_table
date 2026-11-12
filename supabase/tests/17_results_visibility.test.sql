-- "Each player sees only their own" is enforced by the database, not only the
-- screens: nets, end counts, transfers and tournament prizes of others are hidden.
\set ON_ERROR_STOP 1
begin;

select tests.make_user('admin', 'Admin');
select tests.make_user('p1', 'P1');
select tests.make_user('p2', 'P2');

select tests.login('admin');
select tests.put('table', (public.create_table('Private table')).id);
reset role;
select code as table_code from poker_tables where id = tests.id('table') \gset
select tests.login('p1'); select public.join_table(:'table_code'); reset role;
select tests.login('p2'); select public.join_table(:'table_code'); reset role;
select tests.put('m_admin', (select id from table_members where table_id = tests.id('table') and user_id = tests.id('admin')));
select tests.put('m_p1', (select id from table_members where table_id = tests.id('table') and user_id = tests.id('p1')));
select tests.put('m_p2', (select id from table_members where table_id = tests.id('table') and user_id = tests.id('p2')));

select tests.login('admin');
update table_members set status = 'active' where table_id = tests.id('table');
with x as (insert into game_nights (table_id, chips_per_buyin, money_per_buyin, created_by, cashier_member_id)
  values (tests.id('table'), 1000, 100, tests.id('admin'), tests.id('m_admin')) returning id) select tests.put('night', id) from x;
insert into night_players (night_id, member_id, seat, status, final_chips, bought_money, net) values
  (tests.id('night'), tests.id('m_admin'), 0, 'out', 1000, 100, 0),
  (tests.id('night'), tests.id('m_p1'), 1, 'out', 1500, 100, 50),
  (tests.id('night'), tests.id('m_p2'), 2, 'out', 500, 100, -50);
insert into settlements (night_id, from_member, to_member, amount) values (tests.id('night'), tests.id('m_p2'), tests.id('m_p1'), 50);
update game_nights set status = 'closed', closed_at = now() where id = tests.id('night');
update poker_tables set last_settings = last_settings || '{"stats_visibility":"own"}' where id = tests.id('table');
reset role;

-- a player
select tests.login('p1');
select tests.eq((select net from night_players_view where member_id = tests.id('m_p1')), 50::numeric, 'a player sees their own net');
select tests.eq((select count(*)::int from night_players_view where night_id = tests.id('night')), 3, 'a player still sees who played');
select tests.eq((select count(*)::int from night_players_view where night_id = tests.id('night') and net is not null), 1, 'but not the others'' nets');
select tests.eq((select count(*)::int from night_players_view where night_id = tests.id('night') and final_chips is not null), 1, 'nor their end counts');
select tests.throws($$ select net from night_players $$, '%permission denied%', 'the table itself does not give the net away');
select tests.throws($$ select final_chips from night_players $$, '%permission denied%', 'nor the end count');
select tests.eq((select count(*)::int from settlements where night_id = tests.id('night')), 1, 'a player sees the transfers they are part of');
reset role;
select tests.login('admin');
select tests.eq((select count(*)::int from night_players_view where night_id = tests.id('night') and net is not null), 3, 'the admin sees every net');
insert into settlements (night_id, from_member, to_member, amount) values (tests.id('night'), tests.id('m_admin'), tests.id('m_p2'), 10);
reset role;
select tests.login('p1');
select tests.eq((select count(*)::int from settlements where night_id = tests.id('night')), 1, 'a transfer between others stays hidden');
reset role;

-- a tournament prize
select tests.login('admin');
with x as (insert into tournaments (table_id, name, starts_at, table_count, seats_per_table, buy_in, starting_stack, levels, created_by)
  values (tests.id('table'), 'Cup', now(), 1, 3, 100, 10000, '[{"sb":25,"bb":50,"minutes":20}]', tests.id('admin')) returning id)
select tests.put('t', id) from x;
reset role;
insert into tournament_entries (tournament_id, member_id, status, place, prize) values
  (tests.id('t'), tests.id('m_p1'), 'busted', 1, 200), (tests.id('t'), tests.id('m_p2'), 'busted', 2, 100);
reset role;
select tests.login('p1');
select tests.eq((select prize from tournament_results_view where member_id = tests.id('m_p1')), 200::numeric, 'a player sees their own prize');
select tests.ok((select prize from tournament_results_view where member_id = tests.id('m_p2')) is null, 'not the other''s prize');
select tests.eq((select count(*)::int from jsonb_array_elements(public.get_tournament(tests.id('t'))->'entries') e where e->>'prize' is not null), 1, 'the tournament page hides it too');
select tests.throws($$ select prize from tournament_entries $$, '%permission denied%', 'the table itself does not give the prize away');
reset role;

-- back to "everyone sees everything"
select tests.login('admin');
update poker_tables set last_settings = last_settings || '{"stats_visibility":"all"}' where id = tests.id('table');
reset role;
select tests.login('p1');
select tests.eq((select count(*)::int from night_players_view where night_id = tests.id('night') and net is not null), 3, 'with "all", everyone sees every net');
select tests.eq((select count(*)::int from settlements where night_id = tests.id('night')), 2, 'and every transfer');
select tests.eq((select count(*)::int from tournament_results_view where tournament_id = tests.id('t') and prize is not null), 2, 'and every prize');
reset role;

-- outsiders see nothing
select tests.make_user('out', 'Outsider');
select tests.login('out');
select tests.eq((select count(*)::int from night_players_view), 0, 'an outsider sees no results');
select tests.eq((select count(*)::int from tournament_results_view), 0, 'nor prizes');
reset role;

rollback;
