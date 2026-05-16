import {
  fieldRank,
  findStatsByName,
  getLiveStatsCached,
} from "@/lib/feed/live-stats-cache";
import type { FullLiveStats } from "@/lib/golf-api/datagolf";

interface Props {
  tournamentId: string;
  playerName: string;
  /** Which rounds have started — drives which per-round mini cards we render. */
  playedRounds: number[];
}

/**
 * DataGolf strokes-gained + advanced stats for a player. Shows the
 * tournament-wide SG breakdown (with field rank for each bucket),
 * per-round SG mini cards, and a non-SG section for driving / GIR /
 * scrambling / proximity. Mirrors the kind of depth Real shows for
 * NBA / NFL player pages.
 */
export default async function PlayerStats({
  tournamentId,
  playerName,
  playedRounds,
}: Props) {
  const tournament = await getLiveStatsCached(tournamentId, "event_avg");
  const me = findStatsByName(tournament, playerName);
  if (!me) {
    return null;
  }

  // Pull each played round in parallel — cached for 5 min so this is
  // cheap on warm cache and capped at four DataGolf hits on cold.
  const perRound = await Promise.all(
    playedRounds.map(async (r) => {
      const rows = await getLiveStatsCached(tournamentId, r);
      const row = findStatsByName(rows, playerName);
      return { round: r, row };
    }),
  );

  const sgBuckets: {
    key: keyof FullLiveStats;
    label: string;
    pick: (s: FullLiveStats) => number | null;
  }[] = [
    { key: "sgOtt", label: "Off the tee", pick: (s) => s.sgOtt },
    { key: "sgApp", label: "Approach", pick: (s) => s.sgApp },
    { key: "sgArg", label: "Around green", pick: (s) => s.sgArg },
    { key: "sgPutt", label: "Putting", pick: (s) => s.sgPutt },
  ];

  return (
    <section className="pcard-section">
      <h3 className="fantasy-section-title">Strokes gained · tournament</h3>
      <div className="ps-sg-card">
        <SgHeadline
          label="SG total"
          value={me.sgTotal}
          rank={
            me.sgTotal != null
              ? fieldRank(tournament, (s) => s.sgTotal, me.sgTotal)
              : null
          }
        />
        <div className="ps-sg-breakdown">
          {sgBuckets.map((b) => (
            <SgBucket
              key={b.key}
              label={b.label}
              value={b.pick(me)}
              rank={
                b.pick(me) != null
                  ? fieldRank(tournament, b.pick, b.pick(me)!)
                  : null
              }
            />
          ))}
        </div>
      </div>

      {perRound.length > 0 && (
        <>
          <h3 className="fantasy-section-title">Strokes gained · per round</h3>
          <div className="ps-round-grid">
            {perRound.map(({ round, row }) => (
              <div key={round} className="ps-round-card">
                <div className="ps-round-head">R{round}</div>
                {row ? (
                  <>
                    <div className="ps-round-total">
                      {formatSgValue(row.sgTotal)}
                      <span className="ps-round-total-lbl"> total</span>
                    </div>
                    <ul className="ps-round-breakdown">
                      <li>
                        <span>OTT</span>
                        <strong>{formatSgValue(row.sgOtt)}</strong>
                      </li>
                      <li>
                        <span>APP</span>
                        <strong>{formatSgValue(row.sgApp)}</strong>
                      </li>
                      <li>
                        <span>ARG</span>
                        <strong>{formatSgValue(row.sgArg)}</strong>
                      </li>
                      <li>
                        <span>PUTT</span>
                        <strong>{formatSgValue(row.sgPutt)}</strong>
                      </li>
                    </ul>
                  </>
                ) : (
                  <p className="ps-round-empty">—</p>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <h3 className="fantasy-section-title">Advanced</h3>
      <div className="pcard-stat-grid">
        <MiscStat
          label="Driving distance"
          value={me.drivingDist}
          unit="yds"
          rank={
            me.drivingDist != null
              ? fieldRank(tournament, (s) => s.drivingDist, me.drivingDist)
              : null
          }
        />
        <MiscStat
          label="Driving accuracy"
          value={me.drivingAcc}
          asPct
          rank={
            me.drivingAcc != null
              ? fieldRank(tournament, (s) => s.drivingAcc, me.drivingAcc)
              : null
          }
        />
        <MiscStat
          label="Greens in reg"
          value={me.gir}
          asPct
          rank={
            me.gir != null
              ? fieldRank(tournament, (s) => s.gir, me.gir)
              : null
          }
        />
        <MiscStat
          label="Scrambling"
          value={me.scrambling}
          asPct
          rank={
            me.scrambling != null
              ? fieldRank(tournament, (s) => s.scrambling, me.scrambling)
              : null
          }
        />
        <MiscStat
          label="Prox · fairway"
          value={me.proxFw}
          unit="ft"
          rank={
            me.proxFw != null
              ? fieldRank(tournament, (s) => s.proxFw, me.proxFw, true)
              : null
          }
        />
        <MiscStat
          label="Prox · rough"
          value={me.proxRgh}
          unit="ft"
          rank={
            me.proxRgh != null
              ? fieldRank(tournament, (s) => s.proxRgh, me.proxRgh, true)
              : null
          }
        />
      </div>
    </section>
  );
}

function SgHeadline({
  label,
  value,
  rank,
}: {
  label: string;
  value: number | null;
  rank: { rank: number; outOf: number } | null;
}) {
  return (
    <div className="ps-sg-headline">
      <div className="ps-sg-headline-num">{formatSgValue(value)}</div>
      <div className="ps-sg-headline-meta">
        <span className="ps-sg-headline-lbl">{label}</span>
        {rank && (
          <span className="ps-sg-headline-rank">
            {ordinal(rank.rank)} of {rank.outOf}
          </span>
        )}
      </div>
    </div>
  );
}

function SgBucket({
  label,
  value,
  rank,
}: {
  label: string;
  value: number | null;
  rank: { rank: number; outOf: number } | null;
}) {
  return (
    <div className="ps-sg-bucket">
      <div className="ps-sg-bucket-lbl">{label}</div>
      <div className="ps-sg-bucket-num">{formatSgValue(value)}</div>
      {rank && (
        <div className="ps-sg-bucket-rank">{ordinal(rank.rank)}</div>
      )}
    </div>
  );
}

function MiscStat({
  label,
  value,
  unit,
  asPct,
  rank,
}: {
  label: string;
  value: number | null;
  unit?: string;
  asPct?: boolean;
  rank: { rank: number; outOf: number } | null;
}) {
  return (
    <div className="pcard-stat-box">
      <span className="pcard-stat-num">
        {value == null
          ? "—"
          : asPct
          ? `${Math.round(value * 100)}%`
          : unit
          ? `${value.toFixed(unit === "ft" ? 1 : 0)} ${unit}`
          : value.toFixed(1)}
      </span>
      <span className="pcard-stat-lbl">{label}</span>
      {rank && (
        <span className="ps-stat-rank">{ordinal(rank.rank)} in field</span>
      )}
    </div>
  );
}

function formatSgValue(v: number | null): string {
  if (v == null) return "—";
  if (v > 0) return `+${v.toFixed(2)}`;
  return v.toFixed(2);
}

function ordinal(n: number): string {
  const j = n % 10;
  const k = n % 100;
  if (k >= 11 && k <= 13) return `${n}th`;
  if (j === 1) return `${n}st`;
  if (j === 2) return `${n}nd`;
  if (j === 3) return `${n}rd`;
  return `${n}th`;
}
