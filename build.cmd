@REM This can't be a Bash script, because quoting /DDisplayName doesn't work right.
@rmdir /Q /S built
@mkdir built
@mkdir built\addons
@node bin/Outpost_Forms.js build Los_Altos bin\LAARES_Forms.exe "Outpost for LAARES"
@if %errorlevel% neq 0 exit /b %errorlevel%
@"C:\Program Files (x86)\NSIS\makensis.exe" ^
  /Daddon_name=Los_Altos ^
  /DDisplayName="Outpost for LAARES" ^
  setup-LAARES.nsi
@if %errorlevel% neq 0 exit /b %errorlevel%

@rmdir /Q /S built
@mkdir built
@mkdir built\addons
@node bin/Outpost_Forms.js build Enhanced bin\SCCoPIFO.exe "SCCo Pack-It-Forms for Outpost"
@if %errorlevel% neq 0 exit /b %errorlevel%
@"C:/Program Files (x86)/NSIS/makensis.exe" ^
    /Daddon_name=Enhanced ^
    /DDisplayName="SCCo Pack-It-Forms for Outpost (Public Edition)" ^
    setup-SCCo.nsi
@if %errorlevel% neq 0 exit /b %errorlevel%

@REM "C:/Program Files (x86)/NSIS/makensis.exe" ^
@REM     /Daddon_name=Enhanced ^
@REM     /DDisplayName="SCCo Pack-It-Forms for Outpost (Private Edition)" ^
@REM     setup-SCCo_private.nsi
@REM if %errorlevel% neq 0 exit /b %errorlevel%
