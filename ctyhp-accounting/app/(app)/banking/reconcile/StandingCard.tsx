"use client";
import type { ReactNode } from "react";
import { Card, Space } from "antd";
import { ToneBadge } from "@/lib/design/tone";
import { reconcileCard, reconcileEmptyText, type BankStanding, type Money } from "@/lib/domain/bank-standing";

interface Props {
  accountName: string;
  /** Null when the read failed or has no row; the card then draws only as the empty state. */
  standing: BankStanding | null;
  /** The company's today: the age of the last agreed statement is measured to it. */
  today: string;
  money: Money;
  /** The account has no reconciliations: the card is the empty state and carries its buttons. */
  empty?: boolean;
  /** The empty state's buttons, already limited to who may write. */
  children?: ReactNode;
}

/**
 * Where the chosen bank account stands against its statements, above the
 * reconciliations table. Drawn as the Balance Sheet's panel draws a line: the
 * tone's icon and colour around the sentence, which always states the
 * condition. With no reconciliations it replaces the table's bare "No data".
 */
export default function StandingCard({ accountName, standing, today, money, empty = false, children }: Props) {
  if (empty) {
    const text = reconcileEmptyText(accountName, standing, money);
    const card = standing ? reconcileCard(accountName, standing, today, money) : null;
    return (
      <Card size="small" aria-label="Reconciliation standing">
        <Space orientation="vertical" size="middle">
          {card ? <ToneBadge tone={card.tone}>{text}</ToneBadge> : <span>{text}</span>}
          {card?.noLongerAgrees ? <ToneBadge tone="danger">{card.noLongerAgrees}</ToneBadge> : null}
          {children ? <Space wrap>{children}</Space> : null}
        </Space>
      </Card>
    );
  }
  if (!standing) return null;
  const card = reconcileCard(accountName, standing, today, money);
  return (
    <Card size="small" aria-label="Reconciliation standing">
      <Space orientation="vertical" size={4}>
        <ToneBadge tone={card.tone}>{card.text}</ToneBadge>
        {card.noLongerAgrees ? <ToneBadge tone="danger">{card.noLongerAgrees}</ToneBadge> : null}
      </Space>
    </Card>
  );
}
