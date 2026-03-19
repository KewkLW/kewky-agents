param(
  [int]$Port = 80,
  [string]$ProjectRoot = "F:\agent-dashboard",
  [string]$LogDir = "F:\agent-dashboard\logs"
)

$ErrorActionPreference = "Stop"

New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
$logFile = Join-Path $LogDir "startup.log"
$outFile = Join-Path $LogDir "server.out.log"
$errFile = Join-Path $LogDir "server.err.log"

function Write-Log {
  param([string]$Message)
  $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -Path $logFile -Value "[$stamp] $Message"
}

Write-Log "Autostart invoked (port=$Port, root=$ProjectRoot)"

try {
  $listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
    Select-Object -ExpandProperty OwningProcess -Unique
} catch {
  $listeners = @()
}

foreach ($listenerPid in $listeners) {
  if (-not $listenerPid) { continue }

  $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $listenerPid"
  $commandLine = if ($proc) { $proc.CommandLine } else { "" }

  if ($commandLine -match "agent-dashboard[\\/]+server\.js") {
    Write-Log "Stopping existing dashboard instance PID=$listenerPid"
    Stop-Process -Id $listenerPid -Force -ErrorAction SilentlyContinue
  } else {
    Write-Log "Port $Port in use by PID=$listenerPid; not dashboard process. Aborting start."
    exit 1
  }
}

$cmd = "set AGENT_DASH_PORT=$Port && cd /d `"$ProjectRoot`" && node server.js 1>>`"$outFile`" 2>>`"$errFile`""
Start-Process -FilePath "cmd.exe" -ArgumentList "/c", $cmd -WindowStyle Hidden

Write-Log "Dashboard start command launched."
