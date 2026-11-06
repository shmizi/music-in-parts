$project = Split-Path -Parent $PSScriptRoot
$electron = Join-Path $project 'node_modules\electron\dist\electron.exe'
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'Music in Parts.lnk'

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $electron
$shortcut.Arguments = "`"$project`""
$shortcut.WorkingDirectory = $project
$shortcut.Description = 'Music in Parts'
$shortcut.Save()

Write-Output "Created $shortcutPath"
