$SRC = "C:\Ai\pi-desktop\docs\design-archive\legacy-components"
$DST = "C:\Ai\pi-desktop\apps\desktop\src\renderer\src\components"

New-Item -ItemType Directory -Force -Path "$DST\ChatView" | Out-Null
@("ChatView.tsx", "CodeBlock.tsx", "CommandCard.tsx", "MessageBubble.tsx", "ToolCallCard.tsx", "index.ts") | ForEach-Object {
    Move-Item -Path "$SRC\ChatView\$_" -Destination "$DST\ChatView\$_" -Force -ErrorAction SilentlyContinue
}

Move-Item -Path "$SRC\FloatingPanel\index.ts" -Destination "$DST\FloatingPanel\index.ts" -Force -ErrorAction SilentlyContinue

New-Item -ItemType Directory -Force -Path "$DST\GitPanel" | Out-Null
@("GitPanel.tsx", "index.ts") | ForEach-Object {
    Move-Item -Path "$SRC\GitPanel\$_" -Destination "$DST\GitPanel\$_" -Force -ErrorAction SilentlyContinue
}

New-Item -ItemType Directory -Force -Path "$DST\ProjectPanel" | Out-Null
@("ProjectPanel.tsx", "index.ts") | ForEach-Object {
    Move-Item -Path "$SRC\ProjectPanel\$_" -Destination "$DST\ProjectPanel\$_" -Force -ErrorAction SilentlyContinue
}

New-Item -ItemType Directory -Force -Path "$DST\Sidebar" | Out-Null
@("Sidebar.tsx", "SessionList.tsx", "WorkspaceList.tsx", "index.ts") | ForEach-Object {
    Move-Item -Path "$SRC\Sidebar\$_" -Destination "$DST\Sidebar\$_" -Force -ErrorAction SilentlyContinue
}

Move-Item -Path "$SRC\useGit.ts" -Destination "C:\Ai\pi-desktop\apps\desktop\src\renderer\src\hooks\useGit.ts" -Force -ErrorAction SilentlyContinue

Write-Host "MOVED"
ls "$DST"
