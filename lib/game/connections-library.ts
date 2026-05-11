/**
 * Hand-curated category library for Pardle: Connections.
 *
 * V4 design principle: every category gives an "aha" moment when
 * spotted. We cut categories that were pure classification (from Asia,
 * surnames starting with a vowel, three-letter surnames) because
 * those just test whether you can read, not whether you can spot a
 * pattern. Categories now come in three clever flavours:
 *
 *   GREEN  — Year-specific major winners. Each group is exactly the
 *            four players who won that calendar year's four majors.
 *            The PUZZLE is recognising the year.
 *
 *   BLUE   — Narrative feats: won-in-playoff, shot-59, back-to-back-
 *            majors, 25-or-younger, three-decades, captained a side.
 *            Each one is a specific story you have to recall.
 *
 *   PURPLE — Pure wordplay: common-English-word surname, surname-
 *            that's-also-a-first-name, surnames ending in -son,
 *            first/last-name-same-length, surname-starts-with-a-word.
 *
 *   YELLOW — Country groupings. Kept as the most accessible tier so
 *            beginners always have a foothold, but no broad / lazy
 *            "From Asia" type entries.
 *
 * The puzzle generator (connections.ts) enforces strict non-overlap
 * per puzzle: every chosen golfer belongs to EXACTLY ONE of the four
 * selected categories' full member lists.
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

  // ─── GREEN: the four winners of one year's majors ─────────────────
  // Each group is exactly the four players who won that calendar
  // year's four majors. Recognising the *year* is the aha moment.
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
    id: "g-majors-2012",
    label: "Won a major in 2012",
    difficulty: "green",
    memberIds: [
      "bubba-watson",
      "webb-simpson",
      "ernie-els",
      "rory-mcilroy",
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

  // Broader event categories — wider pools so the assembler always
  // has slack to fill green even when several year-specific cats
  // can't be paired together.
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
    id: "g-same-major-three-plus",
    label: "Won the same major three or more times",
    difficulty: "green",
    memberIds: [
      "tiger-woods", // Masters x5, US Open x3, Open x3, PGA x4
      "phil-mickelson", // Masters x3
      "nick-faldo", // Masters x3, Open x3
      "gary-player", // Masters x3, Open x3
      "tom-watson", // Open x5
      "jack-nicklaus", // Masters x6, US Open x4, PGA x5
    ],
  },

  // ─── BLUE: narrative feats ────────────────────────────────────────
  {
    id: "b-major-under-25",
    label: "Won a major aged 25 or younger",
    difficulty: "blue",
    memberIds: [
      "tiger-woods", // 21 at 1997 Masters
      "rory-mcilroy", // 22 at 2011 US Open
      "jordan-spieth", // 21 at 2015 Masters
      "justin-thomas", // 24 at 2017 PGA
      "collin-morikawa", // 23 at 2020 PGA
      "scottie-scheffler", // 25 at 2022 Masters
      "jack-nicklaus", // 22 at 1962 US Open
      "gary-player", // 23 at 1959 Open
    ],
  },
  {
    id: "b-major-playoff",
    label: "Won a major in a playoff",
    difficulty: "blue",
    memberIds: [
      "tiger-woods", // 2008 US Open vs Mediate
      "bubba-watson", // 2012, 2014 Masters
      "john-daly", // 1995 Open vs Rocca
      "stewart-cink", // 2009 Open vs Watson
      "padraig-harrington", // 2007 Open vs Garcia
      "mark-calcavecchia", // 1989 Open
    ],
  },
  {
    id: "b-shot-59-or-lower",
    label: "Has shot 59 or lower on the PGA Tour",
    difficulty: "blue",
    memberIds: [
      "jim-furyk", // 58 + 59
      "adam-hadwin", // 59 in 2017
      "justin-thomas", // 59 in 2017
      "david-duval", // 59 in 1999
    ],
  },
  {
    id: "b-three-decades",
    label: "Won majors in three different decades",
    difficulty: "blue",
    memberIds: [
      "gary-player", // 50s/60s/70s/80s
      "jack-nicklaus", // 60s/70s/80s
      "tiger-woods", // 90s/00s/10s
      "phil-mickelson", // 00s/10s/20s
    ],
  },
  {
    id: "b-back-to-back-major",
    label: "Won the same major in back-to-back years",
    difficulty: "blue",
    memberIds: [
      "tiger-woods", // PGA 1999/2000, Masters 2001/2002
      "padraig-harrington", // Open 2007/2008
      "brooks-koepka", // US Open 2017/2018, PGA 2018/2019
      "nick-faldo", // Masters 1989/1990
      "tom-watson", // Open 1982/1983
      "lee-trevino", // Open 1971/1972
    ],
  },
  {
    id: "b-two-majors-one-year",
    label: "Won two majors in the same calendar year",
    difficulty: "blue",
    memberIds: [
      "tiger-woods", // 2000 (3), 2002 (2)
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
    id: "b-ryder-2023-europe",
    label: "Played for Europe at the 2023 Ryder Cup",
    difficulty: "blue",
    memberIds: [
      "rory-mcilroy",
      "jon-rahm",
      "tyrrell-hatton",
      "shane-lowry",
      "matt-fitzpatrick",
      "viktor-hovland",
      "nicolai-højgaard",
      "ludvig-åberg",
      "sepp-straka",
      "robert-macintyre",
      "justin-rose",
    ],
  },
  {
    id: "b-ryder-2023-usa",
    label: "Played for USA at the 2023 Ryder Cup",
    difficulty: "blue",
    memberIds: [
      "scottie-scheffler",
      "xander-schauffele",
      "patrick-cantlay",
      "jordan-spieth",
      "justin-thomas",
      "brooks-koepka",
      "sam-burns",
      "wyndham-clark",
      "rickie-fowler",
      "max-homa",
      "collin-morikawa",
      "brian-harman",
    ],
  },

  // ─── PURPLE: pure wordplay ────────────────────────────────────────
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
      "sandy-lyle", // Lyle
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
    id: "p-first-name-tom",
    label: "First name is Tom",
    difficulty: "purple",
    memberIds: ["tom-watson", "tom-kim", "tom-hoge", "tom-lehman"],
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
  {
    id: "p-same-length-name",
    label: "First and last name are the same length",
    difficulty: "purple",
    memberIds: [
      "tom-kim", // 3 / 3
      "john-daly", // 4 / 4
      "vijay-singh", // 5 / 5
      "sergio-garcía", // 6 / 6
    ],
  },
  {
    id: "p-surname-starts-with-word",
    label: "Surname begins with a common English word",
    difficulty: "purple",
    memberIds: [
      "tyrrell-hatton", // HAT
      "lucas-glover", // GLOVE
      "gary-player", // PLAY
      "fred-couples", // COUPLE
      "sam-burns", // BURN
      "jim-furyk", // FUR
    ],
  },
];
