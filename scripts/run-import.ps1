#!/usr/bin/env pwsh
# dsh-hao-import 的 Windows 入口：由 DSH 启动钩子（或手动 / 计划任务）调用。
#
# 幂等两层：
#   1. 15 秒冷却，避免同一次启动里被重复触发（--force 可跳过）；
#   2. import_hao.py 用 uploads/.imported.json 按「壁纸 id + 类型」去重。
#
# 环境变量：
#   DSH_HAO_IMPORT_PYTHON       指定 python.exe
#   DSH_WALLPAPER_ENGINE_DIR    壁纸引擎数据目录（日志也写在这里）
#
# 退出码：0 成功（包括「没有新壁纸」）；非 0 表示导入失败，详情见 import.log。
$ErrorActionPreference = 'Continue'

$SELF_DIR = $PSScriptRoot
if (-not $SELF_DIR) { $SELF_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path }
$SCRIPT = Join-Path $SELF_DIR 'import_hao.py'

$Engine = if ($env:DSH_WALLPAPER_ENGINE_DIR) {
  $env:DSH_WALLPAPER_ENGINE_DIR
} else {
  Join-Path $env:USERPROFILE '.dsh-wallpaper-engine'
}
$Log = Join-Path $Engine 'import.log'
$Cool = Join-Path $Engine '.last-run'

$Force = $false
$Dry = $false
$Extra = @()
foreach ($a in $args) {
  switch ($a) {
    '--force' { $Force = $true }
    '--dry-run' { $Dry = $true }
    default { $Extra += $a }
  }
}

function Test-Python([string]$exe, [string[]]$prefix) {
  try {
    $v = & $exe @prefix '-c' 'import sys; print(sys.version_info[0])' 2>$null
    return ($LASTEXITCODE -eq 0 -and "$v".Trim() -eq '3')
  } catch {
    return $false
  }
}

function Find-Python {
  if ($env:DSH_HAO_IMPORT_PYTHON -and (Test-Path -LiteralPath $env:DSH_HAO_IMPORT_PYTHON)) {
    if (Test-Python $env:DSH_HAO_IMPORT_PYTHON @()) {
      return [pscustomobject]@{ Exe = $env:DSH_HAO_IMPORT_PYTHON; Prefix = @() }
    }
  }

  $runtime = Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python'
  $candidates = @(
    (Join-Path $runtime 'python.exe'),
    (Join-Path $runtime 'Scripts\python.exe'),
    (Join-Path $runtime 'bin\python3.exe')
  )
  foreach ($c in $candidates) {
    if ($c -and (Test-Path -LiteralPath $c) -and (Test-Python $c @())) {
      return [pscustomobject]@{ Exe = $c; Prefix = @() }
    }
  }

  $py = Get-Command py -ErrorAction SilentlyContinue
  if ($py -and (Test-Python $py.Source @('-3'))) {
    return [pscustomobject]@{ Exe = $py.Source; Prefix = @('-3') }
  }
  $python = Get-Command python -ErrorAction SilentlyContinue
  if ($python -and (Test-Python $python.Source @())) {
    return [pscustomobject]@{ Exe = $python.Source; Prefix = @() }
  }
  return $null
}

if (-not (Test-Path -LiteralPath $SCRIPT)) {
  Write-Error "dsh-hao-import: 缺少 $SCRIPT"
  exit 127
}

if (-not $Force -and -not $Dry -and (Test-Path -LiteralPath $Cool)) {
  $last = 0
  try {
    $raw = (Get-Content -LiteralPath $Cool -Raw).Trim()
    if ($raw) { $last = [int64]$raw }
  } catch {
    $last = 0
  }
  $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  if (($now - $last) -lt 15) { exit 0 }
}

New-Item -ItemType Directory -Force -Path $Engine | Out-Null
if (-not $Dry) {
  [System.IO.File]::WriteAllText($Cool, [string][DateTimeOffset]::UtcNow.ToUnixTimeSeconds())
}

$py = Find-Python
if ($null -eq $py) {
  Write-Error 'dsh-hao-import: 未找到 Python 3（可用 DSH_HAO_IMPORT_PYTHON 指定 python.exe）'
  exit 127
}

$all = @()
if ($py.Prefix) { $all += $py.Prefix }
$all += $SCRIPT
if ($Extra.Count -gt 0) { $all += $Extra }
if ($Dry) { $all += '--dry-run' }

$out = ''
$rc = 1
try {
  $out = (& $py.Exe @all 2>&1 | Out-String)
  $rc = $LASTEXITCODE
} catch {
  $out = "$_"
  $rc = 1
}

$ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
$logText = "`n[$ts] rc=$rc`n$out`n"
try {
  [System.IO.File]::AppendAllText($Log, $logText, [System.Text.UTF8Encoding]::new($false))
} catch {
  Write-Warning "dsh-hao-import: 写日志失败 $Log : $_"
}

if ($rc -ne 0) {
  $tail = (($out -split "`r?`n") | Select-Object -Last 5) -join "`n"
  Write-Output "导入失败（$rc）："
  Write-Output $tail
  exit 1
}

Write-Output $out
exit 0
