@rem Open a browser page via which you can create or view forms.
@pushd "%~dp0"
bin\Outpost_Forms.exe dry-run
@if not %ERRORLEVEL%==0 exit /b %ERRORLEVEL%
set /p serverPort=<logs\server-port.txt
@if not %ERRORLEVEL%==0 exit /b %ERRORLEVEL%
@if [%serverPort%]==[] exit /b 1
@popd
start http://127.0.0.1:%serverPort%/manual
@if not %ERRORLEVEL%==0 exit /b %ERRORLEVEL%
