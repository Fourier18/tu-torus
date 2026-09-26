; Runs in the installer's .onInit — before the previous version is removed.
;
; Tu-Torus 1.0.0 kept the learner's code, settings (API key) and run records
; inside the install folder (resources\app\workspace), which an upgrade
; deletes along with the old version. From 1.0.1 they live in the per-user
; data folder, %APPDATA%\tu-torus\workspace. Copy them across first, so
; nobody updating from 1.0.0 loses their files. Skipped if the data folder
; already holds a workspace, so newer files are never overwritten.
!macro customInit
  IfFileExists "$LOCALAPPDATA\Programs\tu-torus\resources\app\workspace\*.*" 0 tutorus_migrate_done
  IfFileExists "$APPDATA\tu-torus\workspace\main.py" tutorus_migrate_done 0
  IfFileExists "$APPDATA\tu-torus\workspace\.tutor\settings.json" tutorus_migrate_done 0
    CreateDirectory "$APPDATA\tu-torus\workspace"
    CopyFiles /SILENT "$LOCALAPPDATA\Programs\tu-torus\resources\app\workspace\*.*" "$APPDATA\tu-torus\workspace"
  tutorus_migrate_done:
!macroend
