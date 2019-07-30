@REM This can't be a Bash script, because quoting /DDisplayName doesn't work right.

@set VersionMajor=2
@set VersionMinor=18

@rem rmdir /Q /S built
@rem mkdir built
@rem mkdir built\addons
@rem node bin/Outpost_Forms.js build HTTP bin\HTTP_server.exe "HTTP Request"
@rem if %errorlevel% neq 0 exit /b %errorlevel%
@rem "C:\Program Files (x86)\NSIS\makensis.exe" ^
@rem  /Daddon_name=HTTP ^
@rem  /DDisplayName="HTTP Request" ^
@rem  setup-HTTP.nsi
@rem if %errorlevel% neq 0 exit /b %errorlevel%

@rmdir /Q /S built
@mkdir built
@mkdir built\addons
@node bin/Outpost_Forms.js build %VersionMajor%.%VersionMinor% ^
  Los_Altos bin\Outpost_Forms.exe "Outpost for LAARES"
@if %errorlevel% neq 0 exit /b %errorlevel%
@"C:\Program Files (x86)\NSIS\makensis.exe" ^
  /DVersionMajor=%VersionMajor% ^
  /DVersionMinor=%VersionMinor% ^
  /Daddon_name=Los_Altos ^
  /DDisplayName="Outpost for LAARES" ^
  /DPROGRAM_PATH=bin\Outpost_Forms.exe ^
  setup-LAARES.nsi
@if %errorlevel% neq 0 exit /b %errorlevel%

@rmdir /Q /S built
@mkdir built
@mkdir built\addons
@node bin/Outpost_Forms.js build %VersionMajor%.%VersionMinor% ^
  SCCoPIFO bin\SCCoPIFO.exe "SCCo Pack-It-Forms for Outpost"
@if %errorlevel% neq 0 exit /b %errorlevel%
@"C:/Program Files (x86)/NSIS/makensis.exe" ^
  /DVersionMajor=%VersionMajor% ^
  /DVersionMinor=%VersionMinor% ^
  /DDisplayName="SCCo Pack-It-Forms for Outpost (Public Edition)" ^
  /Daddon_name=SCCoPIFO ^
  /DLaunchFile=SCCo.launch ^
  /DOutFileSuffix=pub ^
  /DPROGRAM_PATH=bin\SCCoPIFO.exe ^
  setup-SCCo.nsi
@if %errorlevel% neq 0 exit /b %errorlevel%

@rmdir /Q /S built
@mkdir built
@mkdir built\addons
@node bin/Outpost_Forms.js build %VersionMajor%.%VersionMinor% ^
  SCCoPIFO bin\SCCoPIFO.exe "SCCo Pack-It-Forms for Outpost"
@if %errorlevel% neq 0 exit /b %errorlevel%
@"C:/Program Files (x86)/NSIS/makensis.exe" ^
  /DVersionMajor=%VersionMajor% ^
  /DVersionMinor=%VersionMinor% ^
  /DDisplayName="SCCo Pack-It-Forms for Outpost (Private Edition)" ^
  /Daddon_name=SCCoPIFO ^
  /DLaunchFile=SCCo_private.launch ^
  /DOutFileSuffix=pvt ^
  /DPROGRAM_PATH=bin\SCCoPIFO.exe ^
  setup-SCCo.nsi
@if %errorlevel% neq 0 exit /b %errorlevel%
