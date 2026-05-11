/**
 * Hand-curated category library for Pardle: Connections.
 *
 * V3 design principle: every category is *clever* — a pattern that
 * gives an "aha" moment when spotted, not just a fact you either know
 * or don't. Three flavours of cleverness, each tied to a difficulty
 * tier:
 *
 *   GREEN  — Year-specific major winners. "The four 2022 major
 *            champions" is more satisfying to spot than "Won the
 *            Masters", because each player belongs to exactly one
 *            year, and recognising the year is the trick.
 *
 *   BLUE   — Specific narrative feats: 2-majors-in-a-year, Olympic
 *            medallists, Ryder Cup captains for one continent.
 *
 *   PURPLE — Pure wordplay over names: common-English-word surnames,
 *            surnames-that-are-first-names, four-letter surnames,
 *            surnames ending in -son. Pure NYT purple energy.
 *
 *   YELLOW — Country groupings. Still the most accessible / fastest-
 *            to-spot tier so beginners have a foothold.
 *
 * The puzzle generator (connections.ts) enforces strict non-overlap
 * per puzzle: every chosen golfer belongs to EXACTLY ONE of the four
 * selected categories' full member lists. So Rory could be the "2014
 * major winner" answer one day and the "Held world #1" answer
 * another, but never both in the same puzzle.
 */

import type { ConnectionsDifficulty } from "./connections-types";

export interface CategoryDef {
  id: string;
  label: string;
  difficulty: ConnectionsDifficulty;
  memberIds: string[];
}

