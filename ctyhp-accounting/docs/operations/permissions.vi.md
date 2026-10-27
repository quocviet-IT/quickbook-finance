# Ai được làm gì trong OneBook

Dành cho admin của từng công ty và người hỗ trợ họ. Bản tiếng Anh:
[permissions.md](permissions.md). Tên màn hình và nút bấm giữ nguyên tiếng Anh
như trên ứng dụng.

---

## Tóm tắt

- Mỗi người trong một công ty có **một vai trò**: admin, accountant, sales hoặc
  viewer.
- Trên vai trò là **38 quyền**, bật hoặc tắt theo từng vai trò ở
  **Settings › Permissions**. Mọi quyền đều được kiểm tra trước khi thao tác chạy.
- **Database là nơi quyết định.** Màn hình ẩn những gì bạn không được làm, nhưng
  chốt chặn thật là hàm database đứng sau mỗi thao tác. Lần nào hàm cũng hỏi bạn
  là ai, vai trò gì, vai trò đó có quyền này không.
- **Tạm khoá một người có tác dụng ngay**, trên mọi màn hình, báo cáo và file
  xuất.
- **Mọi thay đổi đều được ghi** vào nhật ký (audit log): ai làm, lúc nào.

---

## Vai trò

| Vai trò | Dành cho | Tóm tắt |
| --- | --- | --- |
| **admin** | Chủ doanh nghiệp, kế toán trưởng | Làm được mọi việc, gồm người dùng, phân quyền và cài đặt công ty. |
| **accountant** | Kế toán hằng ngày | Nhập, ghi sổ, đối chiếu, huỷ chứng từ. Không quản lý người dùng, phân quyền, cài đặt, không mở lại kỳ. |
| **sales** | Nhân viên bán hàng | Xem sổ sách và quản lý danh mục sản phẩm, dịch vụ. Không ghi sổ. |
| **viewer** | Kiểm toán, chủ chỉ cần xem | Xem sổ sách, nhật ký và tệp đính kèm. Không thay đổi gì. |

Mỗi công ty luôn giữ ít nhất một admin đang hoạt động, và **nhiều nhất hai**.
OneBook từ chối tạm khoá, cho nghỉ hoặc hạ vai trò của admin cuối cùng, admin
không tự làm việc đó với chính mình được, và admin thứ ba bị từ chối dù đến bằng
đường nào: thêm người mới, thêm tài khoản có sẵn, đổi vai trò hay mở lại một
admin đang bị khoá. Muốn đổi hai người làm admin, hạ một người xuống accountant
trước.

## Trạng thái người dùng

| Trạng thái | Vào công ty được không? |
| --- | --- |
| invited, active | Được |
| suspended | Không, kể từ lúc lưu. Có thể bật lại. |
| offboarded | Không. Dành cho người đã nghỉ; không hoàn tác. |

Mỗi lần đổi trạng thái đều phải ghi lý do, và lý do được lưu vào nhật ký.

## Vào một công ty

- Một người mở được một công ty khi danh sách **Users** của công ty đó có họ ở
  trạng thái invited hoặc active. Một tài khoản có thể thuộc nhiều công ty, mỗi
  công ty một vai trò.
- Ô chọn công ty chỉ hiện những công ty người đó thuộc về. Mỗi lần chuyển công ty
  đều được server kiểm tra lại.
- **Platform admin** là một danh sách riêng, nhiều nhất hai người. Chỉ họ mới tạo được
  công ty mới (**Settings › Companies**) hoặc khôi phục bản sao lưu thành một
  công ty mới (**Settings › Backups**). Là admin trong một công ty không bao gồm
  hai việc này.

---

## Ma trận quyền

Mọi quyền dưới đây đều có tác dụng thật: tắt một quyền của vai trò nào thì vai
trò đó bị chặn ngay. Dấu ✓ là thiết lập ban đầu của mọi công ty khi được tạo.

Một số thao tác còn đòi hỏi vai trò, bất kể ma trận bật gì. Trên màn hình, các
công tắc đó bị làm mờ, kèm ghi chú:

- **Admin hoặc accountant** (nghiệp vụ ghi sổ): post và void bill, issue và void
  invoice, đảo bút toán, hoàn tất đối chiếu, đóng kỳ, duyệt PO và duyệt chênh
  lệch, điều chỉnh tồn kho, xoá nợ, vượt hạn mức tín dụng.
