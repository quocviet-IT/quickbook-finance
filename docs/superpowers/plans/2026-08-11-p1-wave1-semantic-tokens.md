# P1 Đợt 1 — Semantic Token: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dựng `lib/design/tokens.ts` làm nguồn sự thật cho màu, rồi đưa **theme Ant Design và mọi màu viết thẳng trong TSX** về đọc từ đó.

**Phạm vi thật — sửa lại sau review toàn nhánh.** Bản đầu của dòng này viết "toàn bộ màu của One Book", và đó là nói quá. Đợt này gỡ 71 hex khỏi 21 file `.tsx` cộng 18 hex trong `providers.tsx`. Nó **không** đụng tới **309 hex nằm trong CSS** của chính hai thư mục đó:

| File | Hex còn lại |
|---|---|
| `app/globals.css` | 225 (chưa kể 32 dòng `:root` mới) |
| `components/work-areas/WorkAreaOverview.module.css` | 84 |

Và chúng đúng là loại trùng lặp đợt này sinh ra để dẹp — riêng `#0f766e` xuất hiện 30 lần trong `globals.css`. Nguyên nhân của sai sót: khảo sát ban đầu đo `globals.css` có 6 custom property rồi kết luận "token gần như không tồn tại", mà **không đếm số hex trong đó**.

Hai file này giờ nằm trong allowlist của `tests/unit/no-hardcoded-color.test.ts` kèm số lượng và lý do, và guard đã mở sang `.css` — trước đó nó chỉ quét `.ts`/`.tsx`, tức lối thoát dễ nhất (đặt màu vào CSS Module cạnh component) đang mở toang và **đã có một component đi qua đó**.

**Cũng chưa thuộc phạm vi:** 64 chỗ `<Tag color="red">` dùng bảng preset của antd, sinh độc lập với `colorError`. Nên `CustomerCreditClient` hiện vẽ `#b91c1c` cạnh `#cf1322` — hai sắc đỏ cùng nghĩa trên một màn hình. Bài toán "ba sắc đỏ" mới giải được một nửa; nửa còn lại thuộc `statusColumn()` của Đợt 2.

**Architecture:** Module thuần ba tầng — palette (màu thô) → semantic (ý nghĩa kế toán) → emitters (`antdThemeTokens()` cho Ant Design, `cssVariableBlock()` cho CSS). Không I/O, không React, nên unit test giữ được toàn bộ. Chống trôi lệch bằng test so khớp thay vì bằng kỷ luật review.

**Tech Stack:** TypeScript 5, Vitest 4 (`environment: "node"`, `include: ["tests/**/*.test.ts"]`), Ant Design 6 `ConfigProvider`, Next.js 16.

## Global Constraints

- Thư mục làm việc là `ctyhp-accounting/`. Mọi đường dẫn dưới đây tương đối với nó.
- Tiền là minor units nguyên; không đụng tới logic tiền trong đợt này.
- Prose hướng người dùng bằng tiếng Anh Mỹ (US English). Code, định danh, comment bằng tiếng Anh.
- Comment giải thích **tại sao**, theo văn phong sẵn có của codebase.
- Không bao giờ nuốt lỗi (không `catch {}` rỗng).
- Bốn cổng bắt buộc trước khi tuyên bố xong: `npm run build`, `npm test`, `npm run typecheck`, `npm run lint`.
- Đổi UI thì phải chạy `scripts/smoke-pages.mjs` **trên server đã build**, không phải `npm run dev`.
- Không force-push. Không commit lên `main` khi chưa được yêu cầu — tạo nhánh trước.

## Phạm vi và thay đổi hình ảnh có chủ ý

Task 1–6 (nền tảng) **không đổi pixel nào** vì không component nào bị sửa.

Task 7–10 (chuyển đổi) **có** đổi pixel ở những chỗ đang tồn tại màu trùng nghĩa. Đây là chủ ý, và đây là danh sách đầy đủ:

| Hex hiện tại | Số chỗ | Gộp về | Ghi chú |
|---|---|---|---|
| `#cf1322` | 11 | `intent.danger` = `#b91c1c` | Đỏ mặc định của antd, lẫn với đỏ của theme |
| `#b42318` | 1 | `intent.danger` = `#b91c1c` | Đỏ thứ ba cùng nghĩa |
| `#389e0d` | 2 | `intent.success` = `#15803d` | Xanh mặc định của antd |
| `#3f8600` | 1 | `intent.success` = `#15803d` | Xanh thứ ba cùng nghĩa |
| `#047857` | 1 | `intent.success` = `#15803d` | Xanh thứ tư cùng nghĩa |
| `#8c8c8c`, `#999`, `#f5f5f5` | 4 | `text.secondary` / `surface.muted` | Xám mặc định của antd |

Màu của **chuỗi dữ liệu biểu đồ** (`series.*`) được chuyển nguyên giá trị, không gộp. Chọn lại một dải màu phân loại đã kiểm định là quyết định riêng, **ngoài phạm vi đợt này**, vì nó đổi diện mạo biểu đồ chứ không sửa trôi lệch.

## File Structure

| File | Trách nhiệm |
|---|---|
| `lib/design/palette.ts` (tạo) | Chỉ giá trị màu thô. Không ý nghĩa. Không ai ngoài `tokens.ts` được import |
| `lib/design/tokens.ts` (tạo) | Ánh xạ ngữ nghĩa + hai hàm phát sinh. Đây là API công khai |
| `lib/design/status.tsx` (tạo) | `statusToken()` trả bộ ba màu+icon+nhãn. Tách khỏi `tokens.ts` vì có JSX icon |
| `tests/unit/design-tokens.test.ts` (tạo) | Phân giải, tương phản, đồng bộ `:root`, `providers.tsx` sạch hex |
| `tests/unit/no-hardcoded-color.test.ts` (tạo) | Guard chống tái phát + allowlist thu hẹp dần |
| `app/providers.tsx` (sửa) | Đọc từ `antdThemeTokens()` thay vì 18 literal hex |
| `app/globals.css` (sửa) | Thêm khối `:root` ở đầu file |

