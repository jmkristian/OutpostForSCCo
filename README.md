This software augments
[Outpost Packet Message Manager](https://www.outpostpm.org),
adding forms that are used for emergency communication by ARES and RACES
in Santa Clara County, California.
It uses the [add-on interface](http://www.outpostpm.org/docs/Outpost320-AddonUG.pdf)
to Outpost, and a web browser to display and edit forms.

For installation and usage instructions, see the UserGuide.html file in each [release](releases).

Source code is stored in this repository.
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
[pack-it-forms](https://github.com/jmkristian/pack-it-forms/blob/SCCo.2/README.md)
(not this repository). You can experiment by replacing the pack-it-forms sub-folder
with a clone of the pack-it-forms repository.
When you're done experimenting, release pack-it-forms and then use the new released version here.
That is, commit changes to pack-it-forms, push them to GitHub, release pack-it-forms,
move your experimental pack-it-forms sub-folder out of OutpostForSCCo,
update ./build.sh to refer to the new version of pack-it-forms,
build a new installer, test it,
commit and push changes to GitHub and create a new release including the new installer.

To develop another add-on, create a new setup-(name).nsi file (using setup-SCCo.nsi as a model)
and an Addon_Name.launch file in the addons sub-folder.
Add a line into build.sh, to call makensis on the new setup-(name).nsi.
Other configuration files will be generated by bin/Outpost\_Forms.js#installConfigFiles.

The installer source code is setup.nsi, and
the source for most of the installed code is bin/Outpost\_Forms.js.
The installer configures Outpost to execute launch.vbs or (on Windows XP) launch.cmd.
For debugging, you might change the configuration to execute launch-v.cmd instead.
