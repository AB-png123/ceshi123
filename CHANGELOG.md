# Changelog

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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
