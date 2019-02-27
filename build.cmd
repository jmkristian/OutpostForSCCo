@REM This can't be a Bash script, because quoting /DDisplayName doesn't work right.

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
@node bin/Outpost_Forms.js build Los_Altos bin\LAARES_Forms.exe "Outpost for LAARES"
@if %errorlevel% neq 0 exit /b %errorlevel%
@"C:\Program Files (x86)\NSIS\makensis.exe" ^
  /Daddon_name=Los_Altos ^
  /DDisplayName="Outpost for LAARES" ^
  /DPROGRAM_PATH=bin\LAARES_Forms.exe ^
  setup-LAARES.nsi
@if %errorlevel% neq 0 exit /b %errorlevel%

@rmdir /Q /S built
@mkdir built
@mkdir built\addons
@node bin/Outpost_Forms.js build Enhanced bin\SCCoPIFO.exe "SCCo Pack-It-Forms for Outpost"
@if %errorlevel% neq 0 exit /b %errorlevel%
@"C:/Program Files (x86)/NSIS/makensis.exe" ^
    /DDisplayName="SCCo Pack-It-Forms for Outpost (Public Edition)" ^
    /Daddon_name=Enhanced ^
    /DLaunchFile=SCCo.launch ^
    /DOutFileSuffix=pub ^
    /DPROGRAM_PATH=bin\SCCoPIFO.exe ^
    setup-SCCo.nsi
@if %errorlevel% neq 0 exit /b %errorlevel%

@rem rmdir /Q /S built
@rem mkdir built
@rem mkdir built\addons
@rem node bin/Outpost_Forms.js build Enhanced bin\SCCoPIFO.exe "SCCo Pack-It-Forms for Outpost"
@rem if %errorlevel% neq 0 exit /b %errorlevel%
@rem "C:/Program Files (x86)/NSIS/makensis.exe" ^
@rem    /DDisplayName="SCCo Pack-It-Forms for Outpost (Private Edition)" ^
@rem    /Daddon_name=Enhanced ^
@rem    /DLaunchFile=SCCo_private.launch ^
@rem    /DOutFileSuffix=pvt ^
@rem    /DPROGRAM_PATH=bin\SCCoPIFO.exe ^
@rem    setup-SCCo.nsi
@rem if %errorlevel% neq 0 exit /b %errorlevel%
