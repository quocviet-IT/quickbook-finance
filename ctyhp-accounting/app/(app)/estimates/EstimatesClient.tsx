"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Dropdown, Input, type MenuProps, type TableColumnsType } from "antd";
import { MoreOutlined, PlusOutlined } from "@ant-design/icons";
import DataTable from "@/components/ui/DataTable";
import FilterBar from "@/components/ui/FilterBar";
import { dateColumn, flexColumn, statusColumn } from "@/components/ui/columns";
import { useInitiallyOpen } from "@/lib/client/use-initially-open";
import { downloadEstimatePdf } from "@/lib/client/invoice-pdf";
import type { AccountRow, CustomerRow, ItemRow, TaxCodeRow } from "@/lib/db/types";
import { USD_DECIMAL_PLACES } from "@/lib/domain/currency";
import { matchesDocumentKeyword } from "@/lib/domain/document-filter";
import {
  ESTIMATE_FILTERS,
  countEstimatesByFilter,
  estimateActions,
  estimateConversionHref,
  estimateInFilter,
  estimateMessages,
  type EstimateFilter,
} from "@/lib/domain/estimates";
import { formatDate, formatMoney } from "@/lib/format";
import {
  declineEstimateAction,
  deleteEstimateAction,
  getEstimateDetailAction,
  getEstimateDocumentAction,
  reopenEstimateAction,
  type EstimateDetailView,
  type EstimateListEntry,
} from "./actions";
import EstimateFormModal, { type ConversionTarget } from "./EstimateFormModal";
import { ESTIMATE_COLUMN_WIDTH, ESTIMATE_ELASTIC_FLOOR, ESTIMATE_STATE_TONES } from "./estimate-columns";
import styles from "./estimates.module.css";

