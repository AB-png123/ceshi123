/**
 * dsh-hao-import —— DSH 启动时自动导入 Hao Wallpaper 的新壁纸。
 *
 * 默认执行插件包内的入口脚本，所以通过 `dsh plugin add github:...` /
 * tgz / npm 装好后即可工作，不需要先手动放置脚本：
 *   · macOS / Linux → scripts/run-import.sh（bash）
 *   · Windows       → scripts/run-import.ps1（PowerShell）
 * DSH_HAO_IMPORT_SCRIPT 可显式覆盖路径（例如自定义副本）。
 *
 * 幂等由入口脚本的 15 秒冷却和 import_hao.py 的 .imported.json 去重共同保证。
 *
 * 设计要点：
 *  · 默认用包内脚本，保证「装完即用」，并按平台选择 .sh / .ps1；
 *  · 脚本或配套 import_hao.py 缺失时用 logger.error 明确报错，不再静默跳过；
 *  · 全程 try/catch，任何失败都只是少导入一次，绝不能拖垮 DSH 启动；
 *  · spawn 用 detached + unref，不阻塞内核初始化、不占用 stdout；
 *  · HOME / USERPROFILE 一律用 os.homedir() 兜底并显式传给子进程；
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
const SCRIPTS = path.resolve(HERE, '..', 'scripts')

/**
 * 选择平台对应的入口脚本与启动方式。纯函数，方便在任意平台做单元测试。
 *
 * @param {object} [opts]
 * @param {string} [opts.platform] Node 的 process.platform 值
 * @param {Record<string,string|undefined>} [opts.env]
 * @returns {{script:string, command:string, args:string[], helper:string, origin:string, platform:string, defaultName:string}}
 */
export function resolveLaunch({ platform = process.platform, env = process.env } = {}) {
  const isWin = platform === 'win32'
  const defaultName = isWin ? 'run-import.ps1' : 'run-import.sh'
  const bundled = path.join(SCRIPTS, defaultName)
  const override = env?.DSH_HAO_IMPORT_SCRIPT
  const script = override || bundled
  const ext = path.extname(script).toLowerCase()

  let command
  let args
  if (ext === '.ps1') {
    command = 'powershell.exe'
    args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script]
  } else if (ext === '.cmd' || ext === '.bat') {
    command = 'cmd.exe'
    args = ['/d', '/s', '/c', script]
  } else if (isWin) {
    // Windows 上的 .sh 覆盖需要 Git Bash / WSL 提供的 bash.exe。
    command = 'bash.exe'
    args = [script]
  } else {
    command = '/bin/bash'
    args = [script]
  }

  return {
    script,
    command,
    args,
    helper: path.join(path.dirname(script), 'import_hao.py'),
    origin: override ? 'DSH_HAO_IMPORT_SCRIPT' : '插件包内置',
    platform: isWin ? 'win32' : 'posix',
    defaultName,
  }
}

function reportError(ctx, message) {
  try {
    ctx?.logger?.error?.(`hao-import: ${message}`)
  } catch {
    /* 连日志都不可用就静默，绝不影响启动 */
  }
}

/**
 * 可注入平台与环境的 apply 实现（测试用）。
 *
 * @param {string} platform
 * @param {Record<string,string|undefined>} env
 * @param {any} ctx
 */
export function applyFor(platform, env, ctx) {
  try {
    if (env?.DSH_HAO_IMPORT_DISABLE === '1') {
      ctx?.logger?.info?.('hao-import: 已被 DSH_HAO_IMPORT_DISABLE 禁用')
      return
    }

    const home = env?.HOME || env?.USERPROFILE || os.homedir()
    const launch = resolveLaunch({ platform, env })

    if (!existsSync(launch.script)) {
      reportError(
        ctx,
        `找不到导入脚本 ${launch.script}（来源：${launch.origin}，平台：${launch.platform}），本次未运行。` +
          `当前平台需要 ${launch.defaultName}；请重装插件` +
          '（dsh plugin --profile desktop add github:AB-png123/dshplugin），' +
          '或把 DSH_HAO_IMPORT_SCRIPT 指向有效脚本。',
      )
      return
    }

    if (!existsSync(launch.helper)) {
      reportError(
        ctx,
        `找到 ${launch.script}，但同目录缺少 import_hao.py（来源：${launch.origin}），本次未运行。` +
          `${launch.defaultName} 需要与 import_hao.py 放在一起；插件安装不完整，请重装。`,
      )
      return
    }

    const childEnv = { ...env, HOME: home }
    if (platform === 'win32') childEnv.USERPROFILE = childEnv.USERPROFILE || home

    const child = spawn(launch.command, launch.args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: childEnv,
    })
    child.on('error', (err) => {
      ctx?.logger?.warn?.(`hao-import: 启动导入失败 ${err?.message ?? err}`)
    })
    child.on('exit', (code, signal) => {
      if (code !== 0) {
        const engine = env?.DSH_WALLPAPER_ENGINE_DIR || path.join(home, '.dsh-wallpaper-engine')
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

export function apply(ctx) {
  return applyFor(process.platform, process.env, ctx)
}

export default { name, inject, apply, applyFor, resolveLaunch }
