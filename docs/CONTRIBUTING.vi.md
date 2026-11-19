# Đóng góp cho Youwee (fork WasewaseX)

Chào mừng và cảm ơn bạn đã cân nhắc đóng góp. Fork này vận hành một hệ thống
CI phân tầng với 89 cổng kiểm tra (gate) mà mọi pull request phải vượt qua
trước khi được hợp nhất. Tài liệu này là hợp đồng ràng buộc: nó giải thích
các quy tắc, các cổng kiểm tra thực thi chúng, và quy trình chính xác để có
một thay đổi được hợp nhất. Nếu bạn thay đổi cách các cổng hoạt động, bạn
**phải** cập nhật tài liệu này trong cùng pull request — cổng
`g32 contributing-coverage` sẽ thất bại nếu không làm vậy. Tài liệu và cơ chế
thực thi luôn đồng bộ một cách chủ ý.

## Bắt đầu

1. Fork repository và clone fork của bạn.
2. Tạo nhánh tính năng từ `main` theo sơ đồ đặt tên nhánh:
   `git checkout main && git pull origin main && git checkout -b fix/my-fix`
   hoặc `feat/my-feature`. Tên nhánh phải bắt đầu bằng một loại Conventional
   Commit (`feat/`, `fix/`, `docs/`, `chore/`, ...).
3. Cài đặt phụ thuộc: `bun install --frozen-lockfile` (yêu cầu Bun; chỉ cần
   Rust toolchain khi bạn chạm vào `src-tauri/`).
4. Thực hiện thay đổi của bạn.
5. Chạy các kiểm tra tiền liệu (pre-flight) cục bộ trước khi push:

   ```bash
   bun run lint          # Biome lint + format
   bunx tsc -b           # Kiểm tra kiểu TypeScript strict
   bun run build:sdk     # build SDK (bắt buộc trước khi chạy test)
   bun test              # Bộ test frontend
   bun run build         # Build production frontend
   cd src-tauri && cargo check && cargo test && cargo fmt --check && cargo clippy -- -D warnings
   for s in scripts/gates/*.mjs; do bun "$s" || exit 1; done   # nơi áp dụng
   ```

6. Commit thay đổi (xem quy tắc commit bên dưới) và push.
7. Mở Pull Request **vào nhánh `main` của fork này**.

## Quy trình Pull Request

- Luôn tạo nhánh từ `main` mới nhất và giữ nhánh của bạn được rebase trong
  khi làm việc để PR luôn có thể hợp nhất.
- Một thay đổi logic cho mỗi PR. Ngân sách kích thước PR là 4.000 dòng thêm
  mới; thay đổi lớn hơn nên tách thành các pull request xếp tầng.
- Tiêu đề PR phải tuân theo Conventional Commits y hệt chủ đề commit
  (`fix(ui): show-in-folder button does nothing on macOS`).
- Nội dung PR phải mô tả động lực, cách tiếp cận, và cách bạn kiểm thử, đồng
  thời liên kết issue nó đóng lại (`Fixes #123`).
- Mọi cổng chặn (blocking, xem dưới đây) phải xanh trước khi hợp nhất. Các
  cổng tư vấn (advisory) chỉ tạo cảnh báo, nhưng số lượng phát hiện của chúng
  được ratchet: giữ cho chúng giảm, không bao giờ tăng.
- Không hợp nhất trực tiếp vào `main`; job gatekeeper tồn tại để được nhìn thấy.

## Quy ước Commit

