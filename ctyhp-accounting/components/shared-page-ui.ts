"use client";

/**
 * The page furniture nearly every signed-in page renders, loaded once with
 * the shell rather than copied into each page.
 *
 * Turbopack puts a client module into each page's own chunk unless a layout
 * above the page already loads it. These are used by 38 to 75 pages each, and
 * after 2.75 none sat in a chunk the pages shared: the page header and its
 * breadcrumb travelled in 75 copies, DataTable in 51, the table pager in 56,
 * StatusTag in 55, the empty state in 54, the column helpers in 38, and the
 * status icons in 56 (bundle measured 2026-10-29). Importing them here, from
 * the shell, puts one copy in the chunk every page already loads, and each
 * page uses that one.
 *
 * The cost is that the few pages without a table or a status also load these,
 * a few kilobytes. The help panels taught the opposite lesson the same way
 * (see tests/unit/shell-bundle.test.ts): taken out of the shell, the code they
 * share with the pages split into a copy per page.
 */
import "@/components/PageHeader";
import "@/components/ui/DataTable";
import "@/components/ui/columns";
import "@/components/ui/table-pagination";
import "@/components/ui/StatusTag";
import "@/components/ui/TableEmpty";
import "@/lib/design/tone";
import "@/lib/design/status";
