@echo This script is for troubleshooting. For normal operation, use launch.vbs.
@cd "%~dp0"
bin\launch.exe %*
@rem For development or debugging, it's convenient to install Node.js and do this instead:
@rem node bin/launch.js %*
@pause