- **Chỉ admin**: mở lại kỳ kế toán, mở lại bảng đối chiếu.

| Nhóm | Quyền | Cho phép | admin | accountant | sales | viewer | Ai dùng được |
| --- | --- | --- | :-: | :-: | :-: | :-: | --- |
| Accounting | Post manual journals | Tạo và ghi bút toán thủ công | ✓ | ✓ | | | Mọi vai trò |
| Accounting | Void journal entries | Đảo bút toán thủ công hoặc số dư đầu kỳ đã ghi | ✓ | ✓ | | | Admin hoặc accountant |
| Accounting | Manage recurring transactions | Tạo, tạm dừng, chạy lại và xem lịch giao dịch định kỳ | ✓ | ✓ | | | Mọi vai trò |
| Accounting | Manage fixed assets | Tạo và quản lý sổ tài sản cố định | ✓ | ✓ | | | Mọi vai trò |
| Accounting | Post asset depreciation | Ghi khấu hao theo lịch vào sổ cái | ✓ | ✓ | | | Mọi vai trò |
| Accounting | Import existing fixed assets | Nhập tài sản cũ và khấu hao luỹ kế | ✓ | ✓ | | | Mọi vai trò |
| Accounting | Dispose fixed assets | Thanh lý, bán tài sản và ghi lãi lỗ | ✓ | ✓ | | | Mọi vai trò |
| Banking | Review bank matches | Tạo, duyệt, từ chối khớp giao dịch ngân hàng với sổ | ✓ | ✓ | | | Mọi vai trò |
| Banking | Manage direct bank feeds | Kết nối ngân hàng và đồng bộ giao dịch | ✓ | ✓ | | | Mọi vai trò |
| Banking | Complete reconciliations | Hoàn tất đối chiếu, hoặc đưa lịch sử tài khoản vào sổ đối chiếu | ✓ | ✓ | | | Admin hoặc accountant |
| Banking | Reopen reconciliations | Mở lại bảng đối chiếu đã hoàn tất | ✓ | | | | Admin |
| Close | Close accounting periods | Đóng kỳ kế toán tháng | ✓ | | | | Admin hoặc accountant |
| Close | Reopen accounting periods | Mở lại kỳ đã đóng | ✓ | | | | Admin |
| Documents | Read supporting documents | Xem và mở tệp đính kèm | ✓ | ✓ | | ✓ | Mọi vai trò |
| Documents | Manage supporting documents | Tải lên và lưu trữ tệp đính kèm | ✓ | ✓ | | | Mọi vai trò |
| Documents | Govern document retention | Đặt thời hạn lưu trữ và giữ hồ sơ | ✓ | | | | Mọi vai trò |
| Governance | Read the audit log | Tra cứu nhật ký thay đổi | ✓ | ✓ | | ✓ | Mọi vai trò |
| Governance | Approve or reject requests | Duyệt yêu cầu hai người | ✓ | ✓ | | | Mọi vai trò |
| Governance | Manage users | Thêm người dùng, đổi vai trò, tạm khoá, cho nghỉ | ✓ | | | | Mọi vai trò |
| Governance | Manage permissions | Sửa ma trận này | ✓ | | | | Mọi vai trò |
| Governance | Manage settings | Hồ sơ công ty, work policy, lịch kỳ kế toán, dung sai mua hàng, chính sách duyệt | ✓ | | | | Mọi vai trò |
| Governance | Export company data | Tải toàn bộ dữ liệu công ty và bản sao lưu | ✓ | | | | Mọi vai trò |
| Governance | Restore a backup | Khôi phục bản sao lưu thành công ty mới (chỉ platform admin) | ✓ | | | | Mọi vai trò |
| Governance | Read the feedback queue | Xem báo lỗi và góp ý của nhân viên | ✓ | | | | Mọi vai trò |
| Governance | Triage feedback | Phân loại báo lỗi | ✓ | | | | Mọi vai trò |
| Inventory | Adjust inventory | Điều chỉnh số lượng hoặc giá trị tồn kho | ✓ | ✓ | | | Admin hoặc accountant |
| Purchases | Post bills | Ghi hoá đơn mua vào công nợ phải trả | ✓ | ✓ | | | Admin hoặc accountant |
| Purchases | Void bills | Huỷ hoá đơn mua, nháp hoặc đã ghi | ✓ | ✓ | | | Admin hoặc accountant |
| Purchases | Approve purchase orders | Chuyển đơn mua hàng từ nháp sang mở | ✓ | ✓ | | | Admin hoặc accountant |
| Purchases | Approve match variances | Lập bill từ PO vượt dung sai, kèm lý do | ✓ | ✓ | | | Admin hoặc accountant |
| Purchases | Read the 1099 review dataset | Chạy báo cáo chuẩn bị 1099 | ✓ | ✓ | | | Mọi vai trò |
| Purchases | Manage vendor tax profiles | Đổi trạng thái W-9, mã số thuế và diện 1099 | ✓ | | | | Mọi vai trò |
| Receivables | Write off balances | Xoá số dư hoá đơn bán hoặc mua | ✓ | ✓ | | | Admin hoặc accountant |
| Receivables | Override a credit limit | Phát hành hoá đơn vượt hạn mức hoặc khi khách đang bị giữ tín dụng | ✓ | | | | Admin hoặc accountant |
| Reporting | Manage budgets | Lập và sửa ngân sách tháng | ✓ | ✓ | | | Mọi vai trò |
| Sales | Issue invoices | Phát hành hoá đơn nháp cho khách | ✓ | ✓ | | | Admin hoặc accountant |
| Sales | Void invoices | Huỷ hoá đơn, nháp hoặc đã phát hành | ✓ | ✓ | | | Admin hoặc accountant |
| Sales | Manage products and services | Tạo, sửa, bật, tắt sản phẩm và dịch vụ | ✓ | ✓ | ✓ | | Mọi vai trò |

