$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$release = Join-Path $root ".release\runtime"
$compilerPaths = @(
  "$env:LOCALAPPDATA\Programs\AutoHotkey\Compiler\Ahk2Exe.exe",
  "$env:ProgramFiles\AutoHotkey\Compiler\Ahk2Exe.exe"
)
$compiler = $compilerPaths | Where-Object { Test-Path $_ } | Select-Object -First 1
$source = Join-Path $root "ahk\relay.ahk"
$base = "$env:LOCALAPPDATA\Programs\AutoHotkey\v2\AutoHotkey64.exe"

if (-not $compiler) {
  throw "Ahk2Exe is missing. In AutoHotkey Dash, install Ahk2Exe, then run npm run build again."
}

if (-not (Test-Path $base)) {
  throw "AutoHotkey v2 is missing. Install it, then run npm run build again."
}

New-Item -ItemType Directory -Force -Path $release | Out-Null

Copy-Item (Join-Path $root "config.example.json") (Join-Path $release "config.json") -Force
Copy-Item (Join-Path $root "config.example.json") (Join-Path $release "config.example.json") -Force
Copy-Item (Join-Path $root "README.md") (Join-Path $release "README.md") -Force

$app = Join-Path $release "Relay Helper.exe"
$compileArgs = "/in `"$source`" /out `"$app`" /base `"$base`" /silent verbose"
$compile = Start-Process -FilePath $compiler -ArgumentList $compileArgs -PassThru -Wait
if ($compile.ExitCode -ne 0 -or -not (Test-Path $app)) {
  throw "Ahk2Exe could not build the Relay helper."
}
Write-Host "Runtime ready: $release"
