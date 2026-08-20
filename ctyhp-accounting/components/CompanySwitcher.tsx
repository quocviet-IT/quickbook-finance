"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { App, Divider, Select, Space, Tag, Tooltip, Typography } from "antd";
import { BankOutlined, PlusOutlined } from "@ant-design/icons";
import { switchCompanyAction } from "@/app/(app)/company-actions";

export interface CompanyChoice {
  slug: string;
  legalName: string;
  dbaName: string | null;
  isSample: boolean;
}

/**
 * Which company's books are open, and how to change it.
 *
 * The reviewer's requirement was that an accountant can move between companies
 * "without leaving their current workflow", so this sits in the header on every
 * screen rather than on a settings page. Changing it reloads the page against
 * the new company's schema — the same screen, different books.
 *
 * With one company it renders as a plain label. A control that offers a choice
 * of one is noise.
 */
export default function CompanySwitcher({
  active,
  options,
  canCreateCompany,
}: {
  active: CompanyChoice | null;
  options: CompanyChoice[];
  /** Only a platform administrator is offered a new set of books. */
  canCreateCompany: boolean;
}) {
  const { message } = App.useApp();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(active?.slug);

  if (!active) {
    return (
      <Tooltip title="This account is not a member of any company. An administrator has to grant access.">
        <Tag color="red">No company</Tag>
      </Tooltip>
    );
  }

  // A dropdown offering a choice of one is noise — for a reader. A platform
  // administrator is different: their dropdown is also where "New company"
  // lives, and hanging that offer off a bare icon beside a label (as this
  // once did) gave the one-company administrator a different, easily missed
  // UI from the many-company one. Same control, same place, either way.
  if (options.length <= 1 && !canCreateCompany) {
    return (
      <Space size={6} className="app-shell__company">
        <BankOutlined />
        <Typography.Text strong ellipsis style={{ maxWidth: 220 }}>
          {active.legalName}
        </Typography.Text>
        {active.isSample ? <Tag color="orange">sample</Tag> : null}
      </Space>
    );
  }

  async function choose(slug: string) {
    setValue(slug);
    startTransition(async () => {
      const res = await switchCompanyAction(slug);
      if (!res.ok) {
        setValue(active!.slug);
        message.error(res.error ?? "Could not switch company");
        return;
      }
      // A hard refresh, not a client navigation: every cached server render
      // belongs to the company that was open when it was made.
      router.refresh();
      window.location.reload();
    });
  }

  return (
    <Select
      value={value}
      loading={pending}
      onChange={choose}
      className="app-shell__company-select"
      style={{ minWidth: 230 }}
      popupMatchSelectWidth={320}
      aria-label="Company"
      prefix={<BankOutlined />}
      // Beyond a handful of companies a plain dropdown is a scroll. Search on
      // the name people actually use, and on the legal name they file under.
      showSearch
      optionFilterProp="searchText"
      filterOption={(input, option) =>
        String(option?.searchText ?? "").toLowerCase().includes(input.toLowerCase())
      }
      notFoundContent="No company matches that name"
      popupRender={(menu) => (
        <>
          {menu}
          {canCreateCompany ? (
            <>
              <Divider style={{ margin: "4px 0" }} />
              <div style={{ padding: "4px 8px 8px" }}>
                <Link href="/settings/companies?new=1">
                  <PlusOutlined /> New company
                </Link>
              </div>
            </>
          ) : null}
        </>
      )}
      options={options.map((company) => ({
        value: company.slug,
        searchText: `${company.dbaName ?? ""} ${company.legalName}`.trim(),
        label: (
          <Space size={6}>
            <span>{company.dbaName || company.legalName}</span>
            {company.isSample ? <Tag color="orange">sample</Tag> : null}
          </Space>
        ),
      }))}
    />
  );
}
