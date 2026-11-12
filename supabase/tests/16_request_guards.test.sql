-- Found by the game-night simulation: chips must never be approved for a
-- player after they left, or after the night closed, and a player cannot be
-- cashed out while a hand-over of theirs is still disputed.
\set ON_ERROR_STOP 1
begin;

select tests.make_user('admin', 'Admin');
select tests.make_user('p1', 'P1');
select tests.make_user('p2', 'P2');

select tests.login('admin');
select tests.put('table', (public.create_table('Guard table')).id);
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
update table_members set status = 'active' where table_id = tests.id('table');
with x as (insert into game_nights (table_id, chips_per_buyin, money_per_buyin, created_by, cashier_member_id)
  values (tests.id('table'), 1000, 100, tests.id('admin'), tests.id('m_admin')) returning id) select tests.put('night', id) from x;
insert into night_players (night_id, member_id, seat) values
  (tests.id('night'), tests.id('m_admin'), 0), (tests.id('night'), tests.id('m_p1'), 1), (tests.id('night'), tests.id('m_p2'), 2);
reset role;

-- p1 buys in, then asks for more and leaves before getting it
select tests.login('p1');
with x as (insert into chip_requests (night_id, member_id, requested_by, mode, chips)
  values (tests.id('night'), tests.id('m_p1'), tests.id('p1'), 'chips', 1000) returning id) select tests.put('r1', id) from x;
reset role;
select tests.login('admin');
update chip_requests set status = 'approved', given_chips = 1000 where id = tests.id('r1');
reset role;
select tests.login('p1');
with x as (insert into chip_requests (night_id, member_id, requested_by, mode, chips)
  values (tests.id('night'), tests.id('m_p1'), tests.id('p1'), 'chips', 1000) returning id) select tests.put('r2', id) from x;
reset role;

select tests.login('admin');
update night_players set status = 'out', final_chips = 1500, bought_money = 100, net = 50 where night_id = tests.id('night') and member_id = tests.id('m_p1');
reset role;
select tests.eq((select status from chip_requests where id = tests.id('r2')), 'rejected', 'a player who leaves has their open request cancelled');
select tests.ok(exists (select 1 from night_events where night_id = tests.id('night') and kind = 'rejected' and payload->>'reason' = 'left'), 'the cancellation is logged');

select tests.login('admin');
select tests.throws(format($$ update chip_requests set status = 'approved', given_chips = 1000 where id = %L $$, tests.id('r2')),
  '%player is not playing%', 'a stale cashier screen cannot approve chips for a player who left');
select tests.throws(format($$ insert into chip_requests (night_id, member_id, mode, chips) values (%L, %L, 'chips', 500) $$, tests.id('night'), tests.id('m_p1')),
  '%player is not playing%', 'no new requests for a player who left');
reset role;
select tests.eq((select sum(given_chips)::int from chip_requests where member_id = tests.id('m_p1') and status = 'approved'), 1000, 'the debt of a player who left stays as it was at cash-out');

-- back at the table: the cash-out is undone and requests work again
select tests.login('admin');
update night_players set status = 'playing', final_chips = null, net = null, bought_money = null where night_id = tests.id('night') and member_id = tests.id('m_p1');
with x as (insert into chip_requests (night_id, member_id, mode, chips) values (tests.id('night'), tests.id('m_p1'), 'chips', 500) returning id) select tests.put('r3', id) from x;
update chip_requests set status = 'approved', given_chips = 500 where id = tests.id('r3');
reset role;
select tests.eq((select status from chip_requests where id = tests.id('r3')), 'approved', 'after "back to playing" the player can buy in again');

-- a disputed hand-over blocks the cash-out until the admin decides
select tests.login('admin');
with x as (insert into chip_requests (night_id, member_id, mode, chips) values (tests.id('night'), tests.id('m_p2'), 'chips', 1000) returning id) select tests.put('r4', id) from x;
update chip_requests set status = 'flagged', given_chips = 1000, detected_chips = 900 where id = tests.id('r4');
select tests.throws(format($$ update night_players set status = 'out', final_chips = 0 where night_id = %L and member_id = %L $$, tests.id('night'), tests.id('m_p2')),
  '%flagged chip request%', 'a player with a disputed hand-over cannot be cashed out');
update chip_requests set status = 'approved', given_chips = 900 where id = tests.id('r4');
update night_players set status = 'out', final_chips = 900, bought_money = 90, net = 0 where night_id = tests.id('night') and member_id = tests.id('m_p2');
reset role;
select tests.eq((select status from night_players where night_id = tests.id('night') and member_id = tests.id('m_p2')), 'out', 'after the admin decides, the cash-out goes through');

-- nothing is approved once the night is closed
select tests.login('admin');
with x as (insert into chip_requests (night_id, member_id, mode, chips) values (tests.id('night'), tests.id('m_admin'), 'chips', 1000) returning id) select tests.put('r5', id) from x;
update game_nights set status = 'closed', closed_at = now() where id = tests.id('night');
select tests.throws(format($$ update chip_requests set status = 'approved', given_chips = 1000 where id = %L $$, tests.id('r5')),
  '%night is closed%', 'a request left open at closing cannot be approved afterwards');
select tests.throws(format($$ insert into chip_requests (night_id, member_id, mode, chips) values (%L, %L, 'chips', 500) $$, tests.id('night'), tests.id('m_admin')),
  '%night is closed%', 'no requests on a closed night');
reset role;

rollback;
