1. Overview
This document presents the results of an in-depth assessment of the One Book Jewelry Operations system’s data import functionality. The review focused on importing transactions and chart of accounts data from QuickBooks or Wave into the new company "Pacific Four Nice." Eight findings were identified, each highlighting critical issues with the import process that need to be addressed for a smooth data migration experience.
The key themes across the findings are:
•  Confusing file type and tab guidance during import
•  Unclear file format expectations (report vs. data file)
•  Data loss during import (100+ rows excluded due to missing amounts)
•  Import dependencies not communicated upfront (chart of accounts and bank accounts)
•  No validation warning for large opening balances
•  Account code mapping errors during import
•  Unclassified and mismatched accounts after chart of accounts import
2. Findings and RecommendationsFinding 1: File type warning — confusing tab guidance
Current State
When uploading a CSV file under the Transactions tab, the system displays a warning: "This file may not belong in this tab. This file has a date and debit or credit columns, so it holds transactions rather than one row per transactions record. Check the tab before mapping." This message is confusing because the user is already on the Transactions tab, yet the system is questioning whether the file belongs there.
Recommendation
Improve the file validation logic to correctly identify transaction files when uploaded under the Transactions tab. If the file format is valid for the selected tab, do not display a warning. If the file truly does not match, provide a clear, actionable message explaining which tab to use instead, with a direct link to navigate there.
Finding 2: Report vs. data file warning — unclear file format expectations
Current State
The system displays a warning: "Holding a report rather than a data file? A Profit and Loss, a Balance Sheet or a bank statement you only want to keep can be saved under Reports → Saved Reports." This adds to the user’s confusion about what type of file the system expects. Users exporting from QuickBooks may not know the difference between a "report export" and a "data export."
Recommendation
Provide clear upfront documentation on what file format is expected for each import type, including specific instructions for exporting from QuickBooks (e.g., "QuickBooks: Reports → Transaction List by Date. Wave: Accounting → Transactions → Export"). Include a downloadable template for each import type so users can verify their file matches the expected format before uploading.
Finding 3: 100 rows excluded due to missing amounts
Current State
The import preview shows "100 row(s) will be left out" because multiple rows (Row 266, 276, 286, 288, 304, 328, 334, 346, and 92 more) have no amount value. The error message says "This row has no amount: map Amount, or map Debit and Credit" for each affected row. This means nearly 7% of the data (100 out of 1,466 rows) will be lost during import, and the system does not provide an easy way to fix these rows.
Recommendation
•  Allow in-app row editing: Let users fix missing amounts directly in the import preview rather than requiring them to go back to the source file, fix it, and re-upload.
•  Export problem rows: Provide an option to download the excluded rows as a separate CSV so users can review and fix them offline before re-importing.
•  Auto-detect Debit/Credit mapping: If the file contains Debit and Credit columns, the system should automatically map them without requiring users to manually choose between Amount vs. Debit/Credit.
Finding 4: Missing chart of accounts dependency not communicated upfront
Current State
After uploading the transaction file, the system shows an error: "Some accounts in this file are not in this company’s chart of accounts." Missing accounts include Transfer Clearing, Payroll, Salary & Wages, Taxes, Corporate Tax, and a transfer account named after one of the company's own bank accounts. The system advises importing the chart of accounts first, then bringing the transactions across — but this requirement is only revealed after the user has already gone through the upload and mapping steps.
Recommendation
•  Enforce import order upfront: Before allowing a transaction import, check if the chart of accounts has been imported and display a clear prerequisite message (e.g., "Step 1: Import your Chart of Accounts. Step 2: Import Transactions").
•  Auto-create missing accounts: Offer an option to automatically create the missing accounts during the transaction import, rather than requiring a separate import step.
Finding 5: Missing bank accounts dependency not communicated upfront
Current State
The system shows an error: "This bank account has no bank record yet." Eight bank accounts referenced in the file — five checking accounts across two banks, a credit union, a payroll account, and Cash on Hand — do not exist in the Banking module. (Their real names are held back: this repository is public, and the names carry the customer's bank and the last four digits of each account.) The system instructs users to add these under Banking first, but this dependency is only revealed at the end of the import process.
Recommendation
•  Pre-flight check: Before starting the import, scan the file for bank account references and verify they exist in the Banking module. Alert the user immediately if any are missing.
•  Auto-create bank accounts: Offer an option to create the missing bank accounts directly from the import screen, so users don’t have to navigate away, set them up separately, and return to re-import.
Finding 6: No validation warning for large opening balance
Current State
The import preview shows "Opening balances in the file: -2,257,487.08." This is a significant negative amount that could indicate an error in the source data or incorrect column mapping. However, the system does not flag this as a potential issue or ask the user to confirm whether this opening balance is correct before proceeding with the import.
Recommendation
•  Add a confirmation prompt: When the opening balance exceeds a certain threshold or is negative, display a prominent warning asking the user to confirm the amount before importing.
•  Provide a summary breakdown: Show a summary of debits vs. credits so users can verify the balance makes sense before committing the import.
Finding 7: Account code mapping errors during import
Current State
During the import process, the system encounters account codes it cannot resolve and displays errors such as "0 and 140. Which account the money belong… 500 on its own, or 500 - Cost of Goods So…" The system cannot properly match account codes from the source file to the company’s chart of accounts, and the error messages are truncated and unclear, leaving users unable to resolve the issue.
Recommendation
•  Clear error messages: Display full, untruncated error messages that clearly explain which account code could not be mapped and what the user needs to do to fix it.
•  Manual mapping interface: Provide a dropdown or search field for each unresolved account code so users can manually select the correct account from the existing chart of accounts during import.
Finding 8: Unclassified and mismatched accounts after chart of accounts import
Current State
After importing the chart of accounts, several accounts appear with issues. Some accounts are marked as "Unclassified" (highlighted in orange), and there are multiple bank-type accounts categorized as "Checking account" with generic "Operating" or "Cash" classifications. Rows highlighted in red indicate errors or accounts that were not properly mapped during the import. This results in an incomplete and potentially inaccurate chart of accounts that will affect all subsequent transactions and reports.
Recommendation
•  Pre-import validation: Validate all accounts before completing the import. Flag any accounts that cannot be automatically classified and require the user to assign a proper category before proceeding.
•  Account type mapping: Provide a mapping step where users can review and correct account types (Asset, Liability, Equity, Revenue, Expense, COGS) before the import is finalized.
•  Use the recommended chart of accounts: As noted in a prior assessment, adopt the jewelry retail-specific chart of accounts as the standard. This would reduce import errors by providing a well-defined target structure that source data can be mapped against.