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

  // ─── YELLOW (word categories): golf-related concepts ──────────────
  {
    id: "y-clubs",
    label: "Types of golf club",
    difficulty: "yellow",
    memberIds: [
      "w-club-driver",
      "w-club-iron",
      "w-club-wood",
      "w-club-wedge",
      "w-club-putter",
      "w-club-hybrid",
    ],
  },
  {
    id: "y-features",
    label: "Course features",
    difficulty: "yellow",
    memberIds: [
      "w-feature-fairway",
      "w-feature-bunker",
      "w-feature-green",
      "w-feature-rough",
      "w-feature-tee",
      "w-feature-pin",
    ],
  },
  {
    id: "y-under-par",
    label: "Scores under par",
    difficulty: "yellow",
    memberIds: [
      "w-score-eagle",
      "w-score-birdie",
      "w-score-albatross",
      "w-score-ace",
    ],
  },
  {
    id: "y-shot-shapes",
    label: "Ball flight shapes",
    difficulty: "yellow",
    memberIds: [
      "w-shot-slice",
      "w-shot-hook",
      "w-shot-fade",
      "w-shot-draw",
    ],
  },
  {
    id: "y-short-game",
    label: "Short-game shot types",
    difficulty: "yellow",
    memberIds: [
      "w-short-putt",
      "w-short-chip",
      "w-short-pitch",
      "w-short-lob",
      "w-feature-bunker", // shared with "Course features"
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
  // ─── GREEN (word categories) ──────────────────────────────────────
  {
    id: "g-open-venues",
    label: "Open Championship venues",
    difficulty: "green",
    memberIds: [
      "w-venue-carnoustie",
      "w-venue-birkdale",
      "w-venue-troon",
      "w-venue-hoylake",
      "w-venue-muirfield",
      "w-venue-st-andrews",
      "w-venue-portrush",
      "w-venue-turnberry",
    ],
  },
  {
    id: "g-augusta-features",
    label: "Augusta National landmarks (first word)",
    difficulty: "green",
    memberIds: [
      "w-augusta-amen", // Corner
      "w-augusta-magnolia", // Lane
      "w-augusta-eisenhower", // Tree
      "w-augusta-hogan", // Bridge
    ],
  },
  {
    id: "g-equipment-brands",
    label: "Golf equipment brands",
    difficulty: "green",
    memberIds: [
      "w-brand-titleist",
      "w-brand-callaway",
      "w-brand-taylormade",
      "w-brand-ping",
      "w-brand-cobra",
      "w-brand-mizuno",
    ],
  },
  {
    id: "g-augusta-flowers",
    label: "Augusta National back-nine flower holes",
    difficulty: "green",
    memberIds: [
      "w-azalea-golden-bell", // 12
      "w-azalea-azalea", // 13
      "w-azalea-redbud", // 16
      "w-azalea-holly", // 18
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
    id: "b-grip-styles",
    label: "Famous golf grip styles",
    difficulty: "blue",
    memberIds: [
      "w-grip-interlocking",
      "w-grip-overlapping",
      "w-grip-baseball",
      "w-grip-vardon",
    ],
  },
  {
    id: "b-ball-anatomy",
    label: "Anatomy of a golf ball",
    difficulty: "blue",
    memberIds: [
      "w-ball-dimple",
      "w-ball-cover",
      "w-ball-core",
      "w-ball-compression",
    ],
  },
  {
    id: "b-water-hazards",
    label: "Types of water hazard",
    difficulty: "blue",
    memberIds: [
      "w-water-lake",
      "w-water-pond",
      "w-water-creek",
      "w-water-stream",
    ],
  },
  {
    id: "b-bag-types",
    label: "Types of golf bag",
    difficulty: "blue",
    memberIds: [
      "w-bag-staff",
      "w-word-cart", // shared with "Golf ___"
      "w-bag-carry",
      "w-bag-tour",
    ],
  },
  {
    id: "b-club-materials",
    label: "Materials used in golf clubs",
    difficulty: "blue",
    memberIds: [
      "w-club-wood", // shared with "Types of golf club"
      "w-club-iron", // shared with "Types of golf club"
      "w-mat-steel",
      "w-mat-graphite",
      "w-mat-titanium",
    ],
  },
  {
    id: "b-practice-aspects",
    label: "Aspects of golf practice",
    difficulty: "blue",
    memberIds: [
      "w-pre-club-driving", // shared with "___ club" (Driving club / Driving range)
      "w-practice-putting",
      "w-practice-chipping",
      "w-practice-approach",
    ],
  },
  {
    id: "b-animal-nicknames",
    label: "Animal nicknames of famous pros",
    difficulty: "blue",
    memberIds: [
      "w-fname-tiger", // Tiger Woods — shared with "Famous golfer first names"
      "w-nick-bear", // Golden Bear — Jack Nicklaus
      "w-nick-shark", // Great White Shark — Greg Norman
      "w-nick-hawk", // The Hawk — Ben Hogan
    ],
  },
  {
    id: "b-design-styles",
    label: "Golf course design styles",
    difficulty: "blue",
    memberIds: [
      "w-design-links",
      "w-design-parkland",
      "w-design-heathland",
      "w-design-stadium",
      "w-design-sandbelt",
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
    id: "p-first-name-tom",
    label: "First name is Tom",
    difficulty: "purple",
    memberIds: ["tom-watson", "tom-kim", "tom-hoge", "tom-lehman"],
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

  // ─── PURPLE (word categories): pure phrase-filler wordplay ────────
  // These are the NYT-purple-style "____ X" / "X ____" categories.
  // Items are short words that look like they could belong anywhere
  // until you spot the connector.
  {
    id: "p-precede-club",
    label: "___ club",
    difficulty: "purple",
    memberIds: [
      "w-pre-club-golf",
      "w-pre-club-country",
      "w-pre-club-night",
      "w-pre-club-driving",
    ],
  },
  {
    id: "p-precede-shot",
    label: "___ shot",
    difficulty: "purple",
    memberIds: [
      "w-pre-shot-trick",
      "w-word-money", // shared with "Perfectly struck shot"
      "w-pre-shot-hero",
      "w-pre-shot-punch",
    ],
  },
  {
    id: "p-follow-golf",
    label: "Golf ___",
    difficulty: "purple",
    memberIds: [
      "w-post-golf-ball",
      "w-word-cart", // shared with "Types of bag"
      "w-post-golf-bag",
      "w-post-golf-glove",
      "w-post-golf-cap",
    ],
  },

  // ─── PURPLE (clever golf-specific wordplay — V6 additions) ────────
  {
    id: "p-swing-parts",
    label: "Parts of a golf swing",
    difficulty: "purple",
    memberIds: [
      "w-swing-setup",
      "w-swing-backswing",
      "w-mishit-top", // shared with "Mis-hits" — top of backswing / topping
      "w-swing-downswing",
      "w-swing-impact",
      "w-swing-followthrough",
    ],
  },
  {
    id: "p-mis-hits",
    label: "Words for a mis-hit",
    difficulty: "purple",
    memberIds: [
      "w-mishit-shank",
      "w-mishit-chunk",
      "w-mishit-skull",
      "w-mishit-thin",
      "w-mishit-fat",
      "w-mishit-top",
    ],
  },
  {
    id: "p-pure-strike",
    label: "Words for a perfectly struck shot",
    difficulty: "purple",
    memberIds: [
      "w-pure-pure",
      "w-pure-flush",
      "w-word-money", // shared with "___ shot"
      "w-pure-sweet",
      "w-pure-stripe",
    ],
  },
  {
    id: "p-hole-objects",
    label: "Things found at a golf hole (also non-golf words)",
    difficulty: "purple",
    memberIds: [
      "w-hole-cup",
      "w-feature-pin",
      "w-hole-flag",
      "w-hole-hole",
    ],
  },
  {
    id: "p-event-common-words",
    label: "Golf tournament names that are also common English words",
    difficulty: "purple",
    memberIds: [
      "w-event-players",
      "w-event-memorial",
      "w-event-travelers",
      "w-event-heritage",
      "w-event-genesis",
      "w-event-open", // shared with "Hole adjectives"
      "w-event-masters",
    ],
  },
  {
    id: "p-hole-adjectives",
    label: "Adjectives a golfer uses to describe a hole",
    difficulty: "purple",
    memberIds: [
      "w-adj-long",
      "w-event-open", // shared with "Tournament names"
      "w-adj-tight",
      "w-adj-tough",
      "w-adj-forgiving",
    ],
  },
];