**Sai khác có chủ ý so với spec.** Spec mục 5 mô tả `lib/design/tokens.ts` là một file duy nhất. Kế hoạch tách thành ba, vì hai lý do kỹ thuật chỉ lộ ra khi viết test:

- Tách `palette.ts` để phép kiểm "mọi token ngữ nghĩa phân giải về một mục trong palette" có hai vế thật sự độc lập. Cùng một file thì phép kiểm đó tự khẳng định chính nó.
- Tách `status.tsx` vì nó chứa JSX, còn `tokens.ts` phải giữ thuần để chạy được trong `environment: "node"` mà Vitest đang cấu hình.

Ranh giới ngữ nghĩa của spec không đổi: vẫn một nguồn sự thật, chỉ là ba file thay vì một.

**Về các bước "thêm vào file test":** Task 2, 3 và 4 đều bổ sung vào cùng
`tests/unit/design-tokens.test.ts`. Mỗi task hiển thị dòng `import` mà ca kiểm
thử mới cần — hãy **gộp chúng vào khối import ở đầu file**, đừng chèn giữa file.
Import lặp lại cùng một module sẽ làm `npm run typecheck` đỏ.

---

### Task 1: Palette và semantic token

**Files:**
- Create: `lib/design/palette.ts`
- Create: `lib/design/tokens.ts`
- Test: `tests/unit/design-tokens.test.ts`

**Interfaces:**
- Consumes: không có (task đầu tiên)
- Produces:
  - `PALETTE: Record<string, string>` từ `lib/design/palette.ts`
  - `TOKENS` với các nhánh `money`, `intent`, `text`, `surface`, `border`, `series` từ `lib/design/tokens.ts`
  - `type TokenPath = string` — khóa phẳng dạng `"money.negative"`
  - `resolveToken(path: TokenPath): string`

- [ ] **Step 1: Write the failing test**

Tạo `tests/unit/design-tokens.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PALETTE } from "@/lib/design/palette";
import { TOKENS, flattenTokens, resolveToken } from "@/lib/design/tokens";

describe("design tokens", () => {
  it("resolves every semantic token to a palette entry", () => {
    // Widened on purpose: PALETTE is `as const`, so an inferred Set would be
    // typed to the literal hexes and refuse the plain string a token carries.
    const paletteValues = new Set<string>(Object.values(PALETTE));
    const orphans = flattenTokens(TOKENS)
      .filter(([, value]) => !paletteValues.has(value))
      .map(([path, value]) => `${path} → ${value}`);
    expect(orphans).toEqual([]);
  });

  it("resolves a token by its dotted path", () => {
    expect(resolveToken("money.negative")).toBe(PALETTE.red700);
    expect(resolveToken("intent.primary")).toBe(PALETTE.teal700);
  });

  it("throws on an unknown token path rather than returning undefined", () => {
    expect(() => resolveToken("money.sideways")).toThrow(/money\.sideways/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/design-tokens.test.ts`
Expected: FAIL — `Cannot find module '@/lib/design/palette'`

- [ ] **Step 3: Write the palette**

Tạo `lib/design/palette.ts`:

```ts
/**
 * Raw colour values. These carry no meaning on their own — `red700` says what
 * the colour is, never what it is for. Meaning is assigned once, in tokens.ts,
 * so a screen that wants "an overdue amount" cannot pick a different red from
 * the one every other screen uses.
 *
 * Nothing outside tokens.ts may import this file.
 */
export const PALETTE = {
  // Brand and chrome
  teal700: "#0f766e",
  slate900: "#0f172a",
  slate600: "#475569",
  slate400: "#94a3b8",
  slate200: "#e2e8f0",
  slate100: "#f1f5f9",
  slate50: "#f6f7f9",
  white: "#ffffff",

  // Intent
  red700: "#b91c1c",
  green700: "#15803d",
  amber700: "#b45309",
  orange700: "#c2410c",
  blue700: "#1d4ed8",
  violet600: "#7c3aed",
  sky700: "#0369a1",
} as const;

export type PaletteKey = keyof typeof PALETTE;
```

- [ ] **Step 4: Write the semantic layer**

Tạo `lib/design/tokens.ts`:

