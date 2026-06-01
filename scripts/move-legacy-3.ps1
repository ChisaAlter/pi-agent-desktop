$SRC = "C:\Ai\pi-desktop\apps\desktop\src\renderer\src"
$DST = "C:\Ai\pi-desktop\docs\design-archive\legacy-components"

Move-Item -Path (Join-Path $SRC "App.tsx") -Destination $DST -Force
Write-Host "DONE"
