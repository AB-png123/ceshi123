#!/usr/bin/env python3
"""把 Hao Wallpaper 本地壁纸库增量导入 DSH 壁纸引擎的 uploads 目录。

工作方式：
  · 扫描 ~/Desktop/数据/壁纸/wallpaper-<id>/（可用 HAO_WALLPAPER_DIR 覆盖）
  · 每个壁纸目录「动态优先」：有 wallpaper.mp4 就导入 mp4，
    否则用 image-wallpaper.png / wallpaper.png 的静态图
  · 已导入的条目按「壁纸 id + 类型」记录在 uploads/.imported.json，重复运行只增不减
  · 标题取自 Hao Wallpaper 的 wallpaper-data.json / wallpaper-cache-index.json，
    截取前 3 段关键词；动态壁纸条目追加「（动态）」

用法：
  python3 import_hao.py [--dry-run]

环境变量：
  HAO_WALLPAPER_DIR           壁纸库目录（默认 ~/Desktop/数据/壁纸）
  DSH_WALLPAPER_ENGINE_DIR    壁纸引擎数据目录（默认 ~/.dsh-wallpaper-engine）
  HAO_WALLPAPER_DATA_DIR      Hao Wallpaper 元数据目录
                              （默认 ~/Library/Application Support/Hao Wallpaper）
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile

HOME = os.path.expanduser("~")


def env_path(name: str, default: str) -> str:
    value = os.environ.get(name)
    return os.path.expanduser(value) if value else default


SRC = env_path("HAO_WALLPAPER_DIR", os.path.join(HOME, "Desktop", "数据", "壁纸"))
ENGINE = env_path("DSH_WALLPAPER_ENGINE_DIR", os.path.join(HOME, ".dsh-wallpaper-engine"))
UP = os.path.join(ENGINE, "uploads")
HAO_DATA = env_path(
    "HAO_WALLPAPER_DATA_DIR",
    os.path.join(HOME, "Library", "Application Support", "Hao Wallpaper"),
)
META = os.path.join(UP, ".meta.json")
STATE = os.path.join(UP, ".imported.json")

VIDEO = "wallpaper.mp4"
STILLS = ("image-wallpaper.png", "wallpaper.png")
IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp")
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


def load_titles() -> dict[str, str]:
    """从 Hao Wallpaper 的元数据里收集 id -> 标题。"""
    out: dict[str, str] = {}
    data = load_json(os.path.join(HAO_DATA, "wallpaper-data.json"), {})
    for key in ("staticWallpapers", "dynamicWallpapers"):
        for item in (data.get(key) or {}).values():
            if isinstance(item, dict) and item.get("id"):
                out[str(item["id"])] = item.get("title") or ""

    index = load_json(os.path.join(HAO_DATA, "wallpaper-cache-index.json"), {})
    for task in index.get("tasks") or []:
        wallpaper = task.get("wallpaperData") or {}
        wid = str(wallpaper.get("id") or "")
        if wid and wid not in out:
            out[wid] = wallpaper.get("title") or task.get("title") or ""
    return out


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
    """返回 [(源文件, 类型)]；动态壁纸只取真 mp4，静态取首帧图。"""
    video = os.path.join(folder, VIDEO)
    if os.path.isfile(video):
        return [(video, "video")]
    for name in STILLS:
        still = os.path.join(folder, name)
        if os.path.isfile(still):
            return [(still, "image")]
    return []


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="导入 Hao Wallpaper 壁纸到 DSH 壁纸引擎")
    parser.add_argument("--dry-run", action="store_true", help="只打印将要导入的条目，不写文件")
    args = parser.parse_args(argv)

    if not os.path.isdir(SRC):
        print(f"壁纸库不存在，跳过：{SRC}")
        return 0

    os.makedirs(UP, exist_ok=True)
    meta: dict = load_json(META, {})
    state: dict = load_json(STATE, {"ids": {}})
    seen: dict = state.setdefault("ids", {})
    titles = load_titles()
    index = next_index(meta, os.listdir(UP))

    added: list[tuple[str, float, str]] = []
    for name in sorted(os.listdir(SRC)):
        if not name.startswith("wallpaper-"):
            continue
        folder = os.path.join(SRC, name)
        if not os.path.isdir(folder):
            continue
        widget_id = name[len("wallpaper-"):]
        for source, kind in candidates(folder):
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
            size_mb = round(os.path.getsize(source) / 1048576, 1)
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
