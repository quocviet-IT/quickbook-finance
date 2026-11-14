"use client";
import { useState } from "react";
import { Button, Modal, Typography } from "antd";
import { ArrowLeftOutlined, ArrowRightOutlined, ColumnWidthOutlined, MinusOutlined, PlusOutlined } from "@ant-design/icons";
import IconActionButton from "./IconActionButton";

/**
 * Arranging a table's columns without dragging (3.0.35, UI audit A9).
 *
 * Bank Transactions lets a reader drag a column heading to move it and drag
 * its edge to resize it, and General Ledger lets them resize. Both were
 * pointer-only: nothing a keyboard or a screen reader could reach, and a drag
 * is exactly what a shaky hand or a touchpad does badly (WCAG 2.2, 2.5.7).
 * This dialog does the same two things with buttons, one step at a time, and
 * says what each press did. Dragging still works as it did.
 *
 * A dialog rather than a popover: it takes focus when it opens, keeps it
 * until Done or Escape, and hands it back to the Columns button.
 */
export interface ArrangeableColumn<K extends string> {
  key: K;
  /** The column's heading, as the table shows it. */
  label: string;
  movable: boolean;
  resizable: boolean;
}

export default function ColumnsDialog<K extends string>({
  table,
  columns,
  onMove,
  onStep,
  onReset,
}: {
  /** The table's name, for the dialog's title: "Bank Transactions". */
  table: string;
  /** In the order the table shows them. */
  columns: readonly ArrangeableColumn<K>[];
  /** One place left or right; returns the new position, from 1. */
  onMove?: (key: K, step: -1 | 1) => number;
  /** One step narrower or wider; returns the new width, or null if it could not be measured. */
  onStep?: (key: K, direction: -1 | 1) => number | null;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  /** What the last press did, read out by a screen reader and shown under the list. */
  const [said, setSaid] = useState("");
  const movable = columns.filter((column) => column.movable);
  // A row without one pair of buttons keeps their place, so every row's buttons line up.
  const anyMoves = Boolean(onMove) && movable.length > 0;
  const anyWidths = Boolean(onStep) && columns.some((column) => column.resizable);
  const gap = (
    <>
      <span className="columns-dialog__spacer" aria-hidden />
      <span className="columns-dialog__spacer" aria-hidden />
    </>
  );

  const move = (column: ArrangeableColumn<K>, step: -1 | 1) => {
    if (!onMove) return;
    const position = onMove(column.key, step);
    setSaid(`${column.label} is now column ${position} of ${movable.length}.`);
  };
  const resize = (column: ArrangeableColumn<K>, direction: -1 | 1) => {
    if (!onStep) return;
    const width = onStep(column.key, direction);
    setSaid(width === null ? `${column.label} could not be measured; it is unchanged.` : `${column.label} is ${width} pixels wide.`);
  };

  return (
    <>
      <Button size="small" icon={<ColumnWidthOutlined />} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        Columns
      </Button>
      <Modal
        open={open}
        title={`${table} columns`}
        onCancel={() => setOpen(false)}
        afterClose={() => setSaid("")}
        destroyOnHidden
        footer={[
          <Button
            key="reset"
            onClick={() => {
              onReset();
              setSaid("The columns are back in their usual order and widths.");
            }}
          >
            Reset columns
          </Button>,
          <Button key="done" type="primary" onClick={() => setOpen(false)}>
            Done
          </Button>,
        ]}
      >
        <Typography.Paragraph type="secondary">
          Dragging a column heading, or its right edge, does the same with the mouse.
        </Typography.Paragraph>
        <ol className="columns-dialog__list" aria-label={`${table} columns, in order`}>
          {columns.map((column) => {
            const at = movable.findIndex((candidate) => candidate.key === column.key);
            return (
              <li key={column.key} className="columns-dialog__row">
                <span>{column.label}</span>
                <span className="columns-dialog__buttons">
                  {column.movable && onMove ? (
                    <>
                      <IconActionButton
                        label={`Move ${column.label} left`}
                        icon={<ArrowLeftOutlined />}
                        disabled={at <= 0}
                        onClick={() => move(column, -1)}
                      />
                      <IconActionButton
                        label={`Move ${column.label} right`}
                        icon={<ArrowRightOutlined />}
                        disabled={at === movable.length - 1}
                        onClick={() => move(column, 1)}
                      />
                    </>
                  ) : anyMoves ? (
                    gap
                  ) : null}
                  {column.resizable && onStep ? (
                    <>
                      <IconActionButton label={`Make ${column.label} narrower`} icon={<MinusOutlined />} onClick={() => resize(column, -1)} />
                      <IconActionButton label={`Make ${column.label} wider`} icon={<PlusOutlined />} onClick={() => resize(column, 1)} />
                    </>
                  ) : anyWidths ? (
                    gap
                  ) : null}
                </span>
              </li>
            );
          })}
        </ol>
        <p className="columns-dialog__said" role="status" aria-live="polite">
          {said}
        </p>
      </Modal>
    </>
  );
}
