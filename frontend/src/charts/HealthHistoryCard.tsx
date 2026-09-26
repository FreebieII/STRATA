// The API's own health readings as charts: availability strips, and (in the
// full version) response-time charts for each check.

import { useState } from "react";

import { api } from "../api/client";
import type { HealthWindow } from "../api/types";
import { useResource } from "../api/useResource";
import { ErrorNotice } from "../components/Parts";
import { Segmented } from "../components/Filters";
import { formatDateTime } from "../lib/format";
import { ChartFrame } from "./ChartFrame";
import { HealthTable, LatencyPanels, UPTIME_LEGEND, UptimeStrips } from "./HealthCharts";

export const HEALTH_INTERVAL_MS = 30_000;

const WINDOW_LABEL: Record<HealthWindow, string> = {
  "1h": "last hour",
  "6h": "last 6 hours",
  "24h": "last 24 hours",
};

const SLOT_LABEL: Record<HealthWindow, string> = {
  "1h": "one-minute slots",
  "6h": "five-minute slots",
  "24h": "20-minute slots",
};

export function HealthHistoryCard({ compact = false }: { compact?: boolean }) {
  const [span, setSpan] = useState<HealthWindow>(compact ? "24h" : "1h");
  const [active, setActive] = useState<number | null>(null);
  const history = useResource(
    `health-history:${span}`,
    (signal) => api.healthHistory(span, signal),
    HEALTH_INTERVAL_MS,
  );
  const data = history.data;
  const since = data?.recording_since;

  const subtitle = data
    ? `${WINDOW_LABEL[span][0]!.toUpperCase()}${WINDOW_LABEL[span].slice(1)}, in ${SLOT_LABEL[span]}. ` +
      `The API checks itself every ${data.sample_every_s} seconds` +
      (since ? `, and has been recording since ${formatDateTime(since)}.` : ".")
    : undefined;

  return (
    <>
      {!compact ? (
        <div className="window-row">
          <Segmented
            label="Show"
            value={span}
            onChange={(value) => value && setSpan(value)}
            options={[
              { value: "1h", label: "1 hour" },
              { value: "6h", label: "6 hours" },
              { value: "24h", label: "24 hours" },
            ]}
          />
        </div>
      ) : null}
      {history.error ? <ErrorNotice error={history.error} title="Couldn't load the health history" /> : null}
      {data ? (
        <ChartFrame
          title={compact ? "Availability, last 24 hours" : "Health history"}
          subtitle={subtitle}
          legend={UPTIME_LEGEND}
          busy={history.refreshing}
          table={<HealthTable series={data.series} bucketS={data.bucket_s} />}
        >
          {data.series.length ? (
            <>
              <UptimeStrips series={data.series} bucketS={data.bucket_s} active={active} onActive={setActive} />
              {!compact ? (
                <LatencyPanels series={data.series} bucketS={data.bucket_s} active={active} onActive={setActive} />
              ) : null}
            </>
          ) : (
            <p className="empty-line">No readings yet. The first arrives within 15 seconds of the API starting.</p>
          )}
          <p className="chart-note">
            Kept in the API&apos;s memory for 24 hours: a restart starts the history afresh. The
            percentages are the share of readings that passed.
          </p>
        </ChartFrame>
      ) : history.loading ? (
        <p className="loading">Loading the health history…</p>
      ) : null}
    </>
  );
}
