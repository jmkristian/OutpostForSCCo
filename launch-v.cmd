@echo This script is for troubleshooting. For normal operation, use launch.vbs.
@cd "%~dp0"
@cd ..
{{PROGRAM_PATH}} %*
@rem For development or debugging, it's convenient to install Node.js and do this instead:
@rem node bin\Outpost_Forms.js %*
@pause
