(function(global) {
    'use strict';

    const parsers = {};

    const platforms = {
        zread: { id: 'zread', label: 'Zread', host: 'zread.ai', source: 'zread.ai' },
        deepwiki: { id: 'deepwiki', label: 'DeepWiki', host: 'deepwiki.com', source: 'deepwiki.com' },
        codewiki: { id: 'codewiki', label: 'Code Wiki', host: 'codewiki.google', source: 'codewiki.google' }
    };

    function detectPlatform(hostname) {
        if ((hostname || '').includes('zread.ai')) return platforms.zread;
        if ((hostname || '').includes('deepwiki.com')) return platforms.deepwiki;
        if ((hostname || '').includes('codewiki.google')) return platforms.codewiki;
        return { id: 'unknown', label: 'Wiki', host: hostname || '', source: hostname || 'unknown' };
    }

    function registerParser(id, parser) {
        parsers[id] = parser;
    }

    function getParser(id) {
        return parsers[id] || null;
    }

    global.WikiParserRegistry = {
        detectPlatform,
        registerParser,
        getParser
    };
})(globalThis);
