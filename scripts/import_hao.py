#!/usr/bin/env python3
"""把 Hao Wallpaper 本地壁纸库增量导入 DSH 壁纸引擎的 uploads 目录。

工作方式（macOS / Windows）：
  · 优先读 Hao Wallpaper 元数据里的 localPath（绝对路径），按 id 找到壁纸文件；
    因此即使壁纸库不在默认位置，也能正确导入。
  · 再扫描壁纸库目录里的 wallpaper-<id>/ 作为兜底（可用 HAO_WALLPAPER_DIR 覆盖）。
  · 每个壁纸「动态优先」：目录里有 wallpaper.mp4/webm/mov 就导入视频，
    否则用 image-wallpaper.png / wallpaper.png 的静态图。
  · 已导入的条目按「壁纸 id + 类型」记录在 uploads/.imported.json，重复运行只增不减。
  · 标题取自 Hao Wallpaper 的 wallpaper-data.json / wallpaper-cache-index.json，
    截取前 3 段关键词；动态壁纸条目追加「（动态）」。

用法：
  python3 import_hao.py [--dry-run]

环境变量：
  HAO_WALLPAPER_DIR           壁纸库目录（单一路径）
  HAO_WALLPAPER_DIRS          多个壁纸库目录，用系统路径分隔符连接（: / ;）
  DSH_WALLPAPER_ENGINE_DIR    壁纸引擎数据目录（默认 ~/.dsh-wallpaper-engine）
  HAO_WALLPAPER_DATA_DIR      Hao Wallpaper 元数据目录（默认自动探测）
                              macOS: ~/Library/Application Support/Hao Wallpaper
                              Windows: %APPDATA%\\Hao Wallpaper 等
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile

# Windows 控制台/重定向默认用本地代码页，直接输出中文可能抛 UnicodeEncodeError。
# 统一成 UTF-8，保证 import.log 与 CI 输出可读。
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HOME = os.path.expanduser("~")
IS_WIN = os.name == "nt"


def env_path(name: str, default: str) -> str:
    value = os.environ.get(name)
    return os.path.expanduser(value) if value else default


def _dedupe(paths: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for p in paths:
        if not p:
            continue
        key = os.path.normcase(os.path.abspath(os.path.expanduser(p)))
        if key in seen:
            continue
        seen.add(key)
        out.append(os.path.expanduser(p))
    return out


def default_library_dirs() -> list[str]:
    if IS_WIN:
        return _dedupe(
            [
                os.path.join(HOME, "Desktop", "数据", "壁纸"),
                os.path.join(HOME, "Pictures", "Hao Wallpaper"),
                os.path.join(HOME, "Pictures", "哲风壁纸"),
            ]
        )
    if sys.platform == "darwin":
        return [os.path.join(HOME, "Desktop", "数据", "壁纸")]
    return [os.path.join(HOME, "Pictures", "Hao Wallpaper")]


def default_data_dirs() -> list[str]:
    """Hao Wallpaper 的 Electron userData 目录（跨平台自动探测）。"""
    if IS_WIN:
        appdata = os.environ.get("APPDATA") or os.path.join(HOME, "AppData", "Roaming")
        local = os.environ.get("LOCALAPPDATA") or os.path.join(HOME, "AppData", "Local")
        return _dedupe(
            [
                os.path.join(appdata, "Hao Wallpaper"),
                os.path.join(appdata, "haowallpaper"),
                os.path.join(appdata, "哲风壁纸"),
                os.path.join(local, "Hao Wallpaper"),
                os.path.join(local, "haowallpaper"),
            ]
        )
    if sys.platform == "darwin":
        return [os.path.join(HOME, "Library", "Application Support", "Hao Wallpaper")]
    return [os.path.join(HOME, ".config", "Hao Wallpaper")]


def library_dirs() -> list[str]:
    multi = os.environ.get("HAO_WALLPAPER_DIRS")
    if multi:
        return _dedupe([p for p in multi.split(os.pathsep) if p.strip()])
    single = os.environ.get("HAO_WALLPAPER_DIR")
    if single:
        return [os.path.expanduser(single)]
    return default_library_dirs()


def data_dirs() -> list[str]:
    single = os.environ.get("HAO_WALLPAPER_DATA_DIR")
    if single:
        return [os.path.expanduser(single)]
    return default_data_dirs()


ENGINE = env_path("DSH_WALLPAPER_ENGINE_DIR", os.path.join(HOME, ".dsh-wallpaper-engine"))
UP = os.path.join(ENGINE, "uploads")
META = os.path.join(UP, ".meta.json")
STATE = os.path.join(UP, ".imported.json")

VIDEO_NAMES = ("wallpaper.mp4", "wallpaper.webm", "wallpaper.mov")
STILLS = ("image-wallpaper.png", "wallpaper.png")
IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif")
VIDEO_EXTS = (".mp4", ".webm", ".mov")


def load_json(path: str, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def dump_json(path: str, data) -> None:
    """原子写入，避免中途退出把状态文件写坏。"""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".tmp-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
            f.write("\n")
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def collect_catalog() -> tuple[dict[str, str], dict[str, str]]:
    """返回 (id -> 标题, id -> localPath)。

    元数据里的 localPath 是绝对路径，这是 Windows 上最可靠的来源：
    不依赖壁纸库的默认目录，也不依赖目录命名。
    """
    titles: dict[str, str] = {}
    local_paths: dict[str, str] = {}

    for base in data_dirs():
        data = load_json(os.path.join(base, "wallpaper-data.json"), {})
        for key in ("staticWallpapers", "dynamicWallpapers"):
            for item in (data.get(key) or {}).values():
                if not isinstance(item, dict):
                    continue
                wid = str(item.get("id") or "")
                if not wid:
                    continue
                titles.setdefault(wid, item.get("title") or "")
                path = item.get("localPath")
                if isinstance(path, str) and path and os.path.isfile(path):
                    local_paths.setdefault(wid, path)

        index = load_json(os.path.join(base, "wallpaper-cache-index.json"), {})
        for task in index.get("tasks") or []:
            wallpaper = task.get("wallpaperData") or {}
            wid = str(wallpaper.get("id") or "")
            if wid and wid not in titles:
                titles[wid] = wallpaper.get("title") or task.get("title") or ""

    return titles, local_paths


def short_title(title: str, parts: int = 3) -> str:
    chunks = [p for p in (title or "").split("-") if p.strip()]
    return "-".join(chunks[:parts]) or "Hao壁纸"


def next_index(meta: dict, uploads: list[str]) -> int:
    """找到下一个可用的 up-hao-NN 序号（同时看 meta 和磁盘文件）。"""
    used = [key for key in meta if key.startswith("up-hao-")]
    for name in uploads:
        stem, _ = os.path.splitext(name)
        if stem.startswith("up-hao-"):
            used.append(stem)
    highest = 0
    for key in used:
        try:
            highest = max(highest, int(key.rsplit("-", 1)[1]))
        except (ValueError, IndexError):
            continue
    return highest + 1


def candidates(folder: str) -> list[tuple[str, str]]:
    """返回 [(源文件, 类型)]；动态壁纸只取真视频，静态取首帧图。"""
    for name in VIDEO_NAMES:
        video = os.path.join(folder, name)
        if os.path.isfile(video):
            return [(video, "video")]
    for name in STILLS:
        still = os.path.join(folder, name)
        if os.path.isfile(still):
            return [(still, "image")]
    return []


def candidates_for_path(path: str) -> list[tuple[str, str]]:
    """元数据 localPath 存在时，优先用它所在目录的标准布局，其次用文件本身。"""
    if not os.path.isfile(path):
        return []
    found = candidates(os.path.dirname(path))
    if found:
        return found
    ext = os.path.splitext(path)[1].lower()
    if ext in VIDEO_EXTS:
        return [(path, "video")]
    if ext in IMAGE_EXTS:
        return [(path, "image")]
    return []


def discover_sources(local_paths: dict[str, str]) -> dict[str, list[tuple[str, str]]]:
    sources: dict[str, list[tuple[str, str]]] = {}

    # 1) 元数据记录的真实路径优先级最高（Windows / 自定义目录都适用）。
    for wid, path in local_paths.items():
        found = candidates_for_path(path)
        if found:
            sources[wid] = found

    # 2) 兜底：扫描壁纸库目录（元数据缺失或 localPath 过期时仍可工作）。
    for root in library_dirs():
        if not os.path.isdir(root):
            continue
        try:
            names = sorted(os.listdir(root))
        except OSError as exc:
            print(f"  ! 无法读取壁纸库 {root}: {exc}", file=sys.stderr)
            continue
        for name in names:
            if not name.startswith("wallpaper-") or name in sources:
                continue
            folder = os.path.join(root, name)
            if not os.path.isdir(folder):
                continue
            wid = name[len("wallpaper-") :]
            if wid in sources:
                continue
            found = candidates(folder)
            if found:
                sources[wid] = found

    return sources


def print_search_paths() -> None:
    print("未找到可导入的壁纸。")
    print("已查找壁纸库：")
    for path in library_dirs():
        print(f"  - {path} ({'存在' if os.path.isdir(path) else '不存在'})")
    print("已查找 Hao Wallpaper 元数据：")
    for path in data_dirs():
        exists = os.path.isfile(os.path.join(path, "wallpaper-data.json"))
        print(f"  - {path} ({'存在' if exists else '不存在'})")
    print(
        "请先在 Hao Wallpaper 里下载一张壁纸；若装在非默认位置，"
        "用 HAO_WALLPAPER_DIR 或 HAO_WALLPAPER_DATA_DIR 指过去。"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="导入 Hao Wallpaper 壁纸到 DSH 壁纸引擎")
    parser.add_argument("--dry-run", action="store_true", help="只打印将要导入的条目，不写文件")
    args = parser.parse_args(argv)

    os.makedirs(UP, exist_ok=True)
    meta: dict = load_json(META, {})
    state: dict = load_json(STATE, {"ids": {}})
    seen: dict = state.setdefault("ids", {})
    titles, local_paths = collect_catalog()
    sources = discover_sources(local_paths)

    if not sources:
        print_search_paths()
        return 0

    index = next_index(meta, os.listdir(UP))

    added: list[tuple[str, float, str]] = []
    for widget_id in sorted(sources):
        for source, kind in sources[widget_id]:
            key = f"{widget_id}:{kind}"
            if key in seen:
                continue
            ext = os.path.splitext(source)[1].lower()
            if kind == "video" and ext not in VIDEO_EXTS:
                continue
            if kind == "image" and ext not in IMAGE_EXTS:
                continue
            out_id = f"up-hao-{index:02d}"
            dest = os.path.join(UP, out_id + ext)
            title = short_title(titles.get(widget_id, "")) + ("（动态）" if kind == "video" else "")
            try:
                size_mb = round(os.path.getsize(source) / 1048576, 1)
            except OSError:
                size_mb = 0.0
            if not args.dry_run:
                try:
                    shutil.copyfile(source, dest)
                except OSError as exc:
                    print(f"  ! 跳过 {source}: {exc}", file=sys.stderr)
                    continue
            meta[out_id] = {"title": title}
            seen[key] = out_id
            index += 1
            added.append((out_id + ext, size_mb, title))

    if not args.dry_run:
        dump_json(META, meta)
        dump_json(STATE, state)

    if args.dry_run:
        print(f"DRY-RUN 预计新增 {len(added)} 条，完成后共 {len(meta)} 条")
    else:
        print(f"新增 {len(added)} 条，uploads 现共 {len(meta)} 条")
    for name, size, title in added:
        print(f"  + {name} {size} MB {title}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
