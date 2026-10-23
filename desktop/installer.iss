#ifndef AppVersion
  #define AppVersion "1.1.0"
#endif
#ifndef AppFiles
  #define AppFiles "..\release\1.1.0\win-x64"
#endif
#ifndef OutputDirectory
  #define OutputDirectory "..\release\1.1.0"
#endif
[Setup]
AppId={{350A316B-2639-4E79-A652-9051E59E6685}
AppName=Qlyra
AppVersion={#AppVersion}
AppPublisher=Qlyra contributors
AppPublisherURL=https://github.com/shanec7825/qq-ucloud-bot
AppSupportURL=https://github.com/shanec7825/qq-ucloud-bot/issues
; Keep the installation identity and location so existing installs upgrade in place.
DefaultDirName={localappdata}\Programs\QQAgent
DefaultGroupName=Qlyra
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutputDirectory}
OutputBaseFilename=Qlyra-Setup-{#AppVersion}-x64
SetupIconFile={#AppFiles}\app.ico
UninstallDisplayIcon={app}\Qlyra.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
[Languages]
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"
[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; Flags: checkedonce
[Files]
Source: "{#AppFiles}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{autoprograms}\Qlyra\Qlyra"; Filename: "{app}\Qlyra.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\Qlyra"; Filename: "{app}\Qlyra.exe"; WorkingDir: "{app}"; Tasks: desktopicon
Name: "{autoprograms}\Qlyra\卸载 Qlyra"; Filename: "{uninstallexe}"
[InstallDelete]
Type: files; Name: "{autoprograms}\QQ Agent\QQ Agent.lnk"
Type: files; Name: "{autoprograms}\QQ Agent\卸载 QQ Agent.lnk"
Type: files; Name: "{autodesktop}\QQ Agent.lnk"
[Run]
Filename: "{app}\Qlyra.exe"; Description: "打开 Qlyra"; Flags: nowait postinstall skipifsilent
; Data lives outside {app}; uninstall never removes user projects, sessions or authorization.
