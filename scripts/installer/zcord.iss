; Zcord Windows Installer — installe comme une vraie application
#define MyAppName "Zcord"
#define MyAppVersion "1.26.3"
#define MyAppPublisher "Zcord"
#define MyAppURL "https://github.com/devdee162-web/qsddddddddddddddddddddddddsq"
#define MyAppExeName "Zcord.exe"

[Setup]
AppId={{A7B3C4D5-E6F7-4890-ABCD-EF1234567890}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={localappdata}\Programs\{#MyAppName}
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
OutputDir=..\..\release
OutputBaseFilename=Zcord-Setup
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\app.ico
SetupIconFile=..\..\static\icon.ico
DisableProgramGroupPage=yes
CloseApplications=force

[Languages]
Name: "french"; MessagesFile: "compiler:Languages\French.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: checkedonce
Name: "launchicon"; Description: "Lancer Zcord apres l'installation"; GroupDescription: "Options:"; Flags: checkedonce

[Files]
Source: "..\..\release\zcord-staging\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\app.ico"; AppUserModelID: "com.zcord.portable"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\app.ico"; Tasks: desktopicon; AppUserModelID: "com.zcord.portable"

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Lancer {#MyAppName}"; Flags: nowait postinstall skipifsilent; Tasks: launchicon

[UninstallDelete]
Type: filesandordirs; Name: "{app}\Data"

[Code]
function InitializeSetup(): Boolean;
begin
  Result := True;
end;
