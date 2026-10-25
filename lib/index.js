/**
 * dsh-hao-import —— DSH 启动时自动导入 Hao Wallpaper 的新壁纸。
 *
 * 默认执行插件包内的 scripts/run-import.sh，所以通过
 * `dsh plugin add github:...` / tgz / npm 装好后即可工作，不需要先手动
 * 往 ~/.dsh/wallpaper-import/ 放脚本。DSH_HAO_IMPORT_SCRIPT 可显式覆盖
 * 路径（例如你想用 ~/.dsh/wallpaper-import/ 里的自定义副本）。
 *
 * 幂等由脚本的 15 秒冷却和 import_hao.py 的 .imported.json 去重共同保证。
 *
 * 设计要点：
 *  · 默认用包内脚本，保证「装完即用」；
 *  · 脚本或配套 import_hao.py 缺失时用 logger.error 明确报错，不再静默跳过；
 *  · 全程 try/catch，任何失败都只是少导入一次，绝不能拖垮 DSH 启动；
 *  · spawn 用 detached + unref，不阻塞内核初始化、不占用 stdout；
 *  · HOME 一律 os.homedir() 兜底并显式传给子进程（宿主 env 里的 HOME 不保证存在）；
 *  · 临时关闭：环境变量 DSH_HAO_IMPORT_DISABLE=1。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-hao-import'

/** 不依赖任何其他服务，纯独立启动钩子。 */
export const inject = []

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BUNDLED_SCRIPT = path.resolve(HERE, '..', 'scripts', 'run-import.sh')

function reportError(ctx, message) {
  try {
    ctx?.logger?.error?.(`hao-import: ${message}`)
  } catch {
    /* 连日志都不可用就静默，绝不影响启动 */
  }
}

export function apply(ctx) {
  try {
    if (process.env.DSH_HAO_IMPORT_DISABLE === '1') {
      ctx?.logger?.info?.('hao-import: 已被 DSH_HAO_IMPORT_DISABLE 禁用')
      return
    }
    const home = process.env.HOME || os.homedir()
    const override = process.env.DSH_HAO_IMPORT_SCRIPT
    const script = override || BUNDLED_SCRIPT
    const origin = override ? 'DSH_HAO_IMPORT_SCRIPT' : '插件包内置'

    if (!existsSync(script)) {
      reportError(
        ctx,
        `找不到导入脚本 ${script}（来源：${origin}），本次未运行。插件安装不完整，或环境变量指向了不存在的文件；` +
          '请重装插件（dsh plugin --profile desktop add github:AB-png123/dshplugin），' +
          '或把 DSH_HAO_IMPORT_SCRIPT 指向有效的 run-import.sh。',
      )
      return
    }

    const helper = path.join(path.dirname(script), 'import_hao.py')
    if (!existsSync(helper)) {
      reportError(
        ctx,
        `找到 ${script}，但同目录缺少 import_hao.py（来源：${origin}），本次未运行。` +
          'run-import.sh 需要与 import_hao.py 放在一起；插件安装不完整，请重装。',
      )
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
    child.on('exit', (code, signal) => {
      if (code !== 0) {
        const engine = process.env.DSH_WALLPAPER_ENGINE_DIR || path.join(home, '.dsh-wallpaper-engine')
        ctx?.logger?.warn?.(
          `hao-import: 导入脚本退出码 ${code}${signal ? `（信号 ${signal}）` : ''}，详见 ${path.join(engine, 'import.log')}`,
        )
      }
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
