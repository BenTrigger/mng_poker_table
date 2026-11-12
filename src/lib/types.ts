export type Chip = { color: string; hex: string; value: number };

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
};
