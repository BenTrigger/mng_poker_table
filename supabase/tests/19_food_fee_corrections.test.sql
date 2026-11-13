-- Food fee + host on a night, and corrections after the count: the admin can
-- fix a cash-out count and a purchase, also after the night is closed, and
-- rewrite the transfers. Nobody else can.
\set ON_ERROR_STOP 1
begin;

select tests.make_user('admin', 'Admin');
select tests.make_user('p1', 'P1');
select tests.make_user('other', 'Other');

select tests.login('admin');
select tests.put('table', (public.create_table('Food table')).id);
select tests.put('m_admin', (select id from table_members where table_id = tests.id('table') and user_id = tests.id('admin')));
reset role;
select code as table_code from poker_tables where id = tests.id('table') \gset
select tests.login('p1');
select public.join_table(:'table_code');
reset role;
select tests.put('m_p1', (select id from table_members where table_id = tests.id('table') and user_id = tests.id('p1')));

select tests.login('other');
select tests.put('table2', (public.create_table('Other table')).id);
select tests.put('m_other', (select id from table_members where table_id = tests.id('table2') and user_id = tests.id('other')));
reset role;

select tests.login('admin');
with x as (insert into game_nights (table_id, chips_per_buyin, money_per_buyin, created_by, cashier_member_id, food_fee, host_member_id)
  values (tests.id('table'), 1500, 50, tests.id('admin'), tests.id('m_admin'), 50, tests.id('m_admin')) returning id) select tests.put('night', id) from x;
select tests.eq((select food_fee from game_nights where id = tests.id('night')), 50::numeric, 'the admin opens a night with a food fee');
select tests.throws(format($$ update game_nights set host_member_id = %L where id = %L $$, tests.id('m_other'), tests.id('night')), '%host is not a member%', 'the host must be from this table');
select tests.throws(format($$ update game_nights set food_fee = -5 where id = %L $$, tests.id('night')), '%food_fee_check%', 'the food fee cannot be negative');
insert into night_players (night_id, member_id, seat, arrived_at) values
  (tests.id('night'), tests.id('m_admin'), 0, now()), (tests.id('night'), tests.id('m_p1'), 1, now());
with x as (insert into chip_requests (night_id, member_id, requested_by, mode, chips) values (tests.id('night'), tests.id('m_p1'), tests.id('admin'), 'chips', 12000) returning id)
  select tests.put('req', id) from x;
update chip_requests set status = 'approved', given_chips = 12000 where id = tests.id('req');
update night_players set status = 'out', final_chips = 11000, net = -33.33, bought_money = 400, left_at = now()
 where night_id = tests.id('night') and member_id = tests.id('m_p1');
reset role;

-- the cashier records chips for a player directly as handed; a player cannot
select tests.login('admin');
with x as (insert into chip_requests (night_id, member_id, requested_by, mode, chips, given_chips, status, approved_by, approved_at)
  values (tests.id('night'), tests.id('m_admin'), tests.id('admin'), 'chips', 1500, 1500, 'approved', tests.id('admin'), now()) returning id)
  select tests.put('direct', id) from x;
reset role;
select tests.eq((select status from chip_requests where id = tests.id('direct')), 'approved', 'the cashier records handed chips in one step');
select tests.login('p1');
select tests.throws(format($$ insert into chip_requests (night_id, member_id, requested_by, mode, chips, given_chips, status) values (%L, %L, %L, 'chips', 1500, 1500, 'approved') $$, tests.id('night'), tests.id('m_p1'), tests.id('p1')), '%only the cashier%', 'a player cannot insert their own chips as handed');
reset role;

-- a player cannot change the fee or a count
select tests.login('p1');
update game_nights set food_fee = 0 where id = tests.id('night');
select tests.eq((select food_fee from game_nights where id = tests.id('night')), 50::numeric, 'a player cannot change the food fee');
update night_players set final_chips = 99999 where night_id = tests.id('night') and member_id = tests.id('m_p1');
reset role;
select tests.eq((select final_chips from night_players where night_id = tests.id('night') and member_id = tests.id('m_p1')), 11000::numeric, 'a player cannot change their own count');

-- the admin fixes the cash-out count while the night is open
select tests.login('admin');
update night_players set final_chips = 12000, net = 0 where night_id = tests.id('night') and member_id = tests.id('m_p1');
reset role;
select tests.eq((select final_chips from night_players where night_id = tests.id('night') and member_id = tests.id('m_p1')), 12000::numeric, 'the admin corrects a cash-out count');

-- close, then correct a purchase and the transfers afterwards
select tests.login('admin');
insert into settlements (night_id, from_member, to_member, amount) values (tests.id('night'), tests.id('m_p1'), tests.id('m_admin'), 50);
update game_nights set status = 'closed', closed_at = now(), settle_mode = 'cashier' where id = tests.id('night');
update chip_requests set given_chips = 15000 where id = tests.id('req');
select tests.eq((select given_chips from chip_requests where id = tests.id('req')), 15000::numeric, 'the admin corrects a purchase after the close');
update night_players set bought_money = 500, net = -100 where night_id = tests.id('night') and member_id = tests.id('m_p1');
delete from settlements where night_id = tests.id('night');
insert into settlements (night_id, from_member, to_member, amount) values (tests.id('night'), tests.id('m_p1'), tests.id('m_admin'), 150);
update game_nights set food_fee = 60 where id = tests.id('night');
reset role;
select tests.eq((select amount from settlements where night_id = tests.id('night')), 150::numeric, 'the admin rewrites the transfers after a correction');
select tests.eq((select food_fee from game_nights where id = tests.id('night')), 60::numeric, 'the admin changes the food fee after the close');
select tests.eq((select settle_mode from game_nights where id = tests.id('night')), 'cashier', 'the settle mode is kept on the night');

-- a closed night still takes no new purchases
select tests.login('admin');
select tests.throws(format($$ insert into chip_requests (night_id, member_id, requested_by, mode, chips) values (%L, %L, %L, 'chips', 1500) $$, tests.id('night'), tests.id('m_p1'), tests.id('admin')), '%night is closed%', 'no new purchases on a closed night');
reset role;

-- the player cannot rewrite the transfers
select tests.login('p1');
delete from settlements where night_id = tests.id('night');
reset role;
select tests.eq((select count(*)::int from settlements where night_id = tests.id('night')), 1, 'a player cannot delete transfers');

rollback;
