import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BRAND } from "@/lib/brand";
import { getSupabaseServer } from "@/lib/supabase/server";
import { isReservedSlug } from "@/lib/channels/reserved-slugs";
import { getActiveTournament } from "@/lib/golf-api/pgatour";
import { getUserStats } from "@/lib/feed/putt-iq";
import { getSharpScore } from "@/lib/feed/sharp-score";
import AuthChip from "../live/auth/AuthChip";
import MainNav from "../MainNav";
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
    .select(
      "id, slug, name, owner_id, bio, is_public, invite_code, owner_author_key, created_at",
    )
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

  // Owner credibility chip: fetch their accumulated Putt-IQ stats
  // keyed by the cookie authorKey they linked on a prior page load.
  // Skips silently when the link isn't there yet or the owner hasn't
  // voted on a single poll.
  const ownerAuthorKey =
    (channel as { owner_author_key?: string | null }).owner_author_key ?? null;
  let ownerPuttIq: {
    total: number;
    correct: number;
    accuracy: number;
    currentStreak: number;
    tournamentRank: number | null;
    tournamentTotal: number;
    tournamentCorrect: number;
  } | null = null;
  let ownerSharp: {
    total: number;
    correct: number;
    accuracy: number;
    qualified: boolean;
    currentStreak: number;
    rank: number | null;
  } | null = null;
  if (ownerAuthorKey) {
    const active = await getActiveTournament().catch(() => null);
    const stats = await getUserStats(
      ownerAuthorKey,
      active?.tournament.id,
    ).catch(() => null);
    if (stats && stats.total > 0) {
      ownerPuttIq = {
        total: stats.total,
        correct: stats.correct,
        accuracy: stats.total > 0 ? stats.correct / stats.total : 0,
        currentStreak: stats.currentStreak,
        tournamentRank: stats.tournamentRank ?? null,
        tournamentTotal: stats.tournament?.total ?? 0,
        tournamentCorrect: stats.tournament?.correct ?? 0,
      };
    }
    // Sharp Score is the broader credibility metric — accuracy
    // across every prediction the owner has made, not just putts.
    // Surfaces as the lead chip; Putt-IQ stays as the per-tournament
    // detail below.
    const sharp = await getSharpScore(ownerAuthorKey).catch(() => null);
    if (sharp && sharp.total > 0) {
      ownerSharp = {
        total: sharp.total,
        correct: sharp.correct,
        accuracy: sharp.accuracy,
        qualified: sharp.qualified,
        currentStreak: sharp.currentStreak,
        rank: sharp.rank,
      };
    }
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
    ownerPuttIq,
    ownerSharp,
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
    <main className="container container-wide v4-theme pv-theme">
      <header className="brand brand-split">
        <h1>{BRAND.name}</h1>
        <div className="brand-nav">
          <MainNav active="none" />
          <AuthChip />
        </div>
      </header>
      <TipsterPageClient
        channel={channel}
        initialInvite={sp.invite ?? null}
        isFresh={sp.new === "1"}
      />
    </main>
  );
}
