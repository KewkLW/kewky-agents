param(
  [string]$TaskName = "AgentDashboard-Autostart",
  [int]$Port = 80,
  [string]$ProjectRoot = "F:\agent-dashboard",
  [switch]$RunNow
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path (Join-Path $ProjectRoot "server.js"))) {
  throw "Missing server.js under $ProjectRoot"
}

$logDir = Join-Path $ProjectRoot "logs"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

$outFile = Join-Path $logDir "server.out.log"
$errFile = Join-Path $logDir "server.err.log"

$userId = "$env:USERDOMAIN\$env:USERNAME"
$runCmd = "set AGENT_DASH_PORT=$Port && cd /d `"$ProjectRoot`" && node server.js 1>>`"$outFile`" 2>>`"$errFile`""
$actionArgs = "/c `"$runCmd`""

$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument $actionArgs
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null

Write-Host "Installed scheduled task: $TaskName"
Write-Host "Runs at logon as $userId on port $Port"

if ($RunNow) {
  Start-ScheduledTask -TaskName $TaskName
  Write-Host "Triggered task immediately."
}
