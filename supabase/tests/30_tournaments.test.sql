-- Tournaments: registration with waiting list, seat draw, bust/rebuy, finish, and the 10-player cap on cash nights.
\set ON_ERROR_STOP 1
begin;

select tests.make_user('admin', 'Admin');
select tests.make_user('p1', 'P1');
select tests.make_user('p2', 'P2');
select tests.make_user('p3', 'P3');
select tests.make_user('p4', 'P4');
select tests.make_user('p5', 'P5');
select tests.make_user('out', 'Outsider');

select tests.login('admin');
select tests.put('table', (public.create_table('Tournament table')).id);
-- 2 tables x 2 seats = 4 places
with x as (insert into tournaments (table_id, name, starts_at, table_count, seats_per_table, buy_in, starting_stack,
                                    rebuy_until_level, late_reg_until_level, levels, created_by)
  values (tests.id('table'), 'Friday', now() + interval '1 day', 2, 2, 100, 10000, 4, 0,
          '[{"sb":25,"bb":50,"minutes":20}]', tests.id('admin')) returning id)
select tests.put('t', id) from x;
reset role;

select tests.login('p1');
select tests.throws(format($$ insert into tournaments (table_id, name, starts_at, buy_in, starting_stack, levels) values (%L, 'x', now(), 1, 1, '[]') $$, tests.id('table')),
  '%row-level security%', 'only the admin opens a tournament');
select tests.eq(public.get_tournament(tests.id('t'))->>'me', null, 'link works before joining the table');
select tests.eq(public.register_tournament(tests.id('t')), 'registered', 'a player registers from the link');
select tests.eq((select status from table_members where table_id = tests.id('table') and user_id = tests.id('p1')), 'active', 'registering joins the table');
select tests.eq(public.register_tournament(tests.id('t')), 'registered', 'registering twice is harmless');
reset role;

select tests.login('p2'); select tests.eq(public.register_tournament(tests.id('t')), 'registered', 'p2 registers'); reset role;
select tests.login('p3'); select tests.eq(public.register_tournament(tests.id('t')), 'registered', 'p3 registers'); reset role;
select tests.login('p4'); select tests.eq(public.register_tournament(tests.id('t')), 'registered', 'p4 takes the last place'); reset role;
select tests.login('p5'); select tests.eq(public.register_tournament(tests.id('t')), 'waiting', 'full -> waiting list'); reset role;

select tests.login('p3');
select public.leave_tournament(tests.id('t'));
reset role;
select tests.eq((select e.status from tournament_entries e join table_members m on m.id = e.member_id
  where e.tournament_id = tests.id('t') and m.user_id = tests.id('p5')), 'registered', 'when someone drops out the waiting list moves up');

select tests.login('p1');
select tests.throws(format($$ select public.start_tournament(%L) $$, tests.id('t')), '%admin only%', 'players cannot start');
select tests.throws(format($$ select public.resize_tournament(%L, 3, 3) $$, tests.id('t')), '%admin only%', 'players cannot resize');
select tests.eq(tests.affected(format($$ update tournaments set buy_in = 1 where id = %L $$, tests.id('t'))), 0, 'players cannot edit the tournament');
select tests.eq(tests.affected(format($$ update tournament_entries set rebuys = 9 where tournament_id = %L $$, tests.id('t'))), 0, 'players cannot edit entries');
reset role;

select tests.login('out');
select tests.eq((select count(*)::int from tournaments where id = tests.id('t')), 0, 'non-members do not see the tournament rows');
reset role;

select tests.login('admin');
select public.resize_tournament(tests.id('t'), 1, 3);
select tests.eq((select count(*)::int from tournament_entries where tournament_id = tests.id('t') and status = 'waiting'), 1, 'shrinking sends the latest sign-up back to waiting');
select public.resize_tournament(tests.id('t'), 2, 2);
select tests.eq((select count(*)::int from tournament_entries where tournament_id = tests.id('t') and status = 'registered'), 4, 'growing brings them back');

select public.start_tournament(tests.id('t'));
select tests.eq((select status from tournaments where id = tests.id('t')), 'running', 'start runs the tournament');
select tests.eq((select count(distinct table_no)::int from tournament_entries where tournament_id = tests.id('t') and status = 'playing'), 2, 'draw uses both tables');
select tests.eq((select max(c)::int from (select count(*) c from tournament_entries where tournament_id = tests.id('t') and status = 'playing' group by table_no) x), 2, 'draw spreads players evenly');
select tests.ok((select clock_anchor is not null from tournaments where id = tests.id('t')), 'clock starts with the draw');
select tests.eq((select registration_open from tournaments where id = tests.id('t')), false, 'no late registration -> closed');
select tests.throws(format($$ select public.start_tournament(%L) $$, tests.id('t')), '%already started%', 'cannot start twice');
reset role;

