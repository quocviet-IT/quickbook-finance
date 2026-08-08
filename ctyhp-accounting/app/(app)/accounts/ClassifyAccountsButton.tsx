"use client";
import { useCallback, useEffect, useState } from "react";
import { Alert, App, Button, List, Modal, Space, Typography } from "antd";
import { classifyAccountsAction, planClassificationAction } from "./actions";

export interface ClassifyAccountsButtonProps {
  canWrite: boolean;
}

interface Plan {
  roles: number;
  details: number;
  unanswerable: { account_code: string; name: string }[];
}

/**
 * Give the accounts an import left unclassified the classification the rest
 * of the chart already has.
 *
 * An account typed in by hand gets a cash-flow role from its type; one arriving
 * through `acc_import_accounts` did not, and an unclassified account holds the
 * Cash Flow Statement in review. One imported chart landed with 54 of 95 like
 * that, fifty of them expenses, income, equity and cost of sales — types with a
 * settled answer.
 *
 * The import fills them in now. This is for the charts imported before it did,
 * and it shows what it will change before changing anything: nothing already
 * classified is touched, and a generic current asset or liability is left for
 * an accountant, because whether a loan is operating or financing is a policy.
 */
export default function ClassifyAccountsButton({ canWrite }: ClassifyAccountsButtonProps) {
  const { message } = App.useApp();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    void planClassificationAction().then((result) => {
      if (result.ok && result.data) setPlan(result.data);
    });
  }, []);

  useEffect(refresh, [refresh]);

  if (!canWrite || !plan) return null;
  const pending = plan.roles + plan.details;
  if (pending === 0) return null;

  const confirm = async () => {
    setBusy(true);
    const result = await classifyAccountsAction();
    setBusy(false);
    if (!result.ok || !result.data) {
      message.error(result.error ?? "Could not classify these accounts");
      return;
    }
    const { rolesSet, detailsSet, stillUnclassified } = result.data;
    message.success(
      `${rolesSet} account(s) classified` +
        (detailsSet > 0 ? `, ${detailsSet} bank account(s) given a kind` : "") +
        (stillUnclassified.length > 0
          ? `. ${stillUnclassified.length} still need a policy.`
          : "."),
    );
    setOpen(false);
    // The action revalidates /accounts, so the table behind this dialog
    // re-renders on its own; only this button's own count has to be re-asked.
    refresh();
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>Classify {pending} account(s)</Button>
      <Modal
        open={open}
        title="Classify these accounts by their type?"
        okText="Classify them"
        okButtonProps={{ loading: busy }}
        onOk={confirm}
        onCancel={() => setOpen(false)}
        width={560}
      >
        <Space direction="vertical" size="small" style={{ width: "100%" }}>
          <Typography.Paragraph style={{ marginBottom: 0 }}>
            {plan.roles > 0 ? (
              <>
                <b>{plan.roles}</b> account(s) will be given the cash-flow role their type
                implies — the same one an account created by hand receives.{" "}
              </>
            ) : null}
            {plan.details > 0 ? (
              <>
                <b>{plan.details}</b> bank account(s) will be given the kind their name plainly
                states.
              </>
            ) : null}
          </Typography.Paragraph>
          <Alert
            type="info"
            showIcon
            message="Nothing already classified is changed"
            description="Only accounts still carrying no classification at all. An answer somebody chose is an answer, and re-answering it would not be a repair."
          />
          {plan.unanswerable.length > 0 ? (
            <>
              <Typography.Text type="secondary">
                These {plan.unanswerable.length} are left for you. Whether a generic current
                asset or liability is operating, investing or financing is a policy, not a
                default:
              </Typography.Text>
              <List
                size="small"
                bordered
                dataSource={plan.unanswerable}
                renderItem={(item) => (
                  <List.Item>
                    {item.account_code} — {item.name}
                  </List.Item>
                )}
                style={{ maxHeight: 180, overflowY: "auto" }}
              />
            </>
          ) : null}
        </Space>
      </Modal>
    </>
  );
}
