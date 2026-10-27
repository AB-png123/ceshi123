import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SH = fileURLToPath(new URL('../scripts/run-import.sh', import.meta.url))
const IS_WIN = process.platform === 'win32'
const PYTHON = process.env.DSH_HAO_IMPORT_PYTHON || 'python3'
const probe = spawnSync(PYTHON, ['--version'], { encoding: 'utf8' })
const skip = IS_WIN
  ? 'POSIX-only wrapper'
  : probe.status === 0
    ? false
    : `Python not available (${PYTHON})`
const WORK = mkdtempSync(path.join(os.tmpdir(), 'dsh-hao-import-sh-'))

function fixture(prefix) {
  const root = mkdtempSync(path.join(WORK, prefix))
  const data = path.join(root, 'data')
  const lib = path.join(root, 'lib')
  const engine = path.join(root, 'engine')
  mkdirSync(data, { recursive: true })
  mkdirSync(lib, { recursive: true })
  mkdirSync(engine, { recursive: true })
  writeFileSync(path.join(root, 'pic.png'), 'png-bytes')
  writeFileSync(
    path.join(data, 'wallpaper-data.json'),
    JSON.stringify({
      staticWallpapers: {
        a: { id: '1', title: 'Mac-测试-标题', localPath: path.join(root, 'pic.png') },
      },
      dynamicWallpapers: {},
    }),
  )
  return { root, data, lib, engine }
}

function envFor(d, extra = {}) {
  return {
    ...process.env,
    HOME: d.root,
    USERPROFILE: d.root,
    HAO_WALLPAPER_DATA_DIR: d.data,
    HAO_WALLPAPER_DIR: d.lib,
    DSH_WALLPAPER_ENGINE_DIR: d.engine,
    DSH_HAO_IMPORT_PYTHON: PYTHON,
    ...extra,
  }
}

function runWrapper(args, env) {
  return spawnSync('/bin/bash', [SH, ...args], { encoding: 'utf8', env })
}

test('writes a UTF-8 log and honors --dry-run', { skip }, () => {
  const d = fixture('dry-')
  const res = runWrapper(['--dry-run'], envFor(d))
  assert.equal(res.status, 0, res.stderr)

  const log = readFileSync(path.join(d.engine, 'import.log'), 'utf8')
  assert.match(log, /rc=0/)
  assert.match(log, /DRY-RUN 预计新增 1 条/)
  assert.match(log, /Mac-测试-标题/)
  assert.ok(!existsSync(path.join(d.engine, 'uploads')))
})

test('imports and releases the cross-process lock', { skip }, () => {
  const d = fixture('run-')
  const res = runWrapper(['--force'], envFor(d))
  assert.equal(res.status, 0, res.stderr)

  assert.ok(existsSync(path.join(d.engine, 'uploads', 'up-hao-01.png')))
  assert.ok(!existsSync(path.join(d.engine, 'uploads', '.import.lock')))
  assert.match(readFileSync(path.join(d.engine, 'import.log'), 'utf8'), /新增 1 条/)
})

test('rejects an unusable DSH_HAO_IMPORT_PYTHON loudly', { skip }, () => {
  const d = fixture('badpy-')
  const res = runWrapper(
    ['--dry-run'],
    envFor(d, { DSH_HAO_IMPORT_PYTHON: path.join(d.root, 'no-such-python3') }),
  )
  assert.equal(res.status, 127)
  const log = readFileSync(path.join(d.engine, 'import.log'), 'utf8')
  assert.match(log, /指定的 DSH_HAO_IMPORT_PYTHON 不可用或低于 3\.8/)
})

test.after(() => rmSync(WORK, { recursive: true, force: true }))
