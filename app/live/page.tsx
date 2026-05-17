import { redirect } from "next/navigation";

/**
 * /live used to be the live feed page. The feed is now the
 * homepage at /, so this just redirects. Sub-routes like
 * /live/bet/[id] and /live/player/[id] still live under app/live/
 * and aren't affected — only the bare /live URL redirects.
 */
export default function LiveRedirect() {
  redirect("/");
}
