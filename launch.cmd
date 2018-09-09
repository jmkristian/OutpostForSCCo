@echo Sorry, this is ugly on Windows XP. Newer versions of Windows work better.
@rem This ugly substitute for launch.vbs is used only on Windows XP.
@rem Why? Firefox on XP crashes when "lauch.vbs open" runs "start http://etc."
@rem If you know how to prevent this, please contribute to
@rem https://github.com/jmkristian/OutpostForLAARES/issues/1
@cd "%~dp0"
@start /B bin\Outpost_for_LAARES.exe %*
