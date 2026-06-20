$ws = New-Object -ComObject WScript.Shell
$desktopPath = [System.Environment]::GetFolderPath('Desktop')
$sc = $ws.CreateShortcut([System.IO.Path]::Combine($desktopPath, 'Pi Agent Desktop.lnk'))
$sc.TargetPath = 'C:\Ai\pi-desktop\launch.bat'
$sc.WorkingDirectory = 'C:\Ai\pi-desktop\apps\desktop'
$sc.Description = 'Pi Agent Desktop - AI Coding Agent GUI'
$sc.Save()
Write-Host "Shortcut created on Desktop"
