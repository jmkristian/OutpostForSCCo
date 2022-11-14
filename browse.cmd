@echo **************************************************
@echo browse.cmd is obsolescent. Use manual.cmd instead.
@echo These are both in %~dp0
@echo **************************************************
@rem Wait for the message to sink in:
@ping -n 11 127.0.0.1 > nul
@"%~dp0manual.cmd"
