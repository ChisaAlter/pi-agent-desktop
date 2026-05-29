# Pi Desktop Test Script
Write-Host "Testing Pi Desktop Application..." -ForegroundColor Cyan

# Check if build exists
$buildPath = "c:/Users/48818/CodeBuddy/20260527141037/pi-desktop/apps/desktop/out/main/index.js"
if (Test-Path $buildPath) {
    Write-Host "✓ Build output exists" -ForegroundColor Green
} else {
    Write-Host "✗ Build output not found" -ForegroundColor Red
    exit 1
}

# Check if pi CLI is available
try {
    $piVersion = pi --version
    Write-Host "✓ Pi CLI available: $piVersion" -ForegroundColor Green
} catch {
    Write-Host "⚠ Pi CLI not found (optional dependency)" -ForegroundColor Yellow
}

# Start the application
Write-Host "Starting Pi Desktop..." -ForegroundColor Yellow
$appProcess = Start-Process -FilePath "npx" -ArgumentList "electron", "out/main/index.js" -WorkingDirectory "c:/Users/48818/CodeBuddy/20260527141037/pi-desktop/apps/desktop" -PassThru -WindowStyle Hidden

# Wait for app to start
Start-Sleep -Seconds 5

# Check if app is running
$appRunning = Get-Process -Name "electron" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq "Pi Desktop" }

if ($appRunning) {
    Write-Host "✓ Pi Desktop is running (PID: $($appRunning.Id))" -ForegroundColor Green
    Write-Host "✓ Window title: $($appRunning.MainWindowTitle)" -ForegroundColor Green
    
    # Take screenshot
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bitmap = New-Object System.Drawing.Bitmap $screen.Width, $screen.Height
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
    $bitmap.Save("c:/Users/48818/CodeBuddy/20260527141037/pi-desktop/test-screenshot.png")
    $graphics.Dispose()
    $bitmap.Dispose()
    
    Write-Host "✓ Screenshot saved to test-screenshot.png" -ForegroundColor Green
    
    # Stop the app
    $appRunning | Stop-Process -Force
    Write-Host "✓ Application stopped" -ForegroundColor Green
    
    Write-Host "`nTest completed successfully!" -ForegroundColor Green
} else {
    Write-Host "✗ Pi Desktop failed to start" -ForegroundColor Red
    exit 1
}