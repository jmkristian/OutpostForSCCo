const resedit = require('resedit');
const fsp = require('../bin/fsp.js');

let fileName = process.argv[2];
let productVersion = process.argv[3];
let productName = process.argv[4];
let fileDescription = process.argv[5];
if (!fileName.toLowerCase().endsWith('.exe')) {
    console.log(fileName + ' is not a .exe');
    process.exitCode = 2;
} else {
    fsp.readFile(fileName).then(function(data) {
        // (the Node.js Buffer instance can be specified directly to NtExecutable.from)
        let exe = resedit.NtExecutable.from(data);
        let res = resedit.NtExecutableResource.from(exe);
        let viList = resedit.Resource.VersionInfo.fromEntries(res.entries);
        // console.log(viList.length + ' versions');

        let parts = productVersion.split('.').map(function(part) {
            return parseInt(part, 10);
        });
        // console.log('version parts: ' + JSON.stringify(parts));
        let versionMS = ((parts[0] || 0) << 16) + (parts[1] || 0);
        let versionLS = ((parts[2] || 0) << 16) + (parts[3] || 0);

        if (viList.length <= 0) {
            viList = [resedit.Resource.VersionInfo.createEmpty()];
        }
        for (var v = 0; v < viList.length; ++v) {
            let vi = viList[v];
            vi.fixedInfo.fileVersionMS = versionMS;
            vi.fixedInfo.fileVersionLS = versionLS;
            vi.fixedInfo.productVersionMS = versionMS;
            vi.fixedInfo.productVersionLS = versionLS;
            let languages = vi.getAllLanguagesForStringValues();
            // console.log(languages.length + ' languages');
            if (languages.length <= 0) {
                languages = [{
                    lang: 0x409, // en_US
                    codepage: 1200, // default
                }];
            }
            for (var t = 0; t < languages.length; ++t) {
                let language = languages[t];
                vi.setStringValues(language, {
                    ProductName: productName,
                    ProductVersion: productVersion,
                    FileDescription: fileDescription,
                    FileVersion: productVersion,
                    LegalCopyright: '2021 by John Kristian',
                    OriginalFilename: '',
                });
            }
            vi.outputToResourceEntries(res.entries);
        }
        res.outputResource(exe);
        return fsp.writeFile(fileName, Buffer.from(exe.generate()));
    }).catch(function(err) {
        console.log(err);
        process.exitCode = 1;
    });
}
