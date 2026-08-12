# P1 — Chuẩn hóa nền tảng UI của One Book

Ngày: 2026-08-11
Trạng thái: thiết kế đã duyệt, chờ lập kế hoạch triển khai

## 1. Mục đích

P0 đã dựng xong bộ đo (Axe, keyboard harness, ma trận viewport, budget bundle,
baseline). P1 dùng bộ đo đó để chuẩn hóa nền tảng UI, nhằm đưa trục UX và
Accessibility lên mức 8.0.

P1 **không** đưa trục Performance lên 8.0. Lý do nằm ở mục 3.

## 2. Hiện trạng đo được

Toàn bộ số dưới đây đo trực tiếp từ mã nguồn và từ `.quality-results/` ngày
2026-08-11, không phải ước lượng.

| Chỉ số | Giá trị |
|---|---|
| File khai báo `columns=` | 73 |
| File tự định dạng tiền tệ | 56 |
| Chỗ dùng `<Table>` | 51 (37 file import antd `Table` trực tiếp, 33 file dùng `DataTable`) |
| `pagination={false}` | 61 |
| Trang `force-dynamic` | 59/60 |
| TSX là Client Component | 128/201 |
| Component trên 400 dòng | 13 |
| `next/dynamic` | **0** |
| CSS custom property trong `globals.css` (3.312 dòng) | **6** (5 trong số đó là `--dashboard-*` cục bộ, không có khối `:root`) |

Mức đa dạng tính năng của bảng rất thấp: `summary=` 6 chỗ (toàn báo cáo),
`expandable=` 5, `rowSelection=` 1, `onRow=` 1, `rowClassName=` 12.

### Bundle (gzip)

| | |
|---|---|
| Tải trên ~59/63 route, trải trên 30 chunk | **613 KB** |
| `/invoices` tổng | 935 KB |
| `/banking` tổng | 921 KB |
| Route nhẹ nhất trong nhóm app | ~720 KB |

Chunk lớn nhất chỉ thuộc một route: 136 KB trên `/banking`, 121 KB trên
`/invoices`.

### Ba phát hiện làm đổi hướng triển khai

**a. Hệ token đã tồn tại, chỉ là không ai đọc nó.**
`app/providers.tsx` khai báo đầy đủ `colorPrimary: #0f766e`,
`colorSuccess: #15803d`, `colorError: #b91c1c`, `colorTextHeading: #0f172a`.
Các hex cứng rải trong TSX chính là bản sao chép tay của đúng các giá trị đó:
`#0f766e` 8 chỗ, `#b91c1c` 7, `#15803d` 5, `#0f172a` 4. Vậy công việc không phải
phát minh hệ token, mà là làm nguồn sự thật đã có với tới được CSS và TSX.

**b. Trùng lặp của bảng nằm ở cột, không ở component bảng.**
Bảng hầu hết phẳng, nhưng 56 file tự đấu dây định dạng tiền. `formatMoney` trong
`lib/format.ts` đã đúng và đã tồn tại — vấn đề là mỗi nơi tự lo căn lề, dấu âm và
nhãn trợ năng một kiểu.

**c. Perf bị chi phối bởi chunk dùng chung, không phải code trang.**
`/invoices` tổng 935 KB nhưng chỉ tự đóng góp ~77 KB. Tách `InvoicesClient` 992
dòng cải thiện khả năng bảo trì và phạm vi re-render, **không giảm tải xuống**.

## 3. Nguyên tắc thiết kế

1. **Đặt điểm tái sử dụng đúng chỗ trùng lặp thật.** Cột, không phải bảng.
2. **Biến quy tắc thành cấu trúc, không thành mục checklist.** Nếu một quy tắc
   chỉ được nhắc trong tài liệu review, nó sẽ bị quên. Nếu API buộc phải tuân
   theo, nó không thể bị quên.
3. **Một nguồn sự thật, nhiều nơi dẫn xuất** — cùng khuôn mẫu `lib/domain/*` mà
   codebase đã dùng cho quy tắc kế toán.