Chúng tôi theo [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — tính năng mới
- `fix:` — sửa lỗi
- `docs:` — thay đổi tài liệu
- `style:` — thay đổi định dạng code (formatting, v.v.)
- `refactor:` — tái cấu trúc code
- `perf:` — cải thiện hiệu năng
- `test:` — thêm hoặc sửa test
- `build:` / `ci:` — hệ thống build / CI
- `chore:` — bảo trì
- `revert:` — hoàn tác

Quy tắc do `g26 commit-hygiene` (`scripts/gates/commit-gates.mjs`) thực thi:

- Định dạng chủ đề: `type(scope)?: mô tả` (4–120 ký tự).
- Không có sáo ngữ AI-slop và không có emoji trong chủ đề commit.
- Mọi commit dưới xem xét phải được tác giả **và** người commit là WasewaseX —
  xem mục tiếp theo.
- `g27 commit-body-width` (`scripts/gates/commit-body-width.mjs`) khuyến nghị
  giữ các dòng thân commit dưới 100 ký tự.

## Yêu cầu về tác giả

**Mọi commit phải được tác giả và người commit là `WasewaseX`**
(`321686523+WasewaseX@users.noreply.github.com`). Đây là cổng chặn cứng
(`g25 author-gate-wasewasex`, hiện thực trong
`scripts/gates/author-gate.mjs`). Không có ngoại lệ cho bot. Cấu hình danh
tính git cục bộ trước khi commit:

```bash
git config user.name "WasewaseX"
git config user.email "321686523+WasewaseX@users.noreply.github.com"
```

Commit do danh tính khác tạo ra sẽ trượt cổng kiểm tra và PR không thể hợp
nhất cho đến khi lịch sử được viết lại.

Chỉ có nội dung email là KHÔNG đủ tin cậy — ai cũng có thể cấu hình email tùy
ý. Một commit chỉ được chấp nhận khi danh tính của nó còn được **xác thực**:
hoặc commit mang chữ ký mật mã mà git xác minh được (signed commits), hoặc
GitHub commits API liên kết **cả** tác giả lẫn người commit về tài khoản
`WasewaseX`. Commit không có chữ ký mà GitHub không thể quy về `WasewaseX`
sẽ bị từ chối. Để đảm bảo mạnh nhất, hãy bật thêm "Require signed commits"
trong cài đặt bảo vệ nhánh của repository (đây là cài đặt repository, không
phải thứ tài liệu này có thể thực thi).

## Hệ thống cổng kiểm tra

Hệ thống nằm trong `.github/workflows/quality-gates.yml` và
`scripts/gates/`. Nó được **phân tầng**:

- **Cổng chặn (blocking)** — phải pass; bất kỳ thất bại nào đều chặn hợp nhất
  (job `GATEKEEPER` tổng hợp chúng).
- **Cổng tư vấn (advisory)** — báo phát hiện dưới dạng cảnh báo; không chặn
  gì, nhưng cơ chế ratchet (xem dưới) bảo đảm số phát hiện chỉ giảm theo
  thời gian.

### Mô hình ratchet (baselines.json)

Fork này kế thừa một codebase upstream lớn và trưởng thành. Các cổng sẽ "đỏ
choét" ngay ngày đầu (legacy `console.log`, so sánh lỏng, file quá khổ, trôi
dịch thuật, tường bình luận, DOM sinks) dùng **ratchet**: số lượng mục vi
phạm hiện tại theo từng file được ghim trong `scripts/gates/baselines.json`
(`scripts/gates/calibrate-baselines.mjs` tái tạo nó). Cổng chỉ thất bại khi
con số đó **tăng**. Dọn dẹp các mục legacy luôn được hoan nghênh — con số
được phép giảm. Không bao giờ nâng baseline để lén lút đưa vi phạm vào; biện
minh cho mọi thay đổi baseline trong mô tả PR.

Các phát hiện zero-tolerance (dấu hiệu AI, emoji trong code, lệnh debugger,
marker xung đột merge chưa xử lý, secrets, khối catch rỗng mới trong file
đã thay đổi) không bao giờ được baseline — chúng chặn ngay lập tức.

### Danh mục cổng kiểm tra

**Nền tảng & build (chặn)** — `g01`–`g10`: install-clean,
lockfile-untouched, typecheck, biome-check, biome-format, unit-tests,
frontend-build, plugin-store-validate, extension-build, sdk-build.

**AI-slop & code nhân hóa (chặn)** — `g11` `scripts/gates/ai-slop.mjs`
(sáo ngữ, placeholder, emoji, tường bình luận), `g12`
`scripts/gates/humanized-code.mjs` (bình luận füller, định danh placeholder),
`g13` `scripts/gates/emoji-ban.mjs` (cấm emoji trong code), `g14` placeholder-ban.

**Mẫu lỗi (chặn)** — `g15` `scripts/gates/bug-patterns.mjs` (catch rỗng,
eval, console.log, so sánh lỏng, TODO), `g16` debugger-ban, `g17`
merge-conflict-markers, `g18` unsafe-regex-scan, `g19` todo-quota (advisory).

