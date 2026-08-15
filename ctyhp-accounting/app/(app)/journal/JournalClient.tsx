"use client";
import { useEffect, useMemo, useState } from "react";
import { Alert, App, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Table, Tag } from "antd";
import { DeleteOutlined, PaperClipOutlined, PlusOutlined } from "@ant-design/icons";
import type { Dayjs } from "dayjs";
import { fromMinor, toMinor } from "@/lib/domain/money";
import IconActionButton from "@/components/ui/IconActionButton";
import AttachmentDrawer, {
  type AttachmentTarget,
} from "@/components/documents/AttachmentDrawer";
import { createJournalAction, reverseEntryAction, listJournalAction } from "./actions";
import type { JournalEntrySummary } from "@/lib/services/journal";

interface Account {
  id: string;
  account_code: string;
  name: string;
}
interface Props {
  canWrite: boolean;
  accounts: Account[];
  baseCurrency: string;
  baseDecimals: number;
  /** Seeded by the top-bar New menu via `?new=1`. */
  initialCreateOpen: boolean;
  /** Opens one journal from an operational report via `?entry=<uuid>`. */
  initialEntryId?: string;
  canReadDocuments: boolean;
  canManageDocuments: boolean;
  canGovernDocuments: boolean;
  scannerConfigured: boolean;
}
interface LineForm {
  account_id?: string;
  debit?: number;
  credit?: number;
}

