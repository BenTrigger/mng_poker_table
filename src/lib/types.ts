export type Chip = {
  color: string;
  hex: string;
  value: number;
  /** reference photos of this chip (storage paths in the "chip-refs" bucket, <table_id>/<file>.jpg) */
  images?: string[];
  /** what the chip looks like (face and edge), learned from photos; helps counting */
  desc?: string;
};

/** A chip type detected by /api/learn-chips. Boxes are pixel coordinates in the photo they refer to. */
export type LearnedChipType = {
  name: string;
  hex: string;
  /** the denomination printed on the chip, when it can be read */
  value: number | null;
  /** a likely value from common colour conventions, only a suggestion */
  suggested: number | null;
  desc: string;
  crops: { photo: number; view: "top" | "side"; box: [number, number, number, number] }[];
};

export type Profile = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  email: string | null;
};

export type PokerTable = {
  id: string;
  code: string;
  name: string;
  owner_id: string;
  last_settings: LastSettings;
  created_at: string;
};

export type LastSettings = {
  chip_set_id?: string;
  chips_per_buyin?: number;
  money_per_buyin?: number;
  cashier_member_id?: string;
  member_ids?: string[];
  /** how the night's debts are settled: minimal transfers between players, or all through the cashier */
  settle_mode?: "players" | "cashier";
  /** food fee per player for the next night, and who usually hosts */
  food_fee?: number;
  host_member_id?: string;
  /** "all": everyone sees everyone's results; "own": players see only their own (admins see all) */
  stats_visibility?: "all" | "own";
  /** the last tournament format, offered again for the next tournament */
  tournament?: Partial<import("./tournament").TournamentForm>;
};

export type Member = {
  id: string;
  table_id: string;
  user_id: string | null;
  display_name: string;
  avatar_url: string | null;
  role: "admin" | "player";
  status: "active" | "pending" | "removed";
  created_at: string;
};

export type ChipSet = {
  id: string;
  table_id: string;
  name: string;
  chips: Chip[];
  created_at: string;
};

export type GameNight = {
  id: string;
  table_id: string;
  status: "open" | "closed";
  chip_set_id: string | null;
  chips_per_buyin: number;
  money_per_buyin: number;
  cashier_member_id: string | null;
  created_by: string | null;
  started_at: string;
  closed_at: string | null;
  photos_purged: boolean;
  /** money each player except the host pays the host for food, apart from the chips */
  food_fee?: number | null;
  host_member_id?: string | null;
  /** how the transfers were settled at the close (kept so corrections settle the same way) */
  settle_mode?: "players" | "cashier" | null;
};

export type NightPlayer = {
  id: string;
  night_id: string;
  member_id: string;
  seat: number;
  status: "playing" | "out";
  final_chips: number | null;
  final_photo_path: string | null;
  left_at: string | null;
  bought_money: number | null;
  net: number | null;
  /** set once the player is at the table (they confirmed, or the admin/cashier marked them) */
  arrived_at?: string | null;
};

export type ChipRequest = {
  id: string;
  night_id: string;
  member_id: string;
  requested_by: string | null;
  mode: "chips" | "money";
  chips: number;
  given_chips: number | null;
  detected_chips: number | null;
  status: "pending" | "approved" | "flagged" | "rejected";
  photo_path: string | null;
  note: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
};

export type NightEvent = {
  id: number;
  night_id: string;
  actor_id: string | null;
  kind: string;
  payload: Record<string, unknown>;
  created_at: string;
};

export type Settlement = {
  id: string;
  night_id: string;
  from_member: string;
  to_member: string;
  amount: number;
  paid: boolean;
  paid_at: string | null;
};

export type ChipCount = {
  counts: { color: string; count: number }[];
  total: number;
  confidence: "high" | "medium" | "low";
  notes: string;
  /** the first count disagreed with the expected amount, so the photo was counted again */
  recounted?: boolean;
};

/** A person's fix to an automatic count, or a free note about the chip set. Fed back into later counts. */
export type ChipCorrection = {
  id: string;
  chip_set_id: string;
  table_id: string;
  detected: { color: string; count: number }[] | null;
  actual: { color: string; count: number }[] | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
};

export type HandoverCount = { member_id: string; chips: number; detected: number | null; photo_path: string | null };

export type CashierHandover = {
  id: string;
  night_id: string;
  from_member: string | null;
  to_member: string;
  handed_chips: number;
  counted_chips: number;
  gap_chips: number;
  bank_chips: number | null;
  counts: HandoverCount[];
  bank_photo_path: string | null;
  outgoing_left: boolean;
  note: string | null;
  created_by: string | null;
  created_at: string;
};

export type Signup = {
  id: string;
  table_id: string;
  starts_at: string;
  location: string | null;
  address: string | null;
  note: string | null;
  seats: number;
  status: "open" | "closed" | "started" | "cancelled";
  night_id: string | null;
  created_by: string | null;
  created_at: string;
};

/** A seat (or waiting-list spot when seat is null) as returned by get_signup() */
export type SignupSeat = {
  member_id: string;
  seat: number | null;
  created_at: string;
  display_name: string;
  avatar_url: string | null;
  user_id: string | null;
};

export type SignupView = {
  signup: Signup;
  table: { id: string; name: string; code: string };
  me: { id: string; status: Member["status"]; role: Member["role"] } | null;
  seats: SignupSeat[];
};

export type TournamentLevel = { sb?: number; bb?: number; ante?: number; minutes: number; break?: boolean };

export type Tournament = {
  id: string;
  table_id: string;
  name: string;
  starts_at: string;
  location: string | null;
  address: string | null;
  note: string | null;
  table_count: number;
  seats_per_table: number;
  buy_in: number;
  starting_stack: number;
  rebuy_until_level: number;
  /** rebuys allowed until this clock time (null = by level only) */
  rebuy_until_time: string | null;
  /** 'upfront' = cash paid to the organizer as you go; 'end' = settle at the end */
  payment_mode: "upfront" | "end";
  rebuy_price: number | null;
  rebuy_chips: number | null;
  addon_price: number | null;
  addon_chips: number | null;
  late_reg_until_level: number;
  levels: TournamentLevel[];
  registration_open: boolean;
  status: "registration" | "running" | "finished" | "cancelled";
  clock_anchor: string | null;
  paused_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_by: string | null;
  created_at: string;
};

export type TournamentEntry = {
  id: string;
  tournament_id: string;
  member_id: string;
  status: "registered" | "waiting" | "playing" | "busted";
  table_no: number | null;
  seat_no: number | null;
  rebuys: number;
  addon: boolean;
  busted_at: string | null;
  busted_by: string | null;
  place: number | null;
  prize: number | null;
  created_at: string;
};

/** An entry as returned by get_tournament(), with the player's name */
export type TournamentEntryView = TournamentEntry & { display_name: string; avatar_url: string | null; user_id: string | null };

export type TournamentView = {
  tournament: Tournament;
  table: { id: string; name: string; code: string; stats_visibility: "all" | "own"; settle_mode: "players" | "cashier" };
  me: { id: string; status: Member["status"]; role: Member["role"] } | null;
  organizer_member_id: string | null;
  entries: TournamentEntryView[];
  /** saved "who pays whom" (only the ones the reader may see) */
  transfers?: TournamentTransfer[];
};

export type TournamentTransfer = {
  id: string;
  tournament_id: string;
  from_member: string;
  to_member: string;
  amount: number;
  paid: boolean;
  paid_at: string | null;
};
