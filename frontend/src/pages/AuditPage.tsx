// The audit log: who did what (logins, operator changes, database upgrades):
// a chart of each day, the actions ranked, and the entries, newest first.
// The database refuses to change or delete these rows.

import { Fragment, useCallback } from "react";
import { useSearchParams } from "react-router";

import { api } from "../api/client";
import { useResource } from "../api/useResource";
import { ChartFrame } from "../charts/ChartFrame";
import { ColumnChart, ColumnTable } from "../charts/ColumnChart";
import { RankBars, RankTable } from "../charts/RankBars";
import {
  AUDIT_LEGEND,
  AUDIT_SERIES,
  auditColumns,
  browserTimeZone,
  parsePeriod,
  PERIODS,
  periodStart,
} from "../charts/series";
import { NameFilter, Pager, Segmented, usePager } from "../components/Filters";
import { IconLock } from "../components/Icons";
import { Card, DisclosureButton, ErrorNotice, JsonBlock, KeyValues, PageHeader, RefreshControl, Time, useToggleSet } from "../components/Parts";
import { formatUtc } from "../lib/format";
import { CHART_INTERVAL_MS, PAGE_SIZE, parseId, parseName } from "./EventsPage";
import { LIST_INTERVAL_MS } from "./OverviewPage";

export function AuditPage() {
  const [params, setParams] = useSearchParams();
  const action = parseName(params.get("action"));
  const beforeId = parseId(params.get("before"));
  const days = parsePeriod(params.get("days"), 30);
  const tz = browserTimeZone();

  const update = useCallback(
    (changes: Record<string, string | null>) =>
      setParams((current) => {
        const next = new URLSearchParams(current);
        for (const [name, value] of Object.entries(changes)) {
          if (value === null) next.delete(name);
          else next.set(name, value);
        }
        return next;
      }),
    [setParams],
  );
  const pager = usePager(beforeId, (id) => update({ before: id === null ? null : String(id) }));
  const { reset } = pager;
  const setFilter = useCallback(
    (changes: Record<string, string | null>) => {
      reset();
      update({ ...changes, before: null });
    },
    [reset, update],
  );
  const setAction = useCallback((value: string | null) => setFilter({ action: value }), [setFilter]);

  const page = useResource(
    `audit:${action}:${beforeId}:${days}`,
    (signal) => api.audit({ limit: PAGE_SIZE, action, beforeId, since: periodStart(days) }, signal),
    beforeId === null ? LIST_INTERVAL_MS : undefined,
  );
  const chart = useResource(
    `audit-stats:${days}:${action}:${tz}`,
    (signal) => api.auditStats({ days, tz, action }, signal),
    CHART_INTERVAL_MS,
  );
  const [open, toggle] = useToggleSet();
  const items = page.data?.items ?? [];
  const seenActions = [...new Set(items.map((e) => e.action))].sort();

  return (
    <>
      <PageHeader
        title="Audit log"
        description={
          <>
            <IconLock size={14} /> Every login, logout and operator change, newest first. The
            database refuses to change or delete these entries.
          </>
        }
      >
        <RefreshControl
          updatedAt={page.updatedAt}
          refreshing={page.refreshing}
          onRefresh={page.refresh}
          {...(beforeId === null ? { every: "30 s" } : {})}
        />
      </PageHeader>

      <div className="filters" role="search" aria-label="Filter the audit log">
        <Segmented
          label="Period"
          value={String(days)}
          onChange={(value) => setFilter({ days: value === "30" ? null : value })}
          options={PERIODS.map((p) => ({ value: String(p), label: `${p} days` }))}
        />
        <NameFilter
          label="Action"
          value={action}
          onChange={setAction}
          suggestions={seenActions}
          placeholder="for example login"
        />
        {action || days !== 30 ? (
          <button
            type="button"
            className="button button--ghost button--small"
            onClick={() => setFilter({ action: null, days: null })}
          >
            Clear filters
          </button>
        ) : null}
      </div>

      {chart.error ? <ErrorNotice error={chart.error} title="Couldn't load the chart" /> : null}
      {chart.data ? (
        <div className="charts-row">
          <ChartFrame
            title="Activity per day"
            subtitle={`Last ${days} days, counted in your time zone (${tz}).`}
            legend={AUDIT_LEGEND}
            busy={chart.refreshing}
            table={<ColumnTable series={AUDIT_SERIES} columns={auditColumns(chart.data)} caption="Audit entries per day" />}
          >
            <ColumnChart
              series={AUDIT_SERIES}
              columns={auditColumns(chart.data)}
              label="Audit entries per day, by kind"
              noun="entries"
            />
          </ChartFrame>
          <ChartFrame
            title="Actions"
            subtitle={`${chart.data.total} entries in ${days} days. Pick one to see only that action.`}
            busy={chart.refreshing}
            table={
              <RankTable
                items={chart.data.actions.map((a) => ({ name: a.name, value: a.count }))}
                caption="Audit actions"
                nameLabel="Action"
              />
            }
          >
            <RankBars
              items={chart.data.actions.map((a) => ({ name: a.name, value: a.count }))}
              label="Audit actions, most frequent first"
              onPick={setAction}
            />
          </ChartFrame>
        </div>
      ) : chart.loading ? (
        <p className="loading">Loading the chart…</p>
      ) : null}

      {page.error ? <ErrorNotice error={page.error} title="Couldn't load the audit log" /> : null}

      <Card busy={page.refreshing && Boolean(page.data)}>
        {page.data && !items.length ? (
          <p className="empty-line">
            {action ? "No entries match this filter." : `No entries in the last ${days} days.`}
          </p>
        ) : null}
        {items.length ? (
          <div className="table-scroll">
            <table className="table table--rows table--stack">
              <caption className="sr-only">Audit log, newest first</caption>
              <thead>
                <tr>
                  <th scope="col" className="col-toggle">
                    <span className="sr-only">Details</span>
                  </th>
                  <th scope="col">Time</th>
                  <th scope="col">Who</th>
                  <th scope="col">Action</th>
                  <th scope="col">Target</th>
                </tr>
              </thead>
              <tbody>
                {items.map((entry) => {
                  const isOpen = open.has(entry.id);
                  const detailsId = `audit-${entry.id}`;
                  return (
                    <Fragment key={entry.id}>
                      <tr className={isOpen ? "is-open" : undefined}>
                        <td className="col-toggle">
                          <DisclosureButton
                            open={isOpen}
                            onToggle={() => toggle(entry.id)}
                            controls={detailsId}
                            label={`entry ${entry.id}`}
                          />
                        </td>
                        <td className="nowrap mono m-r1a">
                          <Time value={entry.occurred_at} />
                        </td>
                        <td className="mono m-r1b">{entry.actor}</td>
                        <td className="mono strong m-r2">{entry.action}</td>
                        <td className="m-r3">
                          {entry.target_id ? (
                            <>
                              <span className="muted">{entry.target_type ?? ""}</span>{" "}
                              <span className="mono">{entry.target_id}</span>
                            </>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                      </tr>
                      {isOpen ? (
                        <tr className="details-row" id={detailsId}>
                          <td />
                          <td colSpan={4}>
                            <KeyValues
                              rows={[
                                ["Entry ID", <span key="i" className="mono">{entry.id}</span>],
                                ["Recorded", <span key="r" className="mono">{formatUtc(entry.occurred_at)}</span>],
                                ["Request ID", <span key="q" className="mono">{entry.request_id ?? "—"}</span>],
                              ]}
                            />
                            <JsonBlock value={entry.details} />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        {page.loading ? <p className="loading">Loading the audit log…</p> : null}
        {page.data ? (
          <Pager pager={pager} nextBeforeId={page.data.next_before_id} count={items.length} noun="entries" />
        ) : null}
      </Card>
    </>
  );
}
