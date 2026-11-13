"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Typography,
} from "antd";
import { timeZoneLabel } from "@/lib/format";
import FormActions from "@/components/ui/FormActions";
import { closeOrConfirmDiscard } from "@/lib/client/destructive-confirm";
import { useUnsavedGuard } from "@/lib/client/use-unsaved-guard";
import { validateOrFocus } from "@/lib/client/validate-or-focus";
import DataTable from "@/components/ui/DataTable";
import { flexColumn } from "@/components/ui/columns";
import { COLUMN } from "@/lib/design/table-metrics";
import { saveCompanySettingsAction, listCompanySettingVersionsAction } from "./actions";
import { CompanyExportCard } from "@/components/settings/CompanyExportCard";
import type { AccountRow, CompanySettingRow } from "@/lib/db/types";
import { humanizeStatus } from "@/lib/domain/status-label";
import { METHOD_LABEL } from "@/lib/domain/inventory-review";
import { formatPostalAddress } from "@/lib/domain/invoice-document";
import type { SetupStep } from "@/lib/domain/company-setup";
import CompanySetupCard from "@/components/settings/CompanySetupCard";
import PostingDefaultsCard from "@/components/settings/PostingDefaultsCard";
import { NO_POSTING_DEFAULTS, type PostingDefaults } from "@/lib/domain/posting-defaults";

/**
 * Version, Effective, Basis, Employer Identification Number. Legal name takes
 * what is left, at least COLUMN.TEXT_MIN. The EIN heading is long and wraps; the
 * value is nine masked characters.
 */
export const COMPANY_VERSIONS_FIXED_WIDTHS = [COLUMN.QTY, COLUMN.DATE, COLUMN.CODE, COLUMN.PICKER] as const;

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
function maskEin(s: string | null | undefined): string {
  if (!s) return "—";
  const t = s.replace(/\s/g, "");
  return t.length <= 4 ? "••" : `•••••${t.slice(-4)}`;
}

