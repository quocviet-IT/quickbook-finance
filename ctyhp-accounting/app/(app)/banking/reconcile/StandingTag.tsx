"use client";
import { Space, Tag, Typography } from "antd";
import { EXTRA_LINE_NOTE, EXTRA_LINE_TAG } from "@/lib/domain/add-missing";
import { NOT_A_TRANSACTION, pairedHowLabel, type Standing } from "@/lib/domain/reconcile-statement";

/**
 * How one statement line stands with the books — on a reconciliation, and in a
 * run's preview. `extra` marks a line the books do not have that Add missing
 * lines holds back, because the statement already balances without it.
 */
export default function StandingTag({ standing, extra = false }: { standing: Standing; extra?: boolean }) {
  if (standing.kind === "aside") return <Tag>{NOT_A_TRANSACTION}</Tag>;
  if (standing.kind === "after") return <Tag>After the statement date</Tag>;
  if (standing.kind === "missing") {
    return (
      <Space size={4} wrap>
        <Tag color="orange">Not in the books</Tag>
        {extra ? (
          <Tag color="volcano" title={EXTRA_LINE_NOTE}>
            {EXTRA_LINE_TAG}
          </Tag>
        ) : null}
      </Space>
    );
  }
  return (
    <Space size={4} direction="vertical">
      <Tag color={standing.ticked ? "green" : "gold"}>
        Paired · {pairedHowLabel(standing.how)}
        {standing.ticked ? "" : " · not ticked"}
      </Tag>
      {standing.entryNumber ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          with {standing.entryNumber}
        </Typography.Text>
      ) : null}
    </Space>
  );
}
