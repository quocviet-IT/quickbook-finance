"use client";
import { useState } from "react";
import Link from "next/link";
import {
  Button,
  Input,
  Select,
  Tag,
  Tooltip,
  type TableColumnsType,
} from "antd";
import { EditOutlined, PlusOutlined } from "@ant-design/icons";
import DataTable from "@/components/ui/DataTable";
import StatusTag from "@/components/ui/StatusTag";
import { flexColumn } from "@/components/ui/columns";
import { COLUMN } from "@/lib/design/table-metrics";
import FilterBar from "@/components/ui/FilterBar";
import IconActionButton from "@/components/ui/IconActionButton";
import type { CustomerRow } from "@/lib/db/types";
import type { CustomerCreditRow } from "@/lib/services/credit";
import { creditStateColor, creditStateLabel, type CreditState } from "@/lib/domain/credit";
import { filterContacts, type ActiveFilter } from "@/lib/domain/contact-filter";
import { formatMoney } from "@/lib/format";
import CustomerFormModal from "./CustomerFormModal";

const money = (minor: number) => formatMoney(minor, "USD", 2);

/**
 * Every fixed column of the list: Credit limit, Owed now, Overdue, Available,
 * Credit status, Status and Actions. The Customer cell is the elastic one and
 * keeps at least COLUMN.TEXT_MIN of the 984px box.
 */
export const CUSTOMER_LIST_FIXED_WIDTHS = [
  COLUMN.MONEY,
  COLUMN.MONEY,
  COLUMN.MONEY,
  COLUMN.MONEY,
  140,
  100,
  80,
] as const;
const [W_LIMIT, W_OWED, W_OVERDUE, W_AVAILABLE, W_CREDIT, W_STATUS, W_ACTIONS] =
  CUSTOMER_LIST_FIXED_WIDTHS;

