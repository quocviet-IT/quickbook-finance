"use client";

import { Segmented, Tooltip } from "antd";
import { BulbOutlined, DesktopOutlined, MoonOutlined } from "@ant-design/icons";
import { useTheme } from "./ThemeProvider";
import type { ThemeMode } from "@/lib/domain/theme";

/**
 * Light, dark, or whatever this machine says.
 *
 * Three states rather than a two-way switch, because "follow the system" is
 * not the same preference as "light" — somebody whose machine turns dark at
 * sunset wants the app to turn with it, and a toggle can only express the
 * theme they are in right now, never that.
 *
 * Icons rather than words: the bar it sits in is already busy, and these
 * three are as close to universal as an icon gets. The labels stay in the
 * tooltip and the aria-label, so nothing is hidden from anyone reading with
 * something other than their eyes.
 */
const OPTIONS: { value: ThemeMode; icon: React.ReactNode; label: string }[] = [
  { value: "light", icon: <BulbOutlined />, label: "Light" },
  { value: "dark", icon: <MoonOutlined />, label: "Dark" },
  { value: "system", icon: <DesktopOutlined />, label: "Match my system" },
];

export default function ThemeToggle() {
  const { mode, setMode } = useTheme();
  return (
    <Segmented<ThemeMode>
      size="small"
      value={mode}
      onChange={setMode}
      aria-label="Colour theme"
      options={OPTIONS.map((option) => ({
        value: option.value,
        label: (
          <Tooltip title={option.label}>
            <span aria-label={option.label} role="img">
              {option.icon}
            </span>
          </Tooltip>
        ),
      }))}
    />
  );
}