Ngoài ma trận, theo vai trò:

- **Chỉ admin:** nhập hệ thống tài khoản, và sửa mã thuế.
- **Admin hoặc accountant:** mọi chứng từ và danh mục còn lại: khách hàng, nhà
  cung cấp, bill, chi phí, thanh toán, hệ thống tài khoản, tài khoản ngân hàng và
  quy tắc ngân hàng.

## Duyệt hai người

Bảy thao tác có thể đặt chờ người thứ hai duyệt, mỗi thao tác từ một mức tiền do
bạn chọn, ở **Settings › Approvals**: bút toán thủ công, xoá nợ, điều chỉnh tồn
kho, mở lại kỳ, mở lại đối chiếu, kiểm quỹ tiền mặt và hồ sơ thuế nhà cung cấp.
Cả bảy đều tắt lúc đầu.

- Người duyệt cần quyền **Approve or reject requests**.
- Nếu bật "người duyệt phải là người khác", công ty cần **ít nhất hai** người
  giữ quyền đó. Chỉ có một người thì thao tác bị chặn với tất cả mọi người, và
  màn hình cảnh báo trước khi bạn lưu.

## Cách hệ thống thực thi

Bốn lớp, và lớp thứ ba là lớp quyết định:

1. **Đăng nhập.** Chỉ người đã đăng nhập mới vào được trang nào đó.
2. **Màn hình và thao tác.** Nút chỉ hiện cho người được dùng, và mỗi thao tác
   được server kiểm tra lại. Lớp này để rõ ràng, không phải để an toàn.
3. **Hàm database.** Mọi thao tác thay đổi sổ sách chạy bên trong một hàm tự kiểm
   tra vai trò và quyền của người gọi, và từ chối ai không thuộc công ty, kể cả
   người đang bị tạm khoá.
4. **Luật bảng.** Chỉ thành viên mới đọc được. Việc ghi đi qua các hàm ở lớp 3.
   Từ bản 2.61, không dữ liệu nào mà màn hình thay đổi có thể bị ghi vòng qua
   hàm của nó: chứng từ, người dùng và phân quyền, kỳ kế toán và nhật ký, ngân
   hàng và mua hàng, và danh mục gốc như tài khoản, khách hàng, nhà cung cấp,
   sản phẩm.

Công ty mới được tạo với đúng các luật như các công ty đang có.

---

## Hướng dẫn vận hành

### Cấp quyền truy cập cho một người

- **Họ chưa từng đăng nhập OneBook:** Settings › Users › **Add user**. Nhập
  email, tên và vai trò. OneBook tạo tài khoản đăng nhập cho họ.