4. **Guard bằng unit test, không bằng kỷ luật review** — cùng khuôn mẫu
   `tests/unit/rsc-antd.test.ts` và `navigation.test.ts`.
5. **Gate luôn xanh trong suốt quá trình.** Không có lô nào để lại gate đỏ.
6. **Nợ còn lại phải nhìn thấy được**, dưới dạng danh sách file cụ thể.

## 4. Cơ chế allowlist thu hẹp dần

Áp dụng thống nhất cho cả bốn đợt. Đây là cách giải quyết đánh đổi của lối quét
ngang: mỗi đợt chạm nhiều file, nên không thể là một PR khổng lồ.

- Lô đầu của mỗi đợt dựng primitive + test + **bật guard ngay**, kèm allowlist
  liệt kê đúng từng file còn nợ. **Không màn hình nào đổi.**
- Các lô sau chuyển đổi theo cụm nghiệp vụ, mỗi lô xóa vài dòng khỏi allowlist.
- Lô cuối: allowlist rỗng, xóa luôn cơ chế allowlist.

Kết quả: gate xanh suốt, và phần chưa làm luôn là một danh sách đọc được chứ
không phải cảm giác. Một đợt bị bỏ dở giữa chừng sẽ tự tố cáo.

**Kế hoạch triển khai viết riêng cho từng đợt**, không gộp thành một kế hoạch
duy nhất. Bốn đợt có phụ thuộc theo thứ tự nhưng không dùng chung file, nên gộp
lại chỉ tạo ra một kế hoạch quá lớn để theo dõi. Đợt song song ở mục 9 có kế
hoạch riêng của nó.

## 5. Đợt 1 — Semantic token

### Kiến trúc

```
lib/design/tokens.ts          ← định nghĩa duy nhất, thuần, không I/O, không React
   ├──► app/providers.tsx     → ConfigProvider theme   (component antd)
   └──► app/globals.css       → khối :root { --ob-* }  (CSS + inline style)
```

Ba tầng tách bạch:

1. **Palette** — giá trị màu thô, không mang ý nghĩa (`teal700: "#0f766e"`).
   Không component nào được import tầng này.
2. **Ngữ nghĩa** — ánh xạ khái niệm kế toán sang palette:
   `money.negative | positive | zero`;
   `status.posted | void | draft | overdue | pending`;
   `intent.primary | success | warning | danger | info`;
   `surface.* | text.* | border.*`
3. **Phát sinh** — `antdThemeTokens()` trả về object cho `ConfigProvider`;
   `cssVariableBlock()` trả về chuỗi `:root`.

### Quy tắc a11y biến thành cấu trúc

Token trạng thái không trả về màu đơn thuần mà trả về bộ ba:

```ts
statusToken("overdue") → { color, icon, label }
```

**Sửa lại một tuyên bố sai của bản spec đầu.** Bản đầu nói bộ ba này khiến quy
tắc trở thành *cấu trúc*. Không đúng: `statusToken("overdue").color` vẫn là một
dòng, nên đó chỉ là *quy ước*. Review Task 5 chỉ ra điều này, và nó không phải
chuyện lý thuyết — `void` và `draft` cố ý dùng chung một màu xám, nên màn hình
nào lấy mỗi `.color` sẽ vẽ hai trạng thái đó giống hệt nhau.

Cấu trúc thật nằm ở `StatusBadge`:

```tsx
<StatusBadge status="overdue" />   // icon + nhãn + màu, không tách rời được
```

Đây là đường mặc định cho mọi màn hình. `statusToken()` vẫn còn cho ca ngoại lệ
thật — một con số tổng được tô màu theo tình trạng quá hạn chẳng hạn — nhưng
hiện trạng thái bằng badge phải là việc **dễ hơn** hiện sai.

### Chống trôi lệch

Khối `:root` nằm **tĩnh** trong `globals.css`, không emit lúc chạy. Một unit test
khẳng định nó khớp từng ký tự với `cssVariableBlock()`. Sửa một nơi mà quên nơi
kia thì test đỏ.

