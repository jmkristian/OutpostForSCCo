@REM Use NSIS to create built\setupAddon.exe.
@REM This can't be a Bash script, because quoting /DDisplayName doesn't work right in bash.
@"C:\Program Files (x86)\NSIS\makensis.exe" ^
  /DVersionMajor=%VersionMajor% ^
  /DVersionMinor=%VersionMinor% ^
  /DVersionPatch=%VersionPatch% ^
  /Daddon_name=%1 ^
  /DDisplayName=%2 ^
  /DPROGRAM_PATH=%3 ^
  /DOutFile=%4 ^
  setup.nsi
@exit /B %errorlevel%
