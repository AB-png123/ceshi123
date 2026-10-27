# Changelog

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## 1.3.3 — 2026-10-27

macOS 兼容性复查后的一轮修复。

- **不再误选坏的 `/usr/bin/python3`**：1.3.3 会先校验候选解释器的版本（要求 3.8+）。未安装 Xcode CLT 时，`/usr/bin/python3` 只是个会弹「安装命令行开发者工具」的存根；现在会跳过它，避免启动时弹窗或日志里只有许可错误。
- **补充 macOS 解释器候选**：DSH 自带运行时、`~/.pyenv/shims/python3`、Homebrew（Intel `/usr/local` 与 Apple Silicon `/opt/homebrew`）、MacPorts `/opt/local`、最后才是 `command -v python3`。
- **`DSH_HAO_IMPORT_PYTHON` 显式指定时校验失败会明确报错**（exit 127 + 写 `import.log`），不再悄悄退回其他解释器。
- **`DSH_WALLPAPER_ENGINE_DIR` 支持 `~`**（此前 `~` 会被当成字面目录名）。
- **并发保护**：`uploads/.import.lock`（PID + 15 分钟陈旧判断）避免多个 DSH 窗口同时导入导致序号/状态互相覆盖；`--dry-run` 不拿锁。
- **macOS 权限提示**：没有可导入项时提示到「系统设置 → 隐私与安全性 → 文件与文件夹」给 DSH 授权 Desktop/Documents。
- 元数据 `localPath` 支持目录和 `~`，目录会按标准布局继续找 `wallpaper.mp4` / 首帧图。
- 新增 `test/wrapper.test.mjs`（真实调用 `run-import.sh`，覆盖日志、锁、错误解释器）；测试共 20 个。
- CI 矩阵加入 `macos-latest`。

## 1.3.2 — 2026-10-27

修复 PowerShell 5.1 在无控制台/重定向场景下的日志乱码。

- 1.3.1 通过设置 `[Console]::OutputEncoding` 来修正中文，但 DSH 以 `stdio=ignore` 后台启动、CI 也会重定向输出，此时该设置可能抛异常或不生效，`import.log` 里的中文标题仍是 `å£çº¸` 之类的乱码。
- 现在由 Python 通过 `--report <path>` 把同一份报告以 UTF-8 写入临时文件，PowerShell 读取该文件后再追加到 `import.log`，完全绕开 PowerShell 的原生输出解码。
- 新增对应测试（17 个）；Windows CI 增加「日志中的中文标题必须正确」断言，PowerShell 5.1 与 7 都覆盖。

## 1.3.1 — 2026-10-27

Windows 复核后的一轮健壮性修复。

- **导入目标跟随壁纸引擎**：解析顺序改为 `DSH_WE_UPLOAD_DIR` → `<引擎目录>/config.json` 的 `uploadDir` → `<引擎目录>/uploads`。此前只写死 `uploads/`，用户在引擎里改过上传目录后，导入的壁纸不会出现在 DSH 里。
- **只导入引擎认识的格式**：`mp4 / png / jpg / jpeg`；遇到 `.webm` / `.mov` / `.webp` / `.bmp` / `.gif` 等会明确打印「不受 DSH 壁纸引擎支持」并跳过，不再复制一个永远不显示的 `up-*.webm`。
- **PowerShell 5.1 修复**：
  - 缺 `import_hao.py`、缺 Python 等早期错误现在写入 `import.log`（插件以 `stdio=ignore` 后台启动，此前这些错误只剩一个退出码）。
  - 冷却文件改为**找到 Python 之后**才写，避免「缺 Python」在 15 秒内被静默吞掉；`-DryRun` 不污染冷却。
  - `-Force` / `-DryRun` 不再作为未知参数转发给 Python；支持 `--force` / `--dry-run`。
  - Python 版本按主次版本比较，真正要求 3.8+。
  - 捕获 Python 输出前切到 UTF-8，中文标题不再因 OEM 代码页变成乱码。
  - 优先用 `USERPROFILE` 推导数据目录，不再被 Git Bash 残留的 `HOME` 带偏。