export default function CompanySettingsClient({
  canEdit,
  current,
  setupSteps = null,
  accounts = [],
  postingDefaults = NO_POSTING_DEFAULTS,
}: {
  canEdit: boolean;
  current: CompanySettingRow | null;
  /** The setup checklist (3.00); null when it could not be read, and then not shown. */
  setupSteps?: SetupStep[] | null;
  /** The chart, for the posting defaults' pickers (3.01). */
  accounts?: AccountRow[];
  postingDefaults?: PostingDefaults;
}) {
  const { message, modal } = App.useApp();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [form] = Form.useForm();
  /**
   * A save in flight (3.0.30). Save used to stay live while the request ran,
   * so a second click sent the same settings again and wrote a second version.
   */
  const [saving, setSaving] = useState(false);
  /** Edited since the form opened: Cancel and leaving the page ask first. */
  const [dirty, setDirty] = useState(false);
  /** Why the last save failed, beside Save until the next attempt. */
  const [saveError, setSaveError] = useState<string | null>(null);
  useUnsavedGuard(editing && dirty, modal, "the company settings");
  const [versions, setVersions] = useState<CompanySettingRow[]>([]);
  /**
   * The history is read after the page arrives. A read that failed used to
   * leave an empty table under a toast — the same as a company with no
   * history — so it now says what failed and offers to read it again.
   */
  const [versionsState, setVersionsState] = useState<"loading" | "ready" | "failed">("loading");
  const [versionsError, setVersionsError] = useState<string | null>(null);
  /** The address as a document prints it, every missing part dropped. */
  const addressLines = current ? formatPostalAddress(current) : [];

  const loadVersions = async () => {
    setVersionsState("loading");
    const r = await listCompanySettingVersionsAction();
    if (r.ok && r.data) {
      setVersions(r.data);
      setVersionsError(null);
      setVersionsState("ready");
    } else {
      // The versions already on screen stay: they were read correctly.
      setVersionsError(r.error ?? "The version history could not be read.");
      setVersionsState("failed");
    }
  };
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadVersions();
  }, []);

  const startEdit = () => {
    form.setFieldsValue({
      legal_name: current?.legal_name, dba_name: current?.dba_name, ein_ref: current?.ein_ref,
      address_line1: current?.address_line1, address_line2: current?.address_line2, city: current?.city,
      region: current?.region, postal_code: current?.postal_code, country: current?.country,
      fiscal_year_start_month: current?.fiscal_year_start_month ?? 1,
      base_currency_code: current?.base_currency_code ?? "USD",
      time_zone: current?.time_zone ?? "America/New_York",
      accounting_basis: current?.accounting_basis ?? "accrual",
      default_payment_terms_days: current?.default_payment_terms_days ?? 30,
      inventory_valuation_method: current?.inventory_valuation_method ?? "average_cost",
      inventory_policy_memo: current?.inventory_policy_memo ?? "",
      pay_note: current?.pay_note ?? "",
      phone: current?.phone ?? "",
      email: current?.email ?? "",
    });
    setDirty(false);
    setSaveError(null);
    setEditing(true);
  };

  /** Back to the settings as they are, the form left clean for next time. */
  const finishEditing = () => {
    setDirty(false);
    setSaveError(null);
    setEditing(false);
  };

  /** Cancel: at once when nothing was changed, otherwise only once the reader agrees. */
  const cancelEdit = () => {
    closeOrConfirmDiscard({
      dirty,
      what: "the changes to the company settings",
      confirm: modal.confirm,
      close: finishEditing,
    });
  };

  const submit = async () => {
    if (saving) return;
    // A wrong or missing field: focus goes to it, and nothing is sent.
    const v = await validateOrFocus(form);
    if (!v) return;
    setSaving(true);
    setSaveError(null);
    try {
      const r = await saveCompanySettingsAction(v);
      if (!r.ok) {
        // The form stays open with everything typed in it.
        setSaveError(r.error ?? "The settings could not be saved.");
        return;
      }
      message.success("Company settings saved as a new version");
      // The name also lives in the company register, which is what the switcher
      // reads. If it did not follow, say so: two different names on screen with
      // no explanation is worse than a warning.
      if (r.data?.registerProblem) {
        message.warning(`The settings were saved, but ${r.data.registerProblem}`, 8);
      }
      finishEditing();
      void loadVersions();
      // The current settings and the setup checklist are the page's; read them
      // again, as the other settings screens do after a save.
      router.refresh();
    } catch (error) {
      // The request itself failed (the network, the server). Not a refusal,
      // but the reader still has to know nothing was saved.
      setSaveError(
        `The settings could not be saved: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      {!editing && setupSteps ? <CompanySetupCard steps={setupSteps} onEdit={canEdit ? startEdit : undefined} /> : null}
      {!editing && (
        <Card
          title="Current settings"
          extra={canEdit ? <Button type="primary" onClick={startEdit}>Edit</Button> : null}
        >
          {current ? (
            <>
              {/*
                Vertical, and that is the fix rather than a preference.

                These were laid out horizontally in a two-column grid, and the
                labels here are long — "Employer Identification Number" is
                twenty-nine characters. A horizontal Descriptions sizes its
                label column to the longest label, so the value column
                collapsed, and the values broke inside themselves: the masked
                EIN came out one character per line, "America/New_York" split
                as "America/New_Yo / rk", "Weighted average cost" as "Weight /
                ed average cost".

                Stacking the label above the value gives every value the full
                width of its column, which is all any of them needed.
              */}
              <Descriptions
                layout="vertical"
                column={{ xs: 1, sm: 2, lg: 3 }}
                size="small"
                colon={false}
              >
                <Descriptions.Item label="Legal name">{current.legal_name}</Descriptions.Item>
                <Descriptions.Item label="Doing Business As">{current.dba_name ?? "—"}</Descriptions.Item>
                <Descriptions.Item label="Employer Identification Number">
                  {maskEin(current.ein_ref)}
                </Descriptions.Item>
                <Descriptions.Item label="Address">
                  {addressLines.length > 0 ? (
                    <span style={{ whiteSpace: "pre-line" }}>{addressLines.join("\n")}</span>
                  ) : (
                    "—"
                  )}
                </Descriptions.Item>
                <Descriptions.Item label="Phone">{current.phone ?? "—"}</Descriptions.Item>
                <Descriptions.Item label="Email">{current.email ?? "—"}</Descriptions.Item>
                <Descriptions.Item label="Fiscal year start">
                  {MONTHS[(current.fiscal_year_start_month ?? 1) - 1]}
                </Descriptions.Item>
                <Descriptions.Item label="Accounting basis">{humanizeStatus(current.accounting_basis)}</Descriptions.Item>
                <Descriptions.Item label="Base currency">{current.base_currency_code}</Descriptions.Item>
                <Descriptions.Item label="Time zone">{`${timeZoneLabel(current.time_zone)} (${current.time_zone})`}</Descriptions.Item>
                <Descriptions.Item label="Default terms (days)">
                  {current.default_payment_terms_days}
                </Descriptions.Item>
                <Descriptions.Item label="Inventory cost basis">
                  {METHOD_LABEL[current.inventory_valuation_method] ?? current.inventory_valuation_method}
                </Descriptions.Item>
              </Descriptions>

              {/*
                The policy is prose — several paragraphs of accounting
                standard — and it was the tenth cell of a grid built for
                one-line facts, carrying `span={3}` on a two-column layout,
                which is not a span that exists. Out of the grid it can simply
                be what it is: a paragraph with a heading.
              */}
              <div className="company-settings__policy">
                <Typography.Text type="secondary" className="company-settings__policy-label">
                  How to pay
                </Typography.Text>
                {current.pay_note ? (
                  <Typography.Paragraph style={{ whiteSpace: "pre-line" }}>{current.pay_note}</Typography.Paragraph>
                ) : (
                  <Typography.Paragraph type="secondary">
                    Not set. Invoices print no payment instructions until it is.
                  </Typography.Paragraph>
                )}
                <Typography.Text type="secondary" className="company-settings__policy-label">
                  Inventory policy
                </Typography.Text>
                {current.inventory_policy_memo ? (
                  <Typography.Paragraph style={{ whiteSpace: "pre-line", marginBottom: 0 }}>
                    {current.inventory_policy_memo}
                  </Typography.Paragraph>
                ) : (
                  <Typography.Text type="warning">
                    Not recorded. GAAP asks for the cost basis to be disclosed.
                  </Typography.Text>
                )}
              </div>
            </>
          ) : (
            <p>No company settings yet.{canEdit ? " Click Edit to create them." : ""}</p>
          )}
        </Card>
      )}
      {editing && (
        <Card title="Edit settings">
          {/*
            In titled sections, one field to a row (3.0.30). The fields used to
            wrap side by side wherever they fitted, so the time zone sat beside
            the currency and the inventory policy beside the payment terms, and
            the eye had no line to follow down the form. Two fields share a row
            only where together they are one value: city and state, postal code
            and country.
          */}
          <Form form={form} layout="vertical" onValuesChange={() => setDirty(true)}>
            <fieldset className="accounting-form-section">
              <legend>Company</legend>
              <Form.Item name="legal_name" label="Legal name" rules={[{ required: true, message: "Enter the legal name" }]}>
                <Input style={{ maxWidth: 480 }} />
              </Form.Item>
              <Form.Item name="dba_name" label="Doing Business As">
                <Input style={{ maxWidth: 480 }} />
              </Form.Item>
              <Form.Item name="ein_ref" label="Employer Identification Number reference">
                <Input style={{ maxWidth: 240 }} />
              </Form.Item>
            </fieldset>

            <fieldset className="accounting-form-section">
              <legend>Address and contact</legend>
              <Form.Item name="address_line1" label="Address line 1">
                <Input autoComplete="address-line1" style={{ maxWidth: 480 }} />
              </Form.Item>
              <Form.Item name="address_line2" label="Address line 2">
                <Input autoComplete="address-line2" style={{ maxWidth: 480 }} />
              </Form.Item>
              <div className="accounting-form-pair">
                <Form.Item name="city" label="City">
                  <Input autoComplete="address-level2" />
                </Form.Item>
                <Form.Item name="region" label="State/Region">
                  <Input autoComplete="address-level1" />
                </Form.Item>
              </div>
              <div className="accounting-form-pair">
                <Form.Item name="postal_code" label="Postal code">
                  <Input autoComplete="postal-code" />
                </Form.Item>
                <Form.Item name="country" label="Country">
                  <Input autoComplete="country-name" />
                </Form.Item>
              </div>
              <Form.Item name="phone" label="Phone" rules={[{ max: 40 }]}>
                <Input type="tel" autoComplete="tel" style={{ maxWidth: 240 }} />
              </Form.Item>
              <Form.Item
                name="email"
                label="Email"
                rules={[{ type: "email", message: "Enter a valid email" }, { max: 254 }]}
                extra="The address, phone and email are printed at the top of every invoice, estimate and sales receipt."
              >
                <Input type="email" autoComplete="email" style={{ maxWidth: 320 }} />
              </Form.Item>
            </fieldset>

            <fieldset className="accounting-form-section">
              <legend>Accounting</legend>
              <Form.Item name="fiscal_year_start_month" label="Fiscal year start" rules={[{ required: true }]}>
                <Select style={{ width: 200 }} options={MONTHS.map((m, i) => ({ value: i + 1, label: m }))} />
              </Form.Item>
              <Form.Item
                name="accounting_basis"
                label="Accounting basis"
                rules={[{ required: true }]}
                tooltip="Every report is prepared on the accrual basis. Cash basis is not implemented, so it cannot be recorded as the company's basis."
              >
                <Select
                  style={{ width: 240 }}
                  options={[
                    { value: "accrual", label: "Accrual" },
                    { value: "cash", label: "Cash (not implemented)", disabled: true },
                  ]}
                />
              </Form.Item>
              <Form.Item name="base_currency_code" label="Base currency">
                <Input disabled style={{ width: 100 }} />
              </Form.Item>
              <Form.Item name="time_zone" label="Time zone">
                <Input style={{ maxWidth: 280 }} />
              </Form.Item>
              <Form.Item name="default_payment_terms_days" label="Default terms (days)">
                <InputNumber min={0} style={{ width: 120 }} />
              </Form.Item>
            </fieldset>

            <fieldset className="accounting-form-section">
              <legend>Inventory</legend>
              <Form.Item
                name="inventory_valuation_method"
                label="Inventory cost basis"
                tooltip="Only a method the costing engine implements can be recorded. Choosing another is refused rather than accepted and ignored."
              >
                <Select
                  style={{ width: 320 }}
                  options={[
                    { value: "average_cost", label: "Weighted average cost" },
                    { value: "fifo", label: "First in, first out (not implemented)" },
                    {
                      value: "specific_identification",
                      label: "Specific identification (not implemented)",
                    },
                  ]}
                />
              </Form.Item>
              <Form.Item
                name="inventory_policy_memo"
                label="Inventory accounting policy"
                tooltip="Why this basis was chosen and when it was adopted. Kept with this version of the settings, so the policy in force on a past date can still be shown."
              >
                <Input.TextArea rows={5} maxLength={4000} showCount style={{ maxWidth: 720 }} />
              </Form.Item>
            </fieldset>

            <fieldset className="accounting-form-section">
              <legend>Invoices</legend>
              {/* The width of a reading line: bank details read badly in a narrow box. */}
              <Form.Item
                name="pay_note"
                label="How to pay"
                extra="Printed at the foot of every invoice, under the totals."
              >
                <Input.TextArea
                  rows={3}
                  maxLength={600}
                  showCount
                  style={{ maxWidth: 720 }}
                  placeholder="Bank transfer to Example Jewelry LLC, routing 000000000, account 0000000000. Checks payable to Example Jewelry LLC."
                />
              </Form.Item>
            </fieldset>

            <FormActions dirty={dirty} error={saveError}>
              <Button type="primary" loading={saving} onClick={() => void submit()}>
                Save new version
              </Button>
              <Button disabled={saving} onClick={cancelEdit}>
                Cancel
              </Button>
            </FormActions>
          </Form>
        </Card>
      )}
      {!editing ? <PostingDefaultsCard defaults={postingDefaults} accounts={accounts} canEdit={canEdit} /> : null}
      <Card title="Version history">
        {versionsState === "failed" ? (
          <Alert
            type="error"
            showIcon
            role="alert"
            style={{ marginBottom: 16 }}
            title="The version history could not be read"
            description={
              versions.length > 0
                ? `${versionsError} The versions below were read earlier and may not include the newest.`
                : versionsError
            }
            action={
              <Button size="small" onClick={() => void loadVersions()}>
                Retry
              </Button>
            }
          />
        ) : null}
        <DataTable<CompanySettingRow>
          rowKey="id"
          rows={versions}
          pagination={false}
          loading={versionsState === "loading"}
          emptyTitle={versionsState === "failed" ? "Not read" : "No versions yet"}
          emptyDescription={
            versionsState === "failed"
              ? "Nothing could be shown until the history is read."
              : "Each save of the settings is kept here as a version."
          }
          columns={[
            // A number, so it lines up on the right like every other number (3.0.30).
            { title: "Version", dataIndex: "version", width: COMPANY_VERSIONS_FIXED_WIDTHS[0], align: "right" },
            { title: "Effective", dataIndex: "effective_from", width: COMPANY_VERSIONS_FIXED_WIDTHS[1] },
            flexColumn<CompanySettingRow>({ title: "Legal name", dataIndex: "legal_name" }),
            { title: "Basis", dataIndex: "accounting_basis", width: COMPANY_VERSIONS_FIXED_WIDTHS[2], render: (v: string) => humanizeStatus(v) },
            { title: "Employer Identification Number", width: COMPANY_VERSIONS_FIXED_WIDTHS[3], render: (_, r) => maskEin(r.ein_ref) },
          ]} />
      </Card>
      <CompanyExportCard />
    </Space>
  );
}
