param(
  [string]$TaskName = "AgentDashboard-Autostart"
)

$ErrorActionPreference = "Stop"

Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop

Write-Host "Removed scheduled task: $TaskName"
