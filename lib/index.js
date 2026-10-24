/**
 * dsh-hao-import —— DSH 启动时自动导入 Hao Wallpaper 的新壁纸。
 *
 * 宿主内核 apply() 时触发一次，实际逻辑在
 *   <HOME>/.dsh/wallpaper-import/run-import.sh
 * （可用 DSH_HAO_IMPORT_SCRIPT 覆盖路径；幂等由脚本的 15 秒冷却和
 * import_hao.py 的 .imported.json 去重共同保证）。
 *
 * 设计要点：
 *  · 全程 try/catch，任何失败都只是少导入一次，绝不能拖垮 DSH 启动；
 *  · spawn 用 detached + unref，不阻塞内核初始化、不占用 stdout；
 *  · HOME 一律 os.homedir() 兜底并显式传给子进程（宿主 env 里的 HOME 不保证存在）；
 *  · 脚本不存在时直接跳过，避免每次启动都刷 spawn 错误；
 *  · 临时关闭：环境变量 DSH_HAO_IMPORT_DISABLE=1。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const name = 'dsh-hao-import'

/** 不依赖任何其他服务，纯独立启动钩子。 */
export const inject = []

export function apply(ctx) {
  try {
    if (process.env.DSH_HAO_IMPORT_DISABLE === '1') {
      ctx?.logger?.info?.('hao-import: 已被 DSH_HAO_IMPORT_DISABLE 禁用')
      return
    }
    const home = process.env.HOME || os.homedir()
    const script =
      process.env.DSH_HAO_IMPORT_SCRIPT || path.join(home, '.dsh', 'wallpaper-import', 'run-import.sh')
    if (!existsSync(script)) {
      ctx?.logger?.warn?.(`hao-import: 未找到 ${script}，跳过（见 README 的安装步骤）`)
      return
    }
    const child = spawn('/bin/bash', [script], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, HOME: home },
    })
    child.on('error', (err) => {
      ctx?.logger?.warn?.(`hao-import: 启动导入失败 ${err?.message ?? err}`)
    })
    child.unref()
    ctx?.logger?.info?.('hao-import: 已在后台触发壁纸导入')
  } catch (err) {
    try {
      ctx?.logger?.warn?.(`hao-import: 初始化异常 ${err?.message ?? err}`)
    } catch {
      /* 连日志都不可用就静默，绝不影响启动 */
    }
  }
}

export default { name, inject, apply }
