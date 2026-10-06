"use client";
import { Space, Tag, Typography } from "antd";
import { pairedHowLabel, type Standing } from "@/lib/domain/reconcile-statement";

/** How one statement line stands with the books — on a reconciliation, and in a run's preview. */
export default function StandingTag({ standing }: { standing: Standing }) {
  if (standing.kind === "after") return <Tag>After the statement date</Tag>;
  if (standing.kind === "missing") return <Tag color="orange">Not in the books</Tag>;
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
