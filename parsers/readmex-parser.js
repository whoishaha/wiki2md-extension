(function(global) {
    'use strict';

    global.WikiParserRegistry.registerParser('readmex', {
        getTitleCandidates() {
            const candidates = [];
            const match = window.location.pathname.match(/^\/([^/]+)\/([^/]+)\//);
            if (match) candidates.push(`${match[1]}/${match[2]}`);
            const heading = document.querySelector('main#doc-content-container h1, main h1');
            if (heading?.textContent?.trim()) candidates.push(heading.textContent.trim());
            return candidates;
        },

        findContentRoot() {
            return document.querySelector('main#doc-content-container .prose') ||
                document.querySelector('main#doc-content-container') ||
                document.querySelector('main');
        },

        extractPages(baseUrl, formattedHeadTitle, helpers) {
            const currentUrl = window.location.href.split('#')[0];
            const repoMatch = window.location.pathname.match(/^\/([^/]+)\/([^/]+)/);
            const repoPrefix = repoMatch ? `/${repoMatch[1]}/${repoMatch[2]}/` : '';
            const seen = new Set();
            const pages = [];

            const links = document.querySelectorAll('aside nav a[href], aside a[href]');
            links.forEach(link => {
                const raw = (link.getAttribute('href') || '').trim();
                if (!raw) return;
                const fullUrl = raw.startsWith('http') ? raw : new URL(raw, baseUrl).href;
                if (!fullUrl.includes('readmex.com')) return;

                const path = new URL(fullUrl).pathname;
                if (repoPrefix && !path.startsWith(repoPrefix)) return;

                const title = (link.textContent || '').trim();
                if (!title) return;

                const key = fullUrl.split('#')[0];
                if (seen.has(key)) return;
                seen.add(key);

                pages.push({
                    url: key,
                    title,
                    selected: key === currentUrl
                });
            });

            if (pages.length === 0) {
                pages.push({
                    url: currentUrl,
                    title: helpers.getPageTitle(),
                    selected: true
                });
            }

            return {
                success: true,
                pages,
                currentTitle: helpers.getPageTitle(),
                baseUrl,
                headTitle: formattedHeadTitle,
                source: 'readmex.com'
            };
        },

        processCustomNode(node, helpers) {
            const tag = node.tagName.toLowerCase();

            if (tag === 'pre' && node.querySelector('[data-code-type="mermaid"]')) {
                return '';
            }

            return null;
        }
    });
})(globalThis);