```ts
import { PALETTE } from "./palette";

/**
 * What each colour is *for*. This is the single definition the Ant Design
 * theme, the CSS custom properties and every component all derive from.
 *
 * The three groups answer different questions and must not be collapsed:
 *   * `money` / `intent` / `text` / `surface` / `border` carry meaning, so two
 *     of them may share a palette entry only when they genuinely mean the same
 *     thing.
 *   * `series` is a categorical scale for charts. Its entries are told apart
 *     from each other, not read for meaning, so contrast rules that apply to
 *     text do not apply here.
 */
export const TOKENS = {
  money: {
    positive: PALETTE.green700,
    negative: PALETTE.red700,
    zero: PALETTE.slate600,
  },
  intent: {
    primary: PALETTE.teal700,
    success: PALETTE.green700,
    warning: PALETTE.amber700,
    danger: PALETTE.red700,
    info: PALETTE.blue700,
  },
  text: {
    heading: PALETTE.slate900,
    body: PALETTE.slate900,
    secondary: PALETTE.slate600,
    onDark: PALETTE.white,
  },
  surface: {
    page: PALETTE.slate50,
    card: PALETTE.white,
    muted: PALETTE.slate100,
    sider: PALETTE.slate900,
  },
  border: {
    default: PALETTE.slate200,
    subtle: PALETTE.slate100,
  },
  // Chart series. Values are carried across unchanged from the two maps that
  // previously defined them by hand (DashboardClient and FinancialCharts);
  // choosing a validated categorical scale is a separate decision.
  series: {
    sales: PALETTE.teal700,
    purchases: PALETTE.violet600,
    inventory: PALETTE.sky700,
    banking: PALETTE.blue700,
    close: PALETTE.orange700,
    governance: PALETTE.slate600,
    other: PALETTE.slate400,
    income: PALETTE.teal700,
    expense: PALETTE.orange700,
    net: PALETTE.blue700,
    receivable: PALETTE.teal700,
    payable: PALETTE.violet600,
    axis: PALETTE.slate400,
    grid: PALETTE.slate200,
  },
} as const;

export type Tokens = typeof TOKENS;

/** Every token as a `["group.name", value]` pair, in declaration order. */
export function flattenTokens(tokens: Tokens = TOKENS): [string, string][] {
  const out: [string, string][] = [];
  for (const [group, entries] of Object.entries(tokens)) {
    for (const [name, value] of Object.entries(entries as Record<string, string>)) {
      out.push([`${group}.${name}`, value]);
    }
  }
  return out;
}

/**
 * Look a token up by its dotted path. Throws rather than returning undefined:
 * an unknown path is a typo, and a silent `undefined` reaches the DOM as a
 * missing colour that nobody notices until a screenshot looks wrong.
 */
export function resolveToken(path: string): string {
  const found = flattenTokens().find(([key]) => key === path);
  if (!found) throw new Error(`Unknown design token: ${path}`);
  return found[1];
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/design-tokens.test.ts`
Expected: PASS — 3 tests

- [ ] **Step 6: Commit**

```bash
git add lib/design/palette.ts lib/design/tokens.ts tests/unit/design-tokens.test.ts
git commit -m "feat(design): add palette and semantic colour tokens"
```

---

### Task 2: Kiểm tra tương phản WCAG AA

**Files:**
- Modify: `lib/design/tokens.ts` (thêm `TEXT_ON_SURFACE_PAIRS`)
- Test: `tests/unit/design-tokens.test.ts` (thêm ca kiểm thử)

**Interfaces:**
- Consumes: `TOKENS`, `resolveToken` (Task 1)
- Produces: `TEXT_ON_SURFACE_PAIRS: readonly [string, string][]` — các cặp `[textPath, surfacePath]` phải đạt AA

Tương phản chỉ áp cho **chữ trên nền**. `series.axis` và `series.grid` là nét vẽ trang trí, không phải chữ; ép chúng đạt 4.5:1 sẽ làm hỏng biểu đồ mà không giúp ai.

- [ ] **Step 1: Write the failing test**

Thêm vào `tests/unit/design-tokens.test.ts`:

```ts
import { TEXT_ON_SURFACE_PAIRS } from "@/lib/design/tokens";

/** WCAG 2.1 relative luminance. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("colour contrast", () => {
  it("meets WCAG AA 4.5:1 for every text-on-surface pair", () => {
    const failures = TEXT_ON_SURFACE_PAIRS.map(([textPath, surfacePath]) => {
      const ratio = contrastRatio(resolveToken(textPath), resolveToken(surfacePath));
      // Compare the true ratio and round only for the message. Rounding first
      // would let a pair at 4.4951 read as 4.50 and pass, quietly lowering the
      // one threshold this test exists to hold.
      return { pair: `${textPath} on ${surfacePath}`, ratio, shown: ratio.toFixed(2) };
    }).filter((row) => row.ratio < 4.5);
    expect(failures).toEqual([]);
  });

  it("checks a meaningful number of pairs", () => {
    expect(TEXT_ON_SURFACE_PAIRS.length).toBeGreaterThanOrEqual(10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/design-tokens.test.ts`
Expected: FAIL — `TEXT_ON_SURFACE_PAIRS` chưa được export

- [ ] **Step 3: Declare the pairs**

Thêm vào cuối `lib/design/tokens.ts`:

```ts
/**
 * Which colours are read as text against which background.
 *
 * Only text belongs here. `series.axis` and `series.grid` are decorative
 * strokes on a chart: holding them to a text contrast ratio would darken the
 * chart furniture without making anything more readable.
 */
export const TEXT_ON_SURFACE_PAIRS: readonly [string, string][] = [
  ["text.heading", "surface.page"],
  ["text.heading", "surface.card"],
  ["text.body", "surface.page"],
  ["text.body", "surface.card"],
  ["text.secondary", "surface.page"],
  ["text.secondary", "surface.card"],
  ["text.onDark", "surface.sider"],
  ["money.positive", "surface.card"],
  ["money.negative", "surface.card"],
  ["money.zero", "surface.card"],
  ["intent.primary", "surface.card"],
  ["intent.success", "surface.card"],
  ["intent.warning", "surface.card"],
  ["intent.danger", "surface.card"],
  ["intent.info", "surface.card"],
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/design-tokens.test.ts`
Expected: PASS — 5 tests

Nếu một cặp trượt, **không nới ngưỡng**. Đổi giá trị trong `palette.ts` sang sắc độ đậm hơn và ghi lý do vào comment.

- [ ] **Step 5: Commit**

```bash
git add lib/design/tokens.ts tests/unit/design-tokens.test.ts
git commit -m "test(design): hold every text-on-surface pair to WCAG AA"
```

---

### Task 3: Phát sinh CSS custom property và đồng bộ globals.css

**Files:**
- Modify: `lib/design/tokens.ts` (thêm `cssVariableBlock`)
- Modify: `app/globals.css` (chèn khối `:root` ở đầu file)
- Test: `tests/unit/design-tokens.test.ts`

