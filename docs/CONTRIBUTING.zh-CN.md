# 向 Youwee（WasewaseX fork）贡献代码

欢迎，感谢你考虑为本项目做贡献。本 fork 运行一套包含 89 个检查门
（gate）的分层 CI 系统，每个 pull request 在合并之前必须全部通过。本文档
是具有约束力的契约：它解释各项规则、执行这些规则的检查门，以及让改动被
合并的确切工作流。如果你改变了检查门的运作方式，就必须在同一个 pull
request 中更新本文档——否则 `g32 contributing-coverage` 门会失败。文档与
执行机制刻意保持同步。

## 快速开始

1. Fork 本仓库并克隆你的 fork。
2. 按分支命名规范从 `main` 创建特性分支：
   `git checkout main && git pull origin main && git checkout -b fix/my-fix`
   或 `feat/my-feature`。分支名必须以 Conventional Commit 类型开头
   （`feat/`、`fix/`、`docs/`、`chore/` 等）。
3. 安装依赖：`bun install --frozen-lockfile`（必须使用 Bun；仅当你改动
   `src-tauri/` 时才需要 Rust 工具链）。
4. 进行你的改动。
5. 推送之前在本地运行预检：

   ```bash
   bun run lint          # Biome lint + format
   bunx tsc -b           # TypeScript strict 类型检查
   bun run build:sdk     # 构建 SDK（运行测试前必须执行）
   bun test              # 前端测试套件
   bun run build         # 前端生产构建
   cd src-tauri && cargo check && cargo test && cargo fmt --check && cargo clippy -- -D warnings
   for s in scripts/gates/*.mjs; do bun "$s" || exit 1; done   # 在适用的地方执行
   ```

6. 提交改动（见下方的提交规则）并推送。
7. 针对**本 fork 的 `main` 分支**发起 Pull Request。

## Pull Request 流程

- 始终从最新的 `main` 创建分支，并在工作期间保持 rebase，让 PR 始终可合并。
- 每个 PR 只承载一个逻辑改动。PR 的新增行预算是 4,000 行；更大的改动应拆
  分为堆叠式 pull request。
- PR 标题必须像提交主题一样严格遵循 Conventional Commits
  （`fix(ui): show-in-folder button does nothing on macOS`）。
- PR 正文必须描述动机、方案以及你的测试方式，并链接它所关闭的 issue
  （`Fixes #123`）。
- 合并前所有阻塞门（见下文）必须全部通过。咨询（advisory）门只产生警告，
  但其发现数量受棘轮（ratchet）约束：只能下降，绝不能上升。
- 不要直接向 `main` 合并；gatekeeper job 的存在就是为了被看见。

## 提交规范

