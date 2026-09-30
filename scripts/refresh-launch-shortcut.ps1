# 刷新桌面快捷方式指向最新打包产物（G1 mock 验证用）
$ErrorActionPreference = 'Stop'
$ws = New-Object -ComObject WScript.Shell
$desktopPath = [Environment]::GetFolderPath('Desktop')
$lnkPath = Join-Path $desktopPath 'Pi Desktop.lnk'
$exePath = 'C:\Ai\pi-desktop\apps\desktop\dist\win-unpacked\Pi Desktop.exe'

if (-not (Test-Path -LiteralPath $exePath)) {
    Write-Host "ERROR: packaged exe not found: $exePath" -ForegroundColor Red
    exit 1
}

$sc = $ws.CreateShortcut($lnkPath)
$sc.TargetPath = $exePath
$sc.WorkingDirectory = 'C:\Ai\pi-desktop\apps\desktop\dist\win-unpacked'
$sc.IconLocation = "$exePath,0"
	$sc.Description = 'Pi Desktop'
$sc.Save()

Write-Host "Shortcut refreshed: $lnkPath"
Write-Host "Target: $exePath"

# 启动
Start-Process -FilePath $lnkPath
Write-Host "Launched via shortcut"