- **bash 入口**：支持 `DSH_WE_DATA_DIR`；缺 Python / 缺脚本的失败也会写进 `import.log`。
- **lib/index.js**：Windows 下 `USERPROFILE` 优先；退出码提示同时识别 `DSH_WE_DATA_DIR`；`spawn` 加 `windowsHide`。
- **状态写入**：`dump_json` 在 Windows 上遇到 `PermissionError`（杀毒/引擎短暂占用）重试 3 次。
- 测试增至 16 个；CI 增加 Windows PowerShell 5.1 冒烟测试与「早期失败必须写日志」断言。

## 1.3.0 — 2026-10-27

Windows 兼容适配。

- 新增 `scripts/run-import.ps1`：PowerShell 5.1+ 入口，负责冷却、查找 Python、写日志；Windows 不再依赖 bash。
- `lib/index.js` 按平台选择入口（`.sh` / `.ps1`，也支持覆盖为 `.cmd`），并抽出可测试的 `resolveLaunch()` / `applyFor()`。
- `scripts/import_hao.py` 优先读取 Hao Wallpaper 元数据里的 `localPath`（绝对路径），不再强依赖 `~/Desktop/数据/壁纸` 目录；目录扫描降级为兜底。
- 增加 Windows 默认路径探测（`%APPDATA%\Hao Wallpaper`、`%LOCALAPPDATA%`、`~/Pictures/Hao Wallpaper`、`~/Pictures/哲风壁纸`）。
- 新增 `HAO_WALLPAPER_DIRS` 支持多个壁纸库；路径去重按 `normcase` 处理 Windows 大小写。
- Python 输出统一 UTF-8，避免 Windows 控制台/重定向时中文报 `UnicodeEncodeError`。
- 新增 4 个 Python 导入测试与 4 个平台解析测试；CI 改为 Ubuntu + Windows 矩阵，并在 Windows 上校验 PowerShell 语法。

## 1.2.0 — 2026-10-25

修复「装完空转」：其他机器从 GitHub 安装后找不到脚本，插件只写一行日志、什么也不做。

- 默认执行**包内** `scripts/run-import.sh`：通过 `dsh plugin add github:…` / tgz 装好后即可工作，无需先手动放置脚本。
- `~/.dsh/wallpaper-import/` 降级为可选路径，仅当显式设置 `DSH_HAO_IMPORT_SCRIPT` 时使用；不再静默回退。
- 脚本或同目录 `import_hao.py` 缺失时，插件以 **error** 级别报出完整路径、来源（包内/环境变量）与修复方式，不再静默跳过。
- `install.sh` 改为可选的脚本副本安装器，并在输出里说明插件默认不依赖该目录。
- README 重写安装章节：删除「先克隆再复制脚本」的前置步骤，补充包内路径、手动运行与排障。
- CI 增加打包断言，确保 `scripts/run-import.sh`、`scripts/import_hao.py` 确实进入 npm tarball。

## 1.1.0 — 2026-10-25

首个开源仓库版本。

- 新增 `install.sh`：一键安装导入脚本，`--with-plugin` 可顺带装入 DSH profile。
- 导入脚本移入 `scripts/`，随仓库分发，不再依赖机器上的 `~/.dsh/wallpaper-import/` 手写副本。
- 路径全部可用环境变量覆盖（`HAO_WALLPAPER_DIR`、`DSH_WALLPAPER_ENGINE_DIR`、`HAO_WALLPAPER_DATA_DIR`）。
- 脚本自动探测 Python（DSH 运行时 → Homebrew → 系统），可用 `DSH_HAO_IMPORT_PYTHON` 指定。
- `.meta.json` / `.imported.json` 改为原子写入，避免中断损坏。
- 新增 `--dry-run` 预演与 `--force` 跳过 15 秒冷却；`--dry-run` 不写冷却时间。
- 移除写死的首轮 bootstrap 映射，改由现有 `.imported.json` 保证幂等。
- 插件在脚本缺失时静默跳过并给出日志提示，不再产生 spawn 错误。
- 新增 README、MIT LICENSE、CI 与发布元数据。

## 1.0.5 — 2026-10-24

- 初始版本：DSH 启动时后台调用 `~/.dsh/wallpaper-import/run-import.sh`。
- 动态壁纸优先、标题提取、按「壁纸 id + 类型」去重。

## 1.0.0 — 2026-10-24

- 内部试用版。
