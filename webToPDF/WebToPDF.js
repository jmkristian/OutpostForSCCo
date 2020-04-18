const path = require('path');
const puppeteer = require('puppeteer-core');
const argv = process.argv;

const headerFontSize = '7pt';
const chromium = argv[2];

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

function log(data) {
    if (data) {
        const message = (typeof data == 'object') ? errorToMessage(data) : ('' + data);
        console.log('[' + new Date().toISOString() + '] ' + message);
    }
}

(async function() {
    try {
        const tableStyle =
              `font-size:${headerFontSize};` +
              'border:none;border-collapse:collapse;' +
              'margin-left:0.25in;margin-right:0.25in;width:100%;';
        const options = {
            format: "Letter",
            margin: {top: '0.1in', bottom: '0.5in', left: '0.25in', right: '0.25in'},
            displayHeaderFooter: true,
            headerTemplate: ' ',
            printBackground: true
        };
        const browser = await puppeteer.launch({
            executablePath: path.join(chromium, 'chrome.exe'),
            headless: true,
            args: ['--disable-gpu']
        });
        const page = await browser.newPage();
        if (argv.length >= 4) {
            await page.goto(argv[3]);
            await page.waitForSelector('#loading');
            await page.waitForSelector('#loading', {hidden: true});
            for (let a = 4; a < argv.length; ++a) {
                const fileName = argv[a];
                const copyName = argv[++a];
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
        await browser.close();
    } catch(err) {
        log(err);
        setTimeout( // Wait for log output to flush.
            function() {process.exit(1);}, 1000);
    }
})();
