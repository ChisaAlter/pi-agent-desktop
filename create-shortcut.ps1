# Pi Desktop 桌面快捷方式创建脚本
# 运行此脚本在桌面创建 Pi Desktop 快捷方式

$desktopPath = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktopPath "Pi Desktop.lnk"
$targetPath = "powershell.exe"
$arguments = "-NoExit -Command `"cd 'c:\Ai\pi-desktop\apps\desktop'; pnpm run dev`""
$workingDirectory = "c:\Ai\pi-desktop\apps\desktop"
$iconPath = "c:\Ai\pi-desktop\apps\desktop\build\icon.ico"

# 如果图标不存在，使用默认图标
if (-not (Test-Path $iconPath)) {
    $iconPath = "shell32.dll,13"  # 默认应用图标
}

# 创建 WScript.Shell 对象
$WshShell = New-Object -ComObject WScript.Shell

# 创建快捷方式
$shortcut = $WshShell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $targetPath
$shortcut.Arguments = $arguments
$shortcut.WorkingDirectory = $workingDirectory
$shortcut.Description = "Pi Desktop - AI 桌面应用"
$shortcut.IconLocation = $iconPath
$shortcut.WindowStyle = 1  # 正常窗口

# 保存快捷方式
$shortcut.Save()

Write-Host "✅ 桌面快捷方式已创建: $shortcutPath" -ForegroundColor Green
Write-Host ""
Write-Host "📌 使用说明:" -ForegroundColor Cyan
Write-Host "   - 双击桌面图标启动 Pi Desktop 开发模式" -ForegroundColor White
Write-Host "   - 应用将在 http://localhost:5173 启动" -ForegroundColor White
Write-Host "   - 关闭终端窗口停止应用" -ForegroundColor White
Write-Host ""

# 打开桌面文件夹
explorer $desktopPath
