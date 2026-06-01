/**
 * Mock crew + member data — verbatim from the design-handoff
 * prototype's RACE / MEMBERS / MOST_POPULAR / MEMBER_INFO constants
 * in Pardle Social v2.html. Drives the first cut of the Groups
 * surface so layout is exact before we wire to the real Supabase
 * `groups` / `group_members` tables.
 *
 * Shapes mirror what real data will populate so the rendering path
 * doesn't change.
 */

export interface RaceRow {
  initials: string;
  name: string;
  pl: string;
  dir: "up" | "down";
  /** Weekly group-win trophies — only meaningful on the All-time
   *  race. */
  trophies?: number;
}

export const RACE: {
  today: RaceRow[];
  season: RaceRow[];
  alltime: RaceRow[];
} = {
  today: [
    { initials: "JO", name: "Jordan", pl: "+£312", dir: "up" },
    { initials: "YO", name: "You", pl: "+£186", dir: "up" },
    { initials: "TH", name: "Theo", pl: "+£54", dir: "up" },
    { initials: "SA", name: "Sam", pl: "−£20", dir: "down" },
    { initials: "MI", name: "Mia", pl: "−£40", dir: "down" },
  ],
  season: [
    { initials: "YO", name: "You", pl: "+£1,940", dir: "up" },
    { initials: "JO", name: "Jordan", pl: "+£1,610", dir: "up" },
    { initials: "MI", name: "Mia", pl: "+£880", dir: "up" },
    { initials: "TH", name: "Theo", pl: "+£40", dir: "up" },
    { initials: "SA", name: "Sam", pl: "−£210", dir: "down" },
  ],
  alltime: [
    { initials: "YO", name: "You", pl: "+£6,120", dir: "up", trophies: 4 },
    { initials: "JO", name: "Jordan", pl: "+£5,400", dir: "up", trophies: 3 },
    { initials: "MI", name: "Mia", pl: "+£3,210", dir: "up", trophies: 2 },
    { initials: "TH", name: "Theo", pl: "+£1,090", dir: "up", trophies: 1 },
    { initials: "SA", name: "Sam", pl: "+£420", dir: "up", trophies: 0 },
  ],
};

export interface MemberRow {
  initials: string;
  name: string;
  pl: string;
  dir: "up" | "down";
  role: "" | "Admin";
}

export const MEMBERS: MemberRow[] = [
  { initials: "JO", name: "Jordan", pl: "+£312", dir: "up", role: "Admin" },
  { initials: "YO", name: "You", pl: "+£186", dir: "up", role: "Admin" },
  { initials: "TH", name: "Theo", pl: "+£54", dir: "up", role: "" },
  { initials: "SA", name: "Sam", pl: "−£20", dir: "down", role: "" },
  { initials: "MI", name: "Mia", pl: "−£40", dir: "down", role: "" },
  { initials: "DA", name: "Dave", pl: "+£18", dir: "up", role: "" },
  { initials: "NI", name: "Nia", pl: "−£8", dir: "down", role: "" },
  { initials: "PA", name: "Paul", pl: "+£5", dir: "up", role: "" },
  { initials: "RO", name: "Rory", pl: "−£60", dir: "down", role: "" },
];

export interface MostPopular {
  player: string;
  market: string;
  count: number;
  backers: string[];
}

export const MOST_POPULAR: MostPopular[] = [
  { player: "R. Henley", market: "OUTRIGHT", count: 4, backers: ["JO", "YO", "TH", "DA"] },
  { player: "A. Smalley", market: "TOP 5", count: 3, backers: ["YO", "MI", "PA"] },
  { player: "M. Brennan", market: "UNDER 69.5 · R4", count: 2, backers: ["SA", "JO"] },
  { player: "N. Echavarria", market: "TOP 10", count: 2, backers: ["MI", "RO"] },
];

export interface MemberBet {
  player: string;
  market: string;
  stakeLabel: string;
  oddsLabel: string;
  probPct: number;
  dir: "up" | "down";
}

export interface MemberInfo {
  initials: string;
  role: "" | "Admin" | "Member";
  today: string;
  dir: "up" | "down";
  hist: number[];
  record: string;
  bets: MemberBet[];
}

export const MEMBER_INFO: Record<string, MemberInfo> = {
  Jordan: {
    initials: "JO",
    role: "Admin",
    today: "+£312",
    dir: "up",
    hist: [40, 90, 70, 160, 240, 312],
    record: "this week · 12 bets · 8 W",
    bets: [
      { player: "R. Henley", market: "OUTRIGHT", stakeLabel: "£50", oddsLabel: "3.50", probPct: 62, dir: "up" },
      { player: "C. Morikawa", market: "TOP 10", stakeLabel: "£30", oddsLabel: "2.10", probPct: 55, dir: "up" },
      { player: "M. Brennan", market: "UNDER 69.5 · R4", stakeLabel: "$40", oddsLabel: "1.90", probPct: 46, dir: "down" },
    ],
  },
  You: {
    initials: "YO",
    role: "Admin",
    today: "+£186",
    dir: "up",
    hist: [20, 40, 60, 120, 150, 186],
    record: "this week · 9 bets · 5 W",
    bets: [
      { player: "R. Henley", market: "OUTRIGHT", stakeLabel: "£50", oddsLabel: "5/2", probPct: 54, dir: "up" },
      { player: "A. Smalley", market: "TOP 5", stakeLabel: "£40", oddsLabel: "2.00", probPct: 71, dir: "up" },
    ],
  },
  Theo: {
    initials: "TH",
    role: "",
    today: "+£54",
    dir: "up",
    hist: [10, 30, 20, 40, 48, 54],
    record: "this week · 7 bets · 4 W",
    bets: [
      { player: "L. Åberg", market: "TOP 10", stakeLabel: "£25", oddsLabel: "3.20", probPct: 38, dir: "down" },
      { player: "E. Cole", market: "TOP 20", stakeLabel: "£20", oddsLabel: "1.70", probPct: 64, dir: "up" },
    ],
  },
  Sam: {
    initials: "SA",
    role: "",
    today: "−£20",
    dir: "down",
    hist: [30, 10, -5, -30, -10, -20],
    record: "this week · 6 bets · 2 W",
    bets: [
      { player: "M. Brennan", market: "UNDER 69.5 · R4", stakeLabel: "$100", oddsLabel: "1.90", probPct: 46, dir: "down" },
    ],
  },
  Mia: {
    initials: "MI",
    role: "",
    today: "−£40",
    dir: "down",
    hist: [20, 0, -15, -35, -45, -40],
    record: "this week · 8 bets · 3 W",
    bets: [
      { player: "A. Smalley", market: "TOP 5", stakeLabel: "£30", oddsLabel: "2.00", probPct: 71, dir: "up" },
      { player: "N. Echavarria", market: "TOP 20", stakeLabel: "£20", oddsLabel: "1.60", probPct: 58, dir: "up" },
    ],
  },
};

export const GROUP_NAME = "The Lads";
export const GROUP_INVITE = "pardle.app/c/the-lads-7f3";
export const GROUP_MEMBER_COUNT = MEMBERS.length;