select tests.login('p5');
select tests.throws(format($$ select public.register_tournament(%L) $$, tests.id('t')), '%registration is closed%', 'late registration closed');
select tests.throws(format($$ select public.leave_tournament(%L) $$, tests.id('t')), '%already started%', 'a seated player cannot leave after the start');
reset role;

select tests.login('p1');
select tests.throws(format($$ select public.bust_player(%L) $$,
  (select e.id from tournament_entries e join table_members m on m.id = e.member_id where e.tournament_id = tests.id('t') and m.user_id = tests.id('p2'))),
  '%admin only%', 'players cannot bust others');
reset role;

select tests.login('admin');
select tests.put('e_p2', (select e.id from tournament_entries e join table_members m on m.id = e.member_id where e.tournament_id = tests.id('t') and m.user_id = tests.id('p2')));
select tests.put('e_p4', (select e.id from tournament_entries e join table_members m on m.id = e.member_id where e.tournament_id = tests.id('t') and m.user_id = tests.id('p4')));
select public.bust_player(tests.id('e_p2'), null);
select tests.eq((select status from tournament_entries where id = tests.id('e_p2')), 'busted', 'bust');
select tests.ok((select table_no is null and seat_no is null from tournament_entries where id = tests.id('e_p2')), 'bust frees the seat');
select public.reenter_player(tests.id('e_p2'), true);
select tests.eq((select rebuys from tournament_entries where id = tests.id('e_p2')), 1, 'rebuy counted');
select tests.eq((select status from tournament_entries where id = tests.id('e_p2')), 'playing', 'rebuy puts the player back');
select tests.eq((select count(*)::int from (select distinct table_no, seat_no from tournament_entries where tournament_id = tests.id('t') and status = 'playing') x), 4, 'every player has their own seat');
select public.bust_player(tests.id('e_p2'), null);
select public.bust_player(tests.id('e_p4'), null);
select public.bust_player((select id from tournament_entries where tournament_id = tests.id('t') and status = 'playing' limit 1), null);
select tests.throws(format($$ select public.bust_player(%L) $$, (select id from tournament_entries where tournament_id = tests.id('t') and status = 'playing')),
  '%last player%', 'the last player cannot be busted');

select public.finish_tournament(tests.id('t'), (
  select jsonb_agg(jsonb_build_object('entry_id', id, 'place', rn, 'prize', case rn when 1 then 350 when 2 then 150 else 0 end))
    from (select id, row_number() over (order by status = 'playing' desc, busted_at desc) rn
            from tournament_entries where tournament_id = tests.id('t') and status in ('playing', 'busted')) x));
select tests.eq((select status from tournaments where id = tests.id('t')), 'finished', 'finish');
select tests.eq((select sum(prize) from tournament_entries where tournament_id = tests.id('t')), 500::numeric, 'prizes stored');
select tests.eq((select count(*)::int from tournament_entries where tournament_id = tests.id('t') and place is null), 0, 'everyone has a place');
select public.reopen_tournament(tests.id('t'));
select tests.eq((select count(*)::int from tournament_entries where tournament_id = tests.id('t') and status = 'playing'), 1, 'reopen brings the winner back');
reset role;

-- a regular night is one table of at most 10
select tests.login('admin');
with x as (insert into game_nights (table_id, chips_per_buyin, money_per_buyin) values (tests.id('table'), 1000, 100) returning id) select tests.put('night', id) from x;
insert into table_members (table_id, display_name) select tests.id('table'), 'g' || g from generate_series(1, 11) g;
insert into night_players (night_id, member_id, seat)
  select tests.id('night'), id, row_number() over () from (select id from table_members where table_id = tests.id('table') and display_name like 'g%' order by display_name limit 10) x;
select tests.eq((select count(*)::int from night_players where night_id = tests.id('night')), 10, '10 players fit at a night');
select tests.throws(format($$ insert into night_players (night_id, member_id) values (%L, %L) $$, tests.id('night'),
  (select id from table_members where table_id = tests.id('table') and display_name = 'g9')), '%table is full%', 'the 11th player is refused');
reset role;

rollback;
