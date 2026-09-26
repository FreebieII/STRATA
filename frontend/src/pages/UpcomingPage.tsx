// A page for something that doesn't exist yet. It says what will be here and
// when, instead of showing made-up numbers.

import type { NavItem, Upcoming } from "../nav";
import { PageHeader } from "../components/Parts";

export function UpcomingPage({ item, upcoming }: { item: NavItem; upcoming: Upcoming }) {
  const Icon = item.icon;
  return (
    <>
      <PageHeader title={item.label} />
      <section className="upcoming" aria-labelledby="upcoming-title">
        <span className="upcoming__icon">
          <Icon size={28} />
        </span>
        <h2 className="upcoming__title" id="upcoming-title">
          Nothing to show yet
        </h2>
        <p className="upcoming__today">{upcoming.today}</p>
        <p className="upcoming__when">
          Arrives in <strong>{upcoming.arrives}</strong>
        </p>
        <div className="upcoming__list">
          <p className="upcoming__list-title">This page will show</p>
          <ul>
            {upcoming.shows.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}

export function NotFoundPage() {
  return (
    <>
      <PageHeader title="Page not found" />
      <section className="upcoming">
        <p className="upcoming__today">There is no page at this address. Use the menu to find your way.</p>
      </section>
    </>
  );
}
