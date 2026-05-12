/**
 * Mapping from our golfer slug (id field in `golfers.ts`) to the
 * corresponding PGA Tour player ID, used to fetch face-cropped
 * headshots from PGA Tour's Cloudinary endpoint:
 *
 *   https://pga-tour-res.cloudinary.com/image/upload
 *     /c_fill,g_face:center,h_400,w_400,q_auto,f_auto
 *     /headshots_{pgaTourId}
 *
 * The `g_face:center` transform auto-detects the face and centres it,
 * giving us consistently-framed headshots that actually overlap when
 * blended — which Wikipedia thumbnails do not.
 *
 * Pros not in this map have no PGA Tour Cloudinary headshot. The Faces
 * game filters its pool to only pros with a known ID so every blend
 * lines up. Legends (Nicklaus, Palmer, Faldo etc.) and a handful of
 * LIV-only pros are intentionally absent until we curate manual face
 * crops for them.
 *
 * To add a missing pro: visit https://www.pgatour.com/player/{ID}/{slug}
 * and copy the numeric ID from the URL into this map. IDs are stable.
 */

export const PGA_TOUR_IDS: Record<string, string> = {
  // S tier — household names with active PGA Tour profiles
  "scottie-scheffler": "46046",
  "rory-mcilroy": "28237",
  "jon-rahm": "46970",
  "xander-schauffele": "48081",
  "bryson-dechambeau": "47959",
  "justin-thomas": "33448",
  "jordan-spieth": "34046",
  "brooks-koepka": "36689",
  "dustin-johnson": "30925",
  "hideki-matsuyama": "32839",
  "collin-morikawa": "50525",
  "tiger-woods": "08793",
  "phil-mickelson": "01810",
  "patrick-cantlay": "35450",

  // A tier — tour stars
  "viktor-hovland": "46717",
  "tommy-fleetwood": "30911",
  "tony-finau": "29725",
  "ludvig-åberg": "52955",
  "cameron-young": "57366",
  "wyndham-clark": "51766",
  "tom-kim": "55182",
  "shane-lowry": "33204",
  "matt-fitzpatrick": "40098",
  "sahith-theegala": "51634",
  "sungjae-im": "39971",
  "min-woo-lee": "37378",
  "robert-macintyre": "52215",
  "adam-scott": "24502",
  "justin-rose": "22405",
  "russell-henley": "34098",
  "sepp-straka": "49960",
  "akshay-bhatia": "56630",
  "keegan-bradley": "33141",
  "webb-simpson": "29221",
  "sam-burns": "47504",
  "max-homa": "39977",
  "rickie-fowler": "32102",
  "jason-day": "28089",
  "brian-harman": "27644",
  "cameron-davis": "45157",
  "cam-davis": "45157",
  "tom-hoge": "35532",
  "harris-english": "34099",
  "keith-mitchell": "39546",
  "kurt-kitayama": "48117",
  "nicolai-højgaard": "52453",
  "ryan-fox": "29936",
  "alex-norén": "27349",
  "erik-van-rooyen": "40006",

  // B tier and active tour regulars
  "si-woo-kim": "37455",
  "will-zalatoris": "47483",
  "adam-hadwin": "33399",
  "mackenzie-hughes": "35506",
  "stephan-jaeger": "36799",
  "lucas-glover": "25900",
  "maverick-mcnealy": "46442",
  "nick-taylor": "25493",
  "j-t-poston": "49771",
  "davis-thompson": "58168",
  "chris-kirk": "30926",
  "adam-schenk": "47347",
  "aaron-rai": "46414",
  "joel-dahmen": "34076",
  "thorbjørn-olesen": "33968",
  "andrew-putnam": "34256",
  "beau-hossler": "35461",
  "davis-riley": "47995",
  "ben-griffin": "54591",
  "nick-dunlap": "59866",
  "vijay-singh": "06567",
  "zach-johnson": "24024",
  // francesco-molinari: removed pending ID verification — 32366 turned
  // out to be Kevin Chappell, which caused the game to reveal the
  // wrong pro. Re-add when verified.
};

/**
 * Returns the PGA Tour Cloudinary headshot URL for a golfer, or null
 * if we don't have a PGA Tour ID for them.
 */
export function pgaTourHeadshotUrl(golferId: string): string | null {
  const id = PGA_TOUR_IDS[golferId];
  if (!id) return null;
  return `https://pga-tour-res.cloudinary.com/image/upload/c_fill,g_face:center,h_400,w_400,q_auto,f_auto/headshots_${id}.png`;
}
