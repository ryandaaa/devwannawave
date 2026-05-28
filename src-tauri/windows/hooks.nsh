!macro NSIS_HOOK_POSTINSTALL
  CopyFiles /SILENT "$INSTDIR\devwannawave.exe" "$INSTDIR\dww.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\dww.exe" "" "$INSTDIR\dww.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\dww.exe" "Path" "$INSTDIR"

  ReadRegStr $0 HKCU "Environment" "Path"
  ${StrLoc} $1 "$0" "$INSTDIR" ">"
  ${If} "$0" == ""
    WriteRegExpandStr HKCU "Environment" "Path" "$INSTDIR"
  ${ElseIf} "$1" == ""
    WriteRegExpandStr HKCU "Environment" "Path" "$0;$INSTDIR"
  ${EndIf}

  System::Call 'user32::SendMessageTimeout(p 0xffff, i 0x001A, p 0, t "Environment", i 0, i 5000, *p .r0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Delete "$INSTDIR\dww.exe"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\dww.exe"

  ReadRegStr $0 HKCU "Environment" "Path"
  ${WordReplace} "$0" ";$INSTDIR" "" "+" $1
  ${WordReplace} "$1" "$INSTDIR;" "" "+" $2
  ${WordReplace} "$2" "$INSTDIR" "" "+" $3

  ${If} "$3" == ""
    DeleteRegValue HKCU "Environment" "Path"
  ${Else}
    WriteRegExpandStr HKCU "Environment" "Path" "$3"
  ${EndIf}

  System::Call 'user32::SendMessageTimeout(p 0xffff, i 0x001A, p 0, t "Environment", i 0, i 5000, *p .r0)'
!macroend
