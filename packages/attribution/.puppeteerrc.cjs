// memlab depends on puppeteer for its own browser runner, which this package never uses: don't download a browser on install
module.exports = {skipDownload: true};
