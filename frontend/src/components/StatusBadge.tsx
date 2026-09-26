// A state shown as colour AND an icon AND a word, never colour alone. The
// four status colours (good, warning, serious, critical) mean only that.

import type { ComponentType } from "react";

import { humanise } from "../lib/format";
import {
  IconCritical,
  IconDebug,
  IconGood,
  IconInfo,
  IconSerious,
  IconUnknown,
  IconWarning,
} from "./Icons";

export type Tone = "good" | "warning" | "serious" | "critical" | "neutral" | "muted";

type IconComponent = ComponentType<{ size?: number }>;

const ICONS: Record<Tone, IconComponent> = {
  good: IconGood,
  warning: IconWarning,
  serious: IconSerious,
  critical: IconCritical,
  neutral: IconInfo,
  muted: IconDebug,
};

export function StatusBadge({
  tone,
  label,
  icon,
  quiet = false,
}: {
  tone: Tone;
  label: string;
  icon?: IconComponent;
  // No background: for dense places like table cells.
  quiet?: boolean;
}) {
  const Glyph = icon ?? ICONS[tone];
  return (
    <span className={`badge badge--${tone}${quiet ? " badge--quiet" : ""}`}>
      <span className="badge__icon">
        <Glyph size={14} />
      </span>
      <span className="badge__label">{label}</span>
    </span>
  );
}

export function severityBadge(severity: string): { tone: Tone; label: string; icon: IconComponent } {
  switch (severity) {
    case "debug":
      return { tone: "muted", label: "Debug", icon: IconDebug };
    case "info":
      return { tone: "neutral", label: "Info", icon: IconInfo };
    case "warning":
      return { tone: "warning", label: "Warning", icon: IconWarning };
    case "error":
      return { tone: "serious", label: "Error", icon: IconSerious };
    case "critical":
      return { tone: "critical", label: "Critical", icon: IconCritical };
    default:
      return { tone: "neutral", label: humanise(severity || "unknown"), icon: IconUnknown };
  }
}

export function SeverityBadge({ severity, quiet }: { severity: string; quiet?: boolean }) {
  const { tone, label, icon } = severityBadge(severity);
  return <StatusBadge tone={tone} label={label} icon={icon} quiet={quiet ?? false} />;
}

export function HealthBadge({ ok, quiet }: { ok: boolean | null; quiet?: boolean }) {
  if (ok === null) return <StatusBadge tone="muted" label="No reading" icon={IconUnknown} quiet={quiet ?? false} />;
  return ok ? (
    <StatusBadge tone="good" label="Healthy" quiet={quiet ?? false} />
  ) : (
    <StatusBadge tone="critical" label="Failing" quiet={quiet ?? false} />
  );
}
