// Horizontal bars, longest first: "which kinds happen most". One series,
// so one colour and no legend; the value sits at the tip of each bar.

export type Ranked = { name: string; value: number };

export function RankBars({
  items,
  label,
  format = (value: number) => String(value),
  color = "var(--series-1)",
  mono = true,
  onPick,
  pickLabel = "Show only",
}: {
  items: Ranked[];
  label: string;
  format?: (value: number) => string;
  color?: string;
  // Names are identifiers (event types, actions): show them in the code face.
  mono?: boolean;
  // Makes each name a button, for example to filter the page by it.
  onPick?: (name: string) => void;
  pickLabel?: string;
}) {
  const top = Math.max(1, ...items.map((item) => item.value));
  if (!items.length) return <p className="empty-line">Nothing recorded in this period.</p>;
  return (
    <ol className="rank" aria-label={label}>
      {items.map((item) => (
        <li className="rank__row" key={item.name}>
          <span className={`rank__name${mono ? " mono" : ""}`} title={item.name}>
            {onPick ? (
              <button
                type="button"
                className="rank__pick"
                onClick={() => onPick(item.name)}
                aria-label={`${pickLabel} ${item.name}`}
              >
                {item.name}
              </button>
            ) : (
              item.name
            )}
          </span>
          <span className="rank__track">
            <span
              className="rank__bar"
              style={{ width: `${Math.max(1.5, (item.value / top) * 100)}%`, background: color }}
            />
            <span className="rank__value">{format(item.value)}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function RankTable({ items, caption, nameLabel }: { items: Ranked[]; caption: string; nameLabel: string }) {
  return (
    <table className="table table--compact">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{nameLabel}</th>
          <th scope="col" className="num">
            Count
          </th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.name}>
            <td className="mono">{item.name}</td>
            <td className="num">{item.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
