import type { FormInstance } from "antd";

type NamePath = Parameters<FormInstance["scrollToField"]>[0];

/**
 * Validate every field; when one is wrong, bring the first into view, put
 * focus in it and return null.
 *
 * The dialogs here validate from their own Save button with validateFields(),
 * which marks the fields red but leaves focus on Save and the first error
 * possibly out of sight. Ant Design's scrollToFirstError only runs on a form
 * submit, which these dialogs do not use.
 */
export async function validateOrFocus<Values>(form: FormInstance<Values>): Promise<Values | null> {
  try {
    return await form.validateFields();
  } catch (error) {
    const first = (error as { errorFields?: { name: NamePath }[] }).errorFields?.[0];
    if (first) form.scrollToField(first.name, { focus: true, block: "center" });
    return null;
  }
}
