/**
 * The Microsoft password complexity standard, as Active Directory and
 * Entra ID enforce it, applied to administrator-assigned passwords:
 *
 *   1. 8 to 256 characters;
 *   2. characters from at least three of the four categories — uppercase,
 *      lowercase, digit, and everything else;
 *   3. the password must not contain the user's account name, nor any part
 *      of their display name three or more characters long. The name is
 *      split on the same delimiters AD uses — commas, periods, dashes,
 *      underscores, spaces, pound signs, and tabs — and shorter parts are
 *      ignored, exactly as the AD rule ignores them.
 *
 * Pure and shared: the Zod schema and the create-user form both call this,
 * so the browser and the server cannot disagree about what a valid
 * password is.
 */

const AD_NAME_DELIMITERS = /[,.\-_\s#\t]+/;

function nameParts(fullName: string | null | undefined): string[] {
  return (fullName ?? "")
    .split(AD_NAME_DELIMITERS)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3);
}

/** The email's local part — what AD would call the account name. */
function accountNameOf(email: string | null | undefined): string {
  const local = (email ?? "").split("@")[0]?.trim() ?? "";
  return local.length >= 3 ? local : "";
}

/**
 * Every way the password falls short of the Microsoft standard, in plain
 * words; an empty list means it complies.
 */
export function passwordPolicyProblems(
  password: string,
  email: string | null | undefined,
  fullName: string | null | undefined,
): string[] {
  const problems: string[] = [];

  if (password.length < 8) {
    problems.push("Use at least 8 characters.");
  }
  if (password.length > 256) {
    problems.push("Use at most 256 characters.");
  }

  const categories =
    Number(/[a-z]/.test(password)) +
    Number(/[A-Z]/.test(password)) +
    Number(/\d/.test(password)) +
    Number(/[^A-Za-z0-9]/.test(password));
  if (categories < 3) {
    problems.push(
      "Use three of the four kinds of character: uppercase, lowercase, a number, a symbol.",
    );
  }

  const lower = password.toLowerCase();
  const account = accountNameOf(email);
  if (account && lower.includes(account.toLowerCase())) {
    problems.push("The password must not contain the account name from the email.");
  }
  for (const part of nameParts(fullName)) {
    if (lower.includes(part.toLowerCase())) {
      problems.push(`The password must not contain "${part}" from the person's name.`);
      break;
    }
  }

  return problems;
}
