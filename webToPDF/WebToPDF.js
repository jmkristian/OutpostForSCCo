const argv = process.argv;
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const footerFontSize = '7pt';

(async function() {
    try {
        const tableStyle =
              `font-size:${footerFontSize};` +
              'border:none;border-collapse:collapse;' +
              'margin-left:0.25in;margin-right:0.25in;width:100%;';
        const options = {
            format: "Letter",
            margin: {top: '0.1in', bottom: '0.5in', left: '0.25in', right: '0.25in'},
            displayHeaderFooter: true,
            headerTemplate: ' ', // no header
            printBackground: true
        };
        const browser = await puppeteer.launch({
            args: ['--disable-gpu'],
            dumpio: true,
            executablePath: path.join(argv[2], 'Chromium-81.0.4044.92', 'chrome.exe'),
            headless: true
        });
        try {
            const page = await browser.newPage();
            if (argv.length >= 4) {
                const pageURL = argv[3];
                await page.goto(pageURL);
                if (argv.length >= 5) {
                    let files = [];
                    for (let a = 4; a < argv.length; ++a) {
                        files.push(argv[a]);
                    }
                    try {
                        await Promise.race([
                            page.waitForSelector('#loading')
                                .then(selected => page.waitForSelector('#loading', {hidden: true})),
                            page.waitForSelector('#something-went-wrong')
                                .then(selected => {throw new Error(`Something went wrong, says ${pageURL}.`);})
                        ])
                    } catch(err) {
                        log(err);
                        // Create just one file, with no copyName.
                        for (let f = 2; f < files.length; f += 2) {
                            fs.unlink(files[f], log);
                        }
                        files = files.slice(0, 1);
                    }
                    for (let f = 0; f < files.length; ++f) {
                        const fileName = files[f];
                        const copyName = files[++f];
                        options.path = path.resolve(fileName);
                        options.footerTemplate = `<table style="${tableStyle}">` +
                            '<tr><td style="text-align:left;padding-left:0;">' +
                            (copyName ? `<b>${copyName}</b> copy` : '') +
                            '</td><td style="text-align:right;padding-right:0;">' +
                            'Page <span class="pageNumber"></span> of <span class="totalPages"></span>' +
                            '</td></tr>' +
                            '</table>',
                        await page.pdf(options);
                    }
                }
            }
        } finally {
            await browser.close();
        }
    } catch(err) {
        log(err);
        process.exitCode = 1;
        // Wait until all promises are fulfilled or rejected, but no more than a few seconds.
        setTimeout(() => {process.exit(1);}, 3000).unref();
    }
})();

function log(data) {
    if (data) {
        const message = (typeof data == 'object') ? errorToMessage(data) : ('' + data);
        console.log('[' + new Date().toISOString() + '] ' + message);
    }
}

function errorToMessage(err) {
    if (err == null) {
        return null;
    } else if (err instanceof Error && err.stack) {
        return err.stack;
    } else if (typeof err == 'string') {
        return err;
    } else {
        return JSON.stringify(err);
    }
}
