"use client";
import { useState } from "react";
import { App, Button, DatePicker, Dropdown, Input, Modal, Select } from "antd";
import type { MenuProps } from "antd";
import { MoreOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import {
  transitionProblem,
  type SurfaceNouns,
  type WorkLifecycle,
} from "@/lib/domain/work-surface/lifecycle";
import type { SurfaceWorkItem } from "@/lib/domain/work-surface/types";
import type {
  WorkItemActionResult,
  WorkItemChange,
} from "@/lib/services/work-surface/change-work-item";

export interface Assignee {
  id: string;
  name: string;
}

/** The server action that writes the change. Passed in, so one menu serves every surface. */
export type ChangeAction = (change: WorkItemChange) => Promise<WorkItemActionResult>;

/**
 * What a person can do with one piece of work.
 *
 * Every option writes the same row through the same action, so the guard and the
 * concurrency token cannot drift between them. An option a rule forbids is not
 * shown greyed out — it is not shown: a menu that offers Dismiss on a blocking
 * item teaches the wrong thing, even when clicking it would fail.
 *
 * The `blocking` flag on the item is used **only to decide what to draw**. The
 * decision that matters is taken on the server, which re-derives it from the
 * records — see `change-work-item.ts`. A screen that lied about the flag would
 * get a menu it could not use, not a dismissal it should not have.
 */
export default function WorkItemActions({
  item,
  assignees,
  onChanged,
  changeAction,
  nouns = {},
}: {
  item: SurfaceWorkItem;
  assignees: Assignee[];
  onChanged: () => void;
  changeAction: ChangeAction;
  nouns?: SurfaceNouns;
}) {
  const { message } = App.useApp();
  const [assignOpen, setAssignOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [dismissOpen, setDismissOpen] = useState(false);
  const [owner, setOwner] = useState<string | null>(item.ownerId);
  const [due, setDue] = useState<string | null>(item.dueDate);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function change(
    to: WorkLifecycle,
    over: { ownerId?: string | null; dueDate?: string | null; reason?: string | null } = {},
  ) {
    setBusy(true);
    const result = await changeAction({
      key: item.key,
      from: item.lifecycle,
      to,
      ownerId: over.ownerId !== undefined ? over.ownerId : item.ownerId,
      dueDate: over.dueDate !== undefined ? over.dueDate : item.dueDate,
      reason: over.reason ?? null,
      expectedVersion: item.stateVersion,
    });
    setBusy(false);
    if (!result.ok) {
      message.error(result.error ?? "Could not change this item");
      return false;
    }
    onChanged();
    return true;
  }

  const menu: MenuProps["items"] = [];
  if (item.lifecycle === "new") {
    menu.push({ key: "ack", label: "Acknowledge", onClick: () => void change("acknowledged") });
  }
  if (item.lifecycle !== "in_progress" && item.lifecycle !== "dismissed") {
    menu.push({ key: "start", label: "Start work", onClick: () => void change("in_progress") });
  }
  if (item.lifecycle === "acknowledged" || item.lifecycle === "in_progress") {
    menu.push({ key: "put-down", label: "Put back in the queue", onClick: () => void change("new") });
  }
  menu.push({
    key: "assign",
    label: item.ownerId ? "Reassign…" : "Assign to…",
    onClick: () => {
      setOwner(item.ownerId);
      setAssignOpen(true);
    },
  });
  menu.push({
    key: "due",
    label: item.dueDate ? "Change due date…" : "Set a due date…",
    onClick: () => {
      setDue(item.dueDate);
      setDateOpen(true);
    },
  });

  if (item.lifecycle === "dismissed") {
    menu.push({ type: "divider" as const, key: "before-restore" });
    menu.push({ key: "restore", label: "Put it back", onClick: () => void change("new") });
  } else if (transitionProblem(item.lifecycle, "dismissed", item, "x", nouns) === null) {
    // Offered only when the rules actually allow it. A blocking item never sees
    // this option at all.
    menu.push({ type: "divider" as const, key: "before-dismiss" });
    menu.push({
      key: "dismiss",
      label: "Dismiss…",
      danger: true,
      onClick: () => {
        setReason("");
        setDismissOpen(true);
      },
    });
  }

  return (
    <>
      <Dropdown menu={{ items: menu, style: { minWidth: 190 } }} trigger={["click"]}>
        <Button size="small" icon={<MoreOutlined />} aria-label={`Actions for ${item.title}`} />
      </Dropdown>

      <Modal
        title="Who is doing this?"
        open={assignOpen}
        confirmLoading={busy}
        okText="Assign"
        onCancel={() => setAssignOpen(false)}
        onOk={async () => {
          if (
            await change(item.lifecycle === "new" ? "acknowledged" : item.lifecycle, {
              ownerId: owner,
            })
          ) {
            setAssignOpen(false);
          }
        }}
      >
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="Nobody — leave it unassigned"
          style={{ width: "100%" }}
          value={owner ?? undefined}
          onChange={(value) => setOwner(value ?? null)}
          options={assignees.map((person) => ({ value: person.id, label: person.name }))}
        />
      </Modal>

      <Modal
        title="When should this be done?"
        open={dateOpen}
        confirmLoading={busy}
        okText="Set the date"
        onCancel={() => setDateOpen(false)}
        onOk={async () => {
          if (await change(item.lifecycle, { dueDate: due })) setDateOpen(false);
        }}
      >
        <DatePicker
          style={{ width: "100%" }}
          value={due ? dayjs(due) : null}
          onChange={(value) => setDue(value ? value.format("YYYY-MM-DD") : null)}
        />
      </Modal>

      <Modal
        title={`Dismiss "${item.title}"?`}
        open={dismissOpen}
        confirmLoading={busy}
        okText="Dismiss"
        okButtonProps={{ danger: true }}
        onCancel={() => setDismissOpen(false)}
        onOk={async () => {
          if (await change("dismissed", { reason })) setDismissOpen(false);
        }}
      >
        <p>
          It drops out of the queue and stays readable under Dismissed. The exception itself is
          untouched — if it is still there tomorrow, dismissing it does not make it go away.
        </p>
        <Input
          placeholder="Duplicate of the entry posted on the 3rd"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Modal>
    </>
  );
}
