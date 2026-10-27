#!/usr/bin/env pwsh
# dsh-hao-import 的 Windows 入口：由 DSH 启动钩子（或手动 / 计划任务）调用。
#
# 用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\run-import.ps1
#   .\run-import.ps1 -Force        # 立即跑一次，跳过 15 秒冷却
#   .\run-import.ps1 -DryRun       # 只预演，不写任何文件
#   （同时兼容 --force / --dry-run，以及从插件里无参调用）
#
# 幂等两层：
#   1. 15 秒冷却，避免同一次启动里被重复触发（-Force 可跳过）；
#   2. import_hao.py 用 uploads/.imported.json 按「壁纸 id + 类型」去重。
#
# 环境变量：
#   DSH_HAO_IMPORT_PYTHON       指定 python.exe（需 3.8+）
#   DSH_WALLPAPER_ENGINE_DIR    壁纸引擎数据目录（本插件的旧变量，优先）
#   DSH_WE_DATA_DIR             壁纸引擎自己的数据目录变量（日志也写在这里）
#
# 退出码：0 成功（包括「没有新壁纸」）；非 0 表示导入失败，详情见 import.log。
# 注意：插件以 stdio=ignore 后台启动本脚本，所以任何早期错误（缺脚本、缺 Python）
# 都必须自己写进 import.log，否则用户只能看到一句「退出码 127」。
$ErrorActionPreference = 'Continue'
if ($env:DSH_HAO_IMPORT_DEBUG -eq '1') {
  [Console]::Error.WriteLine("debug: ps=$($PSVersionTable.PSVersion) pythonLocation=$env:pythonLocation")
}

$SELF_DIR = $PSScriptRoot
if (-not $SELF_DIR) { $SELF_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path }
$SCRIPT = Join-Path $SELF_DIR 'import_hao.py'

function Get-UserHome {
  if ($env:USERPROFILE) { return $env:USERPROFILE }
  if ($env:HOME) { return $env:HOME }
  $p = [Environment]::GetFolderPath('UserProfile')
  if ($p) { return $p }
  return $null
}

$HomeDir = Get-UserHome

# 数据目录与壁纸引擎一致：本插件旧变量 → DSH_WE_DATA_DIR → ~/.dsh-wallpaper-engine
if ($env:DSH_WALLPAPER_ENGINE_DIR) {
  $Engine = $env:DSH_WALLPAPER_ENGINE_DIR
} elseif ($env:DSH_WE_DATA_DIR -and $env:DSH_WE_DATA_DIR.Trim()) {
  $Engine = $env:DSH_WE_DATA_DIR.Trim()
} elseif ($HomeDir) {
  $Engine = Join-Path $HomeDir '.dsh-wallpaper-engine'
} else {
  $Engine = Join-Path ([System.IO.Path]::GetTempPath()) 'dsh-wallpaper-engine'
}
$Log = Join-Path $Engine 'import.log'
$Cool = Join-Path $Engine '.last-run'

function Get-Stamp {
  return [DateTime]::Now.ToString(
    'yyyy-MM-dd HH:mm:ss',
    [System.Globalization.CultureInfo]::InvariantCulture)
}

function Write-Log([string]$Text) {
  try {
    if (-not (Test-Path -LiteralPath $Engine)) {
      New-Item -ItemType Directory -Force -Path $Engine | Out-Null
    }
    [System.IO.File]::AppendAllText(
      $Log, $Text, (New-Object System.Text.UTF8Encoding $false))
  } catch {
    Write-Warning "dsh-hao-import: 写日志失败 $Log : $_"
  }
}

function Fail([int]$Code, [string]$Message) {
  Write-Error $Message
  Write-Log "`n[$(Get-Stamp)] rc=$Code`n$Message`n"
  exit $Code
}

# 目录建不出来时连日志都写不了，直接大声失败。
try {
  if (-not (Test-Path -LiteralPath $Engine)) {
    New-Item -ItemType Directory -Force -Path $Engine | Out-Null
  }
} catch {
  Write-Error "dsh-hao-import: 无法创建数据目录 $Engine : $_"
  exit 1
}

if (-not (Test-Path -LiteralPath $SCRIPT)) {
  Fail 127 "dsh-hao-import: 缺少 ${SCRIPT}（插件包不完整，请重装）"
}

$Force = $false
$Dry = $false
$Extra = @()
foreach ($a in $args) {
  $s = [string]$a
  if ($s -eq '-Force' -or $s -eq '--force' -or $s -eq '/force') {
    $Force = $true
  } elseif ($s -eq '-DryRun' -or $s -eq '--dry-run' -or $s -eq '/dry-run' -or $s -eq '/dryrun') {
    $Dry = $true
  } else {
    $Extra += $a
  }
}

# 冷却只读检查放在找 Python 之前（省一次进程探测），但冷却文件要等
# Python 确认存在后才写 —— 否则「缺 Python」会在 15 秒内被静默吞掉。
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

