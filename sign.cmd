@REM Sign and timestamp %1 using signingCert.pfx.
@SignTool Sign /fd SHA256 /f signingCert.pfx %1
@if %errorlevel% neq 0 exit /B %errorlevel%
@SignTool Timestamp /tr "http://timestamp.sectigo.com" /td SHA256 %1
@if %errorlevel% neq 0 exit /B %errorlevel%
