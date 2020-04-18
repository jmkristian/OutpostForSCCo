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
        var message = (typeof data == 'object') ? errorToMessage(data) : ('' + data);
        console.log('[' + new Date().toISOString() + '] ' + message);
    }
}

(async function() {
    try {
        const copyId = argv[5];
        const copyIdHeader = copyId ? `<b>${copyId}</b> copy` : '';
        const tableStyle =
              `font-size:${headerFontSize};` +
              'border:none;border-collapse:collapse;' +
              'margin-left:0.25in;margin-right:0.25in;width:100%;';
        const browser = await puppeteer.launch({
            executablePath: path.join(chromium, 'chrome.exe'),
            headless: true,
            args: ['--disable-gpu']
        });
        const page = await browser.newPage();
        await page.goto(argv[3]);
        await page.waitForSelector('#loading');
        await page.waitForSelector('#loading', {hidden: true});
        await page.pdf({
            format: "Letter",
            margin: {top: '0.1in', bottom: '0.5in', left: '0.25in', right: '0.25in'},
            displayHeaderFooter: true,
            headerTemplate:
            '<span></span>',
/*
            `<table style="${tableStyle}">` +
                '<tr><td style="width:20%;text-align:left;padding-left:0;">' +
                '<span class="date"></span></td> ' +
                '</td><td style="width:60%;text-align:center;">' +
                copyIdHeader +
                '</td><td style="width:20%;text-align:right;padding-right:0;">' +
                'Page <span class="pageNumber"></span>/<span class="totalPages"></span>' +
                '</td></tr>' +
                '</table>',
*/
            footerTemplate:
            `<table style="${tableStyle}">` +
                '<tr><td style="text-align:left;padding-left:0;">' +
                copyIdHeader +
                '</td><td style="text-align:right;padding-right:0;">' +
                'Page <span class="pageNumber"></span>/<span class="totalPages"></span>' +
                '</td></tr>' +
                '</table>',
            printBackground: true,
            path: argv[4]
        });
        await browser.close();
    } catch(err) {
        log(err);
        process.exit(1);
    }
})();
