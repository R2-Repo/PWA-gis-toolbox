(() => {
    if (window.__gisE2eBlobHookInstalled) return;
    window.__gisE2eBlobHookInstalled = true;
    window.__gisE2eBlobTexts = [];
    const origCreate = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
        const url = origCreate(blob);
        if (blob && typeof blob.text === 'function') {
            void blob.text().then((text) => {
                window.__gisE2eBlobTexts.push(text);
            });
        }
        return url;
    };
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
        const href = this.href;
        const name = this.download;
        const ret = origClick.call(this);
        if (name && href && href.startsWith('blob:')) {
            void fetch(href)
                .then((r) => r.text())
                .then((text) => {
                    window.__gisE2eBlobTexts.push(text);
                })
                .catch(() => {});
        }
        return ret;
    };
})();
