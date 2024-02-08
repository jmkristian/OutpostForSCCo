var ForWriting = 2;
var ssfDESKTOPDIRECTORY = 0x10;
var ssfDRIVES = 0x11;
var ssfCOMMONDESKTOPDIR = 0x19;
var ssfWINDOWS = 0x24;

try {
    var FS = new ActiveXObject("Scripting.FileSystemObject");
    var Shell = new ActiveXObject("shell.application");
    var folder = Shell.BrowseForFolder(
        0, "Choose the folder where you want to store copies of all the messages you send or receive.", 0, ssfDRIVES);
    var ts = FS.OpenTextFile("logs\\archiveFolder.txt", ForWriting, true);
    // WScript.Echo(folder.self.path);
    ts.Write((folder && folder.self) ? folder.self.path : '');
    ts.Close();
} catch(err) {
    WScript.Echo(err);
    WScript.Quit(1);
}