**Interfaces:**
- Consumes: `flattenTokens` (Task 1)
- Produces: `cssVariableBlock(): string` — khối `:root` hoàn chỉnh, kết thúc bằng newline

- [ ] **Step 1: Write the failing test**

Thêm vào `tests/unit/design-tokens.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cssVariableBlock } from "@/lib/design/tokens";

describe("CSS custom properties", () => {
  it("names every token as --ob-group-name", () => {
    const block = cssVariableBlock();
    expect(block).toContain("--ob-money-negative: #b91c1c;");
    expect(block).toContain("--ob-intent-primary: #0f766e;");
    expect(block.startsWith(":root {")).toBe(true);
    expect(block.endsWith("}\n")).toBe(true);
  });

  it("matches the block committed in globals.css character for character", () => {
    const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
    expect(css).toContain(cssVariableBlock());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/design-tokens.test.ts`
Expected: FAIL — `cssVariableBlock` chưa được export

- [ ] **Step 3: Write the emitter**

Thêm vào cuối `lib/design/tokens.ts`:

```ts
/**
 * The tokens as a `:root` block.
 *
 * Emitted into globals.css as static text rather than injected at runtime: a
 * runtime style block costs bytes on every response and cannot be inspected in
 * a diff. A unit test asserts the committed CSS still matches this output, so
 * editing one without the other fails the build instead of drifting quietly.
 */
export function cssVariableBlock(): string {
  const lines = flattenTokens().map(
    ([path, value]) => `  --ob-${path.replace(".", "-")}: ${value};`,
  );
  return `:root {\n${lines.join("\n")}\n}\n`;
}
```

- [ ] **Step 4: Paste the block into globals.css**

Chèn vào **đầu** `app/globals.css`, phía trên khối `html, body {`. Đây là đầu ra chính xác của `cssVariableBlock()` với `TOKENS` ở Task 1 — 32 dòng, đúng thứ tự khai báo:

```css
/* Generated from lib/design/tokens.ts. Do not edit by hand — a unit test
   asserts this block still matches cssVariableBlock() exactly, so changing a
   colour means changing the token and copying the new block over. */
:root {
  --ob-money-positive: #15803d;
  --ob-money-negative: #b91c1c;
  --ob-money-zero: #475569;
  --ob-intent-primary: #0f766e;
  --ob-intent-success: #15803d;
  --ob-intent-warning: #b45309;
  --ob-intent-danger: #b91c1c;
  --ob-intent-info: #1d4ed8;
  --ob-text-heading: #0f172a;
  --ob-text-body: #0f172a;
  --ob-text-secondary: #475569;
  --ob-text-onDark: #ffffff;
  --ob-surface-page: #f6f7f9;
  --ob-surface-card: #ffffff;
  --ob-surface-muted: #f1f5f9;
  --ob-surface-sider: #0f172a;
  --ob-border-default: #e2e8f0;
  --ob-border-subtle: #f1f5f9;
  --ob-series-sales: #0f766e;
  --ob-series-purchases: #7c3aed;
  --ob-series-inventory: #0369a1;
  --ob-series-banking: #1d4ed8;
  --ob-series-close: #c2410c;
  --ob-series-governance: #475569;
  --ob-series-other: #94a3b8;
  --ob-series-income: #0f766e;
  --ob-series-expense: #c2410c;
  --ob-series-net: #1d4ed8;
  --ob-series-receivable: #0f766e;
  --ob-series-payable: #7c3aed;
  --ob-series-axis: #94a3b8;
  --ob-series-grid: #e2e8f0;
}
```

Nếu test ở Step 5 báo lệch, **đừng sửa CSS bằng tay**. Chạy lệnh sau để in ra khối đúng rồi thay nguyên:

```bash
npx vitest run tests/unit/design-tokens.test.ts --reporter=verbose
```

Thông báo lệch của Vitest hiển thị chuỗi mong đợi đầy đủ.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/design-tokens.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 6: Commit**

```bash
git add lib/design/tokens.ts app/globals.css tests/unit/design-tokens.test.ts
git commit -m "feat(design): emit tokens as CSS custom properties, guarded by test"
```

---

### Task 4: Nối providers.tsx vào tokens

**Files:**
- Modify: `app/providers.tsx:17-53`
- Modify: `lib/design/tokens.ts` (thêm `antdThemeTokens`)
- Test: `tests/unit/design-tokens.test.ts`

**Interfaces:**
- Consumes: `TOKENS` (Task 1)
- Produces: `antdThemeTokens(): { token: Record<string, unknown>; components: Record<string, unknown> }`

- [ ] **Step 1: Write the failing test**

Thêm vào `tests/unit/design-tokens.test.ts`:

```ts
import { antdThemeTokens } from "@/lib/design/tokens";

describe("Ant Design theme", () => {
  it("derives its colours from the tokens", () => {
    const theme = antdThemeTokens();
    expect(theme.token.colorPrimary).toBe(resolveToken("intent.primary"));
    expect(theme.token.colorError).toBe(resolveToken("intent.danger"));
    expect(theme.components.Layout.siderBg).toBe(resolveToken("surface.sider"));
  });

  it("leaves no literal colour in providers.tsx", () => {
    const source = readFileSync(join(process.cwd(), "app", "providers.tsx"), "utf8");
    expect(source.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/design-tokens.test.ts`
Expected: FAIL — `antdThemeTokens` chưa export, và `providers.tsx` còn 18 hex

- [ ] **Step 3: Write the emitter**

Thêm vào cuối `lib/design/tokens.ts`:

```ts
/**
 * The colour half of the Ant Design theme.
 *
 * Only colour lives here. Radius, font and size stay in providers.tsx because
 * they are not tokens this module governs, and moving them would make this the
 * home of settings it has nothing to say about.
 */
export function antdThemeTokens() {
  return {
    token: {
      colorPrimary: TOKENS.intent.primary,
      colorInfo: TOKENS.intent.primary,
      colorSuccess: TOKENS.intent.success,
      colorWarning: TOKENS.intent.warning,
      colorError: TOKENS.intent.danger,
      colorBgLayout: TOKENS.surface.page,
      colorTextHeading: TOKENS.text.heading,
    },
    components: {
      Layout: {
        siderBg: TOKENS.surface.sider,
        triggerBg: TOKENS.surface.sider,
        headerBg: TOKENS.surface.card,
      },
      Menu: {
        darkItemBg: TOKENS.surface.sider,
        darkSubMenuItemBg: TOKENS.surface.sider,
        darkItemSelectedBg: TOKENS.intent.primary,
        darkItemColor: TOKENS.border.default,
        darkItemHoverBg: TOKENS.text.secondary,
      },
      Table: {
        headerBg: TOKENS.surface.muted,
        headerColor: TOKENS.text.secondary,
        borderColor: TOKENS.border.subtle,
      },
    },
  };
}
```

**Lưu ý thay đổi hình ảnh — NĂM giá trị, không phải ba.** Bản kiểm kê đầu tiên của kế hoạch này đếm thiếu; review Task 4 tìm ra hai giá trị còn lại. Tất cả đều là sắc độ riêng lẻ không thuộc thang màu nào:

| Thuộc tính | Cũ | Mới | Ảnh hưởng |
|---|---|---|---|
| `Layout.triggerBg` | `#0b1220` | `surface.sider` `#0f172a` | Trước đã gần như trùng siderBg (1.05:1) |
| `Menu.darkItemColor` | `#cbd5e1` | `border.default` `#e2e8f0` | 14.5:1 trên nền sider |
| `Menu.darkItemHoverBg` | `#1e293b` | `text.secondary` `#475569` | Hover **rõ hơn** trước (2.4:1 so với 1.2:1) |
| `Table.headerColor` | `#334155` | `text.secondary` `#475569` | Tương phản 9.5:1 → 6.9:1, vẫn vượt AA |
| `Table.borderColor` | `#eef2f6` | `border.subtle` `#f1f5f9` | Lệch 3/255 mỗi kênh, không nhìn thấy |

Cả năm đã được chấp nhận có cân nhắc. Lý do giữ `Table.headerColor` theo `text.secondary`: tiêu đề cột là nhãn phụ, nên đó mới là token đúng về ngữ nghĩa; `#334155` cũ là một sắc độ tùy ý. **Không** thêm giá trị mới vào palette chỉ để bảo toàn sắc độ cũ — đó đúng là thứ đợt này dẹp.

**Một thứ `antdThemeTokens()` không được mang: các giá trị không phải màu.** `Layout.headerHeight: 56` từng bị mất đúng vì lý do này khi theme chuyển sang token, và mọi trang vẫn render bình thường với chiều cao header sai. Giữ chúng trong `providers.tsx`, và spread lên `components.Layout` để không xóa mất màu:

```tsx
components: {
  ...components,
  Layout: { ...components.Layout, headerHeight: 56 },
  Card: { borderRadiusLG: 12 },
},
```

- [ ] **Step 4: Rewrite providers.tsx**

Thay `app/providers.tsx` bằng:

```tsx
"use client";
import { App, ConfigProvider, theme as antdTheme } from "antd";
import enUS from "antd/locale/en_US";
import { antdThemeTokens } from "@/lib/design/tokens";

const SANS =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/**
 * App-wide Ant Design context: English locale, a disciplined enterprise theme
 * (teal primary, slate chrome), and App context for message/modal.
 * Uses a native font stack — zero web-font requests keeps first paint fast.
 *
 * Every colour comes from lib/design/tokens.ts. A literal here would be a
 * second source of truth for a colour the rest of the app reads from there,
 * and a unit test refuses one.
 */
export default function Providers({ children }: { children: React.ReactNode }) {
  const { token, components } = antdThemeTokens();
  return (
    <ConfigProvider
      locale={enUS}
      theme={{
        algorithm: antdTheme.defaultAlgorithm,
        token: { ...token, borderRadius: 8, fontFamily: SANS, fontSize: 14, wireframe: false },
        components: { ...components, Card: { borderRadiusLG: 12 } },
      }}
    >
      <App>{children}</App>
    </ConfigProvider>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/design-tokens.test.ts`
Expected: PASS — 9 tests

- [ ] **Step 6: Verify the app still renders**

```bash
npm run build
npm start
node --env-file=.env.local scripts/smoke-pages.mjs http://localhost:3000
```

Expected: 48 trang, 0 lỗi. Dừng server sau khi xong.

- [ ] **Step 7: Commit**

```bash
git add lib/design/tokens.ts app/providers.tsx tests/unit/design-tokens.test.ts
git commit -m "refactor(design): derive the Ant Design theme from tokens"
```

---

### Task 5: statusToken — màu không bao giờ đi một mình

**Files:**
- Create: `lib/design/status.tsx`
- Test: `tests/unit/design-status.test.ts`

**Interfaces:**
- Consumes: `TOKENS` (Task 1)
- Produces:
  - `type StatusKey = "posted" | "void" | "draft" | "overdue" | "pending"`
  - `statusToken(key: StatusKey): { color: string; icon: ReactNode; label: string }`

Đây là điểm biến quy tắc a11y thành cấu trúc: không có cách nào lấy màu trạng thái mà không nhận kèm icon và nhãn.

- [ ] **Step 1: Write the failing test**