export default function CustomersClient({
  customers,
  credit,
  usStates,
  canWrite,
}: {
  customers: CustomerRow[];
  /** Exposure per customer, read from the open invoices on every request. */
  credit: CustomerCreditRow[];
  usStates: { code: string; name: string }[];
  canWrite: boolean;
}) {
  const creditByCustomer = new Map(credit.map((row) => [row.customerId, row]));
  const [formFor, setFormFor] = useState<{ customer: CustomerRow | null } | null>(null);

  // The register had no way to search at all — every professional
  // bookkeeping product leads its contact list with one (QuickBooks' "Find a
  // customer or company", Xero's contact search), and a jeweller with a
  // hundred customers should not have to scroll for one. The keyword and the
  // active narrowing are shared with Vendors (lib/domain/contact-filter.ts);
  // the credit narrowing is this screen's own, because only customers carry a
  // credit state, and it filters on the same computed status the Credit
  // status column shows — never a second opinion of it.
  const [keyword, setKeyword] = useState("");
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("all");
  const [creditFilter, setCreditFilter] = useState<CreditState | "all">("all");
  const narrowed = Boolean(keyword) || creditFilter !== "all" || activeFilter !== "all";
  function clearFilters() {
    setKeyword("");
    setCreditFilter("all");
    setActiveFilter("all");
  }

  const overdueOf = (row: CustomerRow) => creditByCustomer.get(row.id)?.overdueMinor ?? 0;
  // Overdue first, the largest first, then by name: the list opens on the
  // customers someone should call.
  const visibleCustomers = filterContacts(customers, keyword, activeFilter)
    .filter((row) => {
      if (creditFilter === "all") return true;
      return creditByCustomer.get(row.id)?.status.state === creditFilter;
    })
    .sort((a, b) => overdueOf(b) - overdueOf(a) || a.name.localeCompare(b.name));

  // Only states the list actually contains: offering "On hold" to a register
  // with nobody on hold is a filter that can only ever return nothing.
  const presentCreditStates = [
    ...new Set(credit.map((row) => row.status.state)),
  ] as CreditState[];

  function openCreate() {
    setFormFor({ customer: null });
  }

  const columns: TableColumnsType<CustomerRow> = [
    {
      // One line: the name, linked to the customer's page. The email and
      // the city live on that page.
      ...flexColumn<CustomerRow>({
        title: "Customer",
        key: "name",
        render: (_: unknown, row: CustomerRow) => (
          <Link href={`/customers/${row.id}`} title={row.name}>
            {row.name}
          </Link>
        ),
      }),
      sorter: (a: CustomerRow, b: CustomerRow) => a.name.localeCompare(b.name),
    },
    {
      title: "Credit limit",
      key: "credit_limit",
      width: W_LIMIT,
      align: "right",
      render: (_, row) =>
        row.credit_limit_minor === null ? (
          <Tooltip title="No limit is enforced for this customer">
            <span className="accounting-muted">Not set</span>
          </Tooltip>
        ) : (
          money(row.credit_limit_minor)
        ),
    },
    {
      title: "Owed now",
      key: "balance",
      width: W_OWED,
      align: "right",
      render: (_, row) => money(creditByCustomer.get(row.id)?.openBalanceMinor ?? 0),
    },
    {
      title: "Overdue",
      key: "overdue",
      width: W_OVERDUE,
      align: "right",
      sorter: (a: CustomerRow, b: CustomerRow) => overdueOf(a) - overdueOf(b),
      render: (_, row) => {
        const overdue = overdueOf(row);
        return overdue === 0 ? "\u2014" : <span className="accounting-negative">{money(overdue)}</span>;
      },
    },
    {
      title: "Available",
      key: "available",
      width: W_AVAILABLE,
      align: "right",
      render: (_, row) => {
        const available = creditByCustomer.get(row.id)?.status.availableMinor ?? null;
        if (available === null) return "\u2014";
        return (
          <span className={available < 0 ? "accounting-negative" : undefined}>
            {money(available)}
          </span>
        );
      },
    },
    {
      title: "Credit status",
      key: "credit_status",
      width: W_CREDIT,
      render: (_, row) => {
        const status = creditByCustomer.get(row.id)?.status;
        if (!status) return "\u2014";
        const tag = <Tag color={creditStateColor(status.state)}>{status.label}</Tag>;
        return status.reasons.length ? (
          <Tooltip title={status.reasons.join(". ")}>{tag}</Tooltip>
        ) : (
          tag
        );
      },
    },
    {
      title: "Status",
      dataIndex: "is_active",
      width: W_STATUS,
      render: (a: boolean) => <StatusTag status={a ? "active" : "inactive"} />,
    },
    ...(canWrite
      ? [
          {
            title: "Actions",
            width: W_ACTIONS,
            render: (_: unknown, row: CustomerRow) => (
              <IconActionButton
                icon={<EditOutlined />}
                label="Edit contact details"
                onClick={() => setFormFor({ customer: row })}
              />
            ),
          },
        ]
      : []),
  ];

  return (
    <div>
      <FilterBar
        resultCount={visibleCustomers.length}
        actions={
          canWrite ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              New customer
            </Button>
          ) : null
        }
      >
        <Input.Search
          allowClear
          aria-label="Search customers by name, contact, email, phone, or city"
          placeholder="Search name, contact, email, or city"
          style={{ width: 300 }}
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
        <Select
          aria-label="Filter customers by credit status"
          value={creditFilter}
          onChange={setCreditFilter}
          style={{ minWidth: 170 }}
          options={[
            { value: "all", label: "All credit statuses" },
            ...presentCreditStates.map((state) => ({
              value: state,
              label: creditStateLabel(state),
            })),
          ]}
        />
        <Select
          aria-label="Filter customers by active status"
          value={activeFilter}
          onChange={setActiveFilter}
          style={{ minWidth: 130 }}
          options={[
            { value: "all", label: "All statuses" },
            { value: "active", label: "Active" },
            { value: "inactive", label: "Inactive" },
          ]}
        />
      </FilterBar>
      <DataTable
        rowKey="id"
        columns={columns}
        dataSource={visibleCustomers}
        sticky
        emptyTitle={narrowed ? "No customers match these filters" : "No customers yet"}
        emptyDescription={
          narrowed
            ? "Clear the filters, or search for another name, contact, email or city."
            : "Add a customer to create invoices and receive payments."
        }
        // The next step, in the empty table itself (3.0.10).
        emptyAction={
          narrowed ? (
            <Button onClick={clearFilters}>Clear filters</Button>
          ) : canWrite ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              New customer
            </Button>
          ) : undefined
        }
      />

      <CustomerFormModal
        open={formFor !== null}
        customer={formFor?.customer ?? null}
        usStates={usStates}
        onClose={() => setFormFor(null)}
      />
    </div>
  );
}