### Đợt 1 làm được tới đâu — ghi lại sau khi thi công xong

Đợt 1 đã chạy xong. Ba điều cần nói đúng, vì Đợt 2–4 sẽ dựng lên trên nó:

1. **Phạm vi hẹp hơn mục 5 này mô tả ban đầu.** Đợt 1 gỡ màu khỏi **TSX và theme
   antd**. Trong `app/` và `components/` vẫn còn **309 hex trong CSS**
   (`globals.css` 225, `WorkAreaOverview.module.css` 84). Chúng nằm trong
   allowlist kèm lý do, và guard đã mở sang `.css`.
2. **`var(--ob-*)` hiện được đọc 0 lần.** Khối `:root` là nửa đầu của đường ống,
   chưa có đầu tiêu thụ. Đợt 2 đừng giả định CSS đã chạy bằng token.
3. **`StatusBadge` chưa có nơi gọi nào.** Mọi trạng thái trong app vẫn hiện bằng
   `<Tag color="green">` không icon. Component đúng và có test, nhưng người dùng
   dự kiến của nó là `statusColumn()` ở Đợt 2 — tính là đã *dựng*, chưa tính là
   đã *áp dụng*.

### Kiểm thử — `tests/unit/design-tokens.test.ts`

| Khẳng định | Bắt được lỗi gì |
|---|---|
| Mọi token ngữ nghĩa phân giải về một mục trong palette | Hex mồ côi lọt vào tầng ngữ nghĩa |
| Khối `:root` khớp `cssVariableBlock()` | Hai nguồn trôi khỏi nhau |
| `providers.tsx` không chứa literal hex | Màu dán thẳng vào theme |
| Mọi cặp text/background đạt WCAG AA 4.5:1 | Màu không đọc được — tính được thuần túy nên là unit test, không phải chờ Axe |
| Guard no-hex: quét `app/` + `components/`, chỉ `tokens.ts` được phép | Tái phát hex cứng |

Guard chỉ quét `app/` và `components/`. `lib/client/invoice-pdf.ts` và
`lib/client/report-export.ts` nằm ngoài: màu trong tài liệu PDF không phải token
CSS và không dẫn xuất từ theme.

### Chia lô

- **Lô 1** — `tokens.ts` + test + nối `providers.tsx` + emit `:root` + bật guard
  no-hex kèm allowlist (~39 chỗ). Không đổi pixel nào.
- **Lô 2…n** — gỡ hex theo cụm: reports, banking, dashboard, còn lại.
- **Lô cuối** — allowlist rỗng.

## 6. Đợt 2 — Table

### Thành phần

```
components/ui/DataTable.tsx      ← giữ mỏng (~80 dòng), thêm contract 2 chế độ
components/ui/ReportTable.tsx    ← biến thể cho 6 bảng báo cáo có dòng tổng
components/ui/columns.tsx        ← bộ dựng cột: nơi tái sử dụng thật
lib/client/table-url-state.ts    ← hook đồng bộ URL
```

### Bộ dựng cột

| Builder | Giải quyết |
|---|---|
| `moneyColumn()` | Căn phải, chữ số tabular, dấu âm có **cả dấu lẫn icon** chứ không chỉ màu, `aria-label` đọc rõ ("negative 1,234.56 US dollars"). Gọi `formatMoney` sẵn có, không viết lại |
| `statusColumn()` | Dùng `statusToken()` của đợt 1 → màu + icon + nhãn |
| `dateColumn()` | Một định dạng ngày duy nhất, `<time datetime>` đúng chuẩn |
| `actionsColumn()` | Qua `IconActionButton`, thừa hưởng vùng bấm 44×44 từ đợt 3 |

### Contract hai chế độ

`DataTable` nhận **một trong hai** nguồn dữ liệu:

- chế độ client: `rows={T[]}` — phân trang/sắp xếp cục bộ
- chế độ server: `page={{ rows, total, pageIndex, pageSize }}` + callbacks

