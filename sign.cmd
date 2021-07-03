@REM Sign and timestamp %1 using signingCert.pfx.
@REM Intermittently, it appears NSIS doesn't close the file before running this script.
@sleep 2
@SignTool Sign /fd SHA256 /f signingCert.pfx %1
@if %errorlevel% neq 0 exit /B %errorlevel%
@SignTool Timestamp /tr "http://timestamp.sectigo.com" /td SHA256 %1
@if %errorlevel% neq 0 exit /B %errorlevel%
