Unicode true
Name "Amelia"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\Amelia"
RequestExecutionLevel user
SetCompressor /SOLID zlib
Icon "${APP_ICON}"
UninstallIcon "${APP_ICON}"
VIProductVersion "1.0.0.0"
VIAddVersionKey "ProductName" "Amelia"
VIAddVersionKey "LegalCopyright" "Amelia"
VIAddVersionKey "FileDescription" "Instalador de Amelia"
VIAddVersionKey "FileVersion" "1.0.0"
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

Section "Amelia"
  SetShellVarContext current
  SetOutPath "$INSTDIR"
  File /r "${APP_FILES}/*"
  File /oname=Amelia.ico "${APP_ICON}"
  CreateShortcut "$SMPROGRAMS\Amelia.lnk" "$INSTDIR\Amelia.exe" "" "$INSTDIR\Amelia.ico"
  WriteUninstaller "$INSTDIR\Desinstalar.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Amelia" "DisplayName" "Amelia"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Amelia" "DisplayVersion" "1.0.0"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Amelia" "DisplayIcon" "$INSTDIR\Amelia.ico"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Amelia" "UninstallString" '$\"$INSTDIR\Desinstalar.exe$\"'
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  Delete "$SMPROGRAMS\Amelia.lnk"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Amelia"
  StrCpy $0 "$LOCALAPPDATA\Programs\Amelia"
  SetOutPath "$LOCALAPPDATA"
  RMDir /r /REBOOTOK "$0"
SectionEnd
