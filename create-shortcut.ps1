# Pi Agent 桌面快捷方式创建脚本
# 运行此脚本在桌面创建 Pi Agent 快捷方式

$desktopPath = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktopPath "Pi Agent.lnk"

# Derive paths from the script's own location — works from any checkout path.
$projectRoot = $PSScriptRoot
$launcherPath = Join-Path $PSScriptRoot "launch.bat"
$iconPath = Join-Path $PSScriptRoot "apps\desktop\build\icon.ico"

# 如果图标不存在，使用默认图标
if (-not (Test-Path $iconPath)) {
    $iconPath = "shell32.dll,13"
}

# 创建 WScript.Shell 对象
$WshShell = New-Object -ComObject WScript.Shell

# 删除旧快捷方式（如果存在）
$oldPaths = @("Pi Desktop.lnk", "Pi Agent.lnk") | ForEach-Object { Join-Path $desktopPath $_ }
foreach ($p in $oldPaths) {
    if ((Test-Path $p) -and ($p -ne $shortcutPath)) {
        Remove-Item $p -Force
        Write-Host "已删除旧快捷方式: $p" -ForegroundColor Yellow
    }
}

# 创建快捷方式
$shortcut = $WshShell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $launcherPath
$shortcut.WorkingDirectory = $projectRoot
$shortcut.Description = "Pi Agent - 每次启动自动构建最新代码"
$shortcut.IconLocation = $iconPath
$shortcut.WindowStyle = 1  # 正常窗口

# 保存快捷方式
$shortcut.Save()

Write-Host "桌面快捷方式已创建: $shortcutPath" -ForegroundColor Green
Write-Host ""
Write-Host "使用说明:" -ForegroundColor Cyan
Write-Host "   - 双击桌面图标启动 Pi Agent" -ForegroundColor White
Write-Host "   - 应用将启动 Electron 桌面客户端" -ForegroundColor White
Write-Host ""
