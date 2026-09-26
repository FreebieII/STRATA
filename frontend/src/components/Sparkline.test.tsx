import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Sparkline, type SparkSample } from "./Sparkline";

const at = (i: number) => Date.parse("2026-09-25T12:00:00Z") + i * 15_000;

function draw(samples: SparkSample[]) {
  const { container } = render(<Sparkline label="Database response time" slots={40} samples={samples} />);
  return container;
}

describe("Sparkline", () => {
  it("draws one line and writes the low and high out", () => {
    const container = draw([
      { at: at(0), value: 1, ok: true },
      { at: at(1), value: 3, ok: true },
      { at: at(2), value: 2, ok: true },
    ]);
    expect(container.querySelectorAll(".spark__line")).toHaveLength(1);
    expect(container.querySelectorAll(".spark__area")).toHaveLength(1);
    expect(container.querySelector(".spark__marker")).not.toBeNull();
    expect(screen.getByText("Low 1.0 ms · high 3.0 ms")).toBeInTheDocument();
  });

  it("breaks the line where a reading is missing, and marks failures", () => {
    const container = draw([
      { at: at(0), value: 1, ok: true },
      { at: at(1), value: 2, ok: true },
      { at: at(2), value: null, ok: false },
      { at: at(3), value: null, ok: null },
      { at: at(4), value: 1, ok: true },
      { at: at(5), value: 2, ok: true },
    ]);
    expect(container.querySelectorAll(".spark__line")).toHaveLength(2);
    expect(container.querySelectorAll(".spark__fail")).toHaveLength(1);
    expect(container.querySelectorAll(".spark__gap")).toHaveLength(1);
    expect(screen.getByText(/1 failed, 1 missed/)).toBeInTheDocument();
  });

  it("can be read one value at a time with the keyboard", () => {
    draw([
      { at: at(0), value: 1.5, ok: true },
      { at: at(1), value: null, ok: false },
      { at: at(2), value: 2.5, ok: true },
    ]);
    const plot = screen.getByRole("img", { name: /Database response time/ });
    fireEvent.keyDown(plot, { key: "ArrowLeft" });
    expect(screen.getByText(/· check failed$/)).toBeInTheDocument();
    fireEvent.keyDown(plot, { key: "Home" });
    expect(screen.getByText(/· 1\.5 ms$/)).toBeInTheDocument();
    fireEvent.keyDown(plot, { key: "Escape" });
    expect(screen.getByText(/^Low 1\.5 ms/)).toBeInTheDocument();
  });

  it("says so when there are no readings yet", () => {
    const container = draw([]);
    expect(screen.getByText("No readings yet.")).toBeInTheDocument();
    expect(container.querySelector(".spark__line")).toBeNull();
  });
});
