import { describe, expect, it } from "vitest";
import type { ModalFuncProps } from "antd";
import { closeOrConfirmDiscard, destructiveConfirmProps } from "@/lib/client/destructive-confirm";

describe("destructiveConfirmProps", () => {
  // The Void dialog opened with focus on Void, so Enter voided the invoice.
  it("opens with focus on Cancel and the destructive button marked as danger", () => {
    const onOk = () => undefined;
    const props = destructiveConfirmProps({ title: "Void INV-000004?", content: "Reverses JE-000026.", okText: "Void", onOk });
    expect(props.autoFocusButton).toBe("cancel");
    expect(props.okButtonProps).toEqual({ danger: true });
    expect(props.okText).toBe("Void");
    expect(props.cancelText).toBe("Cancel");
    expect(props.onOk).toBe(onOk);
  });
});

describe("closeOrConfirmDiscard", () => {
  function recorder() {
    const asked: ModalFuncProps[] = [];
    let closed = 0;
    return {
      asked,
      closedCount: () => closed,
      confirm: (props: ModalFuncProps) => {
        asked.push(props);
      },
      close: () => {
        closed += 1;
      },
    };
  }

  it("closes at once when nothing was typed", () => {
    const r = recorder();
    closeOrConfirmDiscard({ dirty: false, what: "this invoice", confirm: r.confirm, close: r.close });
    expect(r.closedCount()).toBe(1);
    expect(r.asked).toHaveLength(0);
  });

  // Escape on a half-written invoice closed it and threw the lines away.
  it("asks first when something was typed, and closes only if the reader discards", () => {
    const r = recorder();
    closeOrConfirmDiscard({ dirty: true, what: "this invoice", confirm: r.confirm, close: r.close });
    expect(r.closedCount()).toBe(0);
    expect(r.asked).toHaveLength(1);
    const [question] = r.asked;
    expect(question.title).toBe("Discard this invoice?");
    expect(question.content).toBe("What you entered has not been saved. Discarding it cannot be undone.");
    expect(question.okText).toBe("Discard");
    expect(question.cancelText).toBe("Keep editing");
    expect(question.autoFocusButton).toBe("cancel");
    void question.onOk?.();
    expect(r.closedCount()).toBe(1);
  });
});
