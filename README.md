This software augments
[Outpost Packet Message Manager](https://www.outpostpm.org),
adding forms that are used for emergency communication by ARES in Los Altos, California.
It uses the [add-on interface](http://www.outpostpm.org/docs/Outpost320-AddonUG.pdf)
to Outpost, and a web browser to display and edit forms.

### Installation

Install Outpost before installing this software.
Then, download an OutpostForLAARES*.exe installer from the
[releases page](https://github.com/jmkristian/OutpostForLAARES/releases)
and run it. After installation is complete, exit and restart Outpost.

Antivirus or firewall products may resist OutpostForLAARES,
since it isn't in their databases of trusted software.
Here's how to override them:

* Windows Smart Screen may prevent an "unrecognized app" from starting.
Click "More Info" and then "Run Anyway."

* Norton Security may quarantine the installer. Open the Norton Security program,
click "Security", click "History", select "Show Quarantine" and restore the installer.
When creating or opening a message, Norton may pop up a message,
"Suspicious network activity has been detected."
Select "Allow this instance", check "Do not notify me again" and click "OK".

* Avast antivirus might say "This file might be dangerous ... It's been submitted for interrogation."
Click "More details" and then "I trust this file."
Or it might say "this file may contain something bad."
After a minute, it might simply say "no problems found" and continue, without your intervention.
Or it might show a link you can click to run the program anyway.

* Comodo Firewall may ask whether to allow the software to do things.
For the OutpostForLAARES_Setup.exe installer program, click "Treat as Installer or Updater."
For the bin\\Outpost_for_LAARES.exe program, check "Remember my answer" and click "Allow."

Uninstall as you would any program.
For example on Windows 8, open the control panel "Programs and Features",
select "Outpost for LAARES" and click "Uninstall".
If you don't see Outpost for LAARES in the control panel, try closing and re-opening the control panel.
If that fails, try runninng the program uninstall.exe in the OutpostForLAARES folder.
After uninstallation is complete, exit and restart Outpost.

For a
[silent install](http://nsis.sourceforge.net/Which_command_line_parameters_can_be_used_to_configure_installers),
execute the installer with option `/S`.
To specify an installation folder, add the option `/D=C:\YourFolder`.
The /D= option must be last, and the folder name must not be surrounded by quotes.
Beware: a folder name that contains whitepsace won't work with Outpost version 3.2 c118.
For a silent uninstall, execute `.\uninstall.exe /S` in the folder where the program was installed.

### Usage

To create a new message, click an item in the 'Forms' menu of Outpost.
A browser page will pop up; enter data and click the 'Submit to Outpost' button at the top.
The text form of the message will pop up; enter the 'To' addresses and click 'Send'.

Opening a message that's not ready to send will pop up the text form, only,
where you can enter the 'To' addresses.
Opening a message that's ready to send will pop up a browser page.
Opening a message that's been sent or received will ask whether you want to view the
'original format'; that is a browser page.

### In Case of Trouble

If something's not right, please report it by creating a new issue in the
[issues page](https://github.com/jmkristian/OutpostForLAARES/issues).
Please say what browser and what versions of OutpostForLAARES and Windows you used.
To help isolate the problem, please attach a screenshot of a browser page (if any)
and all the files from the folder `OutpostForLAARES\logs`.

Power users might learn more by editing OutpostForLAARES\addons\\*.ini, changing
each occurrence of ...\wscript.exe ...\OutpostForLAARES\launch.vbs
to ...\OutpostForLAARES\launch-v.cmd and observing the console windows that pop up.
The source code for bin\Outpost_for_LAARES.exe is bin\Outpost_for_LAARES.js.

### Developing

Source code is stored in [this repository](https://github.com/jmkristian/OutpostForLAARES).
To build it, you'll need
[Git](https://git-scm.com/downloads),
a bash shell (the one included with Git for Windows is sufficient),
[Node.js](https://nodejs.org/en/download/) version 4 (yes that old),
and [NSIS](http://nsis.sourceforge.net) version 3.
Don't use a more recent version of Node.js: it will build code that won't run on Windows XP.

Clone this repository and then use bash to run ./build.sh in your clone.

Most improvements to the web user interface will be done in
[pack-it-forms](https://github.com/jmkristian/pack-it-forms/blob/LAARES/README.md)
(not this repository). You can experiment by replacing the pack-it-forms sub-folder
with a clone of the pack-it-forms repository.
When you're done experimenting, release pack-it-forms and then use the new released version here.
That is, commit changes to pack-it-forms, push them to GitHub, release pack-it-forms,
remove your experimental pack-it-forms sub-folder,
update ./build.sh to refer to the new version of pack-it-forms,
build a new installer, test it,
commit and push changes to GitHub and create a new release including the new installer.

To develop another add-on, create an Addon_Name.launch file in the addons sub-folder.
Also, insert a line into setup.nsi like this:

    CopyFiles "$OUTPOST_CODE\Aoclient.exe" "$INSTDIR\addons\Addon_Name\Aoclient.exe"

Other configuration files will be generated by bin/Outpost_for_LAARES.js#installConfigFiles.

The installer source code is setup.nsi, and
the source for most of the installed code is bin/Outpost_for_LAARES.js.
The installer configures Outpost to execute launch.vbs;
for debugging you might change the configuration to execute launch.cmd instead.
