"use client";
import { sourceLabel } from "@/lib/domain/entry-detail";
import { useEffect, useMemo, useState } from "react";
import { useInitiallyOpen } from "@/lib/client/use-initially-open";
import StatusTag from "@/components/ui/StatusTag";
import { Alert, App, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Tag, Tooltip } from "antd";
import { DeleteOutlined, PaperClipOutlined, PlusOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { toMinor } from "@/lib/domain/money";
import { journalEntryAmountMinor } from "@/lib/domain/journal-entry-amount";
import { COLUMN } from "@/lib/design/table-metrics";
import DataTable from "@/components/ui/DataTable";
import { flexColumn } from "@/components/ui/columns";
import { formatMoney, formatDate, plural } from "@/lib/format";
import IconActionButton from "@/components/ui/IconActionButton";
import RowActionsMenu from "@/components/ui/RowActionsMenu";
import { MAKE_RECURRING, useMakeRecurring } from "@/components/recurring/useMakeRecurring";
import FilterBar from "@/components/ui/FilterBar";
import dynamic from "next/dynamic";
import type { AttachmentTarget } from "@/components/documents/AttachmentDrawer";
import { createJournalAction, reverseEntryAction, listJournalAction } from "./actions";
import type { JournalEntrySummary, JournalList } from "@/lib/services/journal";
import AdjustingEntryControl from "./AdjustingEntryControl";
import type { ClosedPeriodAsk } from "@/lib/domain/adjusting-entries";

interface Account {
  id: string;
  account_code: string;
  name: string;
}
interface Props {
  canWrite: boolean;
  /** Holds `journal.void`, which reversing an entry needs; the RPC checks it again. */
  canReverse: boolean;
  accounts: Account[];
  baseCurrency: string;
  baseDecimals: number;
  /** Seeded by the top-bar New menu via `?new=1`. */
  initialCreateOpen: boolean;
  /** Opens one journal from an operational report via `?entry=<uuid>`. */
  initialEntryId?: string;
  /** The list the page read for the first paint; null when it did not (2.92). */
  initialJournal: JournalList | null;
  canReadDocuments: boolean;
  canManageDocuments: boolean;
  canGovernDocuments: boolean;
  /** May tick "Adjusting entry": the `journal.post` permission. */
  canMarkAdjusting: boolean;
}
interface LineForm {
  account_id?: string;
  debit?: number;
  credit?: number;
}

/** Loaded on demand — see tests/unit/attachment-drawer-lazy.test.ts. */
const AttachmentDrawer = dynamic(() => import("@/components/documents/AttachmentDrawer"), {
  ssr: false,
});

/** Wide enough for "Opening balance", the longest source, on one line. */
const SOURCE_WIDTH = 132;
/** The paperclip, Reverse and the ⋯ menu side by side. */
const JOURNAL_ACTIONS_WIDTH = 140;

/**
 * Number, Date, Source, Amount, Status, actions. Description takes what is
 * left, at least COLUMN.TEXT_MIN. With the expand button's 48px the row is
 * 982px at its floor, inside the 984px box at 1280.
 */
export const JOURNAL_FIXED_WIDTHS = [
  COLUMN.CODE,
  COLUMN.DATE,
  SOURCE_WIDTH,
  COLUMN.MONEY_WIDE,
  COLUMN.STATUS,
  JOURNAL_ACTIONS_WIDTH,
] as const;

/** An opened entry's lines: Debit and Credit. Account and Memo take what is left. */
export const JOURNAL_LINES_FIXED_WIDTHS = [COLUMN.MONEY, COLUMN.MONEY] as const;

export default function JournalClient({
  canWrite,
  canReverse,
  accounts,
  baseCurrency,
  baseDecimals,
  initialCreateOpen,
  initialEntryId,
  initialJournal,
  canReadDocuments,
  canManageDocuments,
  canGovernDocuments,
  canMarkAdjusting,
}: Props) {
  const { message, modal } = App.useApp();
  const { makeRecurring, pendingId: recurringId } = useMakeRecurring();
  const [entries, setEntries] = useState<JournalEntrySummary[]>(initialJournal?.entries ?? []);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useInitiallyOpen(initialCreateOpen);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const [lines, setLines] = useState<LineForm[]>([{}, {}]);
  const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>(
    initialEntryId ? [initialEntryId] : [],
  );
  const [attachmentTarget, setAttachmentTarget] = useState<AttachmentTarget | null>(null);
  /** The prototype's closed-period question, waiting for an answer. */
  const [closedAsk, setClosedAsk] = useState<{ ask: ClosedPeriodAsk; retry: () => Promise<void> } | null>(null);
  /** Asked once, then remembered for the rest of the visit. */
  const [unlocked, setUnlocked] = useState(false);
  const setAdjusting = (id: string, mark: JournalEntrySummary["adjusting"]) =>
    setEntries((list) => list.map((e) => (e.id === id ? { ...e, adjusting: mark } : e)));

  /**
   * How many entries match the dates on screen, and how many were read.
   *
   * A journal that quietly shows its newest thousand looks exactly like one
   * that is showing everything. This company had 7,532 entries and could reach
   * 1,000 of them; the ones it could not reach were the opening balances, which
   * is precisely what somebody goes looking for.
   */
  const [total, setTotal] = useState(initialJournal?.total ?? 0);
  const [limit, setLimit] = useState(initialJournal?.limit ?? 0);
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
    // The page read the list for the first paint; read here only when it could not.
    if (initialJournal) return;
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
    // The reversal posts on a date of its own; the entry's date is where an
    // entry that should never have been posted is taken back.
    let reversalDate: Dayjs | null = dayjs(entry.entryDate);
    modal.confirm({
      title: `Reverse ${entry.entryNumber}?`,
      content: (
        <Space direction="vertical" style={{ width: "100%" }}>
          <Input
            placeholder="Reason for reversal"
            onChange={(e) => {
              reason = e.target.value;
            }}
          />
          <div>
            <div style={{ marginBottom: 4 }}>Reversal date</div>
            <DatePicker
              defaultValue={reversalDate}
              allowClear={false}
              style={{ width: "100%" }}
              onChange={(value) => {
                reversalDate = value;
              }}
            />
          </div>
        </Space>
      ),
      okText: "Reverse",
      okButtonProps: { danger: true },
      onOk: async () => {
        if (!reversalDate) {
          message.error("Choose the date the reversal posts on");
          throw new Error("Choose the date the reversal posts on");
        }
        const r = await reverseEntryAction({ entry_id: entry.id, reason, reversal_date: reversalDate.format("YYYY-MM-DD") });
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

  const fmt = (m: number) => (m ? formatMoney(m, baseCurrency, baseDecimals) : "");

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      <FilterBar
        ariaLabel="Journal dates and actions"
        resultCount={entries.length}
        actions={
          canWrite ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
              New journal entry
            </Button>
          ) : undefined
        }
      >
        <DatePicker.RangePicker
          aria-label="Entry date range"
          value={range}
          onChange={(value) => {
            const next = value && value[0] && value[1] ? ([value[0], value[1]] as [Dayjs, Dayjs]) : null;
            setRange(next);
            void load(next);
          }}
        />
      </FilterBar>
      {total > entries.length && (
        <Alert
          type="warning"
          showIcon
          message={`Showing the ${entries.length.toLocaleString("en-US")} most recent of ${plural(total, "entry", "entries")}`}
          description={
            "One read carries at most " +
            plural(limit, "entry", "entries") +
            ". Narrow the dates above to reach the rest — an entry outside this list cannot be found by scrolling, however far you page."
          }
        />
      )}
      {closedAsk ? (
        <Alert
          type="warning"
          showIcon
          title={
            <span>
              <strong>{formatDate(closedAsk.ask.entryDate)} is in a closed period.</strong> The books are closed through{" "}
              {formatDate(closedAsk.ask.closedThrough)}. Changing that entry will alter a period somebody has already
              signed off.
            </span>
          }
          action={
            <Space wrap>
              <Button
                size="small"
                danger
                onClick={async () => {
                  const pending = closedAsk;
                  setUnlocked(true);
                  setClosedAsk(null);
                  await pending.retry();
                }}
              >
                Unlock and change it
              </Button>
              <Button size="small" onClick={() => setClosedAsk(null)}>
                Leave it alone
              </Button>
            </Space>
          }
        />
      ) : unlocked ? (
        <Alert
          type="info"
          showIcon
          title="Closed periods are unlocked for this visit"
          description="Adjusting marks on entries in a closed period can be changed until you leave this page. Each change is recorded in the audit log with the period marked closed."
        />
      ) : null}
      <DataTable<JournalEntrySummary>
        rowKey="id"
        loading={loading}
        rows={entries}
        expandable={{
          expandedRowKeys,
          onExpandedRowsChange: (keys) => setExpandedRowKeys([...keys].map(String)),
          expandedRowRender: (e) => (
            <div>
              <DataTable<JournalEntrySummary["lines"][number]>
                rowKey={(_, i) => String(i)}
                pagination={false}
                rows={e.lines}
                columns={[
                  flexColumn<JournalEntrySummary["lines"][number]>({
                    title: "Account",
                    key: "account",
                    render: (_, l) => `${l.accountCode} ${l.accountName}`,
                  }),
                  flexColumn<JournalEntrySummary["lines"][number]>({ title: "Memo", dataIndex: "memo" }),
                  { title: "Debit", key: "debit", width: JOURNAL_LINES_FIXED_WIDTHS[0], align: "right", render: (_, l) => fmt(l.debitMinor) },
                  { title: "Credit", key: "credit", width: JOURNAL_LINES_FIXED_WIDTHS[1], align: "right", render: (_, l) => fmt(l.creditMinor) },
                ]}
              />
              <AdjustingEntryControl
                key={`${e.id}:${e.adjusting ? "on" : "off"}`}
                entry={e}
                canEdit={canMarkAdjusting && e.status === "posted"}
                unlocked={unlocked}
                onChange={(mark) => setAdjusting(e.id, mark)}
                onClosedPeriod={(ask, retry) => setClosedAsk({ ask, retry })}
              />
            </div>
          ),
        }}
        columns={[
          { title: "Number", dataIndex: "entryNumber", width: JOURNAL_FIXED_WIDTHS[0] },
          { title: "Date", dataIndex: "entryDate", width: JOURNAL_FIXED_WIDTHS[1], render: (v: string) => formatDate(v) },
          { title: "Source", dataIndex: "sourceType", width: JOURNAL_FIXED_WIDTHS[2], render: (source: string) => <Tag>{sourceLabel(source)}</Tag> },
          flexColumn<JournalEntrySummary>({
            title: "Description",
            dataIndex: "description",
            // An import writes the whole file name in here, and it was setting
            // the width of the table on its own — pushing Status and the
            // actions off the right-hand edge, where the Reverse button could
            // not be reached without scrolling sideways.
            //
            // flexColumn turns off the browser's own tooltip, which is slow and
            // renders a long line without wrapping; the Ant Design one opens at
            // once and wraps.
            render: (description: string | null) =>
              description ? (
                <Tooltip title={description} placement="topLeft" styles={{ root: { maxWidth: 640 } }}>
                  <span>{description}</span>
                </Tooltip>
              ) : (
                ""
              ),
          }),
          {
            // An entry listed with no amount said nothing of its size until it
            // was opened (UI review, 2026-10-20).
            title: "Amount",
            key: "amount",
            width: JOURNAL_FIXED_WIDTHS[3],
            align: "right",
            render: (_, e) => formatMoney(journalEntryAmountMinor(e.lines), baseCurrency, baseDecimals),
          },
          {
            title: "Status",
            width: JOURNAL_FIXED_WIDTHS[4],
            render: (_, e) => (
              <Space size={4} wrap>
                <StatusTag status={e.isReversed ? "reversed" : e.status} />
                {e.adjusting ? <Tag color="purple">Adjusting</Tag> : null}
              </Space>
            ),
          },
          {
            title: "",
            key: "actions",
            width: JOURNAL_FIXED_WIDTHS[5],
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
                {canReverse &&
                e.status === "posted" &&
                !e.isReversed &&
                !e.isReversal &&
                e.sourceType === "manual" ? (
                  <Button size="small" onClick={() => reverse(e)}>
                    Reverse
                  </Button>
                ) : null}
                {/* An entry written by hand can be made to recur; a document's entry recurs through its document. */}
                {canWrite && e.status === "posted" && !e.isReversal && e.sourceType === "manual" ? (
                  <RowActionsMenu
                    label={`Actions for ${e.entryNumber}`}
                    items={[
                      {
                        key: "recurring",
                        label: MAKE_RECURRING,
                        disabled: recurringId === e.id,
                        onClick: () => void makeRecurring("journal", e.id),
                      },
                    ]}
                  />
                ) : null}
              </Space>
            ),
          },
        ]}
      />
      {/* Fetched when a paperclip is clicked. The drawer already did nothing
          until it had a target — every effect inside returns early on a null
          one — so this changes when it downloads, not what it does. */}
      {attachmentTarget ? (
        <AttachmentDrawer
          target={attachmentTarget}
          canManage={canManageDocuments}
          canGovern={canGovernDocuments}
          onClose={() => setAttachmentTarget(null)}
        />
      ) : null}
      <Modal
        open={open}
        title="New journal entry"
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
