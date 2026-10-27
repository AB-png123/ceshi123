import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('../scripts/import_hao.py', import.meta.url))
const WORK = mkdtempSync(path.join(os.tmpdir(), 'dsh-hao-import-py-'))
const PYTHON =
  process.env.DSH_HAO_IMPORT_PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
const probe = spawnSync(PYTHON, ['--version'], { encoding: 'utf8' })
const HAS_PYTHON = probe.status === 0
const skip = HAS_PYTHON ? false : `Python not available (${PYTHON})`

function run(args, env) {
  return spawnSync(PYTHON, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
}

function baseDirs(prefix) {
  const home = mkdtempSync(path.join(WORK, prefix))
  const data = path.join(home, 'appdata', 'Hao Wallpaper')
  const lib = path.join(home, 'library')
  const engine = path.join(home, 'engine')
  mkdirSync(data, { recursive: true })
  mkdirSync(lib, { recursive: true })
  return { home, data, lib, engine }
}

function envFor(d) {
  return {
    HOME: d.home,
    USERPROFILE: d.home,
    APPDATA: path.join(d.home, 'appdata'),
    LOCALAPPDATA: path.join(d.home, 'LocalAppData'),
    HAO_WALLPAPER_DATA_DIR: d.data,
    HAO_WALLPAPER_DIR: d.lib,
    HAO_WALLPAPER_DIRS: '',
    DSH_WALLPAPER_ENGINE_DIR: d.engine,
    DSH_WE_DATA_DIR: '',
    DSH_WE_UPLOAD_DIR: '',
    DSH_HAO_IMPORT_SCRIPT: '',
  }
}

function writeMetadata(d, items) {
  const staticWallpapers = Object.fromEntries(items.map((item) => [item.id, item]))
  writeFileSync(
    path.join(d.data, 'wallpaper-data.json'),
    JSON.stringify({ staticWallpapers, dynamicWallpapers: {} }),
  )
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

test('imports the absolute localPath recorded in metadata (no default library needed)', { skip }, () => {
  const d = baseDirs('meta-')
  const itemDir = path.join(d.home, 'Downloads', 'hao-12345')
  mkdirSync(itemDir, { recursive: true })
  const file = path.join(itemDir, 'whatever.png')
  writeFileSync(file, 'png-bytes')
  writeMetadata(d, [{ id: '12345', title: '测试-壁纸-标题-多余', localPath: file }])

  const env = envFor(d)
  const dry = run(['--dry-run'], env)
  assert.equal(dry.status, 0, dry.stderr)
  assert.match(dry.stdout, /DRY-RUN 预计新增 1 条/)
  assert.match(dry.stdout, /测试-壁纸-标题/)
  assert.ok(!existsSync(path.join(d.engine, 'uploads')))
  assert.ok(!existsSync(path.join(d.engine, 'uploads', '.meta.json')))

  const real = run([], env)
  assert.equal(real.status, 0, real.stderr)
  assert.match(real.stdout, /新增 1 条/)

  const uploads = path.join(d.engine, 'uploads')
  assert.ok(existsSync(path.join(uploads, 'up-hao-01.png')))
  assert.equal(readJson(path.join(uploads, '.meta.json'))['up-hao-01'].title, '测试-壁纸-标题')
  assert.equal(readJson(path.join(uploads, '.imported.json')).ids['12345:image'], 'up-hao-01')

  const again = run([], env)
  assert.equal(again.status, 0, again.stderr)
  assert.match(again.stdout, /新增 0 条/)
})

test('metadata localPath wins over a same-id folder in the default library', { skip }, () => {
  const d = baseDirs('override-')
  const custom = path.join(d.home, 'Elsewhere', 'wallpaper-777')
  mkdirSync(custom, { recursive: true })
  writeFileSync(path.join(custom, 'wallpaper.png'), 'meta-image')
  writeMetadata(d, [{ id: '777', title: '元数据-标题-优先', localPath: path.join(custom, 'wallpaper.png') }])

  const fallback = path.join(d.lib, 'wallpaper-777')
  mkdirSync(fallback, { recursive: true })
  writeFileSync(path.join(fallback, 'wallpaper.png'), 'fallback-image')

  const dry = run(['--dry-run'], envFor(d))
  assert.equal(dry.status, 0, dry.stderr)
  assert.match(dry.stdout, /DRY-RUN 预计新增 1 条/)
  assert.match(dry.stdout, /元数据-标题-优先/)
  assert.doesNotMatch(dry.stdout, /fallback-image/)
})

test('falls back to scanning wallpaper-<id> folders and prefers video', { skip }, () => {
  const d = baseDirs('scan-')
  const folder = path.join(d.lib, 'wallpaper-999')
  mkdirSync(folder, { recursive: true })
  writeFileSync(path.join(folder, 'wallpaper.png'), 'still-bytes')
  writeFileSync(path.join(folder, 'wallpaper.mp4'), 'video-bytes')

  const real = run([], envFor(d))
  assert.equal(real.status, 0, real.stderr)
  assert.match(real.stdout, /新增 1 条/)

  const uploads = path.join(d.engine, 'uploads')
  assert.ok(existsSync(path.join(uploads, 'up-hao-01.mp4')))
  assert.equal(readJson(path.join(uploads, '.meta.json'))['up-hao-01'].title, 'Hao壁纸（动态）')
})

test('missing library exits 0 and prints the searched paths', { skip }, () => {
  const d = baseDirs('empty-')
  rmSync(d.lib, { recursive: true, force: true })

  const res = run([], envFor(d))
  assert.equal(res.status, 0, res.stderr)
  assert.match(res.stdout, /未找到可导入的壁纸/)
  assert.match(res.stdout, /已查找壁纸库/)
  assert.match(res.stdout, /HAO_WALLPAPER_DIR/)
})

test('honors uploadDir from the engine config.json', { skip }, () => {
  const d = baseDirs('cfgupload-')
  mkdirSync(d.engine, { recursive: true })
  const custom = path.join(d.home, 'custom-uploads')
  writeFileSync(path.join(d.engine, 'config.json'), JSON.stringify({ uploadDir: custom }))

  const itemDir = path.join(d.home, 'Downloads', 'hao-31')
  mkdirSync(itemDir, { recursive: true })
  const file = path.join(itemDir, 'whatever.jPg')
  writeFileSync(file, 'jpg-bytes')
  writeMetadata(d, [{ id: '31', title: '自定义上传目录', localPath: file }])

  const res = run([], envFor(d))
  assert.equal(res.status, 0, res.stderr)
  assert.equal(readJson(path.join(custom, '.meta.json'))['up-hao-01'].title, '自定义上传目录')
  assert.ok(existsSync(path.join(custom, 'up-hao-01.jpg')))
  assert.ok(!existsSync(path.join(d.engine, 'uploads')))
})

test('DSH_WE_UPLOAD_DIR beats config.json and uploads/', { skip }, () => {
  const d = baseDirs('envupload-')
  mkdirSync(d.engine, { recursive: true })
  const fromConfig = path.join(d.home, 'config-uploads')
  const fromEnv = path.join(d.home, 'env-uploads')
  writeFileSync(path.join(d.engine, 'config.json'), JSON.stringify({ uploadDir: fromConfig }))

  const itemDir = path.join(d.home, 'Downloads', 'hao-32')
  mkdirSync(itemDir, { recursive: true })
  writeFileSync(path.join(itemDir, 'wallpaper.png'), 'png')
  writeMetadata(d, [{ id: '32', title: '环境变量优先', localPath: path.join(itemDir, 'wallpaper.png') }])

  const env = { ...envFor(d), DSH_WE_UPLOAD_DIR: fromEnv }
  const res = run([], env)
  assert.equal(res.status, 0, res.stderr)
  assert.ok(existsSync(path.join(fromEnv, 'up-hao-01.png')))
  assert.ok(!existsSync(fromConfig))
})

test('DSH_WE_DATA_DIR is used when the legacy engine variable is unset', { skip }, () => {
  const d = baseDirs('wedata-')
  const itemDir = path.join(d.home, 'Downloads', 'hao-33')
  mkdirSync(itemDir, { recursive: true })
  writeFileSync(path.join(itemDir, 'wallpaper.png'), 'png')
  writeMetadata(d, [{ id: '33', title: 'WE 数据目录', localPath: path.join(itemDir, 'wallpaper.png') }])

  const env = { ...envFor(d), DSH_WALLPAPER_ENGINE_DIR: '', DSH_WE_DATA_DIR: d.engine }
  const res = run([], env)
  assert.equal(res.status, 0, res.stderr)
  assert.ok(existsSync(path.join(d.engine, 'uploads', 'up-hao-01.png')))
})

test('skips formats the wallpaper engine cannot display', { skip }, () => {
  const d = baseDirs('unsupported-')
  const itemDir = path.join(d.home, 'Downloads', 'hao-34')
  mkdirSync(itemDir, { recursive: true })
  const webm = path.join(itemDir, 'clip.webm')
  writeFileSync(webm, 'webm-bytes')
  writeMetadata(d, [{ id: '34', title: '不支持的格式', localPath: webm }])

  const res = run([], envFor(d))
  assert.equal(res.status, 0, res.stderr)
  assert.match(res.stderr, /不受 DSH 壁纸引擎支持/)
  assert.match(res.stdout, /未找到可导入的壁纸/)
  assert.ok(!existsSync(path.join(d.engine, 'uploads', '.meta.json')))
})

test('--report mirrors UTF-8 output for callers that cannot decode stdout', { skip }, () => {
  const d = baseDirs('report-')
  const itemDir = path.join(d.home, 'Downloads', 'hao-35')
  mkdirSync(itemDir, { recursive: true })
  const file = path.join(itemDir, 'wallpaper.png')
  writeFileSync(file, 'png-bytes')
  writeMetadata(d, [{ id: '35', title: '报告-中文-标题', localPath: file }])

  const report = path.join(d.home, 'report.txt')
  const res = run(['--report', report], envFor(d))
  assert.equal(res.status, 0, res.stderr)
  const text = readFileSync(report, 'utf8')
  assert.match(text, /新增 1 条/)
  assert.match(text, /报告-中文-标题/)
})

test.after(() => rmSync(WORK, { recursive: true, force: true }))