- **Họ đã đăng nhập cho một công ty khác:** Settings › Users › **Add existing
  account**. Nhập email họ dùng để đăng nhập và chọn vai trò cho công ty này. Họ
  giữ nguyên mật khẩu.
- Cấp vai trò thấp nhất đủ làm việc. Chỉ bật thêm quyền cho một vai trò khi có
  việc thật cần đến.

### Đổi vai trò

Settings › Users, dòng của người đó, **Change role**. Phải ghi lý do. Không hạ
vai trò được admin đang hoạt động cuối cùng.

### Khi một người nghỉ việc, hoặc cần chặn ngay

1. Settings › Users, dòng của người đó: **Suspend** (hoàn tác được) hoặc
   **Offboard** (vĩnh viễn). Ghi lý do.
2. Có tác dụng ngay ở mọi nơi, kể cả báo cáo và file xuất.
3. Nếu họ từng dùng kết nối ngân hàng, kiểm tra trong Banking các kết nối họ đã
   tạo.
4. Nếu họ là người duyệt, kiểm tra còn ít nhất hai người giữ **Approve or reject
   requests** ở những thao tác đòi người duyệt khác.
5. Nếu họ thuộc nhiều công ty, làm lại ở từng công ty.

### Sửa ma trận quyền

Settings › Permissions. Chỉ người giữ **Manage permissions** mới sửa được. Chỉ
sửa khi có lý do nghiệp vụ, và ghi lý do vào nơi nhóm lưu các quyết định như vậy;
bản thân thao tác bật tắt được lưu trong nhật ký. Admin không tắt được **Manage
users** hay **Manage permissions** của vai trò admin.

### Bật duyệt hai người

Settings › Approvals. Bật thao tác, đặt mức tiền, và chọn người duyệt có phải là
người khác hay không. Xem quy tắc hai người ở trên.

### Tạo công ty, hoặc khôi phục bản sao lưu

Chỉ platform admin. Settings › Companies để tạo; Settings › Backups, **Restore**,
để khôi phục bản sao lưu thành một công ty mới bên cạnh sổ đang chạy. Khôi phục
không bao giờ ghi đè lên một công ty.

### Rà soát quyền truy cập mỗi quý

Mỗi quý, ở từng công ty, một admin:

1. Mở Settings › Users và xác nhận từng người đang hoạt động vẫn cần truy cập,
   với đúng vai trò hiện có.
2. Tạm khoá hoặc cho nghỉ người đã rời đi hoặc đổi việc.
3. Mở Settings › Permissions và xác nhận mọi thay đổi so với ma trận ban đầu vẫn
   còn cần.
4. Mở Settings › Audit history, lọc theo người dùng và phân quyền, đọc những gì
   đã đổi từ lần rà soát trước.
5. Ghi lại ngày rà soát và người rà soát.

### Tự kiểm chứng

Có thể kiểm chứng "database là nơi quyết định" từ bên ngoài, đúng cách một
kiểm toán viên làm, mà không cần mật khẩu của ai. Trên công ty mẫu:

1. Settings › Users, **Add user** với vai trò **Sales**, chỉ dùng cho việc thử
   này.
2. Ghi thông tin đăng nhập vào `ACCESS_PROBE_EMAIL` và `ACCESS_PROBE_PASSWORD`,
   rồi chạy `npm run verify:access-denials` trong `ctyhp-accounting/`. Script
   đăng nhập bằng tài khoản đó và, qua đúng API trình duyệt dùng, thử chín thao
   tác vai trò này không được làm, ghi thẳng vào bảng, và đọc sổ công ty khác.
   Dòng nào cũng phải là PASS (bị từ chối), và không gì được thay đổi.
3. **Suspend** tài khoản, rồi chạy lại với `-- --after-suspend` trong vòng một
   giờ: chính phiên đang đăng nhập đó phải không đọc được gì nữa, ngay lập tức.
4. **Offboard** tài khoản.

---

## Còn chờ quyết định

- **Sales và viewer được xem những gì.** Hiện cả hai xem được toàn bộ sổ cái.
  Thu hẹp lại là quyết định sản phẩm, chưa được đưa ra.
- **Đăng nhập hai lớp (MFA).** Có bắt buộc không, và cho vai trò nào, chưa được
  quyết định. Settings › Users cho biết ai đã bật.
