"use client";
import { useTransition, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownOutlined, ArrowUpOutlined, ExclamationCircleFilled } from "@ant-design/icons";
import { Button, Card, Select } from "antd";
import IntentLink from "@/components/IntentLink";
import type { HomePeriodKey } from "@/lib/domain/dashboard-home/types";
import styles from "./dashboard-home.module.css";
import { PERIOD_OPTIONS } from "./view";

/**
 * The parts every Dashboard card is made of (3.0.38): an Ant Design card with a
 * plain head (its title, and a period or nothing), a body, and a foot with its
 * links; and the three states a card can be in besides its figures.
 */

/** 8px corners and a 48px head, as the rest of the page; set here, inline, so no stylesheet order can undo them. */
const CARD_STYLES = {
  root: { borderRadius: 8 },
  header: { minHeight: 48, padding: "0 16px" },
  body: { padding: 0 },
} satisfies Record<string, CSSProperties>;

export function Widget({
  title,
  extra,
  footer,
  children,
}: {
  title: string;
  extra?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className={styles.card} styles={CARD_STYLES} title={<h2 className={styles.cardTitle}>{title}</h2>} extra={extra}>
      <div className={styles.body}>{children}</div>
      {footer ? <div className={styles.footer}>{footer}</div> : null}
    </Card>
  );
}

/** Pushes what follows it in a card's foot to the right. */
export function Spacer() {
  return <span className={styles.spacer} />;
}

/** A link in a card's foot or body. Prefetches only on intent, as the shell's links do. */
export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return <IntentLink href={href}>{children}</IntentLink>;
}

/**
 * A button that goes somewhere: a real link (it opens in a new tab, and reads
 * as a link), followed inside the app without reloading the page.
 */
export function LinkButton({
  href,
  children,
  primary = false,
  label,
}: {
  href: string;
  children: ReactNode;
  primary?: boolean;
  /** The full name, where the word on the button repeats down a list ("Review: Invoices overdue"). */
  label?: string;
}) {
  const router = useRouter();
  const follow = (event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    router.push(href);
  };
  return (
    <Button size="small" type={primary ? "primary" : "default"} href={href} onClick={follow} aria-label={label}>
      {children}
    </Button>
  );
}

/** Reads the page again: every read is made afresh, as on a reload, without one. */
export function RetryButton({ label = "Retry" }: { label?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button size="small" loading={pending} onClick={() => start(() => router.refresh())}>
      {label}
    </Button>
  );
}

/**
 * A card whose read failed: it says so, says the rest of the page is still
 * right, and offers to read again. The reason is the section's own safe
 * sentence ("Cash flow could not be read."), never a database error.
 */
export function Unavailable({ reason }: { reason: string }) {
  return (
    <div className={`${styles.state} ${styles.stateFailed}`} role="alert">
      <span className={styles.stateTitle}>
        <ExclamationCircleFilled className={styles.stateIcon} aria-hidden="true" />
        {reason}
      </span>
      <span>The other figures on this page are still current.</span>
      <RetryButton />
    </div>
  );
}

/** A card with nothing to show yet: what will appear here, and the one thing to do next. */
export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={styles.state}>
      <span className={styles.stateTitle}>{title}</span>
      {children ? <span>{children}</span> : null}
      {action}
    </div>
  );
}

/**
 * A change in money with its direction as an arrow and in words, so colour is
 * never the only sign of it. `good` says which way is good news: up for cash
 * and income, down for spending.
 */
export function Delta({ minor, money, good = "up" }: { minor: number; money: (minor: number) => string; good?: "up" | "down" }) {
  if (minor === 0) return <span className={styles.delta}>No change</span>;
  const up = minor > 0;
  const tone = up === (good === "up") ? styles.up : styles.down;
  return (
    <span className={`${styles.delta} ${tone}`}>
      {up ? <ArrowUpOutlined aria-hidden="true" /> : <ArrowDownOutlined aria-hidden="true" />}
      <span className="accounting-sr-only">{up ? "Up " : "Down "}</span>
      {money(Math.abs(minor))}
    </span>
  );
}

/** The same for a percentage: "↑15.2%". */
export function PercentDelta({ percent, good = "up" }: { percent: number; good?: "up" | "down" }) {
  const rounded = Math.round(percent * 10) / 10;
  if (rounded === 0) return <span className={styles.delta}>No change</span>;
  const up = rounded > 0;
  const tone = up === (good === "up") ? styles.up : styles.down;
  return (
    <span className={`${styles.delta} ${tone}`}>
      {up ? <ArrowUpOutlined aria-hidden="true" /> : <ArrowDownOutlined aria-hidden="true" />}
      <span className="accounting-sr-only">{up ? "Up " : "Down "}</span>
      {Math.abs(rounded).toFixed(1)}%
    </span>
  );
}

/** The period a card shows, chosen in its head. Changing it reads nothing: every period is already here. */
export function PeriodSelect({
  value,
  onChange,
  label,
}: {
  value: HomePeriodKey;
  onChange: (next: HomePeriodKey) => void;
  label: string;
}) {
  return (
    <Select
      size="small"
      className={styles.period}
      value={value}
      onChange={onChange}
      options={PERIOD_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
      aria-label={label}
      popupMatchSelectWidth={false}
    />
  );
}

/** A colour key: a small square, or a short line for a balance, in a `var(--ob-…)` colour. */
export function Swatch({ color, line = false, dashed = false, empty = false }: { color?: string; line?: boolean; dashed?: boolean; empty?: boolean }) {
  if (line) {
    return (
      <span
        aria-hidden="true"
        className={`${styles.swatchLine} ${dashed ? styles.swatchDash : ""}`}
        style={color ? { borderTopColor: color } : undefined}
      />
    );
  }
  return <span aria-hidden="true" className={`${styles.swatch} ${empty ? styles.swatchEmpty : ""}`} style={color ? { background: color } : undefined} />;
}
