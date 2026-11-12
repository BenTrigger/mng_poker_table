import { supabase } from "@/lib/supabase/client";
import type { Member } from "@/lib/types";

/**
 * Add a guest (no Google account) to a table by name. The same name on the same
 * table returns the guest that is already there, so returning guests keep their
 * history. Table admins only.
 */
export async function addGuest(tableId: string, name: string): Promise<Member> {
  const { data, error } = await supabase().rpc("add_guest", { p_table: tableId, p_name: name.trim() });
  if (error) throw new Error(guestError(error.message));
  return data as Member;
}

/** Admin: move a guest's history onto a member who signed in with Google. */
export async function linkGuest(guestId: string, memberId: string) {
  const { error } = await supabase().rpc("link_guest", { p_guest: guestId, p_member: memberId });
  if (error) throw new Error(guestError(error.message));
}

export function guestError(msg: string) {
  if (msg.includes("name required")) return "צריך לכתוב שם.";
  if (msg.includes("name too long")) return "השם ארוך מדי (עד 40 תווים).";
  if (msg.includes("admin only")) return "רק מנהל השולחן יכול להוסיף אורחים.";
  if (msg.includes("same night")) return "השניים שיחקו באותו ערב, אי אפשר לאחד אותם.";
  if (msg.includes("same tournament")) return "השניים שיחקו באותו טורניר, אי אפשר לאחד אותם.";
  if (msg.includes("not a signed-in member")) return "אפשר לקשר רק לשחקן שנכנס עם גוגל.";
  return msg || "משהו השתבש, נסה שוב";
}