export default function EstimatesClient({
  initialCreateOpen,
  estimates,
  today,
  customers,
  incomeAccounts,
  taxCodes,
  usStates,
  items,
  canWrite,
  canManageItems,
}: {
  /** Seeded by the top-bar New menu via `?new=1`. */
  initialCreateOpen: boolean;
  /** Every estimate, each with its state on the company's today. */
  estimates: EstimateListEntry[];
  /** The company's today, in its own time zone: the day every state was worked out for. */
  today: string;
  customers: CustomerRow[];
  incomeAccounts: AccountRow[];
  taxCodes: TaxCodeRow[];
  usStates: { code: string; name: string }[];
  /** Sold, active catalog entries. */
  items: ItemRow[];
  canWrite: boolean;
  /** Holds `items.manage`, so the empty-catalog hint can link to the catalog. */
  canManageItems: boolean;
}) {
  const { message, modal } = App.useApp();
  const router = useRouter();
  const [createOpen, setCreateOpen] = useInitiallyOpen(initialCreateOpen);
  const [editing, setEditing] = useState<EstimateDetailView | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pdfId, setPdfId] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [filter, setFilter] = useState<EstimateFilter>("all");

  // The pills count what the search leaves, so a pill never promises rows the
  // list then hides.
  const searched = useMemo(
    () => estimates.filter((e) => matchesDocumentKeyword([e.estimate_number, e.customer_name], keyword)),
    [estimates, keyword],
  );
  const counts = useMemo(() => countEstimatesByFilter(searched.map((e) => e.state)), [searched]);
  const rows = useMemo(() => searched.filter((e) => estimateInFilter(e.state, filter)), [searched, filter]);
  const narrowed = keyword.trim() !== "" || filter !== "all";

  function openNew() {
    setEditing(null);
    setCreateOpen(true);
  }

  function closeForm() {
    setCreateOpen(false);
    setEditing(null);
  }

  /** Edit, or view one that can no longer change. Reads its lines first. */
  async function openEstimate(row: EstimateListEntry) {
    setBusyId(row.id);
    const res = await getEstimateDetailAction(row.id);
    setBusyId(null);
    if (!res.ok || !res.data) {
      message.error(res.error ?? "Failed to open the estimate");
      return;
    }
    setCreateOpen(false);
    setEditing(res.data);
  }

  /** To the Invoices screen, which opens New invoice filled in. An expired price is asked about first. */
  function turnIntoInvoice(target: ConversionTarget) {
    const go = () => {
      closeForm();
      router.push(estimateConversionHref(target.id));
    };
    if (!target.expired) {
      go();
      return;
    }
    modal.confirm({
      title: estimateMessages.expiredConfirm(target.estimate_number, formatDate(target.expiry_date)),
      okText: "Turn into an invoice",
      cancelText: "Cancel",
      onOk: go,
    });
  }

  /** No confirmation either way: both are undone by the other. */
  async function setDeclined(row: EstimateListEntry, declined: boolean) {
    setBusyId(row.id);
    const res = declined ? await declineEstimateAction(row.id) : await reopenEstimateAction(row.id);
    setBusyId(null);
    if (res.ok && res.data) {
      const n = res.data.estimate_number;
      message.success(declined ? estimateMessages.declined(n) : estimateMessages.reopened(n));
    } else {
      message.error(res.error ?? (declined ? "Failed to mark the estimate declined" : "Failed to reopen the estimate"));
    }
  }

  function confirmDelete(row: EstimateListEntry) {
    modal.confirm({
      title: estimateMessages.deleteConfirm(row.estimate_number),
      okText: "Delete",
      okButtonProps: { danger: true },
      cancelText: "Cancel",
      onOk: async () => {
        const res = await deleteEstimateAction(row.id);
        // A refusal is the database's own words: mark it declined instead.
        if (res.ok) message.success(`${row.estimate_number} deleted.`);
        else message.error(res.error ?? "Failed to delete the estimate");
      },
    });
  }

  async function downloadPdf(row: EstimateListEntry) {
    setPdfId(row.id);
    try {
      const res = await getEstimateDocumentAction(row.id);
      if (!res.ok || !res.data) {
        message.error(res.error ?? "Failed to build the estimate PDF");
        return;
      }
      await downloadEstimatePdf(res.data);
    } finally {
      setPdfId(null);
    }
  }

  const W = ESTIMATE_COLUMN_WIDTH;
  const columns: TableColumnsType<EstimateListEntry> = [
    {
      title: "Number",
      dataIndex: "estimate_number",
      width: W.number,
      render: (n: string, row) => (
        <Button type="link" size="small" className={styles.number} onClick={() => openEstimate(row)}>
          {n}
        </Button>
      ),
    },
    dateColumn<EstimateListEntry>({ title: "Date", dataIndex: "estimate_date", width: W.date }),
    flexColumn<EstimateListEntry>({ title: "Customer", dataIndex: "customer_name", floor: ESTIMATE_ELASTIC_FLOOR }),
    dateColumn<EstimateListEntry>({ title: "Valid until", dataIndex: "expiry_date", width: W.validUntil }),
    {
      title: "Total",
      dataIndex: "total_minor",
      width: W.total,
      align: "right",
      render: (minor: number, row) => (
        <span className={styles.money}>{formatMoney(minor, row.currency_code, USD_DECIMAL_PLACES)}</span>
      ),
    },
    statusColumn<EstimateListEntry>({ title: "State", dataIndex: "state", tones: ESTIMATE_STATE_TONES, width: W.state }),
    {
      // The invoice made from it that is not void: its number once issued.
      title: "Invoice",
      key: "invoice",
      width: W.invoice,
      render: (_: unknown, row) => (row.live_invoice ? (row.live_invoice.invoice_number ?? "Draft") : "—"),
    },
    {
      title: "",
      key: "actions",
      width: W.actions,
      align: "right",
      render: (_: unknown, row) => {
        const can = estimateActions(row.state, canWrite);
        const menu: MenuProps["items"] = [
          { key: "open", label: can.edit ? "Edit" : "View", onClick: () => void openEstimate(row) },
        ];
        if (can.convert) {
          menu.push({
            key: "convert",
            label: "Turn into an invoice",
            onClick: () =>
              turnIntoInvoice({
                id: row.id,
                estimate_number: row.estimate_number,
                expiry_date: row.expiry_date,
                expired: can.confirmConvert,
              }),
          });
        }
        if (can.decline) {
          menu.push({ key: "decline", label: "Mark declined", onClick: () => void setDeclined(row, true) });
        }
        if (can.reopen) {
          menu.push({ key: "reopen", label: "Reopen", onClick: () => void setDeclined(row, false) });
        }
        if (can.pdf) {
          menu.push({
            key: "pdf",
            label: pdfId === row.id ? "Preparing PDF…" : "Download PDF",
            disabled: pdfId === row.id,
            onClick: () => void downloadPdf(row),
          });
        }
        if (can.delete) {
          menu.push({ type: "divider", key: "before-delete" });
          menu.push({ key: "delete", label: "Delete", danger: true, onClick: () => confirmDelete(row) });
        }
        return (
          <Dropdown menu={{ items: menu, style: { minWidth: 176 } }} trigger={["click"]}>
            <Button
              size="small"
              icon={<MoreOutlined />}
              loading={busyId === row.id}
              aria-label={`Actions for ${row.estimate_number}`}
            />
          </Dropdown>
        );
      },
    },
  ];

  const newButton = canWrite ? (
    <Button type="primary" icon={<PlusOutlined />} onClick={openNew}>
      New estimate
    </Button>
  ) : null;

  return (
    <div>
      <div className={styles.pills} role="group" aria-label="Estimate state">
        {ESTIMATE_FILTERS.map((pill) => (
          <button
            key={pill.key}
            type="button"
            className={styles.pill}
            aria-pressed={filter === pill.key}
            onClick={() => setFilter(pill.key)}
          >
            {pill.label}{" "}
            <span className={styles.pillCount}>({counts[pill.key]})</span>
          </button>
        ))}
      </div>

      <FilterBar resultCount={rows.length} actions={newButton}>
        <Input.Search
          allowClear
          aria-label="Search estimates by number or customer"
          placeholder="Search number or customer"
          style={{ width: 260 }}
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
      </FilterBar>

      <DataTable<EstimateListEntry>
        rowKey="id"
        columns={columns}
        dataSource={rows}
        sticky
        emptyTitle={narrowed ? "No estimates match these filters" : "No estimates yet"}
        emptyAction={narrowed ? undefined : (newButton ?? undefined)}
      />

      <EstimateFormModal
        key={editing?.estimate.id ?? "new"}
        open={createOpen || editing !== null}
        detail={editing}
        today={today}
        customers={customers}
        incomeAccounts={incomeAccounts}
        taxCodes={taxCodes}
        usStates={usStates}
        items={items}
        canWrite={canWrite}
        canManageItems={canManageItems}
        onClose={closeForm}
        onConvert={turnIntoInvoice}
      />
    </div>
  );
}
