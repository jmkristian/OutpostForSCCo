This software augments
[Outpost Packet Message Manager](https://www.outpostpm.org),
adding forms that are used for emergency communication by ARES in Los Altos, California.
It uses the [add-on interface](http://www.outpostpm.org/docs/Outpost320-AddonUG.pdf)
to Outpost, and a web browser to display and edit forms.

### Installation

Install Outpost before installing this software.
Then, download a Setup.exe file from the
[releases page](https://github.com/jmkristian/OutpostForLAARES/releases)
and run it. After installation is complete, exit and restart Outpost.

Antivirus or firewall products may resist this software.
Here's how to overcome their resistance:

* Windows Smart Screen may prevent an "unrecognized app" from starting.
Click "More Info" and then "Run Anyway."

* Windows Firewall may ask to allow Outpost_Forms.exe to communicate on a network.
Check the box for "Private networks" and click "Allow access."

* Norton Security may quarantine the installer. Open the Norton Security program,
click "Security", click "History", select "Show Quarantine" and restore the installer.
When creating or opening a message, Norton may pop up a message,
"Suspicious network activity has been detected."
Select "Allow this instance", check "Do not notify me again" and click "OK".

* Avast antivirus might say "This file might be dangerous - It's been submitted for interrogation."
Click "More details" and then "I trust this file."
Next, open Avast settings, select the "General" tab,
check "allow me to decide" under "Enable CyberCapture"
and try again to run the installer.
Then you'll have to wait for a few minutes, until its interrogation is complete.
Or Avast might say "this file may contain something bad,"
or "CyberCapture has been activated. You've discovered a very rare file."
After a minute, it might simply say "no problems found" and continue, without your intervention.
Or it might show a link you can click to run the program anyway.

* Comodo Firewall may ask whether to allow the software to do things.
For the Setup.exe installer program, click "Treat as Installer or Updater."
For the bin\\Outpost\_Forms.exe program, check "Remember my answer" and click "Allow."

Uninstall as you would any program.
For example on Windows 8, open the control panel "Programs and Features",
select "Outpost for LAARES" and click "Uninstall".
If you don't see the program in the control panel, try closing and re-opening the control panel.
If that fails, try running the program uninstall.exe in the folder where the program was installed.
After uninstallation is complete, exit and restart Outpost.

For a silent install, run the installer with option `/S`.
To specify an installation folder, add the option `/D=C:\YourFolder`.
The [/D= option](http://nsis.sourceforge.net/Which_command_line_parameters_can_be_used_to_configure_installers)
must be last, and the folder name must not be surrounded by quotes.
Beware: a folder name that contains whitepsace won't work with Outpost version 3.2 c118.
For a silent uninstall, run `.\uninstall.exe /S` in the folder where the program was installed.

### Usage

To create a new message, click an item in the 'Forms' menu of Outpost.
A browser page will pop up; enter data and click the 'Submit to Outpost' button at the top.
The text form of the message will pop up; enter the 'To' addresses and click 'Send' or 'Save'.

Opening a message that's not ready to send will pop up the text form, only,
where you can enter the 'To' addresses.
Opening a message that's ready to send will pop up a browser page.
Opening a message that's been sent or received will ask whether you want to view the
'original format'; that is a browser page.

### When Outpost Fails

If Outpost is unusable, it's still possible to use this program.
Run browse.cmd in the folder where you installed the program.
It should open a page in your browser, with buttons you can use to either
open a form to create a message (which you could send via email),
or view a received message as a form.

### In Case of Trouble

If something's not right, please report it by creating or updating an issue in the
[issues page](https://github.com/jmkristian/OutpostForLAARES/issues).
Please say what browser and what versions of this program, Outpost and Windows you used.
To help isolate the problem, please attach all the files from the `logs` sub-folder
of the folder where the program was installed,
and a screenshot of a browser page (if any).

Power users might learn more by editing addons\\*.ini, changing
each occurrence of XXX\\wscript.exe YYY\\launch.vbs
to YYY\\launch-v.cmd and observing the console windows that pop up.
The source code for bin\\Outpost\_Forms.exe is bin\\Outpost\_Forms.js.

### Developing

Source code is stored in [this repository](https://github.com/jmkristian/OutpostForLAARES).
To build it, you'll need
[Git](https://git-scm.com/downloads),
[Node.js](https://nodejs.org/en/download/)
[version 4](https://nodejs.org/download/release/v4.9.1/) (yes that old),
[NSIS](http://nsis.sourceforge.net) version 3 or later
and a bash shell.
The bash shell included with Git for Windows is sufficient.
Don't use a more recent version of Node.js: it will build code that won't run on Windows XP.

Clone this repository and then use bash to run ./build.sh in your clone.

Most improvements to the web user interface will be done in
[pack-it-forms](https://github.com/jmkristian/pack-it-forms/blob/LAARES/README.md)
(not this repository). You can experiment by replacing the pack-it-forms sub-folder
with a clone of the pack-it-forms repository.
When you're done experimenting, release pack-it-forms and then use the new released version here.
That is, commit changes to pack-it-forms, push them to GitHub, release pack-it-forms,
move your experimental pack-it-forms sub-folder out of OutpostForLAARES,
update ./build.sh to refer to the new version of pack-it-forms,
build a new installer, test it,
commit and push changes to GitHub and create a new release including the new installer.

To develop another add-on, create a new setup-(name).nsi file (using setup-LAARES.ini as a model)
and an Addon_Name.launch file in the addons sub-folder.
Add a line into build.sh, to call makensis on the new setup-(name).nsi.
Other configuration files will be generated by bin/Outpost\_Forms.js#installConfigFiles.

The installer source code is setup.nsi, and
the source for most of the installed code is bin/Outpost\_Forms.js.
The installer configures Outpost to execute launch.vbs or (on Windows XP) launch.cmd.
For debugging, you might change the configuration to execute launch-v.cmd instead.
