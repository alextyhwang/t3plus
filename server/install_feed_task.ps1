# Registers (or updates) the "t3plus feeds" scheduled task (Windows): every 2
# minutes, hidden, as the current user, it runs publish_all.py, which runs
#   publish_bot_feed.py  (latest message per bot; read-only on T3's database)
#   publish_home.py      (home widgets: limits, activity, spend, automations;
#                         reads T3's own API with a short-lived read-only
#                         session and T3's database read-only)
# Settings (folders, the t3 CLI, time zone) come from feedconfig.py.
#   .\install_feed_task.ps1 -Python C:\path\to\venv\Scripts\pythonw.exe
# Remove with: Unregister-ScheduledTask -TaskName "t3plus feeds" -Confirm:$false
param(
  # A windowless Python 3.10+ that has the `websockets` package.
  [string]$Python = (Get-Command pythonw.exe -ErrorAction SilentlyContinue).Source
)
$ErrorActionPreference = "Stop"
$script = Join-Path $PSScriptRoot "publish_all.py"
if (-not $Python -or -not (Test-Path $Python)) { throw "pythonw.exe not found; pass -Python <path to pythonw.exe>" }
$action = New-ScheduledTaskAction -Execute $Python -Argument "`"$script`"" -WorkingDirectory $PSScriptRoot
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 2)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 2) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName "t3plus feeds" -Action $action -Trigger $trigger -Settings $settings `
  -Description "Publishes t3plus-bots.json and t3plus-home.json for the t3+ extension. Read-only on T3." -Force | Out-Null
Write-Output "Registered 't3plus feeds' (every 2 minutes)"