我们遵循 [Conventional Commits](https://www.conventionalcommits.org/)：

- `feat:` — 新功能
- `fix:` — 缺陷修复
- `docs:` — 文档改动
- `style:` — 代码风格改动（格式化等）
- `refactor:` — 重构
- `perf:` — 性能改进
- `test:` — 新增或修正测试
- `build:` / `ci:` — 构建系统 / CI 改动
- `chore:` — 维护性工作
- `revert:` — 回滚

由 `g26 commit-hygiene`（`scripts/gates/commit-gates.mjs`）执行的规则：

- 主题格式：`type(scope)?: 描述`（4–120 个字符）。
- 提交主题中不得出现 AI-slop 陈词滥调和 emoji。
- 审查范围内的每个提交的作者与提交者都必须是 WasewaseX —— 见下一节。
- `g27 commit-body-width`（`scripts/gates/commit-body-width.mjs`）建议正文
  每行不超过 100 个字符。

## 作者要求

**每个提交的作者和提交者都必须是 `WasewaseX`**
（`321686523+WasewaseX@users.noreply.github.com`）。这是一道硬性阻塞门
（`g25 author-gate-wasewasex`，实现位于
`scripts/gates/author-gate.mjs`）。没有任何机器人例外。提交之前先配置本
地 git 身份：

```bash
git config user.name "WasewaseX"
git config user.email "321686523+WasewaseX@users.noreply.github.com"
```

由其他身份创建的提交会判定门失败，且在历史被重写之前 PR 无法合并。

仅凭邮箱文本是不可信的——任何人都能随意配置邮箱。只有当提交的身份同时
通过**认证**时才会被接受：提交带有 git 可验证的密码学签名（signed
commits），或者 GitHub commits API 将作者**和**提交者都关联到
`WasewaseX` 账户。GitHub 无法归属于 `WasewaseX` 的未签名提交会被拒绝。
若要获得最强保证，请在仓库的分支保护设置中同时启用 "Require signed
commits"（这是仓库设置，不是本文档能强制执行的内容）。

## 质量门系统

系统位于 `.github/workflows/quality-gates.yml` 和
`scripts/gates/`。它是**分层的**：

- **阻塞门（blocking）** —— 必须通过；任何失败都会阻止合并
  （`GATEKEEPER` job 负责汇总）。
- **咨询门（advisory）** —— 以警告形式报告发现；不阻塞任何内容，但棘轮
  （见下文）确保发现数量随时间只减不增。

### 棘轮模型（baselines.json）

本 fork 继承了一个庞大且成熟的上游代码库。那些第一天就会刷红的门
（遗留的 `console.log`、宽松相等、超长文件、翻译漂移、注释墙、DOM sinks）
使用**棘轮**：每文件当前的问题计数被固定在
`scripts/gates/baselines.json` 中
（`scripts/gates/calibrate-baselines.mjs` 负责重新生成）。只有当计数
**增长**时门才会失败。清理遗留问题永远受欢迎——计数允许下降。绝不要为
了夹带违规而抬高 baseline；每一次 baseline 变更都必须在 PR 描述中给出
理由。

零容忍的发现（AI 痕迹、代码中的 emoji、debugger 语句、未解决的合并冲突
标记、secrets、被改动文件中新增的空 catch 块）永远不会进入 baseline——
它们立即阻塞。

### 检查门目录

**基础与构建（阻塞）** —— `g01`–`g10`：install-clean、
lockfile-untouched、typecheck、biome-check、biome-format、unit-tests、
frontend-build、plugin-store-validate、extension-build、sdk-build。

**AI-slop 与人味代码（阻塞）** —— `g11` `scripts/gates/ai-slop.mjs`
（陈词滥调、占位符、emoji、注释墙），`g12`
`scripts/gates/humanized-code.mjs`（填充注释、占位标识符），`g13`
`scripts/gates/emoji-ban.mjs`（代码禁用 emoji），`g14` placeholder-ban。

**缺陷模式（阻塞）** —— `g15` `scripts/gates/bug-patterns.mjs`（空 catch、
eval、console.log、宽松相等、TODO），`g16` debugger-ban，`g17`
merge-conflict-markers，`g18` unsafe-regex-scan，`g19` todo-quota（advisory）。

**安全（阻塞）** —— `g20` `scripts/gates/secret-patterns.mjs`，`g21`
`scripts/gates/xss-patterns.mjs`（DOM sinks），`g22`
`scripts/gates/blank-target-safety.mjs`（noopener），`g23`
`scripts/gates/insecure-url.mjs`（advisory），`g24` hardcoded-paths
（advisory），外加工具：gitleaks、Trivy 漏洞与 secret 扫描。

**作者与完整性（阻塞）** —— `g25` `scripts/gates/author-gate.mjs`，
`g26` `scripts/gates/commit-gates.mjs`，`g29`
`scripts/gates/integrity-gate.mjs`，`g30` `scripts/gates/protected-paths.mjs`，
`g31` `scripts/gates/workflow-pinning.mjs`；`g27`
`scripts/gates/commit-body-width.mjs` 与 `g28` commit-signature 为 advisory。

**文档与一致性（阻塞）** —— `g32` `scripts/gates/docs-gate.mjs`，`g33`
`scripts/gates/i18n-parity.mjs`，`g35` `scripts/gates/release-consistency.mjs`，
`g36` `scripts/gates/repo-hygiene.mjs`，`g37` `scripts/gates/file-attrs.mjs`
（BOM/CRLF/symlinks），`g38` `scripts/gates/file-naming.mjs`，`g39`
agents-md-present，`g40` license-present，`g41` gitattributes-present，`g42`
`scripts/gates/gitignore-check.mjs`，`g43`
`scripts/gates/package-scripts-check.mjs`，`g45` `scripts/gates/file-size.mjs`
（文件大小限制），`g50`
`scripts/gates/readme-links.mjs`；`g34` `scripts/gates/unused-i18n.mjs` 与
`g44` `scripts/gates/changelog-check.mjs` 为 advisory。

**配置完整性（阻塞）** —— `g46`
`scripts/gates/tauri-config-check.mjs`，`g47`
`scripts/gates/extension-manifest.mjs`，`g48`
`scripts/gates/dependency-budget.mjs`（单一 lockfile + 依赖预算），`g49`
`scripts/gates/tsconfig-strict.mjs`，以及 `semver-check`
（`scripts/gates/semver-check.mjs`）版本校验。

**语法扫描** —— `g51` json-valid（阻塞），`g52` yaml-valid（advisory），
`g53` markdown-lint（advisory），`g54` editorconfig（advisory），`g55`
`scripts/gates/import-hygiene.mjs`（advisory）。

**代码质量启发式（advisory，棘轮）** —— `g56`
`scripts/gates/line-length.mjs`，`g57` `scripts/gates/function-length.mjs`，
`g58` `scripts/gates/nesting-depth.mjs`，`g59`
`scripts/gates/magic-numbers.mjs`，`g60` `scripts/gates/ts-any-audit.mjs`，
`g61` `scripts/gates/duplication-check.mjs`，`g62`
`scripts/gates/react-a11y.mjs`，console-error-audit
（`scripts/gates/console-error-audit.mjs`），env-access 清单
（`scripts/gates/env-scan.mjs`），fetch-timeout 启发式
（`scripts/gates/fetch-timeout.mjs`）。

**代码智能工具** —— 循环依赖（`scripts/gates/circular-imports.mjs`，
阻塞式棘轮；`baselines.json` 中的环数只允许下降），knip 未使用导出
（advisory），depcheck 未使用依赖（advisory），shellcheck（advisory），
osv-scanner（advisory），bundle-size 预算（advisory），pre-commit hook
存在性（阻塞），Trivy 的 semgrep 风格错误配置扫描（advisory），Trivy
license 审计（advisory）。

**Rust / Tauri（阻塞）** —— cargo-check、cargo-test、cargo-fmt、
cargo-clippy + `scripts/gates/clippy-diff.mjs`（被改动文件中不允许任何新
clippy 债务；遗留警告以下降计数的形式报告）；cargo-doc、cargo-deny、
clippy-pedantic 以及 `cargo tree --duplicates` 等价检查以 advisory 方式运行。

**Pull request 门** —— `pr-gates`（`scripts/gates/pr-gates.mjs`，标题阻
塞），`scripts/gates/type-safety-diff.mjs`（不允许新的 `as any` /
`@ts-ignore`），分支命名（advisory），dependency-review（advisory）。

**汇总器** —— `GATEKEEPER`（所有阻塞门）与
`advisory-findings-report`。

## AI-slop 政策（对抗机器生成的样板代码）

我们欢迎辅助工具，但提交的代码必须读起来像一个理解业务领域的人类所写。
`scripts/gates/ai-slop.mjs` 与 `scripts/gates/humanized-code.mjs` 以 strict
模式执行这一要求：

- **零容忍**：LLM 自指（"as an AI"）、占位文字（"your code here"、
  "implementation goes here"）、"Generated by …" 标记、代码文字中的
  emoji（用作 UI 图标的字符串字面量除外）。
- **棘轮陈词滥调**：注释中的营销/填充短语——"delve into"、
  "tapestry"、"supercharge"、"seamless integration"、"leverage"、"game
  changer"、"it's worth noting"、"in the realm of" 等。
- **棘轮注释墙**：注释不得超过文件行数的 25%。
- **棘轮填充注释**："This function…"、"Please note that…"、"In order
  to…" —— 注释必须解释为什么（WHY），而不是叙述做了什么（WHAT）。
- **棘轮占位标识符**：`foo`、`doStuff`、`data1`、`temp2` 等在新声明中
  一律拒绝。

如果遗留问题触发了棘轮，能修就修；否则将其计数保持在 baseline 以下。

## 代码完整性与 CI 防篡改证据

CI 关键文件（`.github/workflows/*`、`scripts/gates/**`、
`CONTRIBUTING.md`、`.editorconfig`）以 SHA-256 固定在
`.integrity/manifest.json` 中（`scripts/gates/integrity-generate.mjs` 负责
重新生成）。`g29 integrity-manifest` 门在每次运行时重算所有哈希。如果你
合法地修改了 CI 关键文件，必须在**同一个提交**中重新生成 manifest：

```bash
bun scripts/gates/integrity-generate.mjs
git add .integrity/manifest.json
```

`ci-change` PR 标签（`g30 protected-paths`、
`scripts/gates/protected-paths.mjs`）仅豁免受审查 CI 改动的路径冻结检查。
它不能替代 manifest：`g29 integrity-manifest` 每次运行都会重算所有
SHA-256，因此无论打什么标签，`.integrity/manifest.json` 未同步更新的
CI 关键文件改动都会在完整性门上失败。在同一提交中刷新 manifest 始终是
必需的。暗中篡改 workflow 会让构建失败。

## 本地门运行器

推送之前在本地运行整套阻塞 scanner（与 CI 镜像一致）：

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

## 报告问题

在本 fork 上开 issue，附上复现步骤、平台与 Youwee 版本。涉及安全的敏感
报告请使用 "Security" → "Report a vulnerability"，而不是公开 issue。