**Bảo mật (chặn)** — `g20` `scripts/gates/secret-patterns.mjs`, `g21`
`scripts/gates/xss-patterns.mjs` (DOM sinks), `g22`
`scripts/gates/blank-target-safety.mjs` (noopener), `g23`
`scripts/gates/insecure-url.mjs` (advisory), `g24` hardcoded-paths (advisory),
cùng các công cụ: gitleaks, quét Trivy vulnerability + secret.

**Tác giả & tính toàn vẹn (chặn)** — `g25` `scripts/gates/author-gate.mjs`,
`g26` `scripts/gates/commit-gates.mjs`, `g29`
`scripts/gates/integrity-gate.mjs`, `g30` `scripts/gates/protected-paths.mjs`,
`g31` `scripts/gates/workflow-pinning.mjs`; `g27`
`scripts/gates/commit-body-width.mjs` và `g28` commit-signature là advisory.

**Tài liệu & tính nhất quán (chặn)** — `g32` `scripts/gates/docs-gate.mjs`, `g33`
`scripts/gates/i18n-parity.mjs`, `g35` `scripts/gates/release-consistency.mjs`,
`g36` `scripts/gates/repo-hygiene.mjs`, `g37` `scripts/gates/file-attrs.mjs`
(BOM/CRLF/symlinks), `g38` `scripts/gates/file-naming.mjs`, `g39`
agents-md-present, `g40` license-present, `g41` gitattributes-present, `g42`
`scripts/gates/gitignore-check.mjs`, `g43`
`scripts/gates/package-scripts-check.mjs`, `g45` `scripts/gates/file-size.mjs`
(giới hạn kích thước file), `g50`
`scripts/gates/readme-links.mjs`; `g34` `scripts/gates/unused-i18n.mjs` và
`g44` `scripts/gates/changelog-check.mjs` là advisory.

**Toàn vẹn cấu hình (chặn)** — `g46`
`scripts/gates/tauri-config-check.mjs`, `g47`
`scripts/gates/extension-manifest.mjs`, `g48`
`scripts/gates/dependency-budget.mjs` (một lockfile duy nhất + ngân sách phụ
thuộc), `g49` `scripts/gates/tsconfig-strict.mjs`, và kiểm tra phiên bản
`semver-check` (`scripts/gates/semver-check.mjs`).

**Quét cú pháp** — `g51` json-valid (chặn), `g52` yaml-valid (advisory),
`g53` markdown-lint (advisory), `g54` editorconfig (advisory), `g55`
`scripts/gates/import-hygiene.mjs` (advisory).

**Heuristic chất lượng code (advisory, ratchet)** — `g56`
`scripts/gates/line-length.mjs`, `g57` `scripts/gates/function-length.mjs`,
`g58` `scripts/gates/nesting-depth.mjs`, `g59`
`scripts/gates/magic-numbers.mjs`, `g60` `scripts/gates/ts-any-audit.mjs`,
`g61` `scripts/gates/duplication-check.mjs`, `g62`
`scripts/gates/react-a11y.mjs`, console-error-audit
(`scripts/gates/console-error-audit.mjs`), môi trường env-access
(`scripts/gates/env-scan.mjs`), heuristic fetch-timeout
(`scripts/gates/fetch-timeout.mjs`).

**Công cụ phân tích code** — circular imports
(`scripts/gates/circular-imports.mjs`, ratchet chặn; số chu trình trong
`baselines.json` chỉ được giảm), knip unused exports (advisory), depcheck
unused dependencies (advisory), shellcheck (advisory), osv-scanner (advisory),
ngân sách bundle-size (advisory), sự hiện diện của pre-commit hook (chặn),
sai cấu hình kiểu semgrep của Trivy (advisory), kiểm toán license Trivy
(advisory).

**Rust / Tauri (chặn)** — cargo-check, cargo-test, cargo-fmt,
cargo-clippy + `scripts/gates/clippy-diff.mjs` (không nhận nợ clippy mới
trong file đã thay đổi; cảnh báo legacy được báo dưới dạng con số giảm dần);
cargo-doc, cargo-deny, clippy-pedantic, và các tương đương
`cargo tree --duplicates` chạy dạng advisory.