export default function JournalClient({
  canWrite,
  accounts,
  baseCurrency,
  baseDecimals,
  initialCreateOpen,
  initialEntryId,
  canReadDocuments,
  canManageDocuments,
  canGovernDocuments,
  scannerConfigured,
}: Props) {
  const { message, modal } = App.useApp();
  const [entries, setEntries] = useState<JournalEntrySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(initialCreateOpen);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const [lines, setLines] = useState<LineForm[]>([{}, {}]);
  const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>(
    initialEntryId ? [initialEntryId] : [],
  );
  const [attachmentTarget, setAttachmentTarget] = useState<AttachmentTarget | null>(null);

  /**
   * How many entries match the dates on screen, and how many were read.
   *
   * A journal that quietly shows its newest thousand looks exactly like one
   * that is showing everything. This company had 7,532 entries and could reach
   * 1,000 of them; the ones it could not reach were the opening balances, which
   * is precisely what somebody goes looking for.
   */
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(0);
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);

  const load = async (dates: [Dayjs, Dayjs] | null = range) => {
    setLoading(true);
    const r = await listJournalAction({
      entryId: initialEntryId ?? null,
      from: dates ? dates[0].format("YYYY-MM-DD") : null,
      to: dates ? dates[1].format("YYYY-MM-DD") : null,
    });
    setLoading(false);
    if (r.ok && r.data) {
      setEntries(r.data.entries);
      setTotal(r.data.total);
      setLimit(r.data.limit);
    } else message.error(r.error ?? "Failed to load journal entries");
  };
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals = useMemo(() => {
    const d = lines.reduce((s, l) => s + toMinor(l.debit ?? 0, baseDecimals), 0);
    const c = lines.reduce((s, l) => s + toMinor(l.credit ?? 0, baseDecimals), 0);
    return { d, c, diff: d - c };
  }, [lines, baseDecimals]);

  const resetForm = () => {
    setLines([{}, {}]);
    form.resetFields();
  };

  const submit = async () => {
    const header = await form.validateFields();
    const payload = {
      entry_date: header.entry_date?.format("YYYY-MM-DD"),
      description: header.description ?? null,
      source_ref: header.source_ref ?? null,
      currency_code: baseCurrency,
      lines: lines
        .filter((l) => l.account_id && ((l.debit ?? 0) > 0 || (l.credit ?? 0) > 0))
        .map((l) => ({
          account_id: l.account_id!,
          debit_minor: toMinor(l.debit ?? 0, baseDecimals),
          credit_minor: toMinor(l.credit ?? 0, baseDecimals),
        })),
    };
    setSaving(true);
    const r = await createJournalAction(payload);
    setSaving(false);
    if (r.ok) {
      message.success(
        r.data?.submittedForApproval
          ? "Journal entry submitted for approval"
          : "Journal entry posted",
      );
      setOpen(false);
      resetForm();
      if (!r.data?.submittedForApproval) void load();
    } else {
      message.error(r.error ?? "Failed to post journal entry");
    }
  };

  const reverse = (entry: JournalEntrySummary) => {
    let reason = "";
    modal.confirm({
      title: `Reverse ${entry.entryNumber}?`,
      content: (
        <Input
          placeholder="Reason for reversal"
          onChange={(e) => {
            reason = e.target.value;
          }}
        />
      ),
      okText: "Reverse",
      okButtonProps: { danger: true },
      onOk: async () => {
        const r = await reverseEntryAction({ entry_id: entry.id, reason });
        if (r.ok) {
          message.success("Reversal posted");
          void load();
        } else {
          message.error(r.error ?? "Failed to reverse entry");
          throw new Error(r.error ?? "Failed to reverse entry");
        }
      },
    });
  };

  const fmt = (m: number) =>
    m ? fromMinor(m, baseDecimals).toLocaleString(undefined, { minimumFractionDigits: baseDecimals }) : "";

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      <Space wrap>
        {canWrite && (
          <Button type="primary" onClick={() => setOpen(true)}>
            New Journal Entry
          </Button>
        )}
        <DatePicker.RangePicker
          aria-label="Entry date range"
          value={range}
          onChange={(value) => {
            const next = value && value[0] && value[1] ? ([value[0], value[1]] as [Dayjs, Dayjs]) : null;
            setRange(next);
            void load(next);
          }}
        />
      </Space>
      {total > entries.length && (
        <Alert
          type="warning"
          showIcon
          message={`Showing the ${entries.length.toLocaleString("en-US")} most recent of ${total.toLocaleString("en-US")} entries`}
          description={
            "One read carries at most " +
            limit.toLocaleString("en-US") +
            " entries. Narrow the dates above to reach the rest — an entry outside this list cannot be found by scrolling, however far you page."
          }
        />
      )}
      <Table<JournalEntrySummary>
        rowKey="id"
        loading={loading}
        dataSource={entries}
        scroll={{ x: "max-content" }}
        expandable={{
          expandedRowKeys,
          onExpandedRowsChange: (keys) => setExpandedRowKeys([...keys].map(String)),
          expandedRowRender: (e) => (
            <Table
              size="small"
              rowKey={(_, i) => String(i)}
              pagination={false}
              dataSource={e.lines}
              columns={[
                { title: "Account", render: (_, l) => `${l.accountCode} ${l.accountName}` },
                { title: "Memo", dataIndex: "memo" },
                { title: "Debit", align: "right", render: (_, l) => fmt(l.debitMinor) },
                { title: "Credit", align: "right", render: (_, l) => fmt(l.creditMinor) },
              ]}
            />
          ),
        }}
        columns={[
          { title: "Number", dataIndex: "entryNumber" },
          { title: "Date", dataIndex: "entryDate" },
          { title: "Source", dataIndex: "sourceType", render: (s: string) => <Tag>{s}</Tag> },
          { title: "Description", dataIndex: "description" },
          {
            title: "Status",
            render: (_, e) => (e.isReversed ? <Tag color="orange">reversed</Tag> : <Tag color="green">{e.status}</Tag>),
          },
          {
            title: "",
            key: "actions",
            render: (_, e) => (
              <Space size={4}>
                {canReadDocuments ? (
                  <IconActionButton
                    label="View journal entry attachments"
                    icon={<PaperClipOutlined />}
                    onClick={() =>
                      setAttachmentTarget({
                        entityType: "journal_entry",
                        entityId: e.id,
                        label: `${e.entryNumber} · ${e.description ?? "Journal entry"}`,
                      })
                    }
                  />
                ) : null}
                {canWrite &&
                e.status === "posted" &&
                !e.isReversed &&
                !e.isReversal &&
                e.sourceType === "manual" ? (
                  <Button size="small" onClick={() => reverse(e)}>
                    Reverse
                  </Button>
                ) : null}
              </Space>
            ),
          },
        ]}
      />
      <AttachmentDrawer
        target={attachmentTarget}
        canManage={canManageDocuments}
        canGovern={canGovernDocuments}
        scannerConfigured={scannerConfigured}
        onClose={() => setAttachmentTarget(null)}
      />
      <Modal
        open={open}
        title="New Journal Entry"
        onCancel={() => setOpen(false)}
        onOk={submit}
        confirmLoading={saving}
        okButtonProps={{ disabled: totals.diff !== 0 || totals.d === 0 }}
        width={760}
      >
        <Form form={form} layout="vertical">
          <Space>
            <Form.Item name="entry_date" label="Date">
              <DatePicker />
            </Form.Item>
            <Form.Item name="source_ref" label="Source reference">
              <Input placeholder="Optional" />
            </Form.Item>
          </Space>
          <Form.Item name="description" label="Description">
            <Input />
          </Form.Item>
        </Form>
        <Card size="small" title={`Lines (${baseCurrency})`}>
          {lines.map((l, i) => (
            <Space key={i} style={{ display: "flex", marginBottom: 8 }}>
              <Select
                showSearch
                style={{ width: 280 }}
                placeholder="Account"
                optionFilterProp="label"
                value={l.account_id}
                options={accounts.map((a) => ({ value: a.id, label: `${a.account_code} ${a.name}` }))}
                onChange={(v) => setLines((p) => p.map((x, j) => (j === i ? { ...x, account_id: v } : x)))}
              />
              <InputNumber
                placeholder="Debit"
                min={0}
                precision={baseDecimals}
                value={l.debit}
                onChange={(v) =>
                  setLines((p) => p.map((x, j) => (j === i ? { ...x, debit: v ?? undefined, credit: undefined } : x)))
                }
              />
              <InputNumber
                placeholder="Credit"
                min={0}
                precision={baseDecimals}
                value={l.credit}
                onChange={(v) =>
                  setLines((p) => p.map((x, j) => (j === i ? { ...x, credit: v ?? undefined, debit: undefined } : x)))
                }
              />
              <IconActionButton
                label="Remove journal line"
                danger
                icon={<DeleteOutlined />}
                onClick={() => setLines((p) => p.filter((_, j) => j !== i))}
                disabled={lines.length <= 2}
              />
            </Space>
          ))}
          <Button icon={<PlusOutlined />} onClick={() => setLines((p) => [...p, {}])}>
            Add line
          </Button>
          <div style={{ marginTop: 12 }}>
            Debit: {fmt(totals.d)} &nbsp; Credit: {fmt(totals.c)} &nbsp;
            <Tag color={totals.diff === 0 ? "green" : "red"}>Difference: {fmt(Math.abs(totals.diff))}</Tag>
          </div>
        </Card>
      </Modal>
    </Space>
  );
}