Cả hai cùng chạy qua `useTableUrlState`. Khi sau này chuyển một màn hình sang
server-side, thứ thay đổi là nguồn dữ liệu trong `page.tsx`; markup bảng và toàn
bộ khai báo cột **không đụng tới**.

### URL state và cái bẫy hiệu năng

59/60 trang đang `force-dynamic`. Nếu hook gọi `router.replace()` cho mọi thay
đổi filter thì mỗi lần gõ phím kích hoạt một vòng render lại phía server — sửa
UX xong lại làm hỏng perf. Nên hook phân biệt:

- **chế độ client** → ghi URL bằng `history.replaceState`, không gọi router.
  URL vẫn chia sẻ và khôi phục được, không có round-trip.
- **chế độ server** → `router.replace()`, vì round-trip chính là mục đích.

Tham số URL parse bằng **Zod** theo quy ước `lib/domain/schemas.ts`. Link cũ có
`page=abc` hoặc cột sort không còn tồn tại thì rơi về mặc định, không ném lỗi.
Đây là kiểm tra dữ liệu không tin cậy, không phải nuốt lỗi.

### Kiểm thử

- `moneyColumn` với số dương / âm / 0 → kiểm chuỗi hiển thị **và** `aria-label`
- `useTableUrlState` → round-trip parse↔serialize; tham số rác rơi về mặc định
- Guard 1: mọi `<Table>` ngoài `DataTable`/`ReportTable` phải nằm trong allowlist
- Guard 2: `pagination={false}` (61 chỗ) — mỗi mục allowlist **phải kèm lý do**,
  vì một số bảng có số dòng chặn cứng theo cấu trúc và không sai

### Chia lô

- **Lô 1** — bộ cột + hook + contract `DataTable` + test. Không màn hình nào đổi.
- **Lô 2…n** — Sales → Purchases → Banking → Accounting → Settings.
- **Lô cuối** — Reports, vì cần `ReportTable` với dòng tổng.

### Ngoài phạm vi đợt này

Đợt này cải thiện UX và khả năng bảo trì, **không hạ bundle**.

## 7. Đợt 3 — Form và Accessibility

Trục yếu nhất, nhưng nguyên nhân không phải thiếu ý thức: đã có 97 chỗ khai
`aria-label`. Nguyên nhân là mỗi form tự nhớ lấy phần khó. Thiết kế vì thế gom
phần khó vào một đường đi chung mà form không thể bỏ qua.

### Thành phần

```
components/ui/AccessibleField.tsx    ← bọc Form.Item, nối aria-describedby đầy đủ
components/ui/LiveAnnouncer.tsx      ← 2 vùng live, gắn một lần trong AppShell
lib/client/use-feedback.ts           ← toast + announce trong MỘT lệnh gọi
lib/client/use-form-submit.ts        ← đường đi chung khi gọi Server Action
lib/domain/error-message.ts          ← describeError()
```

### AccessibleField

`Form.Item` của antd đã nối label và error. Khoảng trống là helper text: khi có
cả mô tả lẫn lỗi, antd chỉ nối lỗi và phần mô tả biến mất với người dùng screen
reader. `AccessibleField` sinh `id` bằng `useId()` và ghép `aria-describedby` từ
**cả hai**. Bắt buộc diễn đạt bằng chữ chứ không chỉ dấu hoa thị; thông báo lỗi
mang theo tên trường.

Phải là `"use client"` — theo bẫy đã ghi trong CLAUDE.md, Server Component không
được đọc `Form.Item`.

### Live announcer buộc dính với toast

Nếu tách riêng `announce()` và `message.success()`, người viết sẽ gọi cái thứ hai
rồi quên cái thứ nhất. Nên gộp: `useFeedback().success(...)` và
`useFeedback().error(...)` làm cả hai việc. Guard test **cấm gọi thẳng
`message.*` ngoài `useFeedback`**.

### Quản lý focus — bốn thời điểm

| Thời điểm | Xử lý |
|---|---|
| Mở modal/drawer | Focus trường đầu tiên |
| Đóng | Trả focus về nút đã mở (`useReturnFocus`) |
| **Đổi route** | App Router không tự dời focus; screen reader đứng nguyên chỗ cũ. `RouteFocus` trong AppShell đưa focus về `<h1>` mà `PageHeader` đã render |
| Validate thất bại | Focus trường sai đầu tiên + đọc "N lỗi cần sửa" |

