import Link from "next/link";
import { BRAND } from "@/lib/brand";

/**
 * Site-wide footer. Renders the responsible-gambling disclaimer +
 * legal links on every page via the root layout. Intentionally
 * understated so it doesn't compete visually with the feed/leader-
 * board content above it.
 */
export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <p className="site-footer-disclaimer">
        {BRAND.name} is a tracker, not a bookmaker — we don&apos;t accept
        bets. 18+ only. If gambling stops being fun, free help is at{" "}
        <a
          href="https://www.gamcare.org.uk"
          target="_blank"
          rel="noreferrer"
          className="site-footer-link"
        >
          GamCare
        </a>{" "}
        (UK) or{" "}
        <a
          href="https://www.ncpgambling.org"
          target="_blank"
          rel="noreferrer"
          className="site-footer-link"
        >
          ncpgambling.org
        </a>{" "}
        (US).
      </p>
      <div className="site-footer-links">
        <Link href="/privacy" className="site-footer-link">
          Privacy
        </Link>
        <Link href="/terms" className="site-footer-link">
          Terms
        </Link>
        <a
          href={`mailto:${BRAND.email}`}
          className="site-footer-link"
        >
          Contact
        </a>
      </div>
    </footer>
  );
}
