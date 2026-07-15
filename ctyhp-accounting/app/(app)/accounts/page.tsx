import { Typography } from "antd";
import { createSupabaseServerClient } from "@/lib/db/server";
import { listAccounts } from "@/lib/services/accounts";
import { listCurrencies, listTaxCodes } from "@/lib/services/reference";
import { getUserRole, canWrite } from "@/lib/auth";
import AccountsClient from "./AccountsClient";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const sb = await createSupabaseServerClient();
  const [accounts, currencies, taxCodes, role] = await Promise.all([
    listAccounts(sb),
    listCurrencies(sb),
    listTaxCodes(sb),
    getUserRole(),
  ]);

  return (
    <div>
      <Typography.Title level={3}>Hệ thống tài khoản</Typography.Title>
      <Typography.Paragraph type="secondary">
        Danh mục tài khoản kế toán — phân loại giao dịch và làm cơ sở cho báo cáo tài chính.
      </Typography.Paragraph>
      <AccountsClient
        accounts={accounts}
        currencies={currencies}
        taxCodes={taxCodes}
        canWrite={canWrite(role)}
      />
    </div>
  );
}
