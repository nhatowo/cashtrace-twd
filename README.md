# CashTrace — Ứng dụng Theo dõi Tiền Đài Loan (TWD) (PWA & iOS `.ipa`)

Ứng dụng tối giản (mobile-first) giúp quét số seri và quản lý tờ tiền Đài Loan (**100, 500, 1000, 2000 TWD**) với nhận diện camera OCR (**Tesseract.js**) và đồng bộ thời gian thực qua **Supabase**. Hỗ trợ xuất cả **Web PWA** và **file `.ipa` cho iOS** để ký bằng chứng chỉ cá nhân (`.p12` + `.mobileprovision`).

---

## Cách xuất file `.ipa` cho iOS và Ký bằng Chứng chỉ (`.p12` + `.mobileprovision`)

Vì máy bạn đang dùng **Windows** (không có Xcode của macOS), dự án đã được tích hợp sẵn **Capacitor iOS** ([`capacitor.config.ts`](./capacitor.config.ts)) và **GitHub Actions macOS Builder** ([`.github/workflows/build-ios-ipa.yml`](./.github/workflows/build-ios-ipa.yml)) để tự động biên dịch ra file `.ipa`.

### Bước 1: Đẩy code lên GitHub để lấy file `.ipa`
1. Tạo một repository mới trên GitHub (có thể để **Private** hoặc **Public**).
2. Mở terminal trong thư mục `TWD` và đẩy code lên:
   ```bash
   git init
   git add .
   git commit -m "Initial CashTrace TWD iOS IPA build"
   git branch -M main
   git remote add origin https://github.com/<ten-tai-khoan>/<ten-repo>.git
   git push -u origin main
   ```
3. Vào tab **Actions** trên GitHub repository của bạn, workflow **`Build iOS IPA (Unsigned & Certificate Signed)`** sẽ tự động chạy trên máy chủ `macos-14` và tạo ra file **`CashTrace-Unsigned.ipa`** trong phần **Artifacts** (chỉ mất khoảng 2–3 phút).

---

### Bước 2: Ký file `.ipa` bằng chứng chỉ của bạn (2 Cách)

#### Cách A: Ký trực tiếp trên iPhone hoặc Windows (ESign / Feather / Scarlet / Sideloadly) — Khuyên dùng
1. Tải file **`CashTrace-Unsigned.ipa`** từ mục **Artifacts** trong tab **Actions** của GitHub về điện thoại iPhone hoặc máy tính Windows.
2. **Trên iPhone (dùng ESign / Feather / GBox / Scarlet)**:
   - Mở ứng dụng **ESign** hoặc **Feather** (đã nhập sẵn chứng chỉ `.p12` và `.mobileprovision` của bạn).
   - Nhập file `CashTrace-Unsigned.ipa` vào mục **Tệp / Ứng dụng**.
   - Nhấn **Ký (Sign)** -> **Cài đặt (Install)** trực tiếp lên màn hình chính iPhone.
3. **Trên Windows (dùng Sideloadly / AltServer)**:
   - Mở **Sideloadly**, kéo file `CashTrace-Unsigned.ipa` vào và nhấn **Start** để ký & cài vào iPhone qua cáp USB/Wi-Fi.

#### Cách B: Tự động ký sẵn `CashTrace-Signed.ipa` ngay trên GitHub Actions bằng `.p12` và `.mobileprovision`
Nếu bạn muốn GitHub xuất ra luôn file `CashTrace-Signed.ipa` đã gắn sẵn chứng chỉ của bạn:
1. Chuyển file `.p12` và `.mobileprovision` sang chuỗi Base64 trên PowerShell (Windows):
   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("duong_dan_toi_cert.p12")) | Set-Clipboard
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("duong_dan_toi_cert.mobileprovision")) | Set-Clipboard
   ```
2. Vào GitHub Repo -> **Settings** -> **Secrets and variables** -> **Actions** -> **New repository secret** và thêm:
   - `IOS_P12_BASE64`: Chuỗi Base64 của file `.p12`
   - `IOS_P12_PASSWORD`: Mật khẩu của chứng chỉ `.p12`
   - `IOS_MOBILEPROVISION_BASE64`: Chuỗi Base64 của file `.mobileprovision`
   - *(Tuỳ chọn)* `NEXT_PUBLIC_SUPABASE_URL` và `NEXT_PUBLIC_SUPABASE_ANON_KEY` (hoặc bạn có thể nhập trực tiếp trên giao diện app sau khi cài lên iPhone).
3. Chạy lại workflow trong tab **Actions**, hệ thống sẽ dùng `zsign` ký thẳng chứng chỉ vào app và xuất ra artifact **`CashTrace-Signed-IPA`**.

---

## Tính năng đã tích hợp trong bản iOS `.ipa`
- **Cấp quyền Camera gốc iOS (`NSCameraUsageDescription`)**: Tự động khai báo trong `Info.plist` để mở camera sau quét số seri mượt mà.
- **4 mệnh giá TWD duy nhất**: `100`, `500`, `1000`, `2000` TWD.
- **Nhận diện số seri OCR (Tesseract.js)** + cho phép sửa lại ký tự nếu mờ.
- **Chống trùng số seri**, **Đánh dấu ĐÃ TIÊU 1 chạm**, **Hoàn tác**, **Tìm kiếm theo số seri**, **Tự động tính tổng tiền đang giữ**, và **Đồng bộ thời gian thực qua Supabase**.
