param([Parameter(Mandatory=$true)][string]$Directory, [Parameter(Mandatory=$true)][int]$AppProcessId)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class DirectoryDialogMessages {
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessageW(IntPtr hWnd, uint msg, IntPtr wParam, string value);
    [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
}
"@
$resolvedDirectory = (Resolve-Path -LiteralPath $Directory).Path
$deadline = [DateTime]::UtcNow.AddSeconds(30)
do {
    $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, 'Select Workspace Directory'))
    foreach ($window in $windows) {
        $ancestor = $window.Current.ProcessId
        for ($step = 0; $step -lt 8 -and $ancestor -gt 0 -and $ancestor -ne $AppProcessId; $step++) {
            $ancestor = (Get-CimInstance Win32_Process -Filter "ProcessId = $ancestor").ParentProcessId
        }
        if ($ancestor -ne $AppProcessId) { continue }
        $folderInput = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, '1152'))
        $select = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, '1'))
        if ($folderInput -and $select -and $folderInput.Current.NativeWindowHandle -ne 0 -and $select.Current.NativeWindowHandle -ne 0) {
            [void][DirectoryDialogMessages]::SendMessageW([IntPtr]$folderInput.Current.NativeWindowHandle, 0x000C, [IntPtr]::Zero, $resolvedDirectory)
            [void][DirectoryDialogMessages]::PostMessageW([IntPtr]$select.Current.NativeWindowHandle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)
            Write-Output 'Native Windows directory selection completed.'
            exit 0
        }
    }
    Start-Sleep -Milliseconds 200
} while ([DateTime]::UtcNow -lt $deadline)
throw 'No native directory picker belonging to the test application was ready.'