### useFormSubmit

Bọc lời gọi Server Action và lo trọn gói: pending → thành công thì announce +
toast → thất bại thì map lỗi về đúng trường, focus trường đầu, announce số lượng.
Thay cho việc trông chờ 44 file `actions.ts` mỗi nơi tự nhớ.

`describeError()` gỡ nhiễu Postgres và **thêm hướng phục hồi**. Thuận lợi là các
RPC đã raise tiếng Anh đọc được (`'Not authorized to post journal entries'`,
`'This line is already matched to the ledger'`). Lỗi không nhận dạng được thì
**hiện nguyên văn**, không nuốt, theo luật trong CLAUDE.md.

### Vùng bấm 44×44

Đặt mức tối thiểu lên `IconActionButton`. Vì `actionsColumn` của đợt 2 đã đi qua
component này, mọi nút hành động trong bảng được sửa theo mà không phải đụng lại.

### Kiểm thử

- Unit: `AccessibleField` ghép `aria-describedby` từ helper + error
- Unit: `describeError`, gồm ca lỗi lạ phải đi qua nguyên vẹn
- Unit: guard cấm `message.*` trực tiếp
- Runtime: **bổ sung kịch bản vào `scripts/quality/keyboard.mjs` sẵn có** (638
  dòng, đã có harness focus-wrap cho drawer) — trả focus khi đóng modal, focus
  khi đổi route, focus khi validate lỗi. Không dựng công cụ mới.

## 8. Đợt 4 — Page pattern và Responsive

### Page pattern

```
PageHeader → summary → FilterBar → DataTable → detail drawer/modal
```

Hiện thực bằng `WorkListPage` với slot có tên, **mặc định nhưng không bắt buộc**
— báo cáo và settings có hình dạng khác một cách chính đáng. Guard test liệt kê
màn hình danh sách chưa dùng. Pattern là mặc định, không phải khung bóp méo màn
hình đặc thù.

### Responsive: ưu tiên dữ liệu, khai ngay trong định nghĩa cột

Chỉ khả thi vì đợt 2 đã gom cột về một chỗ. Mỗi cột khai thêm mức ưu tiên:

```ts
moneyColumn({ title: "Balance", dataIndex: "balance_due_minor", priority: "primary" })
dateColumn({  title: "Due",     dataIndex: "due_date",          priority: "secondary" })
textColumn({  title: "Memo",    dataIndex: "memo",              priority: "detail" })
```

Dưới 768px, `DataTable` tự dựng danh sách thẻ từ `primary` + `secondary`; phần
`detail` đẩy vào drawer của dòng. Không có markup mobile riêng để trôi lệch — bố
cục nhỏ **dẫn xuất** từ khai báo cột.

### Tách 13 component lớn

Làm **cùng lô với việc màn hình đó áp dụng pattern**, không tách thành đợt riêng,
để mỗi PR là một màn hình trọn vẹn và review được.

Quy tắc tách:
- Màn hình giữ lại khung trang + đấu nối bảng
- Mỗi modal/drawer ra file riêng, nạp bằng `next/dynamic`
- Hàm thuần lỡ nằm trong component thì chuyển về `lib/domain/`

Ghi chú trung thực: việc tách này cải thiện khả năng bảo trì và phạm vi
re-render. Phần giảm bundle đến từ `next/dynamic` trên modal, không từ việc tách.

### Kiểm thử

P0 đã chạy 4 viewport (375/768/1024/1440) trên 12 route trong `MATRIX_ROUTES`,
với `viewport-clipping`, `fixed-shell-overlap`, `target-size`. Đợt này **mở rộng
`MATRIX_ROUTES`** thay vì dựng công cụ mới. Thêm guard unit: mỗi bộ cột phải có
ít nhất một cột `primary`.

## 9. Đợt song song — Thu gọn shared bundle

