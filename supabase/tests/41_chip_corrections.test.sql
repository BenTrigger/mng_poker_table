-- Corrections to automatic counts: members add them, everyone at the table reads them, the admin deletes.
\set ON_ERROR_STOP 1
begin;

select tests.make_user('cc_admin', 'Admin');
select tests.make_user('cc_player', 'Player');
select tests.make_user('cc_stranger', 'Stranger');

select tests.login('cc_admin');
select tests.put('cc_table', (public.create_table('Corrections table')).id);
with x as (insert into chip_sets (table_id, name, chips) values (tests.id('cc_table'), 'set', '[{"color":"אדום","hex":"#f00","value":5}]') returning id)
select tests.put('cc_set', id) from x;
with x as (insert into signups (table_id, starts_at, seats, created_by)
  values (tests.id('cc_table'), now() + interval '1 day', 5, tests.id('cc_admin')) returning id)
select tests.put('cc_signup', id) from x;
reset role;

select tests.login('cc_player');
select public.claim_seat(tests.id('cc_signup'));
insert into chip_corrections (chip_set_id, table_id, detected, actual, note)
values (tests.id('cc_set'), tests.id('cc_table'), '[{"color":"אדום","count":4}]', '[{"color":"אדום","count":5}]', 'הצ''יפ התחתון מוסתר');
select tests.ok(true, 'a member records a correction with a note');
select tests.throws(format($$ insert into chip_corrections (chip_set_id, table_id) values (%L, %L) $$, tests.id('cc_set'), tests.id('cc_table')), '%check%', 'an empty correction is refused');
select tests.eq(tests.affected($$ delete from chip_corrections $$), 0, 'a player cannot delete corrections');
reset role;

select tests.login('cc_stranger');
select tests.eq((select count(*) from chip_corrections)::int, 0, 'a stranger does not see the corrections');
select tests.throws(format($$ insert into chip_corrections (chip_set_id, table_id, note) values (%L, %L, 'x') $$, tests.id('cc_set'), tests.id('cc_table')), '%row-level security%', 'a stranger cannot add notes');
reset role;

select tests.login('cc_admin');
select tests.eq((select count(*) from chip_corrections)::int, 1, 'the admin sees the correction');
select tests.eq(tests.affected($$ delete from chip_corrections $$), 1, 'the admin removes it');
reset role;

rollback;