export const CATEGORY_LIBRARY: CategoryDef[] = [
  // ─── YELLOW: country (accessible foothold) ────────────────────────
  {
    id: "y-australia",
    label: "From Australia",
    difficulty: "yellow",
    memberIds: [
      "adam-scott",
      "greg-norman",
      "cameron-smith",
      "jason-day",
      "marc-leishman",
      "cameron-davis",
    ],
  },
  {
    id: "y-england",
    label: "From England",
    difficulty: "yellow",
    memberIds: [
      "nick-faldo",
      "matt-fitzpatrick",
      "tyrrell-hatton",
      "sandy-lyle",
      "ian-woosnam",
      "lee-westwood",
      "aaron-rai",
    ],
  },
  {
    id: "y-spain",
    label: "From Spain",
    difficulty: "yellow",
    memberIds: [
      "jon-rahm",
      "seve-ballesteros",
      "sergio-garcía",
      "josé-maría-olazábal",
    ],
  },
  {
    id: "y-south-africa",
    label: "From South Africa",
    difficulty: "yellow",
    memberIds: [
      "gary-player",
      "ernie-els",
      "justin-rose",
      "erik-van-rooyen",
    ],
  },
  {
    id: "y-scandinavia",
    label: "From Scandinavia",
    difficulty: "yellow",
    memberIds: [
      "viktor-hovland",
      "ludvig-åberg",
      "henrik-stenson",
      "alex-norén",
      "nicolai-højgaard",
      "thorbjørn-olesen",
    ],
  },
  {
    id: "y-asia",
    label: "From Asia",
    difficulty: "yellow",
    memberIds: ["hideki-matsuyama", "tom-kim", "si-woo-kim", "sungjae-im"],
  },

  // ─── GREEN: the four winners of one year's majors ─────────────────
  // Each group is exactly 4. Spotting the *year* is the puzzle —
  // recognising the four specific names as a set is the "aha".
  {
    id: "g-majors-2023",
    label: "Won a major in 2023",
    difficulty: "green",
    memberIds: ["jon-rahm", "wyndham-clark", "brooks-koepka", "brian-harman"],
  },
  {
    id: "g-majors-2022",
    label: "Won a major in 2022",
    difficulty: "green",
    memberIds: [
      "scottie-scheffler",
      "matt-fitzpatrick",
      "justin-thomas",
      "cameron-smith",
    ],
  },
  {
    id: "g-majors-2021",
    label: "Won a major in 2021",
    difficulty: "green",
    memberIds: [
      "hideki-matsuyama",
      "jon-rahm",
      "phil-mickelson",
      "collin-morikawa",
    ],
  },
  {
    id: "g-majors-2017",
    label: "Won a major in 2017",
    difficulty: "green",
    memberIds: [
      "sergio-garcía",
      "brooks-koepka",
      "jordan-spieth",
      "justin-thomas",
    ],
  },
  {
    id: "g-majors-1997",
    label: "Won a major in 1997",
    difficulty: "green",
    memberIds: [
      "tiger-woods",
      "ernie-els",
      "justin-leonard",
      "davis-love-iii",
    ],
  },

  // Broader event categories — wider pools so the assembler has slack
  // for non-overlap constraints. Used when year-specific cats clash.
  {
    id: "g-multiple-masters",
    label: "Multiple Masters titles",
    difficulty: "green",
    memberIds: [
      "tiger-woods",
      "phil-mickelson",
      "jack-nicklaus",
      "arnold-palmer",
      "nick-faldo",
      "gary-player",
      "tom-watson",
      "seve-ballesteros",
      "bubba-watson",
      "josé-maría-olazábal",
      "scottie-scheffler",
    ],
  },
  {
    id: "g-multiple-opens",
    label: "Multiple Open Championship titles",
    difficulty: "green",
    memberIds: [
      "tom-watson",
      "nick-faldo",
      "gary-player",
      "lee-trevino",
      "padraig-harrington",
      "tiger-woods",
      "ernie-els",
      "greg-norman",
    ],
  },
  {
    id: "g-career-pga-champ",
    label: "Won the PGA Championship",
    difficulty: "green",
    memberIds: [
      "scottie-scheffler",
      "xander-schauffele",
      "brooks-koepka",
      "justin-thomas",
      "collin-morikawa",
      "phil-mickelson",
      "tiger-woods",
      "jason-day",
      "keegan-bradley",
      "rory-mcilroy",
      "jack-nicklaus",
      "gary-player",
      "lee-trevino",
      "padraig-harrington",
      "vijay-singh",
      "davis-love-iii",
      "john-daly",
    ],
  },

  // ─── BLUE: narrative / specific feats ─────────────────────────────
  {
    id: "b-two-majors-one-year",
    label: "Won two majors in the same year",
    difficulty: "blue",
    memberIds: [
      "tiger-woods", // 2000, 2002
      "jordan-spieth", // 2015 Masters + US Open
      "tom-watson", // 1977 Masters + Open, 1982 US Open + Open
      "lee-trevino", // 1971 US Open + Open
      "nick-faldo", // 1990 Masters + Open
      "gary-player", // 1965 US Open + Open
      "jack-nicklaus", // 1972, 1975, 1980
    ],
  },
  {
    id: "b-world-no-1",
    label: "Has held world #1",
    difficulty: "blue",
    memberIds: [
      "tiger-woods",
      "greg-norman",
      "nick-faldo",
      "fred-couples",
      "vijay-singh",
      "lee-westwood",
      "rory-mcilroy",
      "adam-scott",
      "jason-day",
      "dustin-johnson",
      "jon-rahm",
      "justin-thomas",
      "brooks-koepka",
      "scottie-scheffler",
    ],
  },
  {
    id: "b-fedex-cup",
    label: "Won the FedEx Cup",
    difficulty: "blue",
    memberIds: [
      "tiger-woods",
      "vijay-singh",
      "jim-furyk",
      "henrik-stenson",
      "jordan-spieth",
      "rory-mcilroy",
      "justin-thomas",
      "justin-rose",
      "dustin-johnson",
      "patrick-cantlay",
      "viktor-hovland",
      "scottie-scheffler",
    ],
  },
  {
    id: "b-players-championship",
    label: "Won the Players Championship",
    difficulty: "blue",
    memberIds: [
      "scottie-scheffler",
      "rory-mcilroy",
      "justin-thomas",
      "webb-simpson",
      "si-woo-kim",
      "jason-day",
      "rickie-fowler",
      "sergio-garcía",
      "phil-mickelson",
      "davis-love-iii",
      "adam-scott",
      "greg-norman",
      "tiger-woods",
      "justin-leonard",
      "sandy-lyle",
      "fred-couples",
    ],
  },
  {
    id: "b-captain-usa",
    label: "Captained a USA Ryder Cup team",
    difficulty: "blue",
    memberIds: [
      "tom-watson",
      "paul-azinger",
      "tom-lehman",
      "davis-love-iii",
      "jim-furyk",
      "steve-stricker",
    ],
  },
  {
    id: "b-captain-europe",
    label: "Captained a European Ryder Cup team",
    difficulty: "blue",
    memberIds: [
      "nick-faldo",
      "josé-maría-olazábal",
      "padraig-harrington",
      "colin-montgomerie",
    ],
  },
  {
    id: "b-olympic-medal",
    label: "Won an Olympic medal in golf",
    difficulty: "blue",
    memberIds: [
      "justin-rose",
      "henrik-stenson",
      "xander-schauffele",
      "hideki-matsuyama",
    ],
  },
  {
    id: "b-major-after-40",
    label: "Won a major aged 40 or older",
    difficulty: "blue",
    memberIds: [
      "phil-mickelson",
      "vijay-singh",
      "hale-irwin",
      "mark-omeara",
      "lee-trevino",
      "gary-player",
      "jack-nicklaus",
    ],
  },

  // ─── PURPLE: name-pattern wordplay ────────────────────────────────
  {
    id: "p-surname-english-word",
    label: "Surname is a common English word",
    difficulty: "purple",
    memberIds: [
      "jason-day",
      "patrick-reed",
      "justin-rose",
      "gary-player",
      "curtis-strange",
      "lucas-glover",
      "ryan-fox",
      "fred-couples",
      "sam-burns",
    ],
  },
  {
    id: "p-surname-is-first-name",
    label: "Surname is also a common first name",
    difficulty: "purple",
    memberIds: [
      "patrick-reed", // Reed
      "adam-scott", // Scott
      "keith-mitchell", // Mitchell
      "davis-riley", // Riley
      "sandy-lyle", // Lyle (Lyle Lovett, etc)
    ],
  },
  {
    id: "p-surname-ends-son",
    label: "Surname ends in -son",
    difficulty: "purple",
    memberIds: [
      "phil-mickelson",
      "henrik-stenson",
      "tom-watson",
      "webb-simpson",
      "dustin-johnson",
      "davis-thompson",
      "bubba-watson",
    ],
  },
  {
    id: "p-surname-starts-vowel",
    label: "Surname starts with a vowel",
    difficulty: "purple",
    memberIds: [
      "josé-maría-olazábal",
      "thorbjørn-olesen",
      "ludvig-åberg",
      "sungjae-im",
      "harris-english",
      "ernie-els",
    ],
  },
  {
    id: "p-first-name-tom",
    label: "First name is Tom",
    difficulty: "purple",
    memberIds: ["tom-watson", "tom-kim", "tom-hoge", "tom-lehman"],
  },
  {
    id: "p-three-letter-surname",
    label: "Three-letter surname",
    difficulty: "purple",
    memberIds: ["jason-day", "ryan-fox", "tom-kim", "si-woo-kim", "aaron-rai"],
  },
  {
    id: "p-four-letter-surname",
    label: "Four-letter surname",
    difficulty: "purple",
    memberIds: [
      "justin-rose", // Rose
      "stewart-cink", // Cink
      "chris-kirk", // Kirk
      "tom-hoge", // Hoge
      "max-homa", // Homa
      "john-daly", // Daly
      "patrick-reed", // Reed
    ],
  },
];
