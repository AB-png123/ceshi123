# dsh-hao-import

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Platform: macOS | Windows](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey.svg)
![DSH: >=0.2.0-rc.1](https://img.shields.io/badge/DSH-%3E%3D0.2.0--rc.1-4B32C3.svg)

> 一个开源的 [DeepSeek Harness](https://github.com/deepseek-ai) 插件：**每次启动 DSH 时，自动把 [Hao Wallpaper](https://www.haowallpaper.com/) 新下载的壁纸增量导入 DSH 壁纸引擎。** 支持 macOS 与 Windows。

Hao Wallpaper 的壁纸存在自己的目录里，而 DSH 壁纸引擎只认 `~/.dsh-wallpaper-engine/uploads/` 下的 `up-*` 文件。每次下载完都要手动拷贝、改名、写标题——本插件把这件事变成「打开 DSH 就自动完成」。

> **前置条件**：需要先安装 **`dsh-plugin-wallpaper-engine`**（DSH 壁纸引擎插件）。本插件解决的是「壁纸引擎装好后没有可用壁纸」的问题；没有壁纸引擎时，导入的文件不会被展示。

---

## 特性

- **启动即导入**：挂在 DSH 内核 `apply()` 上，每次启动后台执行一次，不阻塞启动。
- **跨平台**：macOS / Linux 走 `bash` 入口，Windows 走 PowerShell 5.1+ 入口；Windows 不需要安装 Git Bash。
- **增量 + 幂等**：按「壁纸 id + 类型」记录已导入条目，重复启动只会得到「新增 0 条」。
- **优先用元数据里的真实路径**：Windows 上 Hao Wallpaper 的壁纸库位置并不固定，插件直接读 `wallpaper-data.json` 里的 `localPath`（绝对路径），不依赖目录约定。
- **动态壁纸优先**：有 `wallpaper.mp4` 就导入真视频，避免把首帧图当成两条。
- **标题自动提取**：从 Hao Wallpaper 的元数据里取标题，截取前 3 段关键词；动态条目自动加「（动态）」。
- **失败可隔离**：脚本或 Python 出错只写日志，绝不影响 DSH 启动。
- **可配置 / 可禁用**：路径、解释器、开关都有环境变量。

## 工作原理

```
DSH 启动
  └─ 插件 apply()                              lib/index.js
       └─ 按平台 spawn 入口                    scripts/run-import.sh（macOS/Linux）
       │                                       scripts/run-import.ps1（Windows）
       │                                         └─ 15 秒冷却
       └─ python import_hao.py                  scripts/import_hao.py
            ├─ 读 wallpaper-data.json 的 localPath（Windows 主路径）
            ├─ 兜底扫描 wallpaper-<id>/ 目录
            └─ 复制到 <引擎目录>/uploads/up-hao-NN.*
               → 更新 .imported.json / .meta.json，追加 import.log
```

`<引擎目录>` 默认是 `~/.dsh-wallpaper-engine`（Windows 为 `%USERPROFILE%\.dsh-wallpaper-engine`）。

| 组件 | 作用 |
| --- | --- |
| `lib/index.js` | DSH 插件入口：按平台选入口脚本，后台触发 |
| `cordis.patch.yml` | bundle patch，让 `dsh plugin add` 把插件挂到宿主内核 |
| `scripts/run-import.sh` | macOS/Linux 无界面入口：查找 Python、冷却、写日志 |
| `scripts/run-import.ps1` | Windows 无界面入口，同上（PowerShell 5.1+） |
| `scripts/import_hao.py` | 真正的扫描 / 去重 / 复制 / 写标题逻辑 |
| `install.sh` | macOS/Linux 可选：把脚本复制到 `~/.dsh/wallpaper-import/`，并可选装插件（插件本身不需要） |

## 环境要求

- **macOS**，或 **Windows 10/11**（Linux 理论上可用，未做专门测试）
- **DeepSeek Harness** ≥ `0.2.0-rc.1`
- **DSH 壁纸引擎插件**（`dsh-plugin-wallpaper-engine`）：本插件只负责把壁纸导入引擎的数据目录，壁纸的实际展示由该插件负责；没装它时导入的文件不会出现在 DSH 里
- **Python 3.8+**（优先使用 DSH 自带运行时，找不到再退回系统 `python3` / `python`）
- **Hao Wallpaper**，并且至少下载过一张壁纸
- Windows 需要 **PowerShell 5.1+**（系统自带）；不需要 Git Bash / WSL

## 安装

插件**自带导入脚本**（包内 `scripts/`），装好插件就能用——不需要先克隆仓库、也不需要手动复制任何文件到 `~/.dsh/wallpaper-import/`。

```bash
# A. 直接从 GitHub 安装
dsh plugin --profile desktop add github:AB-png123/dshplugin

# B. 或者从 Release 下载 tgz 后安装（Windows 下路径改成 C:\...）
dsh plugin --profile desktop add /path/to/dsh-hao-import-1.3.0.tgz
```

> 仓库早前名为 `AB-png123/ceshi123`，GitHub 会自动重定向；当前地址是 `AB-png123/dshplugin`。
>
> 旧版本要求先把脚本放进 `~/.dsh/wallpaper-import/`，否则插件只会静默跳过；1.2.0 起默认执行包内脚本，`~/.dsh/wallpaper-import/` 降级为**可选手动/自定义路径**（见下方 `DSH_HAO_IMPORT_SCRIPT`）。
>
> `./install.sh` 只服务于想手动管理脚本副本的 macOS/Linux 用户（例如配合 launchd）；Windows 用户不需要它。

重启 DSH 应用后生效。验证：

```bash
# macOS / Linux
tail -n 10 ~/.dsh-wallpaper-engine/import.log

# Windows PowerShell
Get-Content -Tail 10 "$env:USERPROFILE\.dsh-wallpaper-engine\import.log"
```

看到 `[时间] rc=0` 和「新增 N 条」就说明跑通了；没有新壁纸时会显示「新增 0 条」。

如果插件安装不完整（包内 `scripts/` 缺失）或 `DSH_HAO_IMPORT_SCRIPT` 指向了不存在的文件，插件会以 **error 级别**记录「找不到导入脚本 …」并给出修复方式，而不是静默跳过。DSH 日志位置：`~/.dsh/logs/`（Windows 为 `%USERPROFILE%\.dsh\logs\`）。

## 配置

所有配置都通过环境变量传入（GUI 应用不继承终端环境；Windows 可在「系统属性 → 环境变量」里设置后重启 DSH，macOS 可用 `launchctl setenv`）：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DSH_HAO_IMPORT_DISABLE` | 未设置 | 设为 `1` 关闭导入 |
| `DSH_HAO_IMPORT_SCRIPT` | 包内 `scripts/run-import.sh` / `run-import.ps1` | 显式覆盖入口脚本路径（可用 `.ps1` / `.cmd` / `.sh`） |
| `DSH_HAO_IMPORT_PYTHON` | 自动查找 | 指定 Python 解释器（`python3` 或 `python.exe`） |
| `HAO_WALLPAPER_DIR` | macOS：`~/Desktop/数据/壁纸`；Windows：`~/Desktop/数据/壁纸`、`~/Pictures/Hao Wallpaper`、`~/Pictures/哲风壁纸` | 兜底扫描的壁纸库目录 |
| `HAO_WALLPAPER_DIRS` | 未设置 | 多个壁纸库目录，用系统路径分隔符连接（Windows `;`，macOS `:`） |
| `HAO_WALLPAPER_DATA_DIR` | macOS：`~/Library/Application Support/Hao Wallpaper`；Windows：`%APPDATA%\Hao Wallpaper` 等 | Hao Wallpaper 元数据目录（`wallpaper-data.json` 所在处） |
| `DSH_WALLPAPER_ENGINE_DIR` | `~/.dsh-wallpaper-engine` | 壁纸引擎数据目录（日志也在这里） |

> 在 Windows 上最省事的方式通常是**不配置任何路径**：插件会直接读元数据里的绝对路径。只有元数据缺失或壁纸库被移动时，才需要 `HAO_WALLPAPER_DATA_DIR` / `HAO_WALLPAPER_DIR`。

## 手动运行与调试

插件安装后，脚本在 profile 的 `node_modules/dsh-hao-import/scripts/` 下：

```bash
# macOS / Linux
cd ~/.dsh/profiles/desktop/node_modules/dsh-hao-import
bash scripts/run-import.sh --force      # 立即跑一次（跳过 15 秒冷却）
bash scripts/run-import.sh --dry-run    # 只打印将导入什么，不写文件
python3 scripts/import_hao.py --dry-run # 直接调用 Python
```

```powershell
# Windows PowerShell
cd "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-hao-import"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-import.ps1 --force
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-import.ps1 --dry-run
python .\scripts\import_hao.py --dry-run
```

如果你把脚本复制到了 `~/.dsh/wallpaper-import/` 并想继续用那份副本，设置 `DSH_HAO_IMPORT_SCRIPT` 指向它即可；插件不会自动回退到该目录。

## 数据与状态文件

| 路径（macOS） | Windows 等价路径 | 内容 |
| --- | --- | --- |
| `~/.dsh-wallpaper-engine/uploads/up-hao-NN.*` | `%USERPROFILE%\.dsh-wallpaper-engine\uploads\up-hao-NN.*` | 导入后的壁纸文件 |
| `~/.dsh-wallpaper-engine/uploads/.meta.json` | 同上目录 | `up-hao-NN` → 标题 |
| `~/.dsh-wallpaper-engine/uploads/.imported.json` | 同上目录 | 壁纸 id + 类型 → `up-hao-NN`，幂等去重依据 |
| `~/.dsh-wallpaper-engine/import.log` | 同上 | 每次运行的输出与退出码 |
| `~/.dsh-wallpaper-engine/.last-run` | 同上 | 上次运行时间戳（15 秒冷却） |

想重新导入某张壁纸：删掉 `.imported.json` 里对应键和 `uploads/` 里的文件，再运行一次即可。

## 卸载

```bash
dsh plugin --profile desktop remove dsh-hao-import
# macOS/Linux：仅当你手动复制过脚本时才需要
rm -rf ~/.dsh/wallpaper-import
# 可选：清掉已导入的壁纸与状态
# rm -rf ~/.dsh-wallpaper-engine
```

Windows 上删除 `%USERPROFILE%\.dsh-wallpaper-engine` 即可清理数据。

## 已知限制

- 支持 macOS 与 Windows；Linux 走 bash 入口，理论可用但未专门测试。
- 依赖 Hao Wallpaper 的本地文件布局与元数据；Hao Wallpaper 改结构后需要同步调整脚本。
- 动态壁纸只导入 `wallpaper.mp4` / `wallpaper.webm` / `wallpaper.mov` 本体；Hao Wallpaper 未落地真视频时（只有低清预览）不会导入。
- 标题来自 Hao Wallpaper 元数据，元数据缺失时退回「Hao壁纸」。
- Windows 上若系统组策略禁止脚本执行，PowerShell 入口可能被拦；此时可手动运行 `python scripts\import_hao.py`。

## 排查

| 现象 | 处理 |
| --- | --- |
| 日志写「未找到可导入的壁纸」 | 会列出已查找的壁纸库与元数据目录；用 `HAO_WALLPAPER_DIR` / `HAO_WALLPAPER_DATA_DIR` 指到实际位置，或先在 Hao Wallpaper 下载一张 |
| 一直「新增 0 条」 | 已导入过；检查 `.imported.json`，或删掉对应键重试 |
| 启动后没有触发 | `dsh plugin ls` 确认插件在列表中，然后重启 DSH |
| 日志报「找不到导入脚本 …」 | 插件安装不完整（包内 `scripts/` 缺失）或 `DSH_HAO_IMPORT_SCRIPT` 失效；重装插件，或把该变量指向有效入口脚本 |
| 报「未找到 python3 / Python 3」 | 设置 `DSH_HAO_IMPORT_PYTHON`；Windows 安装 python.org 版本并勾选 Add to PATH |
| Windows 提示脚本被禁用 | 插件本身用 `-ExecutionPolicy Bypass` 启动；手动执行时也加该参数，或直接运行 `python scripts\import_hao.py` |
| 插件加载失败 | 确认 DSH 版本 ≥ `0.2.0-rc.1`（`package.json` 里的 `dsh.engines.dsh`） |

## 开发

```bash
node --check lib/index.js
npm test                        # node --test（自动发现 test/*.test.mjs）
python3 -m py_compile scripts/import_hao.py
bash -n scripts/run-import.sh install.sh
npm pack --dry-run              # 确认 scripts/（含 .ps1）进入 tarball
```

Windows 本地开发：

```powershell
node --check lib/index.js
npm test
python -m py_compile scripts\import_hao.py
powershell -NoProfile -Command "$e=$null; [void][System.Management.Automation.Language.Parser]::ParseFile('scripts\run-import.ps1',[ref]$null,[ref]$e); if($e){$e; exit 1}"
```

欢迎 Issue / PR：<https://github.com/AB-png123/dshplugin/issues>

## 隐私

插件只在本机读写文件，不发任何网络请求；不收集、不上传任何数据。

## License

[MIT](LICENSE) © 2026 AB-png123

---

### English

`dsh-hao-import` is a small open-source plugin for DeepSeek Harness on **macOS and Windows**. On every DSH startup it imports newly downloaded [Hao Wallpaper](https://www.haowallpaper.com/) wallpapers into the DSH wallpaper engine (`~/.dsh-wallpaper-engine/uploads/`), idempotently, without blocking startup and without any network access.

On Windows the plugin reads the absolute `localPath` values stored in Hao Wallpaper's `wallpaper-data.json`, so a non-default wallpaper library location still works. The entry point is PowerShell (`scripts/run-import.ps1`); no Git Bash or WSL is required. See the Chinese sections above for installation, configuration and troubleshooting.
