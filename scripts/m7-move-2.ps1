$SRC = "C:\Ai\pi-desktop\docs\design-archive\legacy-components"
$DST = "C:\Ai\pi-desktop\apps\desktop\src\renderer\src\components"

# IconBar
New-Item -ItemType Directory -Force -Path "$DST\IconBar" | Out-Null
Get-ChildItem -Path "$SRC\IconBar" -File | ForEach-Object {
    Move-Item -Path $_.FullName -Destination "$DST\IconBar\$($_.Name)" -Force
}

# Settings
New-Item -ItemType Directory -Force -Path "$DST\Settings" | Out-Null
Get-ChildItem -Path "$SRC\Settings" -File | ForEach-Object {
    Move-Item -Path $_.FullName -Destination "$DST\Settings\$($_.Name)" -Force
}

# PiStatusPanel
New-Item -ItemType Directory -Force -Path "$DST\PiStatusPanel" | Out-Null
Get-ChildItem -Path "$SRC\PiStatusPanel" -File | ForEach-Object {
    Move-Item -Path $_.FullName -Destination "$DST\PiStatusPanel\$($_.Name)" -Force
}

# ResizablePanel.tsx
Move-Item -Path "$SRC\ResizablePanel.tsx" -Destination "$DST\ResizablePanel.tsx" -Force

# ChatInput (M2 work: AttachmentChip + MentionPopover)
New-Item -ItemType Directory -Force -Path "$DST\ChatInput" | Out-Null
Get-ChildItem -Path "$SRC\ChatInput" -File | ForEach-Object {
    Move-Item -Path $_.FullName -Destination "$DST\ChatInput\$($_.Name)" -Force
}

# plugin-store.ts
Move-Item -Path "$SRC\plugin-store.ts" -Destination "C:\Ai\pi-desktop\apps\desktop\src\renderer\src\stores\plugin-store.ts" -Force

# usePiStream, usePiDriver (will be rewritten in M7-2)
Move-Item -Path "$SRC\usePiStream.ts" -Destination "C:\Ai\pi-desktop\apps\desktop\src\renderer\src\hooks\usePiStream.ts" -Force
Move-Item -Path "$SRC\usePiDriver.ts" -Destination "C:\Ai\pi-desktop\apps\desktop\src\renderer\src\hooks\usePiDriver.ts" -Force

# Don't restore old App.tsx (we keep the M6 minimal version as base)
# But keep it in legacy for reference

Write-Host "MOVED"
ls "$DST"
