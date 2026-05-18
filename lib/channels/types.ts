/**
 * Shared types for the tipster-channel feature. Mirror the Supabase
 * tables defined in supabase/migrations/0004_tipster_channels.sql.
 *
 * Customer-facing copy in the UI calls these "Tipster page" /
 * "Follower" / "Tip" / "Chat" — the channel/follower vocabulary here
 * is internal only and should never appear in user-visible strings.
 */

export interface Channel {
  id: string;
  slug: string;
  name: string;
  ownerId: string;
  bio: string | null;
  isPublic: boolean;
  /** Only exposed to the owner (and to a joiner mid-handshake). */
  inviteCode?: string;
  createdAt: string;
}

export type ChannelRole = "owner" | "follower";

export interface ChannelFollower {
  channelId: string;
  userId: string;
  role: ChannelRole;
  joinedAt: string;
  notifyOnNewTip: boolean;
}

export interface ChannelMessage {
  id: string;
  channelId: string;
  authorId: string;
  /** epoch ms in the API; ISO string in the DB. */
  ts: number;
  text: string;
  refBetId: string | null;
}

/** Hydrated view returned by GET /api/channels/[slug]. */
export interface ChannelView {
  channel: Channel;
  followerCount: number;
  /** Membership status for the requesting user. null = anonymous. */
  viewer: {
    isOwner: boolean;
    isFollower: boolean;
    notifyOnNewTip: boolean;
  } | null;
}