Độc lập với bốn đợt trên và không tranh chấp file, nên chạy song song được. Kéo
lên từ P2 vì nếu không có nó, trục Performance gần như đứng yên sau P1.

### Việc đã xác định chắc chắn

**a. `jspdf` bị import tĩnh trên route lớn nhất.**
`lib/client/invoice-pdf.ts` import `jsPDF` và `jspdf-autotable` ở đầu file;
`InvoicesClient.tsx` import module đó. Chunk 121 KB gzip chỉ nằm trên `/invoices`
chính là nó. `lib/client/report-export.ts` **đã** làm động đúng cách. Sửa theo
mẫu đó là thắng lợi chắc chắn, đo được ngay bằng `npm run quality:bundle`.

**b. Toàn repo có 0 chỗ dùng `next/dynamic`.**
Đòn bẩy lazy-load modal hoàn toàn chưa được khai thác. Kết hợp với đợt 4.

### Việc cần đo trước khi quyết

**c. Chunk 136 KB chỉ trên `/banking`** — chưa rõ là gì, phải xác định trước.

**d. 613 KB dùng chung trải trên 30 chunk, không có chunk nào áp đảo.**
Bề mặt là 37 component antd và 20 icon trên 53 file. Cần kiểm tra
`optimizePackageImports` có đang áp dụng cho `antd` và `@ant-design/icons` hay
không — Next.js có danh sách mặc định, nên phải **đo trước khi cấu hình thêm**,
tránh thêm một dòng config không làm gì cả.

### Nguyên tắc

Mỗi thay đổi phải kèm số đo trước/sau từ `npm run quality:bundle`. Budget hiện
tại là 10% hoặc 20 KB gzip.

## 10. Tiêu chí nghiệm thu

### Theo đợt

| Đợt | Xong khi |
|---|---|
| 1 — Token | Allowlist no-hex rỗng; test tương phản WCAG AA xanh; `providers.tsx` không còn literal hex |
| 2 — Table | Cả hai allowlist rỗng; mọi bảng đi qua `DataTable`/`ReportTable`; filter/sort/page khôi phục được từ URL |
| 3 — Form/a11y | Allowlist `message.*` rỗng; kịch bản keyboard mới xanh; mọi vùng bấm ≥ 44×44 |
| 4 — Pattern | Mọi màn hình danh sách dùng `WorkListPage`; mỗi bộ cột có cột `primary`; 13 component trên 400 dòng đã tách xong **hoặc** nằm trong allowlist kèm lý do |
| Song song — Bundle | `/invoices` giảm ≥ 100 KB gzip; các mục c, d đã đo và có kết luận |

### Toàn P1

- Bốn cổng bắt buộc xanh: `build` + `test` + `typecheck` + `lint`
- `scripts/smoke-pages.mjs` xanh trên server đã build (48 trang)
- `npm run quality:runtime` không phát sinh finding mới so với baseline
- Không có allowlist nào còn sót

## 11. Điều KHÔNG thuộc phạm vi P1

Ghi rõ để không ai hiểu nhầm là đã xong:

- **Server-side pagination.** Đợt 2 chỉ dọn đường bằng contract hai chế độ.
- **Giảm 613 KB shared bundle xuống mức mục tiêu.** Đợt song song chỉ xử lý phần
  đã xác định chắc chắn, cộng với việc đo phần còn lại.
- **Virtualize danh sách lớn.**
- **Web Worker cho parse CSV.**
- **Chuyển trang khỏi `force-dynamic`.**

### Kỳ vọng điểm số sau P1

| Trục | Hiện tại | Sau P1 (ước tính) |
|---|---|---|
| UX | 7.0 | ~7.8 |
| Accessibility | 6.2 | ~8.0 |
| Performance | 6.3 | ~7.0 với đợt song song (~6.6 nếu không có) |

Trục Performance cần P2 mới đạt 8.0. Đây là ước tính từ kiến trúc, sẽ được thay
bằng số đo thật khi `npm run quality:runtime` chạy đủ chu kỳ.
