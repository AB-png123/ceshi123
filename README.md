# dsh-hao-import

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Platform: macOS](https://img.shields.io/badge/platform-macOS-lightgrey.svg)
![DSH: >=0.2.0-rc.1](https://img.shields.io/badge/DSH-%3E%3D0.2.0--rc.1-4B32C3.svg)

> 一个开源的 [DeepSeek Harness](https://github.com/deepseek-ai) 插件：**每次启动 DSH 时，自动把 [Hao Wallpaper](https://www.haowallpaper.com/) 新下载的壁纸增量导入 DSH 壁纸引擎。**

Hao Wallpaper 的壁纸存在自己的目录里，而 DSH 壁纸引擎只认 `~/.dsh-wallpaper-engine/uploads/` 下的 `up-*` 文件。每次下载完都要手动拷贝、改名、写标题——本插件把这件事变成「打开 DSH 就自动完成」。

---

## 特性
-**注意使用该插件要先安装dsh-plugin-wallpaper-engine插件才可以配合使用，否则没使用，该插件主要作用是为了解决plugin-wallpaper-engine插件安装后wallpaper-engine引擎没有可用壁纸的解决方案。
- **启动即导入**：挂在 DSH 内核 `apply()` 上，每次启动后台执行一次，不阻塞启动。
- **增量 + 幂等**：按「壁纸 id + 类型」记录已导入条目，重复启动只会得到「新增 0 条」。
- **动态壁纸优先**：有 `wallpaper.mp4` 就导入真视频，避免把首帧图当成两条。
- **标题自动提取**：从 Hao Wallpaper 的元数据里取标题，截取前 3 段关键词；动态条目自动加「（动态）」。
- **失败可隔离**：脚本或 Python 出错只写日志，绝不影响 DSH 启动。
- **可配置 / 可禁用**：路径、解释器、开关都有环境变量。

## 工作原理

```
DSH 启动
  └─ 插件 apply()                       lib/index.js
       └─ spawn bash run-import.sh      scripts/run-import.sh（15 秒冷却）
            └─ python import_hao.py     scripts/import_hao.py
                 └─ 扫描壁纸库 → 复制到 ~/.dsh-wallpaper-engine/uploads/up-hao-NN.*
                                   → 更新 .imported.json / .meta.json
                                   → 追加日志 import.log
```

| 组件 | 作用 |
| --- | --- |
| `lib/index.js` | DSH 插件入口，启动时后台触发导入脚本 |
| `cordis.patch.yml` | bundle patch，让 `dsh plugin add` 把插件挂到宿主内核 |
| `scripts/run-import.sh` | 无界面入口：查找 Python、冷却、写日志 |
| `scripts/import_hao.py` | 真正的扫描 / 去重 / 复制 / 写标题逻辑 |
| `install.sh` | 把脚本安装到 `~/.dsh/wallpaper-import/`，可选装插件 |

## 环境要求

- **macOS**（脚本按 macOS 的目录约定与 `/bin/bash` 编写）
- **DeepSeek Harness** ≥ `0.2.0-rc.1`
- **Python 3.8+**（优先使用 DSH 自带运行时，找不到再退回系统 `python3`）
- **Hao Wallpaper**，并且至少下载过一张壁纸

## 安装

### 1. 获取源码

```bash
git clone https://github.com/AB-png123/ceshi123.git
cd ceshi123
```

### 2. 安装导入脚本

```bash
./install.sh
```

脚本会被复制到 `~/.dsh/wallpaper-import/`。也可以手动安装：

```bash
mkdir -p ~/.dsh/wallpaper-import
cp scripts/run-import.sh scripts/import_hao.py ~/.dsh/wallpaper-import/
chmod +x ~/.dsh/wallpaper-import/run-import.sh
```

### 3. 安装插件本体

任选一种：

```bash
# A. 直接从 GitHub 安装
dsh plugin --profile desktop add github:AB-png123/ceshi123

# B. 或者先打包，再安装本地 tgz
npm pack .
cd ~/.dsh/profiles/desktop
dsh plugin --profile desktop add /path/to/ceshi123/dsh-hao-import-1.1.0.tgz

# C. 或者让安装脚本代劳（上一步的 ./install.sh 加 --with-plugin）
```

### 4. 重启 DSH

重启 DeepSeek Harness 应用后生效。验证：

```bash
tail -n 10 ~/.dsh-wallpaper-engine/import.log
```

看到 `[时间] rc=0` 和「新增 N 条」就说明跑通了。

## 配置

所有配置都通过环境变量传入（GUI 应用不继承终端环境，必要时用 `launchctl setenv` 或在启动 DSH 的 shell 里导出）：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DSH_HAO_IMPORT_DISABLE` | 未设置 | 设为 `1` 关闭导入 |
| `DSH_HAO_IMPORT_SCRIPT` | `~/.dsh/wallpaper-import/run-import.sh` | 覆盖脚本路径 |
| `DSH_HAO_IMPORT_PYTHON` | 自动查找 | 指定 `python3` 解释器 |
| `HAO_WALLPAPER_DIR` | `~/Desktop/数据/壁纸` | Hao Wallpaper 壁纸库目录 |
| `DSH_WALLPAPER_ENGINE_DIR` | `~/.dsh-wallpaper-engine` | 壁纸引擎数据目录（日志也在这里） |
| `HAO_WALLPAPER_DATA_DIR` | `~/Library/Application Support/Hao Wallpaper` | Hao Wallpaper 元数据目录 |

## 手动运行与调试

```bash
# 立即跑一次（跳过 15 秒冷却）
~/.dsh/wallpaper-import/run-import.sh --force

# 只看会导入什么，不写任何文件
~/.dsh/wallpaper-import/run-import.sh --dry-run

# 直接调用 Python（同样支持 --dry-run）
~/.dsh/wallpaper-import/import_hao.py --dry-run
```

## 数据与状态文件

| 路径 | 内容 |
| --- | --- |
| `~/.dsh-wallpaper-engine/uploads/up-hao-NN.*` | 导入后的壁纸文件 |
| `~/.dsh-wallpaper-engine/uploads/.meta.json` | `up-hao-NN` → 标题 |
| `~/.dsh-wallpaper-engine/uploads/.imported.json` | 壁纸 id + 类型 → `up-hao-NN`，幂等去重依据 |
| `~/.dsh-wallpaper-engine/import.log` | 每次运行的输出与退出码 |
| `~/.dsh-wallpaper-engine/.last-run` | 上次运行时间戳（15 秒冷却） |

想重新导入某张壁纸：删掉 `.imported.json` 里对应键和 `uploads/` 里的文件，再运行一次即可。

## 卸载

```bash
dsh plugin --profile desktop remove dsh-hao-import
rm -rf ~/.dsh/wallpaper-import
# 可选：清掉已导入的壁纸与状态
# rm -rf ~/.dsh-wallpaper-engine
```

## 已知限制

- 只支持 macOS，Linux/Windows 需要自行改脚本路径。
- 依赖 Hao Wallpaper 的本地文件布局；Hao Wallpaper 改目录结构后需要同步调整脚本。
- 动态壁纸只导入 `wallpaper.mp4` 本体；Hao Wallpaper 未落地真视频时（只有低清预览）不会导入。
- 标题来自 Hao Wallpaper 元数据，元数据缺失时退回「Hao壁纸」。

## 排查

| 现象 | 处理 |
| --- | --- |
| 日志写「壁纸库不存在」 | 用 `HAO_WALLPAPER_DIR` 指向实际目录，或先在 Hao Wallpaper 下载一张 |
| 一直「新增 0 条」 | 已导入过；检查 `.imported.json`，或删掉对应键重试 |
| 启动后没有触发 | `dsh plugin ls` 确认插件在列表中，然后重启 DSH |
| 报「未找到 python3」 | 设置 `DSH_HAO_IMPORT_PYTHON=/usr/bin/python3` |
| 插件加载失败 | 确认 DSH 版本 ≥ `0.2.0-rc.1`（`package.json` 里的 `dsh.engines.dsh`） |

## 开发

```bash
node --check lib/index.js
python3 -m py_compile scripts/import_hao.py
bash -n scripts/run-import.sh install.sh
```

欢迎 Issue / PR：<https://github.com/AB-png123/ceshi123/issues>

## 隐私

插件只在本机读写文件，不发任何网络请求；不收集、不上传任何数据。

## License

[MIT](LICENSE) © 2026 AB-png123

---

### English

`dsh-hao-import` is a small open-source plugin for DeepSeek Harness on macOS. On every DSH startup it imports newly downloaded [Hao Wallpaper](https://www.haowallpaper.com/) wallpapers into the DSH wallpaper engine (`~/.dsh-wallpaper-engine/uploads/`), idempotently, without blocking startup and without any network access. See the Chinese sections above for installation, configuration and troubleshooting; the commands and environment variables apply as written.
