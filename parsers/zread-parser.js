(function(global) {
    'use strict';

    global.WikiParserRegistry.registerParser('zread', {
        getTitleCandidates() {
            return [];
        },

        findContentRoot() {
            return document.querySelector('#cgx-selectable-wiki') || document.querySelector('article#article-content');
        },

        extractPages(baseUrl, formattedHeadTitle, helpers) {
            const sidebarViewport = document.querySelector('[data-radix-scroll-area-viewport]');
            let linkElements = [];

            if (sidebarViewport) {
                linkElements = sidebarViewport.querySelectorAll('a[href]');
            }

            if (linkElements.length <= 1) {
                const pathMatch = window.location.pathname.match(/^(\/[^/]+\/[^/]+)/);
                if (pathMatch) {
                    const repoPath = pathMatch[1];
                    linkElements = document.querySelectorAll(`a[title][href*="${repoPath}"]`);
                }
            }

            if (linkElements.length <= 1) {
                linkElements = document.querySelectorAll('a[title].block.cursor-pointer.truncate[href]');
            }

            const seen = new Set();
            const pages = [];
            const currentUrlNoHash = window.location.href.split('#')[0];
            const repoMatch = window.location.pathname.match(/^(\/[^/]+\/[^/]+)/);
            const repoPrefix = repoMatch ? repoMatch[1] : '';

            linkElements.forEach(link => {
                const href = link.getAttribute('href');
                const title = (link.getAttribute('title') || '').trim();

                if (!href || !title) return;
                if (!href.includes(repoPrefix)) return;

                const fullUrl = href.startsWith('http') ? href : new URL(href, baseUrl).href;
                if (!fullUrl.includes('zread.ai')) return;

                const slugMatch = fullUrl.match(/zread\.ai\/[^/]+\/[^/]+\/([^/#?]+)/);
                if (!slugMatch) return;
                const slug = slugMatch[1];
                if (slug.match(/\.\w{2,4}$/) && !slug.match(/\.md$/)) return;

                if (fullUrl.includes('feishu.cn') || fullUrl.includes('github.com') ||
                    fullUrl.includes('producthunt') || fullUrl.includes('startupfa.me')) return;

                if (href.startsWith('#') || (href.includes('#') && !href.includes('/') && !href.includes('zread.ai'))) return;

                const key = fullUrl.split('#')[0];
                if (seen.has(key)) return;
                seen.add(key);

                pages.push({
                    url: key,
                    title,
                    selected: key === currentUrlNoHash
                });
            });

            const currentPageTitle =
                document.querySelector('h1')?.textContent?.trim() ||
                document.querySelector('[data-selected="true"]')?.textContent?.trim() ||
                helpers.getPageTitle();

            return {
                success: true,
                pages,
                currentTitle: currentPageTitle,
                baseUrl,
                headTitle: formattedHeadTitle,
                source: 'zread.ai'
            };
        },

        processCustomNode() {
            return null;
        }
    });
})(globalThis);
