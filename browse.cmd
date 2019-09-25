@rem Open a browser page via which you can create or view forms.
@pushd "%~dp0"
"{{PROGRAM_PATH}}" dry-run "{{PROGRAM_PATH}}"
@if not %ERRORLEVEL%==0 goto wrapup
set /P serverPort=<logs\server-port.txt
@if not %ERRORLEVEL%==0 goto wrapup
@if [%serverPort%]==[] cmd /C exit 15
@if not %ERRORLEVEL%==0 goto wrapup
start http://127.0.0.1:%serverPort%/manual
:wrapup
@popd
@if not %ERRORLEVEL%==0 (
    @echo error %ERRORLEVEL%
    @pause
    @exit /B %ERRORLEVEL%
)
