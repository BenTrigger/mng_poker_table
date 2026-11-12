-- Guest players by name: add (admins only), reuse across nights, link to a
-- real account (admin or personal invite link) keeping all history.
\set ON_ERROR_STOP 1
begin;

select tests.make_user('admin', 'Admin');
select tests.make_user('cash', 'Cashier');
select tests.make_user('p1', 'P1');
select tests.make_user('dani', 'Dani Google');
select tests.make_user('yossi', 'Yossi Google');

select tests.login('admin');
select tests.put('table', (public.create_table('Guest table')).id);
select tests.put('m_admin', (select id from table_members where table_id = tests.id('table') and user_id = tests.id('admin')));
reset role;
select code as table_code from poker_tables where id = tests.id('table') \gset

select tests.login('cash');
select public.join_table(:'table_code');
reset role;
select tests.login('p1');
select public.join_table(:'table_code');
reset role;
select tests.put('m_cash', (select id from table_members where table_id = tests.id('table') and user_id = tests.id('cash')));
select tests.put('m_p1', (select id from table_members where table_id = tests.id('table') and user_id = tests.id('p1')));

select tests.login('admin');
update table_members set status = 'active' where id in (tests.id('m_cash'), tests.id('m_p1'));
select tests.put('g_dani', (public.add_guest(tests.id('table'), '  דני  ')).id);
select tests.eq((select display_name from table_members where id = tests.id('g_dani')), 'דני', 'admin adds a guest by name only (trimmed)');
select tests.eq((select user_id is null and status = 'active' from table_members where id = tests.id('g_dani')), true, 'guest is an active member without an account');
select tests.eq((public.add_guest(tests.id('table'), 'דני')).id, tests.id('g_dani'), 'the same name reuses the remembered guest');
select tests.throws(format($$ select public.add_guest(%L, '   ') $$, tests.id('table')), '%name required%', 'empty name is refused');

-- night 1 with the guest; cashier is "cash"
with x as (insert into game_nights (table_id, chips_per_buyin, money_per_buyin, created_by, cashier_member_id)
  values (tests.id('table'), 1000, 100, tests.id('admin'), tests.id('m_cash')) returning id) select tests.put('n1', id) from x;
insert into night_players (night_id, member_id, seat, status, net) values
  (tests.id('n1'), tests.id('m_admin'), 0, 'playing', null),
  (tests.id('n1'), tests.id('g_dani'), 1, 'playing', null);
insert into chip_requests (night_id, member_id, mode, chips, given_chips, status, requested_by)
  values (tests.id('n1'), tests.id('g_dani'), 'chips', 1000, 1000, 'approved', tests.id('admin'));
reset role;

select tests.login('p1');
select tests.throws(format($$ select public.add_guest(%L, 'מישהו') $$, tests.id('table')), '%admin only%', 'a plain player cannot add guests');
reset role;

select tests.login('cash');
select tests.throws(format($$ select public.add_guest(%L, 'יוסי') $$, tests.id('table')), '%admin only%', 'the cashier cannot add guests (admins only)');
reset role;

select tests.login('admin');
select tests.put('g_yossi', (public.add_guest(tests.id('table'), 'יוסי')).id);
insert into night_players (night_id, member_id, seat) values (tests.id('n1'), tests.id('g_yossi'), 2);
select tests.eq((select count(*)::int from night_players where night_id = tests.id('n1')), 3, 'admin seats a new guest mid-night');
reset role;

select tests.login('admin');
update night_players set status = 'out', net = -100, bought_money = 100 where night_id = tests.id('n1') and member_id = tests.id('g_dani');
update game_nights set status = 'closed', closed_at = now() where id = tests.id('n1');
insert into settlements (night_id, from_member, to_member, amount) values (tests.id('n1'), tests.id('g_dani'), tests.id('m_admin'), 100);
reset role;

-- Dani joins with the general table link first (separate pending member)
select tests.login('dani');
select tests.eq(public.join_table(:'table_code'), 'pending', 'dani joins through the general link');
reset role;
select tests.put('m_dani', (select id from table_members where table_id = tests.id('table') and user_id = tests.id('dani')));

select tests.login('p1');
select tests.throws(format($$ select public.link_guest(%L, %L) $$, tests.id('g_dani'), tests.id('m_dani')), '%admin only%', 'only the admin links a guest');
reset role;

select tests.login('admin');
select tests.throws(format($$ select public.link_guest(%L, %L) $$, tests.id('m_p1'), tests.id('m_dani')), '%not a guest%', 'a real member cannot be merged away');
select tests.throws(format($$ select public.link_guest(%L, %L) $$, tests.id('g_dani'), tests.id('g_yossi')), '%not a signed-in member%', 'a guest can only be linked to a signed-in member');
select public.link_guest(tests.id('g_dani'), tests.id('m_dani'));
select tests.eq((select count(*)::int from table_members where id = tests.id('g_dani')), 0, 'the guest row is gone after linking');
select tests.eq((select status from table_members where id = tests.id('m_dani')), 'active', 'linking also approves the pending member');
select tests.eq((select net from night_players where night_id = tests.id('n1') and member_id = tests.id('m_dani')), -100::numeric, 'night history moves to the real account');
select tests.eq((select count(*)::int from chip_requests where member_id = tests.id('m_dani')), 1, 'chip requests move too');
select tests.eq((select from_member from settlements where night_id = tests.id('n1')), tests.id('m_dani'), 'open debts move too');
reset role;

-- Yossi opens his personal invite link after joining by the general link
select tests.login('admin');
with x as (insert into game_nights (table_id, chips_per_buyin, money_per_buyin, created_by)
  values (tests.id('table'), 1000, 100, tests.id('admin')) returning id) select tests.put('n2', id) from x;
insert into night_players (night_id, member_id, seat) values (tests.id('n2'), tests.id('g_yossi'), 0);
reset role;
select tests.login('yossi');
select public.join_table(:'table_code');
reset role;
select tests.put('m_yossi', (select id from table_members where table_id = tests.id('table') and user_id = tests.id('yossi')));
select tests.login('yossi');
select tests.eq(public.join_table(:'table_code', tests.id('g_yossi')), 'active', 'personal link merges the guest into the existing membership');
reset role;
select tests.eq((select count(*)::int from night_players where member_id = tests.id('m_yossi')), 2, 'both nights now belong to yossi');
select tests.eq((select count(*)::int from table_members where id = tests.id('g_yossi')), 0, 'guest yossi is gone');

-- conflict: guest and member in the same night
select tests.login('admin');
select tests.put('g_x', (public.add_guest(tests.id('table'), 'כפול')).id);
insert into night_players (night_id, member_id, seat) values (tests.id('n2'), tests.id('g_x'), 1), (tests.id('n2'), tests.id('m_p1'), 2);
select tests.throws(format($$ select public.link_guest(%L, %L) $$, tests.id('g_x'), tests.id('m_p1')), '%same night%', 'cannot merge two people who sat at the same night');
reset role;

rollback;
