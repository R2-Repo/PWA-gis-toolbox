/** Google Tag Manager / gtag snippet injected only on production release builds. */
export const GTM_HTML_SNIPPET = `    <!-- Google Analytics -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
    <script>
        window.dataLayer = window.dataLayer || [];
        function gtag(){dataLayer.push(arguments);}
        gtag('js', new Date());
        gtag('config', 'G-ZTHRF9QMPV');
    </script>
`;

/**
 * @param {'build' | 'serve'} command
 * @param {string} mode
 * @returns {boolean}
 */
export function shouldInjectGtmHtml(command, mode) {
    return command === 'build' && mode === 'production';
}