Tạo `tests/unit/design-status.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { STATUS_KEYS, statusToken } from "@/lib/design/status";
import { TOKENS } from "@/lib/design/tokens";

describe("status tokens", () => {
  it("returns a colour, an icon and a label for every status", () => {
    for (const key of STATUS_KEYS) {
      const token = statusToken(key);
      expect(token.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(token.icon).toBeTruthy();
      expect(token.label.length).toBeGreaterThan(0);
    }
  });

  it("gives overdue the danger colour and void a muted one", () => {
    expect(statusToken("overdue").color).toBe(TOKENS.intent.danger);
    expect(statusToken("void").color).toBe(TOKENS.text.secondary);
  });

  it("gives each status a distinct label so colour is never the only signal", () => {
    const labels = STATUS_KEYS.map((key) => statusToken(key).label);
    expect(new Set(labels).size).toBe(STATUS_KEYS.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/design-status.test.ts`
Expected: FAIL — `Cannot find module '@/lib/design/status'`

- [ ] **Step 3: Write the implementation**

Tạo `lib/design/status.tsx`:

```tsx
import type { ReactNode } from "react";
import {
  CheckCircleFilled,
  ClockCircleFilled,
  EditFilled,
  ExclamationCircleFilled,
  StopFilled,
} from "@ant-design/icons";
import { TOKENS } from "./tokens";

/**
 * A document status, and the three things a reader needs to tell it apart.
 *
 * The colour is never returned on its own. Colour alone fails anyone who cannot
 * distinguish the hues, and it fails everyone in a printed report — so asking
 * this module for a status colour hands back the icon and the wording with it,
 * and a caller cannot take the colour while leaving the other two behind.
 */
export const STATUS_KEYS = ["posted", "void", "draft", "overdue", "pending"] as const;

export type StatusKey = (typeof STATUS_KEYS)[number];

export interface StatusToken {
  color: string;
  icon: ReactNode;
  label: string;
}

const STATUS: Record<StatusKey, StatusToken> = {
  posted: { color: TOKENS.intent.success, icon: <CheckCircleFilled />, label: "Posted" },
  void: { color: TOKENS.text.secondary, icon: <StopFilled />, label: "Void" },
  draft: { color: TOKENS.text.secondary, icon: <EditFilled />, label: "Draft" },
  overdue: { color: TOKENS.intent.danger, icon: <ExclamationCircleFilled />, label: "Overdue" },
  pending: { color: TOKENS.intent.warning, icon: <ClockCircleFilled />, label: "Pending" },
};

export function statusToken(key: StatusKey): StatusToken {
  return STATUS[key];
}
```

- [ ] **Step 4: Allow TSX in the test include**

`vitest.config.ts` hiện chỉ nhận `tests/**/*.test.ts`. Test này import một file `.tsx`, nên cần JSX transform. Sửa `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  esbuild: {
    // lib/design/status.tsx carries JSX. React 19's automatic runtime means no
    // React import is needed in the source file.
    jsx: "automatic",
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/design-status.test.ts`
Expected: PASS — 3 tests

- [ ] **Step 6: Commit**

```bash
git add lib/design/status.tsx tests/unit/design-status.test.ts vitest.config.ts
git commit -m "feat(design): pair every status colour with an icon and a label"
```

---

### Task 6: Guard chống tái phát hex, kèm allowlist

**Files:**
- Create: `tests/unit/no-hardcoded-color.test.ts`

**Interfaces:**
- Consumes: không có
- Produces: allowlist mà Task 7–10 thu hẹp dần

Guard bật **ngay bây giờ**, khi 21 file còn nợ, để gate xanh suốt và phần nợ hiện thành danh sách đọc được.

- [ ] **Step 1: Write the test with the current offenders listed**

Tạo `tests/unit/no-hardcoded-color.test.ts`:

```ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Colour belongs in lib/design/tokens.ts and nowhere else.
 *
 * Every hex below is a hand-copied duplicate of a value the theme already
 * defines, which is how three different reds all came to mean "error". The
 * allowlist is the work still outstanding: it shrinks with each migration
 * batch and is deleted with the last one. A file may not be added back.
 *
 * Scope is app/ and components/. lib/client/invoice-pdf.ts and
 * lib/client/report-export.ts are excluded on purpose: colours inside a
 * generated PDF are not CSS and do not derive from the theme.
 */
const ALLOWLIST = new Set([
  "app/(app)/dashboard/DashboardClient.tsx",
  "components/charts/FinancialCharts.tsx",
  "components/payables/PayRunPanel.tsx",
  "app/(app)/reports/transactions/TransactionListClient.tsx",
  "components/feedback/ReportDialog.tsx",
  "app/(app)/reports/inventory-review/InventoryReviewClient.tsx",
  "app/(app)/reports/gl-posting/GlPostingClient.tsx",
  "app/(app)/reports/customer-credit/CustomerCreditClient.tsx",
  "app/(app)/reports/cash-flow-forecast/CashFlowForecastClient.tsx",
  "app/(app)/fixed-assets/FixedAssetsClient.tsx",
  "app/(auth)/login/page.tsx",
  "app/(app)/settings/import/ImportPreviewPanel.tsx",
  "app/(app)/reports/saved/SavedReportsClient.tsx",
  "app/(app)/reports/saved/SaveReportModal.tsx",
  "app/(app)/reports/number-sequence/NumberSequenceClient.tsx",
  "app/(app)/reports/fixed-assets/FixedAssetReportClient.tsx",
  "app/(app)/reports/1099/Report1099Client.tsx",
  "app/(app)/recurring/RecurringClient.tsx",
  "app/(app)/banking/BankingClient.tsx",
  "app/(app)/banking/BankTransactionsTable.tsx",
  "app/(app)/accounts/AccountsClient.tsx",
]);

/**
 * Built fresh on each use, never shared.
 *
 * A regex literal with the `g` flag carries `lastIndex` between calls, so
 * `.test()` on the same pattern alternates true and false across files and
 * quietly clears half the offenders. This guard exists to be trusted, so it
 * does not reuse one.
 */
const hexPattern = () => /#[0-9a-fA-F]{3,8}\b/;
const ROOT = process.cwd();

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith(".tsx") || entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

const files = [...sourceFiles(join(ROOT, "app")), ...sourceFiles(join(ROOT, "components"))];

describe("hard-coded colour", () => {
  it("finds files to check", () => {
    expect(files.length).toBeGreaterThan(150);
  });

  it("appears in no file outside the shrinking allowlist", () => {
    const offenders = files
      .map((file) => ({ path: relative(ROOT, file).replaceAll("\\", "/"), source: readFileSync(file, "utf8") }))
      .filter(({ path }) => !ALLOWLIST.has(path))
      .filter(({ source }) => hexPattern().test(source))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it("lists no file that has already been cleaned", () => {
    const stale = [...ALLOWLIST].filter((path) => {
      const source = readFileSync(join(ROOT, path), "utf8");
      return !hexPattern().test(source);
    });
    expect(stale).toEqual([]);
  });
});
```

