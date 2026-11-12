-- "Who pays whom" after a tournament is saved, private results are respected,
-- and the creditor marks a transfer as paid.
\set ON_ERROR_STOP 1
begin;

select tests.make_user('admin', 'Admin');
select tests.make_user('p1', 'P1');
select tests.make_user('p2', 'P2');
select tests.make_user('p3', 'P3');

select tests.login('admin');
select tests.put('table', (public.create_table('Transfers table')).id);
reset role;
select code as table_code from poker_tables where id = tests.id('table') \gset
select tests.login('p1'); select public.join_table(:'table_code'); reset role;
select tests.login('p2'); select public.join_table(:'table_code'); reset role;
select tests.login('p3'); select public.join_table(:'table_code'); reset role;
select tests.put('m1', (select id from table_members where user_id = tests.id('p1')));
select tests.put('m2', (select id from table_members where user_id = tests.id('p2')));
select tests.put('m3', (select id from table_members where user_id = tests.id('p3')));

select tests.login('admin');
with x as (insert into tournaments (table_id, name, starts_at, table_count, seats_per_table, buy_in, starting_stack, levels, created_by)
  values (tests.id('table'), 'Cup', now(), 1, 4, 100, 10000, '[{"sb":25,"bb":50,"minutes":20}]', tests.id('admin')) returning id)
select tests.put('t', id) from x;
reset role;
select tests.login('p1'); select public.register_tournament(tests.id('t')); reset role;
select tests.login('p2'); select public.register_tournament(tests.id('t')); reset role;
select tests.login('p3'); select public.register_tournament(tests.id('t')); reset role;

select tests.login('admin');
select tests.throws(format($$ select public.save_tournament_transfers(%L, '[]') $$, tests.id('t')), '%not finished%', 'transfers are saved only after the end');
select public.start_tournament(tests.id('t'));
select public.finish_tournament(tests.id('t'), jsonb_build_array(
  jsonb_build_object('entry_id', (select id from tournament_entries where member_id = tests.id('m1')), 'place', 1, 'prize', 300),
  jsonb_build_object('entry_id', (select id from tournament_entries where member_id = tests.id('m2')), 'place', 2, 'prize', 0),
  jsonb_build_object('entry_id', (select id from tournament_entries where member_id = tests.id('m3')), 'place', 3, 'prize', 0)));
reset role;

select tests.login('p2');
select tests.throws(format($$ select public.save_tournament_transfers(%L, '[]') $$, tests.id('t')), '%admin only%', 'a player cannot save transfers');
reset role;

select tests.login('admin');
select tests.throws(format($$ select public.save_tournament_transfers(%L, %L) $$, tests.id('t'),
  jsonb_build_array(jsonb_build_object('from', tests.id('m2'), 'to', tests.id('m2'), 'amount', 100))), '%bad transfer%', 'a transfer to oneself is refused');
select public.save_tournament_transfers(tests.id('t'), jsonb_build_array(
  jsonb_build_object('from', tests.id('m2'), 'to', tests.id('m1'), 'amount', 100),
  jsonb_build_object('from', tests.id('m3'), 'to', tests.id('m1'), 'amount', 100)));
select tests.eq((select count(*)::int from tournament_transfers where tournament_id = tests.id('t')), 2, 'the admin saves the transfers');
select public.save_tournament_transfers(tests.id('t'), jsonb_build_array(
  jsonb_build_object('from', tests.id('m2'), 'to', tests.id('m1'), 'amount', 100),
  jsonb_build_object('from', tests.id('m3'), 'to', tests.id('m1'), 'amount', 100)));
select tests.eq((select count(*)::int from tournament_transfers where tournament_id = tests.id('t')), 2, 'saving again replaces them');
update poker_tables set last_settings = last_settings || '{"stats_visibility":"own"}' where id = tests.id('table');
reset role;

select tests.login('p2');
select tests.eq((select count(*)::int from tournament_transfers), 1, 'with private results a player sees only their own transfer');
select tests.eq(jsonb_array_length(public.get_tournament(tests.id('t'))->'transfers'), 1, 'the tournament page too');
select tests.eq(tests.affected(format($$ update tournament_transfers set paid = true where tournament_id = %L $$, tests.id('t'))), 0, 'the debtor cannot mark it paid');
reset role;
select tests.login('p1');
select tests.eq(jsonb_array_length(public.get_tournament(tests.id('t'))->'transfers'), 2, 'the winner sees both transfers to them');
select tests.throws(format($$ update tournament_transfers set amount = 1 where from_member = %L $$, tests.id('m2')), '%only the admin%', 'the creditor cannot change the amount');
select tests.eq(tests.affected(format($$ update tournament_transfers set paid = true, paid_at = now() where from_member = %L $$, tests.id('m2'))), 1, 'the creditor marks it paid');
reset role;

select tests.login('admin');
select tests.throws(format($$ select public.save_tournament_transfers(%L, '[]') $$, tests.id('t')), '%already paid%', 'once something is paid the transfers stay');
select public.reopen_tournament(tests.id('t'));
select tests.eq((select count(*)::int from tournament_transfers where tournament_id = tests.id('t')), 0, 'reopening the tournament drops the transfers');
reset role;

rollback;
