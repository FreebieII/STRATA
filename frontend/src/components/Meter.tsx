// A single amount against a whole (for example a limit as a share of the
// capital). The value is always written out beside the bar.

export function Meter({
  label,
  value,
  fraction,
  detail,
}: {
  label: string;
  value: string;
  // 0..1 of the track; clamped.
  fraction: number;
  detail?: string;
}) {
  const share = Math.min(1, Math.max(0, fraction));
  return (
    <div className="meter">
      <div className="meter__head">
        <span className="meter__label">{label}</span>
        <span className="meter__value">{value}</span>
      </div>
      <div
        className="meter__track"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(share * 1000) / 10}
        aria-valuetext={detail ? `${value}, ${detail}` : value}
      >
        <div className="meter__fill" style={{ width: `${share * 100}%` }} />
      </div>
      {detail ? <p className="meter__detail">{detail}</p> : null}
    </div>
  );
}

// A count shown as a row of small blocks: "5 stop-outs" is five blocks.
export function Pips({ count, max = 40, label }: { count: number; max?: number; label: string }) {
  const whole = Math.max(0, Math.floor(count));
  const shown = Math.min(whole, max);
  return (
    <div className="pips" role="img" aria-label={label}>
      {Array.from({ length: shown }, (_, i) => (
        <span key={i} className="pips__pip" />
      ))}
      {whole > max ? <span className="pips__more">+{whole - max}</span> : null}
    </div>
  );
}