**Cổng pull-request** — `pr-gates` (`scripts/gates/pr-gates.mjs`, tiêu đề
chặn), `scripts/gates/type-safety-diff.mjs` (không `as any` /
`@ts-ignore` mới), đặt tên nhánh (advisory), dependency-review (advisory).

**Bộ tổng hợp** — `GATEKEEPER` (tất cả cổng chặn) và
`advisory-findings-report`.

## Chính sách AI-slop (chống code máy sinh)

Chúng tôi hoan nghênh công cụ hỗ trợ, nhưng code được commit phải đọc như do
một con người hiểu rõ miền bài toán viết ra. `scripts/gates/ai-slop.mjs` và
`scripts/gates/humanized-code.mjs` thực thi điều này ở chế độ strict:

- **Zero tolerance**: tự tham chiếu LLM ("as an AI"), văn bản placeholder
  ("your code here", "implementation goes here"), dấu "Generated by …",
  emoji trong văn bản code (ngoài string literal dùng làm icon UI).
- **Sáo ngữ ratchet**: các cụm marketing/độn trong bình luận — "delve into",
  "tapestry", "supercharge", "seamless integration", "leverage", "game
  changer", "it's worth noting", "in the realm of", và đồng bọn.
- **Tường bình luận ratchet**: bình luận không được vượt 25% số dòng của file.
- **Bình luận độn ratchet**: "This function…", "Please note that…",
  "In order to…" — bình luận phải giải thích TẠI SAO, không tường thuật CÁI GÌ.
- **Định danh placeholder ratchet**: `foo`, `doStuff`, `data1`, `temp2` và
  họ hàng bị từ chối trong khai báo mới.

Nếu một tồn đọng legacy vấp ratchet, hãy sửa nếu có thể; nếu không, giữ số
đếm của nó ở hoặc dưới baseline.

## Toàn vẹn code và chứng cứ chống can thiệp CI

Các file trọng yếu CI (`.github/workflows/*`, `scripts/gates/**`,
`CONTRIBUTING.md`, `.editorconfig`) được ghim bằng SHA-256 trong
`.integrity/manifest.json` (`scripts/gates/integrity-generate.mjs` tái tạo
ghim). Cổng `g29 integrity-manifest` tính lại mọi hash mỗi lần chạy. Nếu bạn
thay đổi hợp pháp một file trọng yếu CI, hãy tái tạo manifest **trong cùng
commit**:

```bash
bun scripts/gates/integrity-generate.mjs
git add .integrity/manifest.json
```

Nhãn PR `ci-change` (`g30 protected-paths`,
`scripts/gates/protected-paths.mjs`) chỉ miễn trừ một thay đổi CI đã được
duyệt khỏi kiểm tra đóng băng đường dẫn THÔI. Nó không thay thế manifest:
`g29 integrity-manifest` tính lại mọi SHA-256 mỗi lần chạy, nên một chỉnh sửa
trọng yếu CI với `.integrity/manifest.json` không đổi sẽ trượt cổng toàn vẹn
bất kể nhãn nào. Việc tái tạo manifest trong cùng commit luôn là bắt buộc.
Can thiệp workflow ngầm sẽ làm build thất bại.

## Trình chạy cổng cục bộ

Chạy toàn bộ bộ scanner chặn cục bộ trước khi push (bắt chước CI):

```bash
export GITHUB_EVENT_NAME=push GITHUB_SHA=$(git rev-parse HEAD)
for s in ai-slop humanized-code bug-patterns file-size secret-patterns \
         xss-patterns blank-target-safety repo-hygiene file-attrs file-naming \
         release-consistency i18n-parity tauri-config-check extension-manifest \
         dependency-budget tsconfig-strict readme-links workflow-pinning \
         docs-gate integrity-gate author-gate commit-gates semver-check \
         gitignore-check package-scripts-check; do
  bun scripts/gates/$s.mjs || exit 1
done
```

## Báo lỗi

Mở issue trên fork này kèm các bước tái hiện, nền tảng, và phiên bản Youwee.
Với báo cáo nhạy cảm về bảo mật, dùng "Security" → "Report a
vulnerability" thay vì issue công khai.
