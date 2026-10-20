"use client";
import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Checkbox, Input, Select, Space, Tag, type InputRef, type TableColumnsType } from "antd";
import DataTable from "@/components/ui/DataTable";
import { flexColumn } from "@/components/ui/columns";
import ReportBar from "@/components/reports/ReportBar";
import { ReportFoot, ReportPaper, StatRow, reportPaperStyles as paper } from "@/components/reports/ReportPaper";
import { useUnsavedGuard } from "@/lib/client/use-unsaved-guard";
import {
  BALANCE_BASIS_NOTE,
  COMPARISON_GROUPS,
  INACTIVE_ROW_NOTE,
  LOAD_FAILED,
  NO_DIFFERENCES,
  balanceComparisonHeading,
  balanceComparisonSheet,
  buildComparison,
  checkNewExternal,
  draftLines,
  draftProblem,
  formatFigureText,
  hydrateSaved,
  nothingTypedMessage,
  parseExternalBalance,
  rowDiffers,
  tableLines,
  type Comparison,
  type ComparisonGroup,
  type ComparisonRow,
  type ExternalRow,
  type TableLine,
} from "@/lib/domain/balance-comparison";
import { formatMoney } from "@/lib/format";
import type { BalanceComparisonData } from "@/lib/services/balance-comparison";
import { saveBalanceComparisonAction } from "./actions";
import {
  COMPARISON_ACCOUNT_FLOOR,
  COMPARISON_CODE_WIDTH,
  COMPARISON_DIFFERENCE_WIDTH,
  COMPARISON_ONEBOOK_WIDTH,
  COMPARISON_OTHER_WIDTH,
} from "./comparison-columns";
import styles from "./balance-comparison.module.css";

const PATH = "/reports/balance-comparison";

/**
 * One figure box. It keeps its own text while it is typed in: nothing above it
 * feeds the text back, so typing never re-renders the box. The text is read
 * once, on blur, and the rows and totals follow from that.
 */
function FigureBox({
  label,
  initialText,
  error,
  onText,
  rowKey,
  register,
}: {
  label: string;
  initialText: string;
  error: string | null;
  onText: (text: string) => void;
  /** Lets Save read the box as it stands, whether or not it has lost focus. */
  rowKey: string;
  register: (key: string, el: HTMLInputElement | null) => void;
}) {
  return (
    <>
      <Input
        ref={(r) => register(rowKey, r?.input ?? null)}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        status={error ? "error" : undefined}
        defaultValue={initialText}
        inputMode="decimal"
        autoComplete="off"
        style={{ textAlign: "right" }}
        onBlur={(e) => onText(e.currentTarget.value)}
        onPressEnter={(e) => e.currentTarget.blur()}
      />
      {error ? (
        <span className={styles.fieldError} role="alert">
          {error}
        </span>
      ) : null}
    </>
  );
}

