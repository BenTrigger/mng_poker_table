# Game-night simulation

`game-night.sim.ts` plays a whole poker night the way people really use the app:
six users, each on their own phone (browser), against a **local** Supabase with
every migration applied, realtime on, and RLS as in production.

What happens in the night:

1. The admin creates a table and four friends join straight in with the table link.
2. The admin defines the chip set, 1000 chips = ₪100, picks Yossi as cashier and opens the night.
3. Requests and hand-overs, each with a photo:
   - the photo matches the request, approved at once;
   - the cashier handed less by mistake and records what was really handed;
   - the photo misses chips, the cashier insists, the admin approves;
   - the photo sees too many, the cashier fixes one colour by hand and approves (logged, saved to the chip set);
   - a request sent by mistake is rejected; the admin and the cashier buy in themselves.
4. A late player joins the table and is seated; a guest added by mistake is removed.
5. A player cashes out while he still has a request open (it is cancelled, never becomes debt).
6. The cashier goes home: full count of every stack, the role moves to another player.
7. A disputed hand-over blocks that player's cash-out and the closing until the admin decides.
8. End of night: everyone is counted, 50 chips are missing, the gap is spread,
   transfers are created, photos are deleted, a winner marks a transfer as paid.

After every step the database is checked: debts, events in the log, nets that sum
to exactly zero, transfers that match the nets.

Two more scenarios run the same way:

- `signup-and-rules.sim.ts`: the table link from signed-out to inside the table,
  joining by code, each user seeing only their own tables, a removed player
  coming back only with the admin's approval, a personal invite link, early sign-up with seats, a waiting list, address edits
  seen live, cancelling a seat (players and the admin, also after registration
  closes), "each sees only their own" results, settling everything through the
  cashier, and what a player must not be able to do through the API.
- `tournament.sim.ts`: a two-table tournament from registration (waiting list,
  a drop-out) through the seat draw, bust-outs, a rebuy, an add-on, table
  balancing and the final, with prizes that add up to the pool and saved
  transfers that the winner marks as received.

Chip recognition is mocked in the browser (`/api/count-chips`), so each photo
"sees" exactly what the scenario says and no AI credit is used.

## Run it

Needs Docker and the Supabase CLI (`npx supabase`).

```sh
npm run test:sim
```

The script starts the local stack (`supabase start`), refuses to run if the API
is not local, builds the app against it and runs the scenarios (`npm run test:sim -- tournament` runs one). CI runs it on
every push.
