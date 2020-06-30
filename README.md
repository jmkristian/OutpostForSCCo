This software augments
[Outpost Packet Message Manager](https://www.outpostpm.org),
adding forms that are used for emergency communication by ARES and RACES
in Santa Clara County, California.
It uses the [add-on interface](http://www.outpostpm.org/docs/Outpost320-AddonUG.pdf)
to Outpost, and a web browser to display and edit forms.

For installation and usage instructions, see the UserGuide.html file in each [release](https://github.com/jmkristian/OutpostForSCCo/releases).

Source code is stored in this repository.
To build it, you'll need
[Git](https://git-scm.com/downloads),
[nvm for Windows](https://github.com/coreybutler/nvm-windows),
[NSIS](http://nsis.sourceforge.net) version 3 or later
and a bash shell.
The bash shell included with Git for Windows is sufficient.

Using [nvm](https://github.com/coreybutler/nvm-windows),
install the 32-bit variant of
[Node.js](https://nodejs.org/en/download/)
[version 4.9.1](https://nodejs.org/download/release/v4.9.1/) (yes that old).
Run "nvm install" from a Windows cmd or PowerShell prompt (not bash).
That old version of Node.js builds code that runs on Windows XP; newer versions don't.

Clone this repository and then use bash to run ./build.sh in your clone.

Most improvements to the web user interface will be done in
[pack-it-forms](https://github.com/jmkristian/pack-it-forms/blob/SCCo.2/README.md)
(not this repository). You can experiment by replacing the pack-it-forms sub-folder
with a clone of the pack-it-forms repository.
When you're done experimenting, release pack-it-forms and then use the new released version here.
That is, commit changes to pack-it-forms, push them to GitHub, release pack-it-forms,
move your experimental pack-it-forms sub-folder out of OutpostForSCCo,
update ./build.sh to refer to the new version of pack-it-forms,
build a new installer, test it,
commit and push changes to GitHub and create a new release including the new installer.

To develop another add-on, create form-*.html files in pack-it-forms.
For guidance, see pack-it-forms/README.md.
Also, create Addon.nsi and Addon.launch files in pack-it-forms/resources/integration/scco,
using Los\_Altos.nsi and Los\_Altos.launch as models.
And add a stanza into build.cmd, to copy the new Addon.nsi and call makensis.
Other configuration files will be generated by bin/Outpost\_Forms.js#installConfigFiles.

If you need to store new forms in a private repository, organize them in parallel with pack-it-forms.
At a minimum, the private repository should contain form-xx.html files,
and a resources/integration/scco folder that contains build.cmd, Addon.nsi and Addon.launch files.
Use the files from pack-it-forms as models.
Pass the name of your private repository to ./build.sh on the command line.

The installer source code is setup.nsi, and
the source for most of the installed code is bin/Outpost\_Forms.js.
The installer configures Outpost to execute launch.vbs.
For debugging, you might change the configuration to execute launch-v.cmd instead.
