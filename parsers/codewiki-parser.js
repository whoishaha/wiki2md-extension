(function(global) {
    'use strict';

    global.WikiParserRegistry.registerParser('codewiki', {
        getTitleCandidates() {
            const candidates = [];
            const heading = document.querySelector('repository-page h1');
            if (heading?.textContent?.trim()) candidates.push(heading.textContent.trim());
            const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href');
            if (canonical) {
                const match = canonical.match(/codewiki\.google\/github\.com\/([^/]+)\/([^/#?]+)/);
                if (match) candidates.push(`${match[1]}/${match[2]}`);
            }
            return candidates;
        },

        findContentRoot() {
            return document.querySelector('code-documentation-article-body-content') ||
                document.querySelector('[data-test-id="documentation-container"] code-documentation-article-body-content') ||
                document.querySelector('[data-test-id="documentation-container"]') ||
                document.querySelector('code-documentation');
        },

        extractPages(baseUrl, formattedHeadTitle, helpers) {
            const currentUrl = window.location.href.split('#')[0];
            const title = helpers.getPageTitle();

            return {
                success: true,
                pages: [{
                    url: currentUrl,
                    title,
                    selected: true
                }],
                currentTitle: title,
                baseUrl,
                headTitle: formattedHeadTitle,
                source: 'codewiki.google'
            };
        },

        processCustomNode(node, helpers) {
            const tag = node.tagName.toLowerCase();

            if (tag === 'code-snippet') {
                return helpers.extractCodeWikiSnippet(node);
            }

            if (tag === 'code-documentation-diagram-inline') {
                return helpers.convertCodeWikiDiagram(node);
            }

            if (tag === 'code-documentation-table') {
                const table = node.querySelector('table');
                return table ? helpers.formatTable(table) : '';
            }

            return null;
        }
    });
})(globalThis);
