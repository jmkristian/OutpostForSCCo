@REM Create an installer for one addon.
@REM %1 = short name of the addon, from Outpost's point of view
@REM %2 = full name of the addon, from users' point of view
@REM %3 = name of the HTTP server .exe file
@REM %4 = name of the installer .exe file
@REM This can't be a Bash script, because quoting /DDisplayName doesn't work right in bash.
@"C:\Program Files (x86)\NSIS\makensis.exe" ^
  /DVersionMajor=%VersionMajor% ^
  /DVersionMinor=%VersionMinor% ^
  /Daddon_name=%1 ^
  /DDisplayName=%2 ^
  /DPROGRAM_PATH=%3 ^
  /DOutFile=%4 ^
  setup.nsi
@exit /B %errorlevel%
