/**
 * Hand-written one-line trivia hints, keyed by golfer slug (matches
 * the `id` field in golfers.ts). Surfaced in the Pros game after the
 * 4th wrong guess.
 *
 * Style rules:
 * - One sentence, specific enough to identify the pro but NOT
 *   restating something already visible in the reveal grid
 *   (country flag / age / height / majors / Tour wins / Ryder Cups).
 * - Prefer storylines a fan would remember (a particular win, a
 *   famous moment, a notable relationship) over dry stats.
 * - Never include the pro's name (or unique surname). The hint
 *   should leave the player one step short of the answer, not
 *   hand it to them.
 *
 * If a pro has no manual hint here, the Pros page falls back to a
 * lighter auto-generated nudge. To add a new pro: drop a line below
 * with the slug and a fact.
 */

export const PRO_HINTS: Record<string, string> = {
  // ── S tier ────────────────────────────────────────────────────
  "scottie-scheffler":
    "Has been World No. 1 for more than 100 consecutive weeks.",
  "rory-mcilroy":
    "Won four majors by age 25, then went over a decade waiting for his next.",
  "jon-rahm":
    "Defected to LIV Golf in 2023 as the reigning Masters champion.",
  "xander-schauffele":
    "Won his first two majors in the same calendar year.",
  "bryson-dechambeau":
    "Famously bulked up by 50 lbs before bombing his way to a US Open title.",
  "justin-thomas":
    "Has been best friends with Jordan Spieth since they were teenagers.",
  "jordan-spieth":
    "Made a Sunday quadruple bogey at the 12th to give back a Masters lead.",
  "brooks-koepka":
    "Has openly said majors are the only events he cares about.",
  "dustin-johnson":
    "His brother-in-law is hockey legend Wayne Gretzky.",
  "hideki-matsuyama":
    "Became the first man from his country to win the Masters.",
  "collin-morikawa":
    "Won the PGA Championship in only his second major-championship start.",
  "tiger-woods":
    "Won the 1997 Masters by 12 shots at age 21.",
  "phil-mickelson":
    "Became the oldest major champion in history aged 50.",
  "patrick-cantlay":
    "Nicknamed 'Patty Ice' partly for his glacial pace of play.",

  // ── A tier ────────────────────────────────────────────────────
  "viktor-hovland":
    "Won the 2023 Tour Championship from his home continent of Europe.",
  "tommy-fleetwood":
    "Long-haired English star who has been Europe's Ryder Cup spark plug.",
  "tony-finau":
    "Dislocated his ankle celebrating a hole-in-one at the Masters Par-3 Contest.",
  "ludvig-åberg":
    "Made his Ryder Cup debut before winning his first PGA Tour event.",
  "cameron-young":
    "Tall American who finished runner-up at the 2022 Open Championship.",
  "wyndham-clark":
    "Won the 2023 US Open at Los Angeles Country Club.",
  "tom-kim":
    "Korean prodigy who won three PGA Tour events before turning 21.",
  "shane-lowry":
    "Lifted the Claret Jug at Royal Portrush in driving rain in 2019.",
  "matt-fitzpatrick":
    "Won the 2022 US Open with the same high-school friend on the bag.",
  "sahith-theegala":
    "Stanford graduate and the first Indian-American star on Tour.",
  "sungjae-im":
    "Finished runner-up at the 2020 Masters before turning 23.",
  "min-woo-lee":
    "Younger brother of LPGA major champion Minjee.",
  "robert-macintyre":
    "Left-handed Scot who won the 2024 Scottish Open with his dad caddying.",
  "adam-scott":
    "Lifted the green jacket using a long-handled anchored putter.",
  "justin-rose":
    "Won the 2013 US Open and Olympic gold in Rio 2016.",
  "russell-henley":
    "Steady Georgia native known for putting under pressure.",
  "sepp-straka":
    "Austrian by birth, raised in the American South.",
  "akshay-bhatia":
    "Skipped college to turn pro at 17, the first ever to do so out of high school in the US.",
  "keegan-bradley":
    "Nephew of LPGA Hall-of-Famer Pat Bradley; named USA Ryder Cup captain.",
  "webb-simpson":
    "Won the 2012 US Open at the Olympic Club in San Francisco.",
  "sam-burns":
    "Louisiana native with a famously easy-going Southern demeanour.",
  "max-homa":
    "Famous for roasting amateur swings posted to him on Twitter.",
  "rickie-fowler":
    "Known for his head-to-toe orange Sunday outfits.",
  "jason-day":
    "Australian former World No. 1 who won the 2015 PGA Championship.",
  "brian-harman":
    "Left-handed grinder who lifted the Claret Jug at Hoylake in 2023.",
  "cameron-davis":
    "Australian who has won the Rocket Mortgage Classic twice.",
  "cam-davis":
    "Australian who has won the Rocket Mortgage Classic twice.",
  "tom-hoge":
    "Won the AT&T Pebble Beach Pro-Am in 2022 having grown up in North Dakota.",
  "harris-english":
    "Georgia Bulldog who has chased a major final-round near-miss for years.",
  "keith-mitchell":
    "Won the 2019 Honda Classic with a closing birdie at PGA National.",
  "kurt-kitayama":
    "Won his maiden PGA Tour title at Arnold Palmer's tournament.",
  "nicolai-højgaard":
    "Danish twin who played Ryder Cup as a rookie alongside his brother.",

  // ── B tier ────────────────────────────────────────────────────
  "ryan-fox":
    "His father captained the All Blacks rugby team.",
  "alex-norén":
    "Won at Wentworth and was a fixture in Europe's Ryder Cup conversations.",
  "erik-van-rooyen":
    "South African whose first PGA Tour win came on a Sunday emotional roller-coaster after a close friend's death.",
  "si-woo-kim":
    "Was the youngest ever Players Championship winner.",
  "will-zalatoris":
    "Has been told for years he looks like the caddie kid from Happy Gilmore.",
  "adam-hadwin":
    "Canadian who got tackled by security trying to spray champagne on a friend's first win.",
  "mackenzie-hughes":
    "Canadian who won his first PGA Tour event in his rookie year in 2016.",
  "stephan-jaeger":
    "German who took home the 2024 Houston Open as his maiden Tour win.",
  "lucas-glover":
    "Won the 2009 US Open after a one-hour rain delay during the playoff.",
  "maverick-mcnealy":
    "Stanford grad whose father co-founded Sun Microsystems.",
  "nick-taylor":
    "Broke a 69-year drought for Canadians at the RBC Canadian Open.",
  "j-t-poston":
    "Won at Wyndham with the lowest 72-hole score of the 2019 season.",
  "davis-thompson":
    "Lifted his maiden trophy at the 2024 John Deere Classic.",
  "chris-kirk":
    "Stepped away from the Tour for treatment for alcohol addiction, then came back and won again.",
  "adam-schenk":
    "Indiana grinder who has built his career as a consistent top-50 player.",
  "aaron-rai":
    "English-Indian veteran of the European Tour, won the 2024 Wyndham.",
  "joel-dahmen":
    "Testicular cancer survivor who became a Netflix Full Swing breakout star.",
  "thorbjørn-olesen":
    "Danish Ryder Cup veteran who has won across three continents.",
  "andrew-putnam":
    "Washington native who broke through with a Barracuda Championship title.",
  "beau-hossler":
    "Once led the US Open at age 17 as an amateur.",
  "davis-riley":
    "Won his first PGA Tour title at the 2024 Charles Schwab Challenge.",
  "ben-griffin":
    "Quit golf to be a mortgage loan officer, then came back and won on Tour.",
  "nick-dunlap":
    "The first amateur in over 30 years to win a PGA Tour event.",
  "vijay-singh":
    "Three-time major champion from Fiji who reached World No. 1 in his 40s.",
  "zach-johnson":
    "Won the 2007 Masters by laying up on every par 5.",

  // ── Legends (Wikipedia-image rotation, no PGA Tour Cloudinary) ──
  "jack-nicklaus":
    "Has the all-time record for most major championship wins.",
  "arnold-palmer":
    "Has the most iconic charge in Masters history, recovering from seven back.",
  "seve-ballesteros":
    "Spanish artist of the impossible recovery shot.",
  "greg-norman":
    "Held a six-shot lead going into the final round of the 1996 Masters and lost.",
  "nick-faldo":
    "Won three Masters and three Opens with an icy-cool demeanour.",
  "tom-watson":
    "Nearly won the Open Championship at age 59 in 2009.",
  "gary-player":
    "South African Big Three legend who won the career Grand Slam.",
  "lee-trevino":
    "Mexican-American six-time major winner with a self-taught swing.",
  "bernhard-langer":
    "German Masters champion who still beats his age regularly on the senior tour.",
  "ernie-els":
    "South African giant nicknamed 'The Big Easy' for his smooth swing.",
};
