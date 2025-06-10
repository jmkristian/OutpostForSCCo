@IF EXIST node_modules\.bin\node.exe (
  node_modules\.bin\node.exe node_modules\pkg\lib-es5\bin.js %*
) ELSE (
  @SETLOCAL
  @SET PATHEXT=%PATHEXT:;.JS;=;%
  node node_modules\pkg\lib-es5\bin.js %*
)