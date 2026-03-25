$ErrorActionPreference = "Stop"

Write-Host "== Build =="
npm run build

Write-Host "== acpx cursor sessions new =="
acpx cursor sessions new

Write-Host "== acpx cursor prompt =="
acpx cursor "列出当前目录并简述用途"

Write-Host "== acpx cursor status =="
acpx cursor status

Write-Host "== acpx cursor exec =="
acpx cursor exec "one-shot: 用一句话说 hello"

Write-Host "验证完成"
