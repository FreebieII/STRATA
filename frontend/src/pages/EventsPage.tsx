// System events (start-ups, failed logins, database upgrades…), newest first.
// Filters live in the address, so a filtered view can be bookmarked.

import { Fragment, useCallback } from "react";
import { useSearchParams } from "react-router";

import { api, NAME_PATTERN } from "../api/client";
import { SEVERITIES, type Severity } from "../api/types";
import { useResource } from "../api/useResource";
import { NameFilter, Pager, Segmented, usePager } from "../components/Filters";
import { Card, DisclosureButton, ErrorNotice, JsonBlock, KeyValues, PageHeader, RefreshControl, Time, useToggleSet } from "../components/Parts";
import { SeverityBadge } from "../components/StatusBadge";
import { formatUtc, humanise } from "../lib/format";
import { LIST_INTERVAL_MS } from "./OverviewPage";

export const PAGE_SIZE = 50;

export function parseSeverity(value: string | null): Severity | null {
  return SEVERITIES.find((s) => s === value) ?? null;
}

export function parseName(value: string | null): string | null {
  return value && NAME_PATTERN.test(value) ? value : null;
}

export function parseId(value: string | null): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id >= 1 ? id : null;
}

export function EventsPage() {
  const [params, setParams] = useSearchParams();
  const severity = parseSeverity(params.get("severity"));
  const eventType = parseName(params.get("type"));
  const beforeId = parseId(params.get("before"));

  const update = useCallback(
    (changes: Record<string, string | null>) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [name, value] of Object.entries(changes)) {
            if (value === null) next.delete(name);
            else next.set(name, value);
          }
          return next;
        },
        { replace: false },
      ),
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
  const setType = useCallback((value: string | null) => setFilter({ type: value }), [setFilter]);

  // Only the newest page refreshes by itself; older pages don't change.
  const page = useResource(
    `events:${severity}:${eventType}:${beforeId}`,
    (signal) => api.events({ limit: PAGE_SIZE, severity, eventType, beforeId }, signal),
    beforeId === null ? LIST_INTERVAL_MS : undefined,
  );
  const [open, toggle] = useToggleSet();
  const items = page.data?.items ?? [];
  const seenTypes = [...new Set(items.map((e) => e.event_type))].sort();
  const filtered = severity !== null || eventType !== null;

  return (
    <>
      <PageHeader
        title="Events"
        description="What the platform did and noticed, newest first. Stored in PostgreSQL."
      >
        <RefreshControl
          updatedAt={page.updatedAt}
          refreshing={page.refreshing}
          onRefresh={page.refresh}
          {...(beforeId === null ? { every: "30 s" } : {})}
        />
      </PageHeader>

      <div className="filters" role="search" aria-label="Filter events">
        <Segmented
          label="Severity"
          value={severity}
          onChange={(value) => setFilter({ severity: value })}
          options={[
            { value: null, label: "All" },
            ...SEVERITIES.map((s) => ({ value: s, label: humanise(s) })),
          ]}
        />
        <NameFilter
          label="Event type"
          value={eventType}
          onChange={setType}
          suggestions={seenTypes}
          placeholder="for example login_failed"
        />
        {filtered ? (
          <button type="button" className="button button--ghost button--small" onClick={() => setFilter({ severity: null, type: null })}>
            Clear filters
          </button>
        ) : null}
      </div>

      {page.error ? <ErrorNotice error={page.error} title="Couldn't load the events" /> : null}

      <Card busy={page.refreshing && Boolean(page.data)}>
        {page.data && !items.length ? (
          <p className="empty-line">
            {filtered ? "No events match these filters." : "No events recorded yet."}
          </p>
        ) : null}
        {items.length ? (
          <div className="table-scroll">
            <table className="table table--rows table--stack">
              <caption className="sr-only">System events, newest first</caption>
              <thead>
                <tr>
                  <th scope="col" className="col-toggle">
                    <span className="sr-only">Details</span>
                  </th>
                  <th scope="col">Time</th>
                  <th scope="col">Severity</th>
                  <th scope="col">Event</th>
                  <th scope="col">Component</th>
                  <th scope="col">Message</th>
                </tr>
              </thead>
              <tbody>
                {items.map((event) => {
                  const isOpen = open.has(event.id);
                  const detailsId = `event-${event.id}`;
                  return (
                    <Fragment key={event.id}>
                      <tr className={isOpen ? "is-open" : undefined}>
                        <td className="col-toggle">
                          <DisclosureButton
                            open={isOpen}
                            onToggle={() => toggle(event.id)}
                            controls={detailsId}
                            label={`event ${event.id}`}
                          />
                        </td>
                        <td className="nowrap mono m-r1a">
                          <Time value={event.occurred_at} />
                        </td>
                        <td className="m-r1b">
                          <SeverityBadge severity={event.severity} quiet />
                        </td>
                        <td className="mono m-r3a">{event.event_type}</td>
                        <td className="mono muted m-r3b">{event.component}</td>
                        <td className="wrap m-r2">{event.message}</td>
                      </tr>
                      {isOpen ? (
                        <tr className="details-row" id={detailsId}>
                          <td />
                          <td colSpan={5}>
                            <KeyValues
                              rows={[
                                ["Event ID", <span key="i" className="mono">{event.id}</span>],
                                ["Recorded", <span key="r" className="mono">{formatUtc(event.occurred_at)}</span>],
                                ["Request ID", <span key="q" className="mono">{event.request_id ?? "—"}</span>],
                              ]}
                            />
                            <JsonBlock value={event.details} />
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
        {page.loading ? <p className="loading">Loading events…</p> : null}
        {page.data ? (
          <Pager pager={pager} nextBeforeId={page.data.next_before_id} count={items.length} noun="events" />
        ) : null}
      </Card>
    </>
  );
}