function Test-Python([string]$Exe, [string[]]$Prefix = @()) {
  try {
    # PowerShell 5.1 里未绑定的 [string[]] 是 $null，直接 @Prefix 会抛
    # "Cannot index into a null array"；先归一成数组再 splat。
    # 代码里不能出现双引号：PS 5.1 不会转义内嵌的 "，会把它拆坏导致 Python SyntaxError。
    $cmdArgs = @()
    if ($Prefix) { $cmdArgs += $Prefix }
    $cmdArgs += @('-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)')
    $null = & $Exe @cmdArgs 2>$null
    $code = $LASTEXITCODE
    if ($env:DSH_HAO_IMPORT_DEBUG -eq '1') {
      [Console]::Error.WriteLine("debug: test $Exe => rc=$code")
    }
    return ($code -eq 0)
  } catch {
    if ($env:DSH_HAO_IMPORT_DEBUG -eq '1') {
      [Console]::Error.WriteLine("debug: test $Exe threw: $_")
    }
    return $false
  }
}

function Get-CommandPath($command) {
  if ($null -eq $command) { return $null }
  # Windows PowerShell 5.1 上部分 ApplicationInfo 的 .Source 为空，.Path 才可靠。
  if ($command.Path) { return [string]$command.Path }
  if ($command.Source) { return [string]$command.Source }
  return $null
}

function Find-Python {
  $explicit = $env:DSH_HAO_IMPORT_PYTHON
  if ($explicit) {
    if ((Test-Path -LiteralPath $explicit) -and (Test-Python $explicit @())) {
      return [pscustomobject]@{ Exe = $explicit; Prefix = @() }
    }
    Write-Warning "dsh-hao-import: DSH_HAO_IMPORT_PYTHON=$explicit 不可用或低于 Python 3.8，继续自动探测"
  }

  # 先收集明确路径，再退回 PATH，最后才试 py 启动器。
  # setup-python 的解释器在 $env:pythonLocation；DSH 桌面版自带一份运行时。
  $candidates = @()
  if ($env:pythonLocation) {
    $candidates += (Join-Path $env:pythonLocation 'python.exe')
  }
  if ($HomeDir) {
    $runtime = Join-Path $HomeDir '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python'
    $candidates += @(
      (Join-Path $runtime 'python.exe'),
      (Join-Path $runtime 'Scripts\python.exe'),
      (Join-Path $runtime 'bin\python3.exe')
    )
  }
  foreach ($base in @("$env:LOCALAPPDATA\Programs\Python", "$env:ProgramFiles\Python", 'C:\Python')) {
    if (-not $base -or -not (Test-Path -LiteralPath $base)) { continue }
    $found = @(Get-ChildItem -Path (Join-Path $base 'Python3*\python.exe') -ErrorAction SilentlyContinue)
    foreach ($f in $found) { $candidates += $f.FullName }
  }
  foreach ($name in @('python', 'python3')) {
    $p = Get-CommandPath (Get-Command $name -ErrorAction SilentlyContinue)
    if ($p) { $candidates += $p }
  }
  foreach ($c in $candidates) {
    if ($env:DSH_HAO_IMPORT_DEBUG -eq '1') {
      [Console]::Error.WriteLine("debug: candidate '$c' exists=$(Test-Path -LiteralPath $c)")
    }
    if ($c -and (Test-Path -LiteralPath $c) -and (Test-Python $c @())) {
      return [pscustomobject]@{ Exe = $c; Prefix = @() }
    }
  }

  # py 启动器要 -3 才会选 Python 3。
  $py = Get-CommandPath (Get-Command py -ErrorAction SilentlyContinue)
  if ($py -and (Test-Python $py @('-3'))) {
    return [pscustomobject]@{ Exe = $py; Prefix = @('-3') }
  }
  return $null
}

$py = Find-Python
if ($null -eq $py) {
  Fail 127 'dsh-hao-import: 未找到 Python 3.8+（可用 DSH_HAO_IMPORT_PYTHON 指定 python.exe）'
}

if (-not $Dry) {
  try {
    [System.IO.File]::WriteAllText($Cool, [string][DateTimeOffset]::UtcNow.ToUnixTimeSeconds())
  } catch {
    Write-Warning "dsh-hao-import: 写冷却文件失败 $Cool : $_"
  }
}

# Python 统一输出 UTF-8；PowerShell 5.1 默认按 OEM 代码页解码原生命令输出，
# 不切换的话中文标题在 import.log 里会变成乱码。
try {
  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
} catch {
  # 无控制台（后台/隐藏窗口）时设置会失败，忽略即可。
}

$all = @()
if ($py.Prefix -and $py.Prefix.Count -gt 0) { $all += $py.Prefix }
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

$ts = Get-Stamp
Write-Log "`n[$ts] rc=$rc`n$out`n"

if ($rc -ne 0) {
  $tail = (($out -split "`r?`n") | Select-Object -Last 5) -join "`n"
  Write-Output "导入失败（${rc}）："
  Write-Output $tail
  exit 1
}

Write-Output $out
exit 0
