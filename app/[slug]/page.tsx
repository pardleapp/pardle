import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BRAND } from "@/lib/brand";
import { getSupabaseServer } from "@/lib/supabase/server";
import { isReservedSlug } from "@/lib/channels/reserved-slugs";
import TipsterPageClient from "./TipsterPageClient";

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ invite?: string; new?: string }>;
}

async function fetchChannel(slug: string) {
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: channel } = await supabase
    .from("channels")
    .select("id, slug, name, owner_id, bio, is_public, invite_code, created_at")
    .eq("slug", slug.toLowerCase())
    .maybeSingle();
  if (!channel) return null;

  const { count: followerCount } = await supabase
    .from("channel_followers")
    .select("user_id", { count: "exact", head: true })
    .eq("channel_id", channel.id);

  let viewer: {
    isOwner: boolean;
    isFollower: boolean;
    notifyOnNewTip: boolean;
  } | null = null;
  if (user) {
    const isOwner = user.id === channel.owner_id;
    const { data: f } = await supabase
      .from("channel_followers")
      .select("notify_on_new_tip")
      .eq("channel_id", channel.id)
      .eq("user_id", user.id)
      .maybeSingle();
    viewer = {
      isOwner,
      isFollower: !!f,
      notifyOnNewTip: f?.notify_on_new_tip ?? false,
    };
  }

  return {
    id: channel.id as string,
    slug: channel.slug as string,
    name: channel.name as string,
    ownerId: channel.owner_id as string,
    bio: (channel.bio as string | null) ?? null,
    isPublic: channel.is_public as boolean,
    inviteCode: viewer?.isOwner
      ? (channel.invite_code as string)
      : undefined,
    followerCount: followerCount ?? 0,
    viewer,
  };
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  if (isReservedSlug(slug)) {
    return { title: `${BRAND.name}` };
  }
  const channel = await fetchChannel(slug);
  if (!channel) return { title: `${BRAND.name}` };
  return {
    title: `${channel.name} (@${channel.slug}) — ${BRAND.name}`,
    description: channel.bio ?? `Follow ${channel.name} on Pardle.`,
  };
}

export default async function TipsterPage({
  params,
  searchParams,
}: PageProps) {
  const { slug } = await params;
  const sp = await searchParams;
  // Defence-in-depth: app/[slug] catches every top-level URL we
  // don't statically own. Reject reserved-route names so e.g.
  // /api or /live can never be intercepted even if Next.js's
  // static-route priority slipped.
  if (isReservedSlug(slug)) notFound();
  const channel = await fetchChannel(slug);
  if (!channel) notFound();

  return (
    <main className="container container-wide">
      <header className="brand brand-split">
        <h1>
          <Link href="/" className="tipster-back">
            {BRAND.name}
          </Link>
        </h1>
        <Link href="/" className="hub-nav-tab">
          Live feed
        </Link>
      </header>
      <TipsterPageClient
        channel={channel}
        initialInvite={sp.invite ?? null}
        isFresh={sp.new === "1"}
      />
    </main>
  );
}
