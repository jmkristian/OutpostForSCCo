/** Run {{PROGRAM_PATH}} with the arguments that were passed to this script,
    the working directory that contains the folder that contains this script
    and no visible window.
*/

var vbExclamation = 48; // Display a yellow exclamation mark
var vbHide = 0; // Don't open a console window
var vbOKOnly = 0; // Offer an OK button, only

var FSO = WScript.CreateObject('Scripting.FileSystemObject');
var my_folder = FSO.GetParentFolderName(FSO.GetParentFolderName(WScript.ScriptFullName));
// WScript.Echo(my_folder);

// Construct a command line as a string:
var argv = WScript.Arguments;
var arguments = ['"' + FSO.BuildPath(my_folder, '{{PROGRAM_PATH}}') + '"'];
for (var i = 0; i < argv.length; ++i) {
    var arg = "" + argv(i);
    // WScript.Echo((typeof arg) + " " + arg);
    if (arg.length = 0 || arg.search(/[" \t]/) >= 0) {
        // Enquote this argument:
        arg = '"' + arg.replace(/"/g, '""') + '"';
    }
    arguments.push(arg);
}
var command_line = arguments.join(' ');
// WScript.Echo(command_line);

// Create process:
var shell = WScript.CreateObject('WScript.Shell');
shell.CurrentDirectory = my_folder;
try {
    var result = shell.Run(command_line, vbHide, true);
    if (result) {
        shell.Popup('Error ' + result + ' from ' + command_line,
                    0, '{{DisplayName}}',  vbOKOnly + vbExclamation);
        WScript.Quit(result);
    }
} catch(err) {
    var number = err.number;
    try {
        number = number >>> 0; // coerce to unsigned number
    } catch(ignored) {
    }
    shell.Popup(err.name + ' ' + number.toString(16) + ' ' + (err.description || err.message)
                + '\nfrom WScript.Shell.Run ' + command_line,
                0, '{{DisplayName}}',  vbOKOnly + vbExclamation);
    throw err;
}