Ca kiểm thử thứ ba là phần quan trọng: nó **buộc allowlist phải co lại**. Dọn sạch một file mà quên xóa khỏi allowlist thì test đỏ, nên danh sách không thể phình ra thành lời nói dối.

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run tests/unit/no-hardcoded-color.test.ts`
Expected: PASS — 3 tests. `providers.tsx` đã sạch từ Task 4 nên không có mặt trong allowlist.

- [ ] **Step 3: Run the whole suite**

Run: `npm test`
Expected: PASS toàn bộ

- [ ] **Step 4: Commit**

```bash
git add tests/unit/no-hardcoded-color.test.ts
git commit -m "test(design): guard against hard-coded colour, with a shrinking allowlist"
```

---

## Task 7–10: Chuyển đổi theo cụm

Bốn task còn lại dùng **chung một quy trình**. Chép lại đầy đủ ở đây vì người thực hiện có thể đọc không theo thứ tự.

### Quy trình cho mỗi file

1. Mở file, tìm mọi hex bằng `#[0-9a-fA-F]{3,8}\b`
2. Tra bảng ánh xạ dưới đây để chọn token
3. Thay bằng `TOKENS.<nhóm>.<tên>`, thêm `import { TOKENS } from "@/lib/design/tokens";`
4. Nếu hex đó biểu thị một **trạng thái chứng từ**, dùng `statusToken()` thay vì màu trần, và hiển thị cả icon lẫn nhãn
5. Xóa đường dẫn file khỏi `ALLOWLIST` trong `tests/unit/no-hardcoded-color.test.ts`
6. Chạy `npx vitest run tests/unit/no-hardcoded-color.test.ts` — phải PASS
7. Commit từng file hoặc từng cụm nhỏ

### Bảng ánh xạ đầy đủ

| Hex | Token | Ghi chú |
|---|---|---|
| `#b91c1c`, `#cf1322`, `#b42318` | `TOKENS.intent.danger` | Gộp ba đỏ |
| `#15803d`, `#389e0d`, `#3f8600`, `#047857` | `TOKENS.intent.success` | Gộp bốn xanh |
| `#b45309`, `#d46b08` | `TOKENS.intent.warning` | |
| `#7c3aed` | `TOKENS.series.purchases` | |
| `#0369a1` | `TOKENS.series.inventory` | |
| `#475569`, `#8c8c8c`, `#999` | `TOKENS.text.secondary` | |
| `#f1f5f9`, `#f5f5f5` | `TOKENS.surface.muted` | |
| `#e5e7eb` | `TOKENS.border.default` | |

Số âm trong bảng số liệu dùng `TOKENS.money.negative`, **không** dùng `intent.danger`: một số âm không phải một lỗi.

### Những chỗ cùng một hex mang hai nghĩa

Bốn giá trị dưới đây xuất hiện ở nhiều nơi với ý nghĩa khác nhau, nên không có ánh xạ chung. Đây là địa chỉ chính xác của từng chỗ, để không phải đoán:

| File:dòng | Hex | Token |
|---|---|---|
| `DashboardClient.tsx:281` | `#0f766e` | `TOKENS.intent.primary` |
| `DashboardClient.tsx:566` | `#0f766e` | `TOKENS.series.sales` |
| `FinancialCharts.tsx:12` | `#0f766e` | `TOKENS.series.income` |
| `FinancialCharts.tsx:15` | `#0f766e` | `TOKENS.series.receivable` |
| `DashboardClient.tsx:293` | `#1d4ed8` | `TOKENS.intent.info` |
| `DashboardClient.tsx:569` | `#1d4ed8` | `TOKENS.series.banking` |
| `FinancialCharts.tsx:14` | `#1d4ed8` | `TOKENS.series.net` |
| `DashboardClient.tsx:287` | `#c2410c` | `TOKENS.intent.warning` |
| `DashboardClient.tsx:570` | `#c2410c` | `TOKENS.series.close` |
| `FinancialCharts.tsx:13` | `#c2410c` | `TOKENS.series.expense` |
| `DashboardClient.tsx:572` | `#94a3b8` | `TOKENS.series.other` |
| `FinancialCharts.tsx:138` | `#94a3b8` | `TOKENS.series.axis` |
| `FinancialCharts.tsx:125` | `#e2e8f0` | `TOKENS.series.grid` |
| `FinancialCharts.tsx:188` | `#ffffff` | `TOKENS.text.onDark` |

Hex ở các file khác không nằm trong bảng này đều đơn nghĩa và tra được từ bảng ánh xạ trên.

