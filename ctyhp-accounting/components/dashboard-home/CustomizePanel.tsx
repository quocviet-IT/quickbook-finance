"use client";
import { ArrowDownOutlined, ArrowUpOutlined } from "@ant-design/icons";
import { Button, Checkbox, Tooltip } from "antd";
import {
  HOME_PRESETS,
  moveWidget,
  presetLayout,
  toggleShown,
  widgetTitle,
  type OverviewLayout,
} from "@/lib/domain/dashboard-home/layout";
import styles from "./dashboard-home.module.css";

/**
 * Customize the Overview tab (3.0.39): start from a preset, tick the cards to
 * show, move them with the arrows (or drag the cards themselves below), then
 * save. Drawn between the tabs and the Overview's cards, on Overview only.
 * Every change shows at once in the cards below; nothing is kept until Save.
 */
export default function CustomizePanel({
  layout,
  saving,
  onChange,
  onSave,
  onCancel,
}: {
  layout: OverviewLayout;
  saving: boolean;
  onChange: (next: OverviewLayout) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const last = layout.order.length - 1;
  return (
    <div className={styles.customize} role="region" aria-label="Customize the Overview tab">
      <h2 className={styles.cardTitle}>Customize the Overview tab</h2>
      <div className={styles.customizeRow}>
        <span className={styles.caption}>
          <b>Start from</b>
        </span>
        {HOME_PRESETS.map((preset) => (
          <Button key={preset.key} size="small" onClick={() => onChange(presetLayout(preset.key))}>
            {preset.label}
          </Button>
        ))}
        <span className={styles.caption}>
          Drag a card to move it, or use the arrows. The button above a card makes it wider or narrower.
        </span>
      </div>
      <ul className={styles.customizeList}>
        {layout.order.map((key, index) => {
          const title = widgetTitle(key);
          return (
            <li key={key} className={styles.customizeItem}>
              <Checkbox className={styles.customizeCheck} checked={layout.shown.includes(key)} onChange={() => onChange(toggleShown(layout, key))}>
                {title}
              </Checkbox>
              <Tooltip title="Move earlier">
                <Button
                  size="small"
                  icon={<ArrowUpOutlined aria-hidden="true" />}
                  aria-label={`Move ${title} earlier`}
                  disabled={index === 0}
                  onClick={() => onChange(moveWidget(layout, key, -1))}
                />
              </Tooltip>
              <Tooltip title="Move later">
                <Button
                  size="small"
                  icon={<ArrowDownOutlined aria-hidden="true" />}
                  aria-label={`Move ${title} later`}
                  disabled={index === last}
                  onClick={() => onChange(moveWidget(layout, key, 1))}
                />
              </Tooltip>
            </li>
          );
        })}
      </ul>
      <div className={styles.customizeRow}>
        <Button type="primary" loading={saving} onClick={onSave}>
          Save layout
        </Button>
        <Button disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
        <span className={styles.caption}>The layout is yours alone; other people in the company keep their own.</span>
      </div>
    </div>
  );
}
