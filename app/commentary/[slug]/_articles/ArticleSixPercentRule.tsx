import { cookies } from "next/headers";
import EmailGate from "./six-percent/EmailGate";
import { READER_COOKIE } from "./six-percent/reader";
import Free from "./six-percent/Free";
import Paid from "./six-percent/Paid";
import styles from "./six-percent/article.module.css";

/**
 * Article: "The six percent rule" — Jeremy Paul over 69.5, R3 at Crans.
 *
 * Two halves. Everyone reads the setup and the reversion study; the
 * projection, price and staking sit behind an email gate.
 *
 * The gate is enforced on the SERVER: <Gated> reads the reader cookie
 * and simply doesn't render <Paid> without it, so the paid markup never
 * reaches a first-time visitor. A CSS overlay would ship the whole
 * article and lose to devtools in five seconds.
 *
 * Unlike the other pieces in _articles/ this one carries its own
 * stylesheet (charts, stat cards, data tables) rather than the inline
 * prose helpers, because it is chart-heavy.
 */
const GETS = [
  "The projection, and the three numbers it is built from",
  "Why the last tee time on Saturday is worth two thirds of a stroke",
  "Our price, the edge against the market, and how we are staking it",
  "The two ways this bet loses",
];

/** Async so it can read cookies; rendered as a child of the sync body. */
async function Gated() {
  const jar = await cookies();
  if (jar.get(READER_COOKIE)?.value === "1") return <Paid />;
  return (
    <EmailGate
      article="six-percent-rule"
      heading="The rest of this one is free too."
      sub="It just costs an email address. Drop it in and the projection, the price and the staking appear right here."
      gets={GETS}
    />
  );
}

export default function ArticleSixPercentRule() {
  return (
    <div className={styles.article}>
      <Free />
      <Gated />
    </div>
  );
}