### Task 7: Biểu đồ và dashboard

**Files:**
- Modify: `app/(app)/dashboard/DashboardClient.tsx` (13 hex, dòng 281–323 và 566–572)
- Modify: `components/charts/FinancialCharts.tsx` (11 hex, dòng 12–19, 125, 138, 188)
- Test: `tests/unit/no-hardcoded-color.test.ts` (xóa 2 mục khỏi allowlist)

Hai file này giữ **bản đồ danh mục riêng chồng nhau** — `sales: #0f766e` ở file này và `income: #0f766e` ở file kia. Sau khi chuyển, cả hai đọc từ `TOKENS.series`, và sự trùng lặp trở nên nhìn thấy được cho quyết định về sau.

- [ ] **Step 1:** Chuyển `DashboardClient.tsx` theo quy trình trên
- [ ] **Step 2:** Chuyển `FinancialCharts.tsx` theo quy trình trên
- [ ] **Step 3:** Xóa hai đường dẫn khỏi `ALLOWLIST`
- [ ] **Step 4:** Run: `npx vitest run tests/unit/no-hardcoded-color.test.ts` — Expected: PASS
- [ ] **Step 5:** Commit

```bash
git add app/\(app\)/dashboard/DashboardClient.tsx components/charts/FinancialCharts.tsx tests/unit/no-hardcoded-color.test.ts
git commit -m "refactor(design): read chart and dashboard colour from tokens"
```

### Task 8: Báo cáo

**Files:** 9 file trong `app/(app)/reports/` (`transactions`, `inventory-review`, `gl-posting`, `customer-credit`, `cash-flow-forecast`, `saved/SavedReportsClient`, `saved/SaveReportModal`, `number-sequence`, `fixed-assets`, `1099`) — tổng 14 hex

- [ ] **Step 1:** Chuyển từng file theo quy trình trên. `TransactionListClient.tsx:249` (`amount < 0 ? "#b91c1c" : "#15803d"`) phải thành `TOKENS.money.negative` / `TOKENS.money.positive`, **không** phải `intent.*`
- [ ] **Step 2:** Xóa 9 đường dẫn khỏi `ALLOWLIST`
- [ ] **Step 3:** Run: `npx vitest run tests/unit/no-hardcoded-color.test.ts` — Expected: PASS
- [ ] **Step 4:** Commit `refactor(design): read report colour from tokens`

### Task 9: Nghiệp vụ

**Files:** `components/payables/PayRunPanel.tsx` (3), `app/(app)/fixed-assets/FixedAssetsClient.tsx` (2), `app/(app)/recurring/RecurringClient.tsx` (1), `app/(app)/banking/BankingClient.tsx` (1), `app/(app)/banking/BankTransactionsTable.tsx` (1), `app/(app)/accounts/AccountsClient.tsx` (1)

- [ ] **Step 1:** Chuyển từng file. `PayRunPanel.tsx:80` là tổng quá hạn → dùng `statusToken("overdue")` để có cả icon và nhãn, không chỉ màu
- [ ] **Step 2:** Xóa 6 đường dẫn khỏi `ALLOWLIST`
- [ ] **Step 3:** Run: `npx vitest run tests/unit/no-hardcoded-color.test.ts` — Expected: PASS
- [ ] **Step 4:** Commit `refactor(design): read operational screen colour from tokens`

### Task 10: Còn lại, và xóa cơ chế allowlist

**Files:** `components/feedback/ReportDialog.tsx` (2), `app/(auth)/login/page.tsx` (1), `app/(app)/settings/import/ImportPreviewPanel.tsx` (1)

- [ ] **Step 1:** Chuyển ba file cuối
- [ ] **Step 2:** Xóa ba đường dẫn khỏi `ALLOWLIST` — danh sách giờ rỗng
- [ ] **Step 3:** Xóa hằng `ALLOWLIST`, bỏ hai `.filter()` dùng nó, và xóa luôn ca kiểm thử `"lists no file that has already been cleaned"` (không còn gì để giữ đúng)
- [ ] **Step 4:** Run: `npx vitest run tests/unit/no-hardcoded-color.test.ts` — Expected: PASS, 2 tests
- [ ] **Step 5:** Chạy đủ bốn cổng

```bash
npm run typecheck && npm test && npm run lint && npm run build
```

Expected: cả bốn xanh. **Dán nguyên văn đầu ra, không cắt bớt** — dòng pass/fail thường nằm ở cuối.

- [ ] **Step 6:** Xác nhận trên ứng dụng thật

```bash
npm start
node --env-file=.env.local scripts/smoke-pages.mjs http://localhost:3000
```

Expected: 48 trang, 0 lỗi.

- [ ] **Step 7:** Đo lại chất lượng

```bash
npm run quality:bundle
```

Expected: không vượt budget (10% hoặc 20 KB gzip). Đợt này không nhằm giảm bundle; phép đo để chắc chắn nó không **tăng**.

- [ ] **Step 8:** Commit

```bash
git add -A
git commit -m "refactor(design): finish the colour migration and retire the allowlist"
```

---

## Tiêu chí nghiệm thu Đợt 1

- [ ] `ALLOWLIST` không còn tồn tại trong mã nguồn
- [ ] `grep -rE '#[0-9a-fA-F]{3,8}\b' app components --include=*.tsx --include=*.ts` không trả về kết quả nào
- [ ] Test tương phản WCAG AA xanh với ≥ 10 cặp
- [ ] Khối `:root` trong `globals.css` khớp `cssVariableBlock()`
- [ ] Bốn cổng xanh, đầu ra dán nguyên văn
- [ ] `scripts/smoke-pages.mjs` xanh trên server đã build
- [ ] `npm run quality:bundle` không vượt budget
