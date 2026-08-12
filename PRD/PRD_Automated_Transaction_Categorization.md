# Product Requirements Document (PRD): Automated Transaction Categorization and Ledger Posting Enhancement in OneBook

## 1. Executive Summary

This Product Requirements Document (PRD) outlines the user feedback and feature enhancement requests captured from client review session video recordings for **OneBook**, an accounting and financial management platform. The core objective of this enhancement is to streamline transaction entry through intelligent keyword-based auto-suggestions linked to the **Chart of Accounts** and to ensure seamless, real-time posting of categorized entries into their respective **Ledgers** and financial reports (such as Sales and Payroll reports).

---

## 2. Video Transcription & Subtitle Record

Below is the verbatim transcription and timestamped subtitle record extracted from the user's feedback video (`34.143.156.198-RemoteDesktopConnection2026-08-0517-29-50.mp4`):

| Timestamp | Subtitle / Spoken Content |
| :--- | :--- |
| **[00:02.2 - 00:05.7]** | Hi, Viet. Good morning to you. |
| **[00:05.7 - 00:22.4]** | So the reason I want to enhance the feature of categorization on the OneBook, as you can see here, I can categorize on the transaction feature. |
| **[00:22.4 - 00:33.6]** | Whenever I make a keyword like fee, fee or a payroll, see that there will be a suggested already, a suggestion from the chart of accounts. |
| **[00:40.6 - 00:56.5]** | So if I use wages or salary, yeah, you can see here, like for example, sales. So this will be sales because it is sales definitely. This one also sales. |
| **[00:58.1 - 01:13.0]** | As you can see, once I click the correct chart of account or account, it will automatically go to the sales report. |
| **[01:13.0 - 01:35.8]** | So when I'm going to profit and sales, and I choose August 1 to 5, and going to make a copy of it, then I want to do on details and click sales. |
| **[01:35.8 - 01:46.9]** | Give me a second because my remote computer is too slow. Okay. |
| **[01:46.9 - 02:18.9]** | So you can see here, I add the 4,500 to sales, then the 510 to sales. Look. So you can see here that was categorized to sale automatically. I mean, it will be put on the ledger sales. Do you see that? |
| **[02:18.9 - 02:24.2]** | So that's the feature that I want you to make. |
| **[02:24.2 - 02:58.8]** | So first, when I want to categorize here, all of the categorized or the chart of account that has payroll will be shown here. If it is debit, if it is credit, anything. So then once I categorize the sales or the other accounts, it will be shown on their respective ledger. That's all. Thank you. |

---

## 3. User Requirements Analysis

Based on the video walkthrough and feedback provided by the user, the enhancement request can be broken down into three core functional modules:

| Feature Area | Current State / Observation | Desired Enhancement / Requirement |
| :--- | :--- | :--- |
| **1. Transaction Keyword Auto-Suggestion** | Users manually search or select accounts during transaction entry. | Implement smart keyword-based matching (e.g., typing "fee", "payroll", "salary", "sales") that instantly surfaces relevant suggestions from the **Chart of Accounts** (handling both debit and credit entries). |
| **2. Automated Categorization & Mapping** | Users select accounts for individual transaction line items. | Upon selecting or confirming a Chart of Account suggestion, the transaction is immediately mapped and bound to that account category. |
| **3. Real-Time Ledger Posting & Reporting** | Categorized entries need manual compilation into reports. | Automatically post categorized transactions to their respective **Ledgers** (e.g., Sales Ledger, Payroll Ledger) and reflect them instantly in financial reports (e.g., Profit & Loss / Sales details for specified date ranges like August 1–5). |

---

## 4. Functional Specifications & Detailed User Stories

### Module 1: Smart Chart of Accounts Auto-Suggestion (Detailed User Stories & Acceptance Criteria)

#### User Story 1.1: Keyword-Based Account Auto-Suggestion during Transaction Entry
- **As an** accountant or business user entering transactions into OneBook,
- **I want** the system to automatically suggest relevant Chart of Accounts options as I type keywords (such as `sales`, `payroll`, `fee`, `salary`, `wages`),
- **So that** I can quickly categorize transactions without having to manually scroll through the entire Chart of Accounts tree.

**Acceptance Criteria:**
1. **Trigger & Responsiveness**: When typing into the account/category input field of a transaction row, the system must trigger auto-suggestion within 300ms after typing a minimum of 2 characters.
2. **Keyword Matching Logic**: The search algorithm must perform fuzzy matching across account names, account codes, and predefined aliases/keywords (e.g., typing `fee` matches "Bank Service Fee", "Professional Fee"; typing `payroll` matches "Payroll Expense", "Salaries & Wages").
3. **Display Format**: The suggestion dropdown must display the Account Code, Account Name, Account Type (Asset, Liability, Equity, Revenue, Expense), and Normal Balance (Debit/Credit).
4. **Keyboard & Mouse Navigation**: Users must be able to navigate through the suggestion list using Up/Down arrow keys and select an item using `Enter` or `Tab`, as well as clicking with the mouse.

---

#### User Story 1.2: Contextual Filtering for Debit and Credit Accounts
- **As an** accountant,
- **I want** the auto-suggestion dropdown to correctly surface applicable accounts regardless of whether the transaction line is a debit or credit entry,
- **So that** I can easily assign both revenue/expense categories and asset/liability balancing accounts without restriction.

**Acceptance Criteria:**
1. **Dual-Nature Support**: When entering a transaction, typing a keyword (e.g., `payroll`) must display all matching accounts associated with that keyword, clearly indicating their debit/credit classification.
2. **Filtering by Transaction Type (Optional Toggle)**: If configured in transaction settings, the system may filter suggestions based on transaction side (e.g., restricting credit side suggestions primarily to Revenue/Liability/Equity accounts and debit side to Expense/Asset accounts), while allowing full override.

---

### Module 2: Automated Ledger Posting
- **Trigger**: Upon saving or confirming a categorized transaction line item.
- **Behavior**:
  - The system automatically creates journal entries / ledger updates corresponding to the chosen Chart of Account.
  - For example, assigning amounts ($4,500 and $510) to "Sales" automatically credits/posts them to the **Sales Ledger**.

---

### Module 3: Financial Reporting Integration
- **Trigger**: Navigating to financial reports (e.g., Profit & Loss, Sales Summary, Detailed Ledger Reports) and selecting filter criteria (e.g., Date Range: August 1 to August 5).
- **Behavior**:
  - Reports dynamically aggregate all automatically posted ledger entries.
  - Users can drill down into transaction details (e.g., clicking "Sales" details) to inspect individual transactions grouped under that ledger.

---

## 5. Acceptance Criteria (General System Level)

1. **Auto-Suggestion Accuracy**: Typing keywords such as "sales" or "payroll" during transaction entry displays correct, relevant Chart of Account suggestions within 300ms.
2. **Seamless Categorization**: Selecting a suggested account successfully binds the transaction line item without requiring auxiliary manual steps.
3. **Automated Ledger Update**: Transactions categorized under a specific account automatically update the corresponding ledger (e.g., Sales Ledger reflects newly added amounts instantly).
4. **Report Consistency**: Financial statements and detailed ledger views (filtered by date range, e.g., August 1–5) correctly display the aggregated amounts and provide full drill-down capability into transaction details.

---
*Document Version:* 1.1  
*Author:* Manus AI  
*Date:* August 7, 2026  
