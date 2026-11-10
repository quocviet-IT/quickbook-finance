import type { ModalFuncProps } from "antd";

/**
 * A question before something that cannot be taken back.
 *
 * Focus starts on Cancel. Ant Design's confirm focuses its OK button, so the
 * Void dialog opened with Void under the reader's Enter key (3.0.8 review).
 */
export function destructiveConfirmProps({
  title,
  content,
  okText,
  onOk,
  cancelText = "Cancel",
}: {
  title: string;
  content: string;
  okText: string;
  onOk: ModalFuncProps["onOk"];
  cancelText?: string;
}): ModalFuncProps {
  return {
    title,
    content,
    okText,
    okButtonProps: { danger: true },
    cancelText,
    autoFocusButton: "cancel",
    onOk,
  };
}

/**
 * Closing a form: at once when nothing was typed, otherwise only after the
 * reader agrees to throw it away. Escape, the close button and Cancel all come
 * here; a click outside the form does not close it at all.
 */
export function closeOrConfirmDiscard({
  dirty,
  what,
  confirm,
  close,
}: {
  dirty: boolean;
  /** "this invoice", "this customer". */
  what: string;
  /** `modal.confirm` from App.useApp(). */
  confirm: (props: ModalFuncProps) => unknown;
  close: () => void;
}): void {
  if (!dirty) {
    close();
    return;
  }
  confirm(
    destructiveConfirmProps({
      title: `Discard ${what}?`,
      content: "What you entered has not been saved. Discarding it cannot be undone.",
      okText: "Discard",
      cancelText: "Keep editing",
      onOk: close,
    }),
  );
}
