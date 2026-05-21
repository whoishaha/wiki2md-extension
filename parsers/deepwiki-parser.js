(function(global) {
    'use strict';

    global.WikiParserRegistry.registerParser('deepwiki', {
        getTitleCandidates() {
            const candidates = [];
            const selected = document.querySelector('.container > div:nth-child(1) a[data-selected="true"]');
            if (selected?.textContent?.trim()) candidates.push(selected.textContent.trim());
            const heading = document.querySelector('.container > div:nth-child(1) h1');
            if (heading?.textContent?.trim()) candidates.push(heading.textContent.trim());
            return candidates;
        },

        findContentRoot() {
            return document.querySelector('.container > div:nth-child(2) .prose') ||
                document.querySelector('.container > div:nth-child(2) .prose-custom') ||
                document.querySelector('.container > div:nth-child(2)') ||
                document.querySelector('main article') ||
                document.querySelector('main');
        },

        extractPages(baseUrl, formattedHeadTitle, helpers) {
            const sidebarLinks = Array.from(document.querySelectorAll('.border-r-border ul li a[href], aside a[href], nav a[href]'));
            const seen = new Set();
            const currentUrlNoHash = window.location.href.split('#')[0];
            const repoMatch = window.location.pathname.match(/^(\/[^/]+\/[^/]+)/);
            const repoPrefix = repoMatch ? repoMatch[1] : '';
            const pages = [];

            sidebarLinks.forEach(link => {
                const href = link.getAttribute('href');
                const title = helpers.cleanTitleText(link.textContent || link.getAttribute('title') || '');
                if (!href || !title || href.startsWith('#')) return;

                const fullUrl = href.startsWith('http') ? href : new URL(href, baseUrl).href;
                if (!fullUrl.includes('deepwiki.com')) return;

                const path = new URL(fullUrl).pathname;
                if (repoPrefix && !path.startsWith(repoPrefix)) return;

                const key = fullUrl.split('#')[0];
                if (seen.has(key)) return;
                seen.add(key);

                pages.push({
                    url: key,
                    title,
                    selected: key === currentUrlNoHash || link.getAttribute('data-selected') === 'true'
                });
            });

            return {
                success: true,
                pages,
                currentTitle: helpers.getPageTitle(),
                baseUrl,
                headTitle: formattedHeadTitle,
                source: 'deepwiki.com'
            };
        },

        processCustomNode() {
            return null;
        }
    });
})(globalThis);
