$SRC = "C:\Ai\pi-desktop\apps\desktop\src\renderer\src"
$DST = "C:\Ai\pi-desktop\docs\design-archive\legacy-components"

# Create archive dir
New-Item -ItemType Directory -Force -Path $DST | Out-Null

# Move broken pre-existing files
Move-Item -Path (Join-Path $SRC "hooks\usePiDriver.ts") -Destination $DST -Force
Move-Item -Path (Join-Path $SRC "hooks\usePiStream.ts") -Destination $DST -Force
Move-Item -Path (Join-Path $SRC "hooks\useGit.ts") -Destination $DST -Force
Move-Item -Path (Join-Path $SRC "App.tsx") -Destination $DST -Force
Move-Item -Path (Join-Path $SRC "components\ApprovalPanel") -Destination $DST -Force
Move-Item -Path (Join-Path $SRC "components\PiStatusPanel") -Destination $DST -Force
Move-Item -Path (Join-Path $SRC "components\Settings") -Destination $DST -Force
Move-Item -Path (Join-Path $SRC "components\GitPanel") -Destination $DST -Force
Move-Item -Path (Join-Path $SRC "components\ProjectPanel") -Destination $DST -Force
Move-Item -Path (Join-Path $SRC "components\Sidebar") -Destination $DST -Force
Move-Item -Path (Join-Path $SRC "components\IconBar") -Destination $DST -Force
Move-Item -Path (Join-Path $SRC "components\FloatingPanel") -Destination $DST -Force
Move-Item -Path (Join-Path $SRC "components\ResizablePanel.tsx") -Destination $DST -Force
Move-Item -Path (Join-Path $SRC "stores\plugin-store.ts") -Destination $DST -Force

Write-Host "MOVED $(Get-ChildItem $DST | Measure-Object).Count items to legacy-components"
