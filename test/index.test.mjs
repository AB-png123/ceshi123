import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const LIB = fileURLToPath(new URL('../lib/index.js', import.meta.url))
const STUB = '#!/bin/bash\nset -eu\necho ran > "$HOME/hao-import-marker"\n'
const WORK = mkdtempSync(path.join(os.tmpdir(), 'dsh-hao-import-test-'))

function makePackage(withScript, withHelper) {
  const root = mkdtempSync(path.join(WORK, 'pkg-'))
  mkdirSync(path.join(root, 'lib'), { recursive: true })
  copyFileSync(LIB, path.join(root, 'lib', 'index.js'))
  if (withScript) {
    mkdirSync(path.join(root, 'scripts'), { recursive: true })
    const script = path.join(root, 'scripts', 'run-import.sh')
    writeFileSync(script, STUB)
    chmodSync(script, 0o755)
  }
  if (withHelper) writeFileSync(path.join(root, 'scripts', 'import_hao.py'), '# stub\n')
  return root
}

function fakeCtx(errors, warns = []) {
  return {
    logger: {
      info() {},
      warn: (m) => warns.push(m),
      error: (m) => errors.push(m),
    },
  }
}

async function load(root) {
  const entry = path.join(root, 'lib', 'index.js')
  return import(`${pathToFileURL(entry).href}?t=${Date.now()}`)
}

function waitFor(file, timeoutMs = 3000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (existsSync(file)) return true
    spawnSync('sleep', ['0.05'])
  }
  return false
}

test('bundled script runs when the package ships scripts/', async () => {
  const root = makePackage(true, true)
  const home = mkdtempSync(path.join(WORK, 'home-'))
  const marker = path.join(home, 'hao-import-marker')
  const old = { HOME: process.env.HOME, DSH_HAO_IMPORT_SCRIPT: process.env.DSH_HAO_IMPORT_SCRIPT }
  process.env.HOME = home
  delete process.env.DSH_HAO_IMPORT_SCRIPT
  try {
    const mod = await load(root)
    mod.apply(fakeCtx([]))
    assert.ok(waitFor(marker), 'bundled run-import.sh should have executed')
    assert.equal(readFileSync(marker, 'utf8').trim(), 'ran')
  } finally {
    if (old.HOME === undefined) delete process.env.HOME
    else process.env.HOME = old.HOME
    if (old.DSH_HAO_IMPORT_SCRIPT !== undefined) process.env.DSH_HAO_IMPORT_SCRIPT = old.DSH_HAO_IMPORT_SCRIPT
  }
})

test('missing script fails loudly instead of silently skipping', async () => {
  const root = makePackage(false, false)
  delete process.env.DSH_HAO_IMPORT_SCRIPT
  const errors = []
  const mod = await load(root)
  mod.apply(fakeCtx(errors))
  assert.equal(errors.length, 1)
  assert.match(errors[0], /找不到导入脚本/)
  assert.match(errors[0], /插件包内置/)
  assert.match(errors[0], /DSH_HAO_IMPORT_SCRIPT/)
})

test('missing import_hao.py is reported separately', async () => {
  const root = makePackage(true, false)
  delete process.env.DSH_HAO_IMPORT_SCRIPT
  const errors = []
  const mod = await load(root)
  mod.apply(fakeCtx(errors))
  assert.equal(errors.length, 1)
  assert.match(errors[0], /缺少 import_hao\.py/)
})

test('an explicit DSH_HAO_IMPORT_SCRIPT that no longer exists is an error, not a fallback', async () => {
  const root = makePackage(true, true)
  const missing = path.join(WORK, 'does-not-exist', 'run-import.sh')
  process.env.DSH_HAO_IMPORT_SCRIPT = missing
  try {
    const errors = []
    const mod = await load(root)
    mod.apply(fakeCtx(errors))
    assert.equal(errors.length, 1)
    assert.match(errors[0], /DSH_HAO_IMPORT_SCRIPT/)
  } finally {
    delete process.env.DSH_HAO_IMPORT_SCRIPT
  }
})

test.after(() => rmSync(WORK, { recursive: true, force: true }))
