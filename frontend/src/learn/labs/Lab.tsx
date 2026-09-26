// The frame and controls every lab shares. A lab is something to try: change a
// number and watch what happens. Its tag says what the numbers are.

import { useId, type ReactNode } from "react";

import { IconBacktests } from "../../components/Icons";

export type LabKind = "made-up" | "arithmetic" | "rules";

const TAG: Record<LabKind, string> = {
  "made-up": "Try it · made-up prices, not market data",
  arithmetic: "Try it · arithmetic with your numbers",
  rules: "Try it · STRATA's rules, on a pretend trade",
};

export function Lab({
  title,
  kind,
  intro,
  children,
  note,
}: {
  title: string;
  kind: LabKind;
  // What to do, in a sentence.
  intro: ReactNode;
  children: ReactNode;
  // Small print: what the lab simplifies.
  note?: ReactNode;
}) {
  const titleId = useId();
  return (
    <section className="lab" aria-labelledby={titleId}>
      <div className="lab__head">
        <p className="lab__title" id={titleId}>
          <IconBacktests size={16} />
          {title}
        </p>
        <span className={`lab__tag lab__tag--${kind}`}>{TAG[kind]}</span>
      </div>
      <p className="lab__intro">{intro}</p>
      {children}
      {note ? <p className="lab__note">{note}</p> : null}
    </section>
  );
}

/** A labelled slider with its value beside it. */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format = String,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}) {
  const id = useId();
  return (
    <div className="lab-slider">
      <label className="lab-slider__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={format(value)}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <output className="lab-slider__value mono" htmlFor={id}>
        {format(value)}
      </output>
    </div>
  );
}

/** A labelled on/off switch. */
export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="lab-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/** A figure worth reading at a glance: a label over a big number. */
export function Readout({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return (
    <div className="lab-readout">
      <p className="lab-readout__label">{label}</p>
      <p className="lab-readout__value">{value}</p>
      {detail ? <div className="lab-readout__detail">{detail}</div> : null}
    </div>
  );
}

export const money = (n: number, digits = 2) =>
  `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

/** A signed percentage with a real minus sign: "+4.2%", "−1.0%". */
export const signedPct = (n: number, digits = 1) => {
  const text = Math.abs(n).toFixed(digits);
  if (Number(text) === 0) return `${(0).toFixed(digits)}%`;
  return `${n < 0 ? "−" : "+"}${text}%`;
};
