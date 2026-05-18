import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/channels/me
 *
 * Returns the signed-in user's tipster relationships:
 *   - owned: channels the user is the owner of (typically 0 or 1)
 *   - following: channels the user follows (excluding owned)
 *
 * Used by the /tipster hub page and the AuthChip menu so users can
 * re-find pages they've followed without bookmarking.
 */
export async function GET() {
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ owned: [], following: [] });
  }

  // Pull every channel the user has a follower row for, with role.
  const { data: rows } = await supabase
    .from("channel_followers")
    .select(
      "channel_id, role, notify_on_new_tip, channels:channel_id ( slug, name, bio, is_public )",
    )
    .eq("user_id", user.id);

  const owned: Array<{
    slug: string;
    name: string;
    bio: string | null;
    isPublic: boolean;
  }> = [];
  const following: Array<{
    slug: string;
    name: string;
    bio: string | null;
    isPublic: boolean;
    notifyOnNewTip: boolean;
  }> = [];

  for (const r of rows ?? []) {
    const c = r.channels as unknown as
      | {
          slug: string;
          name: string;
          bio: string | null;
          is_public: boolean;
        }
      | null;
    if (!c) continue;
    if (r.role === "owner") {
      owned.push({
        slug: c.slug,
        name: c.name,
        bio: c.bio,
        isPublic: c.is_public,
      });
    } else {
      following.push({
        slug: c.slug,
        name: c.name,
        bio: c.bio,
        isPublic: c.is_public,
        notifyOnNewTip: !!r.notify_on_new_tip,
      });
    }
  }

  return NextResponse.json({ owned, following });
}
