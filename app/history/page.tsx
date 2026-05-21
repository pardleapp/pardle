import { redirect } from "next/navigation";

/** /history was the old bet-history surface — its content has been
 *  folded into /bets as a stats + chart summary above the tracker.
 *  Leave a permanent redirect for any external links or bookmarks. */
export default function HistoryRedirect() {
  redirect("/bets");
}
