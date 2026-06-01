$SRC = "C:\Ai\pi-desktop\apps\desktop\src\renderer\src"
$DST = "C:\Ai\pi-desktop\docs\design-archive\legacy-components"

Move-Item -Path (Join-Path $SRC "components\ChatView") -Destination $DST -Force
Move-Item -Path (Join-Path $SRC "components\ChatInput") -Destination $DST -Force
Write-Host "DONE"
