"use client";

import { Button, Dropdown, Tooltip, type MenuProps } from "antd";
import { BulbOutlined, CheckOutlined, DesktopOutlined, MoonOutlined } from "@ant-design/icons";
import { useTheme } from "./ThemeProvider";
import type { ThemeMode } from "@/lib/domain/theme";

/**
 * One button that shows the theme you are in, and opens the three choices.
 *
 * It was three segmented buttons sitting permanently in the header. Reported
 * as making the bar too crowded to read, which it was: the header already
 * carries a company switcher, a search field, a New transaction button, the
 * approvals count and the account menu. A display preference does not earn
 * three permanent slots beside five things people came here to use.
 *
 * The icon is the theme currently in effect — a sun in light, a moon in dark —
 * so the bar answers "which am I in" at a glance and costs one slot to do it.
 * "Match my system" is a mode rather than a third icon: when it is chosen the
 * button shows whichever theme the machine has picked, because that is what
 * the reader is looking at, and the menu is where the distinction lives.
 */
const LABEL: Record<ThemeMode, string> = {
  light: "Light",
  dark: "Dark",
  system: "Match my system",
};

export default function ThemeToggle() {
  const { mode, theme, setMode } = useTheme();

  const items: MenuProps["items"] = (["light", "dark", "system"] as ThemeMode[]).map((value) => ({
    key: value,
    // The tick marks the chosen *mode*, not the theme showing. Someone on
    // "system" needs to see that they are on system, even while the button
    // beside it shows a moon.
    icon:
      value === "light" ? <BulbOutlined /> : value === "dark" ? <MoonOutlined /> : <DesktopOutlined />,
    label: (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 132 }}>
        <span style={{ flex: 1 }}>{LABEL[value]}</span>
        {mode === value ? <CheckOutlined style={{ fontSize: 12 }} /> : null}
      </span>
    ),
    onClick: () => setMode(value),
  }));

  return (
    <Dropdown menu={{ items, selectedKeys: [mode] }} placement="bottomRight" trigger={["click"]}>
      <Tooltip title={`Theme: ${LABEL[mode]}`} placement="bottom">
        <Button
          type="text"
          aria-label={`Colour theme: ${LABEL[mode]}. Choose another.`}
          icon={theme === "dark" ? <MoonOutlined /> : <BulbOutlined />}
        />
      </Tooltip>
    </Dropdown>
  );
}