/** The form that adds an account the other system has and this one has not. */
function AddExternalPanel({
  otherName,
  decimals,
  existingKeys,
  onAdd,
  onCancel,
}: {
  otherName: string;
  decimals: number;
  existingKeys: ReadonlySet<string>;
  onAdd: (row: ExternalRow, minor: number) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [group, setGroup] = useState<ComparisonGroup>("asset");
  const [figure, setFigure] = useState("");
  const [problem, setProblem] = useState<{ field: "code" | "name" | "figure"; error: string } | null>(null);

  const submit = () => {
    const result = checkNewExternal({ code, name, group, figure }, existingKeys, decimals);
    if (!result.ok) {
      setProblem({ field: result.field, error: result.error });
      return;
    }
    onAdd(result.row, result.minor);
  };

  const errorFor = (field: "code" | "name" | "figure") =>
    problem?.field === field ? (
      <span className={styles.fieldError} role="alert">
        {problem.error}
      </span>
    ) : null;

  return (
    <div className={styles.addPanel} role="group" aria-label={`Add an account ${otherName} has`}>
      <div className={styles.addField} style={{ width: 110 }}>
        <Input
          aria-label="Account code"
          placeholder="Code"
          value={code}
          status={problem?.field === "code" ? "error" : undefined}
          onChange={(e) => setCode(e.target.value)}
        />
        {errorFor("code")}
      </div>
      <div className={styles.addField} style={{ flex: "1 1 200px" }}>
        <Input
          aria-label="Account name"
          placeholder="Account name"
          value={name}
          status={problem?.field === "name" ? "error" : undefined}
          onChange={(e) => setName(e.target.value)}
        />
        {errorFor("name")}
      </div>
      <Select<ComparisonGroup>
        aria-label="Group"
        value={group}
        onChange={setGroup}
        options={COMPARISON_GROUPS.map((g) => ({ value: g.key, label: g.title }))}
        style={{ width: 140 }}
      />
      <div className={styles.addField} style={{ width: 170 }}>
        <Input
          aria-label={`Figure in ${otherName}`}
          placeholder="Figure"
          value={figure}
          inputMode="decimal"
          status={problem?.field === "figure" ? "error" : undefined}
          style={{ textAlign: "right" }}
          onChange={(e) => setFigure(e.target.value)}
          onPressEnter={submit}
        />
        {errorFor("figure")}
      </div>
      <Space>
        <Button type="primary" onClick={submit}>
          Add account
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </Space>
    </div>
  );
}

/** What the draft would save, as a string, so "unsaved" means "differs from what is saved". */
function draftKey(comparedWith: string, note: string, comparison: Comparison): string {
  const lines = draftLines(comparison)
    .map((l) => ("accountId" in l ? `a:${l.accountId}=${l.otherMinor}` : `x:${l.externalCode.toLowerCase()}|${l.externalName}=${l.otherMinor}`))
    .sort();
  return JSON.stringify([comparedWith.trim(), note.trim(), lines]);
}

export default function BalanceComparisonClient({
  asOf,
  companyName,
  currencyCode,
  decimals,
  canSave,
  data,
  loadError,
}: {
  asOf: string;
  companyName: string;
  currencyCode: string;
  decimals: number;
  canSave: boolean;
  data: BalanceComparisonData | null;
  loadError: string | null;
}) {
  const router = useRouter();
  const { message, modal } = App.useApp();

  const [initial] = useState(() => {
    const accounts = data?.accounts ?? [];
    const hydrated = hydrateSaved(data?.lines ?? []);
    const comparedWith = data?.header?.comparedWith ?? "";
    const note = data?.header?.note ?? "";
    const comparison = buildComparison({
      accounts,
      figures: data?.figures ?? {},
      typed: hydrated.typed,
      externals: hydrated.externals,
    });
    return { ...hydrated, comparedWith, note, key: draftKey(comparedWith, note, comparison) };
  });

  const [comparedWith, setComparedWith] = useState(initial.comparedWith);
  const [note, setNote] = useState(initial.note);
  const [typed, setTyped] = useState<Record<string, number | null>>(initial.typed);
  const [externals, setExternals] = useState<ExternalRow[]>(initial.externals);
  // What was typed in each box on its last blur, so a box that is hidden by a filter and shown again keeps its text.
  const [rawText, setRawText] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [baseline, setBaseline] = useState(initial.key);
  const [onlyDifferences, setOnlyDifferences] = useState(false);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // The date picked in the bar; Run report goes there.
  const [pickedAsOf, setPickedAsOf] = useState(asOf);
  // The figure boxes on screen, the Compared with box and the Note box, read as they stand when Save is pressed.
  const boxes = useRef(new Map<string, HTMLInputElement>());
  const withRef = useRef<InputRef>(null);
  const noteRef = useRef<InputRef>(null);
  const registerBox = useCallback((key: string, el: HTMLInputElement | null) => {
    if (el) boxes.current.set(key, el);
    else boxes.current.delete(key);
  }, []);

  const money = useCallback((minor: number) => formatMoney(minor, currencyCode, decimals), [currencyCode, decimals]);

  const comparison = useMemo(
    () =>
      buildComparison({
        accounts: data?.accounts ?? [],
        figures: data?.figures ?? {},
        typed,
        externals,
      }),
    [data, typed, externals],
  );

  const dirty = draftKey(comparedWith, note, comparison) !== baseline;
  useUnsavedGuard(dirty, modal, "these figures");

  const otherName = comparedWith.trim() || "The other system";
  const heading = balanceComparisonHeading(asOf, comparedWith);

  const sheet = useMemo(
    () =>
      balanceComparisonSheet(comparison, { asOf, comparedWith, companyName, currencyCode, decimals, onlyDifferences }),
    [comparison, asOf, comparedWith, companyName, currencyCode, decimals, onlyDifferences],
  );

  const lines = useMemo(
    () => tableLines(comparison, onlyDifferences, new Set(Object.keys(errors))),
    [comparison, onlyDifferences, errors],
  );
  const nothingToShow = onlyDifferences && !lines.some((l) => l.kind === "row");

  const commit = useCallback(
    (row: ComparisonRow, text: string) => {
      const parsed = parseExternalBalance(text, row.side, decimals);
      setRawText((prev) => ({ ...prev, [row.key]: text }));
      if (!parsed.ok) {
        setErrors((prev) => ({ ...prev, [row.key]: parsed.error }));
        setTyped((prev) => ({ ...prev, [row.key]: null }));
        return;
      }
      setErrors((prev) => {
        if (!(row.key in prev)) return prev;
        const { [row.key]: _gone, ...rest } = prev;
        void _gone;
        return rest;
      });
      setTyped((prev) => ({ ...prev, [row.key]: parsed.minor }));
    },
    [decimals],
  );

  const removeExternal = useCallback((row: ComparisonRow) => {
    setExternals((prev) => prev.filter((e) => e.key !== row.key));
    setTyped((prev) => {
      const { [row.key]: _gone, ...rest } = prev;
      void _gone;
      return rest;
    });
    setErrors((prev) => {
      const { [row.key]: _gone, ...rest } = prev;
      void _gone;
      return rest;
    });
  }, []);

  const addExternal = (row: ExternalRow, minor: number) => {
    setExternals((prev) => [...prev, row]);
    setTyped((prev) => ({ ...prev, [row.key]: minor }));
    setAdding(false);
  };

  const goTo = (date: string) => {
    const go = () => router.push(`${PATH}?asOf=${date}`);
    if (!dirty) return go();
    modal.confirm({
      title: "Leave without saving?",
      content: "You have figures that are not saved. Changing the date now throws them away.",
      okText: "Change the date",
      okButtonProps: { danger: true },
      cancelText: "Stay and keep editing",
      onOk: go,
    });
  };

  const save = async () => {
    setSaveError(null);
    // Read every box as it stands: a value typed and saved without leaving the box (some browsers do not blur on a button click) still counts.
    const withName = withRef.current?.input?.value ?? comparedWith;
    const noteText = noteRef.current?.input?.value ?? note;
    const nextTyped = { ...typed };
    const nextErrors = { ...errors };
    const nextRaw = { ...rawText };
    for (const group of comparison.groups) {
      for (const row of group.rows) {
        const el = boxes.current.get(row.key);
        if (!el) continue;
        const parsed = parseExternalBalance(el.value, row.side, decimals);
        nextRaw[row.key] = el.value;
        if (parsed.ok) {
          delete nextErrors[row.key];
          nextTyped[row.key] = parsed.minor;
        } else {
          nextErrors[row.key] = parsed.error;
          nextTyped[row.key] = null;
        }
      }
    }
    setComparedWith(withName);
    setNote(noteText);
    setRawText(nextRaw);
    setTyped(nextTyped);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setSaveError("Some figures are not numbers. Fix the boxes marked in red, or empty them, before saving.");
      return;
    }
    const fresh = buildComparison({
      accounts: data?.accounts ?? [],
      figures: data?.figures ?? {},
      typed: nextTyped,
      externals,
    });
    const draft = { asOf, comparedWith: withName, note: noteText, lines: draftLines(fresh) };
    const problem = draftProblem(draft);
    if (problem) {
      setSaveError(problem);
      return;
    }
    setSaving(true);
    const result = await saveBalanceComparisonAction(draft);
    setSaving(false);
    if (!result.ok || !result.data) {
      setSaveError(result.error ?? "The comparison could not be saved.");
      return;
    }
    setBaseline(draftKey(withName, noteText, fresh));
    message.success(result.data.message);
    router.refresh();
  };

  if (!data) {
    return (
      <Alert
        type="warning"
        showIcon
        title={loadError ?? LOAD_FAILED}
        action={
          <Button size="small" onClick={() => router.refresh()}>
            Try again
          </Button>
        }
      />
    );
  }

  const nothing = data.header ? null : nothingTypedMessage(asOf, data.savedDates);

  /* ------------------------------------------------------------ table */

  const figureCell = (line: Extract<TableLine, { kind: "row" }>) => {
    const r = line.row;
    if (!canSave || r.inactive) {
      return r.otherMinor === null ? "" : <span className={r.otherMinor < 0 ? styles.negative : undefined}>{money(r.otherMinor)}</span>;
    }
    return (
      <FigureBox
        label={`${r.code} ${r.name}: figure in ${otherName}`}
        initialText={rawText[r.key] ?? (r.otherMinor === null ? "" : formatFigureText(r.otherMinor, decimals))}
        error={errors[r.key] ?? null}
        onText={(text) => commit(r, text)}
        rowKey={r.key}
        register={registerBox}
      />
    );
  };

  const moneyText = (minor: number | null) =>
    minor === null ? "" : <span className={minor < 0 ? styles.negative : undefined}>{money(minor)}</span>;

  const columns: TableColumnsType<TableLine> = [
    { title: "Code", key: "code", width: COMPARISON_CODE_WIDTH, render: (_, l) => (l.kind === "row" ? l.row.code : "") },
    {
      ...flexColumn<TableLine>({
        title: "Account",
        key: "account",
        floor: COMPARISON_ACCOUNT_FLOOR,
        render: (_, l) => {
          if (l.kind === "heading") return l.label;
          if (l.kind === "total") return <strong>{l.label}</strong>;
          const r = l.row;
          return (
            <>
              <span>{r.name}</span>
              {r.inactive ? (
                <>
                  {" "}
                  <Tag>Inactive</Tag>
                  <span className={styles.note}>{INACTIVE_ROW_NOTE}</span>
                </>
              ) : null}
              {r.external ? (
                <span className={styles.note}>
                  Only in {otherName}
                  {canSave ? (
                    <>
                      {" · "}
                      <Button type="link" size="small" style={{ padding: 0, height: "auto" }} onClick={() => removeExternal(r)}>
                        Remove
                      </Button>
                    </>
                  ) : null}
                </span>
              ) : null}
            </>
          );
        },
      }),
      // A sentence under the name wraps rather than being cut to one line.
      ellipsis: false,
    },
    {
      title: "OneBook",
      key: "onebook",
      width: COMPARISON_ONEBOOK_WIDTH,
      align: "right",
      render: (_, l) =>
        l.kind === "row" ? moneyText(l.row.onebookMinor) : l.kind === "total" ? <strong>{moneyText(l.totals.onebookMinor)}</strong> : "",
    },
    {
      title: otherName,
      key: "other",
      width: COMPARISON_OTHER_WIDTH,
      align: "right",
      render: (_, l) => (l.kind === "row" ? figureCell(l) : l.kind === "total" ? <strong>{moneyText(l.totals.otherMinor)}</strong> : ""),
    },
    {
      title: "Difference",
      key: "difference",
      width: COMPARISON_DIFFERENCE_WIDTH,
      align: "right",
      render: (_, l) => {
        if (l.kind === "total") return <strong>{moneyText(l.totals.differenceMinor)}</strong>;
        if (l.kind !== "row" || l.row.differenceMinor === null) return "";
        const text = moneyText(l.row.differenceMinor);
        return rowDiffers(l.row) ? (
          <span className={styles.differenceFlag}>
            <span role="img" aria-label="Differs">
              ≠
            </span>{" "}
            {text}
          </span>
        ) : (
          text
        );
      },
    },
  ];

  const rowClassName = (l: TableLine) =>
    l.kind === "heading"
      ? styles.heading
      : l.kind === "total"
        ? paper.totalRow
        : rowDiffers(l.row)
          ? styles.differs
          : "";

  return (
    <div>
      <ReportBar
        ariaLabel="Comparison date, other system and exports"
        dates={{ kind: "asOf", to: pickedAsOf, onTo: setPickedAsOf }}
        onRun={() => (pickedAsOf === asOf ? router.refresh() : goTo(pickedAsOf))}
        loading={false}
        sheet={sheet}
        filters={
          <>
            <Input
              ref={withRef}
              aria-label="Compared with"
              prefix={<span className={paper.muted}>Compared with</span>}
              placeholder="For example, QuickBooks"
              maxLength={80}
              defaultValue={initial.comparedWith}
              disabled={!canSave}
              // Room for "Compared with" and the whole hint after it, with the
              // few pixels Chrome needs before it cuts a placeholder short.
              style={{ width: 296 }}
              onBlur={(e) => setComparedWith(e.currentTarget.value)}
              onPressEnter={(e) => e.currentTarget.blur()}
            />
            <Input
              ref={noteRef}
              aria-label="Note"
              prefix={<span className={paper.muted}>Note</span>}
              placeholder="Optional"
              maxLength={500}
              defaultValue={initial.note}
              disabled={!canSave}
              style={{ width: 280 }}
              onBlur={(e) => setNote(e.currentTarget.value)}
              onPressEnter={(e) => e.currentTarget.blur()}
            />
          </>
        }
        actions={
          canSave ? (
            <Button type="primary" onClick={() => void save()} loading={saving}>
              Save
            </Button>
          ) : null
        }
      />

      {nothing ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          title={
            nothing.parts && nothing.nearest ? (
              <>
                {nothing.parts.before}
                <Link href={`${PATH}?asOf=${nothing.nearest}`}>{nothing.parts.date}</Link>
                {nothing.parts.after}
              </>
            ) : (
              nothing.text
            )
          }
        />
      ) : null}

      {saveError ? <Alert type="error" showIcon closable style={{ marginBottom: 12 }} title={saveError} onClose={() => setSaveError(null)} /> : null}

      <ReportPaper companyName={companyName} title={heading} range={BALANCE_BASIS_NOTE} currencyCode={currencyCode}>
        <StatRow
          items={[
            { label: "Figures typed", value: comparison.typedCount.toLocaleString("en-US") },
            {
              label: "Accounts that differ",
              value: comparison.differenceCount.toLocaleString("en-US"),
              danger: comparison.differenceCount > 0,
            },
          ]}
        />
        <div className={styles.toolbar}>
          <Checkbox checked={onlyDifferences} onChange={(e) => setOnlyDifferences(e.target.checked)}>
            Only differences
          </Checkbox>
          {canSave ? (
            <Button onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
              Add an account the other system has
            </Button>
          ) : null}
        </div>
        {adding ? (
          <AddExternalPanel
            otherName={otherName}
            decimals={decimals}
            existingKeys={new Set(externals.map((e) => e.key))}
            onAdd={addExternal}
            onCancel={() => setAdding(false)}
          />
        ) : null}
        {nothingToShow ? (
          <div className={paper.empty}>{NO_DIFFERENCES}</div>
        ) : (
          <div className={paper.det}>
            <DataTable<TableLine>
              className={styles.comparisonTable}
              rowKey="key"
              pagination={false}
              dataSource={lines}
              columns={columns}
              rowClassName={rowClassName}
              emptyTitle="No accounts to compare"
            />
          </div>
        )}
        <ReportFoot>
          {canSave
            ? "Type each figure as the other system prints it, for example 1,234.56, (1,234.56) or 1,234.56 CR. Leave a box empty when there is no figure; an empty box is never saved as zero. The difference is OneBook minus the other system."
            : "The difference is OneBook minus the other system. Only staff can type or save figures."}
        </ReportFoot>
      </ReportPaper>
    </div>
  );
}
