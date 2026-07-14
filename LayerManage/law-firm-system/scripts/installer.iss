; ──────────────────────────────────────────────────────
; Law Firm Management System - Inno Setup Installer
; 律所闭环管理系统 安装程序
; ──────────────────────────────────────────────────────

#define MyAppName "律所管理系统"
#define MyAppNameEn "LawFirmSystem"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "LawFirm"
#define MyAppURL "http://localhost:7001"
#define MyAppExeName "law-firm-system.exe"

[Setup]
; GUID - generate a unique one for your app
AppId={{A1B2C3D4-E5F6-7890-ABCD-EF1234567890}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppSupportURL={#MyAppURL}

; Use LocalAppData to avoid requiring administrator privileges
DefaultDirName={localappdata}\{#MyAppNameEn}
DefaultGroupName={#MyAppName}

; Output
OutputDir=..\apps\dist\installer
OutputBaseFilename=LawFirmSystem-Setup-1.0.0

; Compression
Compression=lzma2/ultra64
SolidCompression=yes

; Installer appearance
WizardStyle=modern
WizardSizePercent=120,140

; Permissions - no admin needed for LocalAppData
PrivilegesRequired=lowest
ArchitecturesInstallIn64BitMode=x64compatible

; Uninstall
UninstallDisplayName={#MyAppName}

; Disable directory page (auto-use LocalAppData)
DisableDirPage=no
DisableProgramGroupPage=no

[Languages]
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Messages]
chinesesimplified.BeveledLabel={#MyAppName} v{#MyAppVersion}

[Files]
; Main application (portable directory)
Source: "..\apps\dist\law-firm-system\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
; Start Menu shortcut
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; Comment: "启动律所管理系统"
; Desktop shortcut
Name: "{userdesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; Comment: "启动律所管理系统"; Tasks: desktopicon
; Uninstall shortcut
Name: "{group}\卸载 {#MyAppName}"; Filename: "{uninstallexe}"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加图标:"; Flags: checkedonce

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "启动律所管理系统"; Flags: nowait postinstall skipifsilent

[UninstallRun]
; Notify user to stop the server before uninstall
Filename: "taskkill"; Parameters: "/f /im {#MyAppExeName}"; Flags: runhidden

[Code]
// Optional: detect if port 7001 is already in use
function InitializeSetup: Boolean;
begin
  Result := True;
end;

// Custom uninstall logic to clean up database
function InitializeUninstall: Boolean;
begin
  Result := True;
end;

// Show install completion message
procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    // Installation complete
  end;
end;
