// content.js - wiki2md-extension converter
// Runs on Zread, DeepWiki, and Code Wiki pages to extract content and sidebar links.

(function() {
    'use strict';

    // Notify background that content script is ready
    chrome.runtime.sendMessage({ action: 'contentScriptReady', url: window.location.href }, () => {
        const error = chrome.runtime.lastError;
        if (error && !error.message.includes('Receiving end does not exist')) {
            console.warn('Content script ready notification error:', error.message);
        }
    });

    // Handle incoming messages
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        switch (request.action) {
            case 'convertToMarkdown':
                try {
                    const result = convertPageToMarkdown();
                    sendResponse(result);
                } catch (error) {
                    sendResponse({ success: false, error: error.message });
                }
                break;

            case 'extractAllPages':
                try {
                    const result = extractAllPages();
                    sendResponse(result);
                } catch (error) {
                    sendResponse({ success: false, error: error.message });
                }
                break;

            case 'pageLoaded':
            case 'tabActivated':
                sendResponse({ received: true });
                break;
        }
        return true;
    });

    function getPlatform() {
        return globalThis.WikiParserRegistry.detectPlatform(window.location.hostname);
    }

    function getPlatformParser() {
        return globalThis.WikiParserRegistry.getParser(getPlatform().id);
    }

    function toAbsoluteUrl(href) {
        if (!href) return '';
        const normalized = href.trim().replace(/[\u0000-\u001f\u007f]/g, '');
        if (/^(https?:|mailto:)/i.test(normalized)) return normalized;
        if (normalized.startsWith('#')) return normalized;
        try {
            return new URL(normalized, window.location.origin).href;
        } catch (error) {
            return '';
        }
    }

    function isSafeMarkdownUrl(url, allowHash = true, allowMailto = true) {
        if (!url) return false;
        if (allowHash && url.startsWith('#')) return true;
        try {
            const parsed = new URL(url, window.location.origin);
            const allowedProtocols = allowMailto ? ['http:', 'https:', 'mailto:'] : ['http:', 'https:'];
            return allowedProtocols.includes(parsed.protocol);
        } catch (error) {
            return false;
        }
    }

    function escapeMarkdownText(text) {
        return (text || '').replace(/([\\`*_{}\[\]()#+\-.!|>])/g, '\\$1');
    }

    function escapeYamlString(text) {
        return (text || '')
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\r?\n/g, ' ');
    }

    /**
     * Convert current page to Markdown
     */
    function convertPageToMarkdown() {
        const title = getPageTitle();
        let markdown = extractContent();
        markdown = normalizeMarkdownFences(markdown);
        const url = window.location.href;

        const platform = getPlatform();
        const urlMatch = platform.id === 'zread'
            ? url.match(/zread\.ai\/([^/]+)\/([^/]+)/)
            : platform.id === 'deepwiki'
                ? url.match(/deepwiki\.com\/([^/]+)\/([^/]+)/)
                : url.match(/codewiki\.google\/github\.com\/([^/]+)\/([^/#?]+)/);
        const owner = urlMatch ? urlMatch[1] : '';
        const repo = urlMatch ? urlMatch[2] : '';

        // Build YAML frontmatter
        const frontmatter = [
            '---',
            `title: "${escapeYamlString(title)}"`,
            `source: ${platform.source}`,
            ...(owner ? [`owner: ${owner}`] : []),
            ...(repo ? [`repo: ${repo}`] : []),
            `url: ${url}`,
            '---',
            ''
        ].join('\n');

        const body = `# ${escapeMarkdownText(title)}\n\n${markdown}`;
        const footer = `\n\n---\n*Source: [${url}](${url}) on ${platform.label}*`;

        return {
            success: true,
            markdown: frontmatter + body + footer,
            markdownTitle: title,
            headTitle: cleanHeadTitle(document.title || title),
            repoName: repo,
            owner,
            source: platform.source,
            title: title
        };
    }

    function cleanHeadTitle(text) {
        return (text || '')
            .split('|')[0]
            .replace(/[\/|]/g, '-')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .trim();
    }

    /**
     * Get page title from h1 or document title
     */
    function getPageTitle() {
        const parser = getPlatformParser();
        const candidates = parser?.getTitleCandidates?.({ getPageTitle, cleanTitleText }) || [];

        const h1 = document.querySelector('h1');
        if (h1 && h1.textContent.trim()) {
            // Strip "报告问题" and similar action links from the title text
            const text = h1.textContent.trim();
            candidates.push(text.replace(/报告问题.*$/, '').trim() || text);
        }

        const titleTag = document.querySelector('title');
        if (titleTag) {
            candidates.push(titleTag.textContent.split('|')[0].trim());
        }

        const routeAnnouncer = document.querySelector('next-route-announcer')?.shadowRoot?.querySelector('[aria-live]');
        if (routeAnnouncer?.textContent) {
            candidates.push(routeAnnouncer.textContent.split('|')[0].trim());
        }

        const selectedNav = document.querySelector('[data-selected="true"], a[aria-current="page"]');
        if (selectedNav?.textContent) {
            candidates.push(selectedNav.textContent.trim());
        }

        const title = candidates
            .map(cleanTitleText)
            .find(candidate => candidate && !isUuidLike(candidate));

        if (title) return title;
        return 'Untitled';
    }

    function cleanTitleText(text) {
        return (text || '')
            .replace(/报告问题.*$/, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function isUuidLike(text) {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test((text || '').trim());
    }

    /**
     * Extract the main content as Markdown
     */
    function extractContent() {
        const parser = getPlatformParser();
        if (!parser?.findContentRoot) return '*No content found*';
        const contentElement = parser.findContentRoot();

        if (!contentElement) return '*No content found*';

        // Clone to avoid modifying original DOM
        const clone = contentElement.cloneNode(true);

        // Remove unwanted elements
        removeUnwanted(clone);

        // Remove bottom page navigation (prev/next links)
        const bottomNav = clone.querySelector('.mx-auto.my-12.flex');
        if (bottomNav) bottomNav.remove();

        // Remove "报告问题" (report issue) links
        const reportLinks = clone.querySelectorAll('a[href*="feishu"]');
        reportLinks.forEach(el => el.remove());

        const measurementHost = document.createElement('div');
        measurementHost.style.cssText = 'position:absolute;left:-10000px;top:0;width:1200px;visibility:hidden;pointer-events:none;';
        measurementHost.appendChild(clone);
        document.body.appendChild(measurementHost);
        try {
            return processNode(clone, getPlatform().id);
        } finally {
            measurementHost.remove();
        }
    }

    /**
     * Remove navigation, scripts, and other unwanted elements
     */
    function removeUnwanted(root) {
        const selectors = [
            'script', 'style', 'noscript', 'iframe', 'nav', 'button',
            'footer', 'header',
            '[class*="sidebar"]', '[class*="toc"]', '[class*="menu"]',
            '[class*="nav-"]', '[class*="footer"]', '[class*="header"]',
            '[aria-label*="nav"]', '[role="navigation"]', '[role="nav"]',
            'chat', 'app-footer', 'share-button', '.backdrop',
            // Metadata bar (reading time, level)
            '.text-muted-foreground.mt-2.flex',
            // Lucide icon SVGs within content
            'svg.lucide',
            // "报告问题" link buttons
            'a[href*="feishu"]'
        ];
        selectors.forEach(sel => {
            try {
                root.querySelectorAll(sel).forEach(el => el.remove());
            } catch (e) {
                // Complex selector might fail, ignore
            }
        });

        root.querySelectorAll('[role="button"]').forEach(el => {
            if (hasMermaidContent(el) || el.closest('figure.mermaid, [id$="-mermaid"]')) return;
            el.remove();
        });
    }

    function hasMermaidContent(el) {
        return !!el.querySelector?.('figure.mermaid, [id$="-mermaid"], [id$="-mermaid-svg"], svg[id^="mermaid-"], svg[id$="-mermaid-svg"], svg.flowchart, svg.sequenceDiagram, svg.classDiagram, svg.stateDiagram');
    }

    function findMermaidSvg(container) {
        if (!container) return null;

        const inlineSvg = container.querySelector('svg[id^="mermaid-"], svg[id$="-mermaid-svg"], svg');
        if (inlineSvg) return inlineSvg;

        const mermaidHost = container.matches?.('[id$="-mermaid"]')
            ? container
            : container.querySelector('[id$="-mermaid"]');
        const hostId = mermaidHost?.id;
        if (!hostId) return null;

        const direct = document.getElementById(`${hostId}-svg`);
        if (direct?.tagName?.toLowerCase() === 'svg') return direct;
        const directSvg = direct?.querySelector?.('svg');
        if (directSvg) return directSvg;

        const numericMatch = hostId.match(/^d(\d+)-mermaid$/);
        if (numericMatch) {
            const renderedHolder = document.getElementById(`dd${numericMatch[1]}-mermaid-svg`);
            const renderedSvg = renderedHolder?.querySelector?.('svg');
            if (renderedSvg) return renderedSvg;
        }

        return null;
    }

    function convertFlowchartSvgToMermaidText(svgElement) {
      if (!svgElement) return null;
    
        console.log("Starting flowchart conversion with hierarchical logic...");
      let mermaidCode = "flowchart TD\n\n";
      const nodes = {}; 
      const clusters = {}; 
        const parentMap = {}; // Maps a child SVG ID to its parent SVG ID
        const allElements = {}; // All nodes and clusters, for easy lookup
    
        // 1. Collect all nodes
        svgElement.querySelectorAll('g.node').forEach(nodeEl => {
        const svgId = nodeEl.id;
            if (!svgId) return;
    
            let textContent = "";
            const pElementForText = nodeEl.querySelector('.label foreignObject div > span > p, .label foreignObject div > p');
            if (pElementForText) {
                let rawParts = [];
                pElementForText.childNodes.forEach(child => {
                    if (child.nodeType === Node.TEXT_NODE) rawParts.push(child.textContent);
                    else if (child.nodeName.toUpperCase() === 'BR') rawParts.push('<br>');
                    else if (child.nodeType === Node.ELEMENT_NODE) rawParts.push(child.textContent || '');
                });
                textContent = rawParts.join('').trim().replace(/"/g, '#quot;');
            }
            if (!textContent.trim()) {
                const nodeLabel = nodeEl.querySelector('.nodeLabel, .label, foreignObject span, foreignObject div, text');
                if (nodeLabel && nodeLabel.textContent) {
                    textContent = nodeLabel.textContent.trim().replace(/"/g, '#quot;');
                }
            }
            
            let mermaidId = svgId.replace(/^flowchart-/, '').replace(/-\d+$/, '');
    
            const bbox = nodeEl.getBoundingClientRect();
            if (bbox.width > 0 || bbox.height > 0) {
        nodes[svgId] = { 
                    type: 'node',
          mermaidId: mermaidId, 
          text: textContent, 
                    svgId: svgId,
                    bbox: bbox,
                };
                allElements[svgId] = nodes[svgId];
            }
        });
    
        // 2. Collect all clusters
        svgElement.querySelectorAll('g.cluster').forEach(clusterEl => {
            const svgId = clusterEl.id;
            if (!svgId) return;
    
        let title = "";
            const labelEl = clusterEl.querySelector('.cluster-label, .label');
            if (labelEl && labelEl.textContent) {
                title = labelEl.textContent.trim();
        }
        if (!title) {
              title = svgId;
            }
    
            const rect = clusterEl.querySelector('rect');
            const bbox = rect ? rect.getBoundingClientRect() : clusterEl.getBoundingClientRect();
    
            if (bbox.width > 0 || bbox.height > 0) {
                clusters[svgId] = {
                    type: 'cluster',
                    mermaidId: svgId, // Use stable SVG ID for mermaid ID
          title: title, 
                    svgId: svgId,
                    bbox: bbox,
                };
                allElements[svgId] = clusters[svgId];
            }
        });
    
        // 3. Build hierarchy (parentMap) by checking for geometric containment
        for (const childId in allElements) {
            const child = allElements[childId];
            let potentialParentId = null;
            let minArea = Infinity;
    
            for (const parentId in clusters) {
                if (childId === parentId) continue;
                const parent = clusters[parentId];
    
                if (child.bbox.left >= parent.bbox.left &&
                    child.bbox.right <= parent.bbox.right &&
                    child.bbox.top >= parent.bbox.top &&
                    child.bbox.bottom <= parent.bbox.bottom) {
    
                    const area = parent.bbox.width * parent.bbox.height;
                    if (area < minArea) {
                        minArea = area;
                        potentialParentId = parentId;
                    }
                }
            }
            if (potentialParentId) {
                parentMap[childId] = potentialParentId;
            }
        }
    
        // 4. Process edges and assign to their lowest common ancestor cluster
        const edges = [];
        const edgeLabels = [];
        svgElement.querySelectorAll('g.edgeLabel').forEach(labelEl => {
            const text = getDiagramLabelText(labelEl);
            if (!text) return;

            const transform = labelEl.getAttribute('transform') || '';
            const transformMatch = transform.match(/translate\(([^,\s]+)[,\s]+([^\)]+)\)/);
            if (transformMatch) {
                const point = getSvgPointInScreenSpace(labelEl, parseFloat(transformMatch[1]), parseFloat(transformMatch[2]));
                edgeLabels.push({ text, x: point.x, y: point.y });
                return;
            }

            const bbox = labelEl.getBoundingClientRect();
            if (bbox.width > 0 || bbox.height > 0) {
                edgeLabels.push({
                    text,
                    x: bbox.left + bbox.width / 2,
                    y: bbox.top + bbox.height / 2
                });
            }
        });
      
      svgElement.querySelectorAll('path.flowchart-link').forEach(path => {
            const pathId = path.id;
        if (!pathId) return;
        
        let sourceNode = null;
        let targetNode = null;
            let idParts = pathId.replace(/^(L_|FL_)/, '').split('_');
            if(idParts.length > 1 && idParts[idParts.length-1].match(/^\d+$/)){
                idParts.pop();
            }
            idParts = idParts.join('_');
    
            for (let i = 1; i < idParts.length; i++) {
                const potentialSourceName = idParts.substring(0,i);
                const potentialTargetName = idParts.substring(i);
                 const foundSourceNode = Object.values(nodes).find(n => n.mermaidId === potentialSourceName);
                 const foundTargetNode = Object.values(nodes).find(n => n.mermaidId === potentialTargetName);
                 if(foundSourceNode && foundTargetNode){
                     sourceNode = foundSourceNode;
                     targetNode = foundTargetNode;
                     break;
                 }
            }
            
             if (!sourceNode || !targetNode) { // Fallback for complex names
                const pathIdParts = pathId.replace(/^(L_|FL_)/, '').split('_');
                if(pathIdParts.length > 2){
                     for (let i = 1; i < pathIdParts.length; i++) {
                        const sName = pathIdParts.slice(0, i).join('_');
                        const tName = pathIdParts.slice(i, pathIdParts.length -1).join('_');
                        const foundSourceNode = Object.values(nodes).find(n => n.mermaidId === sName);
                        const foundTargetNode = Object.values(nodes).find(n => n.mermaidId === tName);
                         if(foundSourceNode && foundTargetNode){
                             sourceNode = foundSourceNode;
                             targetNode = foundTargetNode;
              break;
                         }
                    }
                }
            }
    
            if (!sourceNode || !targetNode) {
                console.warn("Could not determine source/target for edge:", pathId);
                return;
            }
    
            let label = "";
            try {
                const totalLength = path.getTotalLength();
                if (totalLength > 0) {
                    const midPoint = path.getPointAtLength(totalLength / 2);
                    let labelPoint = { x: midPoint.x, y: midPoint.y };
                    const screenCtm = path.getScreenCTM?.();
                    if (screenCtm && typeof DOMPoint !== 'undefined') {
                        labelPoint = new DOMPoint(midPoint.x, midPoint.y).matrixTransform(screenCtm);
                    } else {
                        const pathBox = path.getBoundingClientRect();
                        if (pathBox.width > 0 || pathBox.height > 0) {
                            labelPoint = {
                                x: pathBox.left + pathBox.width / 2,
                                y: pathBox.top + pathBox.height / 2
                            };
                        }
                    }
            let closestLabel = null;
            let closestDist = Infinity;
                    for (const currentLabel of edgeLabels) {
                        const dist = Math.sqrt(Math.pow(currentLabel.x - labelPoint.x, 2) + Math.pow(currentLabel.y - labelPoint.y, 2));
              if (dist < closestDist) {
                closestDist = dist;
                            closestLabel = currentLabel;
              }
            }
                    if (closestLabel && closestDist < 75) {
              label = closestLabel.text;
            }
          }
            } catch (e) {
                console.error("Error matching label for edge " + pathId, e);
            }
            
            const labelPart = label ? `|"${label}"|` : "";
        const edgeText = `${sourceNode.mermaidId} -->${labelPart} ${targetNode.mermaidId}`;
        
            // Find Lowest Common Ancestor
            const sourceAncestors = [parentMap[sourceNode.svgId]];
            while (sourceAncestors[sourceAncestors.length - 1]) {
                sourceAncestors.push(parentMap[sourceAncestors[sourceAncestors.length - 1]]);
            }
            let lca = parentMap[targetNode.svgId];
            while (lca && !sourceAncestors.includes(lca)) {
                lca = parentMap[lca];
            }
            
            edges.push({ text: edgeText, parentId: lca || 'root' });
        });
        
        // 5. Generate Mermaid output
        const definedNodeMermaidIds = new Set();
      for (const svgId in nodes) {
        const node = nodes[svgId];
            if (!definedNodeMermaidIds.has(node.mermaidId)) {
          mermaidCode += `${node.mermaidId}["${node.text}"]\n`;
                definedNodeMermaidIds.add(node.mermaidId);
            }
        }
        mermaidCode += '\n';
        
        // Group children and edges by parent
        const childrenMap = {};
        const edgeMap = {};
    
        for (const childId in parentMap) {
            const parentId = parentMap[childId];
            if (!childrenMap[parentId]) childrenMap[parentId] = [];
            childrenMap[parentId].push(childId);
        }
        
        edges.forEach(edge => {
            const parentId = edge.parentId || 'root';
            if (!edgeMap[parentId]) edgeMap[parentId] = [];
            edgeMap[parentId].push(edge.text);
        });
        
        // Add top-level edges
        (edgeMap['root'] || []).forEach(edgeText => {
            mermaidCode += `${edgeText}\n`;
        });
    
        function buildSubgraphOutput(clusterId) {
            const cluster = clusters[clusterId];
            if (!cluster) return;
    
            mermaidCode += `\nsubgraph ${cluster.mermaidId} ["${cluster.title}"]\n`;
            
            const childItems = childrenMap[clusterId] || [];
            
            // Render nodes within this subgraph
            childItems.filter(id => nodes[id]).forEach(nodeId => {
                mermaidCode += `    ${nodes[nodeId].mermaidId}\n`;
            });
            
            // Render edges within this subgraph
            (edgeMap[clusterId] || []).forEach(edgeText => {
                mermaidCode += `    ${edgeText}\n`;
            });
            
            // Render nested subgraphs
            childItems.filter(id => clusters[id]).forEach(subClusterId => {
                buildSubgraphOutput(subClusterId);
            });
            
            mermaidCode += "end\n";
        }
    
        const topLevelClusters = Object.keys(clusters).filter(id => !parentMap[id]);
        topLevelClusters.forEach(buildSubgraphOutput);
      
      if (Object.keys(nodes).length === 0 && Object.keys(clusters).length === 0) return null;
      return '```mermaid\n' + mermaidCode.trim() + '\n```';
    }

    function getSvgPointInScreenSpace(svgChild, x, y) {
        const ownerSvg = svgChild.ownerSVGElement || svgChild.closest?.('svg');
        const screenCtm = ownerSvg?.getScreenCTM?.();
        if (screenCtm && typeof DOMPoint !== 'undefined') {
            return new DOMPoint(x, y).matrixTransform(screenCtm);
        }
        return { x, y };
    }

    function getDiagramLabelText(labelEl) {
        const p = labelEl.querySelector?.('p');
        if (!p) return labelEl.textContent?.trim() || '';

        const parts = [];
        p.childNodes.forEach(child => {
            if (child.nodeType === Node.TEXT_NODE) {
                parts.push(child.textContent || '');
            } else if (child.nodeName?.toUpperCase() === 'BR') {
                parts.push('<br>');
            } else if (child.textContent) {
                parts.push(child.textContent);
            }
        });
        return parts.join('').replace(/"/g, '#quot;').trim();
    }
    
    // Function for Class Diagram (ensure this exists from previous responses)
    function convertClassDiagramSvgToMermaidText(svgElement) {
      if (!svgElement) return null;
      const mermaidLines = ['classDiagram'];
      const classData = {}; 
    
      // 1. Parse Classes and their geometric information
      svgElement.querySelectorAll('g.node.default[id^="classId-"]').forEach(node => {
        const classIdSvg = node.getAttribute('id'); 
        if (!classIdSvg) return;
        
        const classNameMatch = classIdSvg.match(/^classId-([^-]+(?:-[^-]+)*)-(\d+)$/);
        if (!classNameMatch) return;
        const className = classNameMatch[1];
    
        let cx = 0, cy = 0, halfWidth = 0, halfHeight = 0;
        const transform = node.getAttribute('transform');
        if (transform) {
          const match = transform.match(/translate\(([^,]+),\s*([^)]+)\)/);
          if (match) {
            cx = parseFloat(match[1]);
            cy = parseFloat(match[2]);
          }
        }
        const pathForBounds = node.querySelector('g.basic.label-container > path[d^="M-"]');
        if (pathForBounds) {
          const d = pathForBounds.getAttribute('d');
          const dMatch = d.match(/M-([0-9.]+)\s+-([0-9.]+)/); // Extracts W and H from M-W -H
          if (dMatch && dMatch.length >= 3) {
            halfWidth = parseFloat(dMatch[1]);
            halfHeight = parseFloat(dMatch[2]);
          }
        }
    
        if (!classData[className]) {
            classData[className] = { 
                stereotype: "", 
                members: [], 
                methods: [], 
                svgId: classIdSvg, 
                x: cx, 
                y: cy, 
                width: halfWidth * 2, 
                height: halfHeight * 2 
            };
        }
        const stereotypeElem = node.querySelector('g.annotation-group.text foreignObject span.nodeLabel p, g.annotation-group.text foreignObject div p');
        if (stereotypeElem && stereotypeElem.textContent.trim()) {
            classData[className].stereotype = stereotypeElem.textContent.trim();
        }
        node.querySelectorAll('g.members-group.text g.label foreignObject span.nodeLabel p, g.members-group.text g.label foreignObject div p').forEach(m => {
          const txt = m.textContent.trim();
          if (txt) classData[className].members.push(txt);
        });
        node.querySelectorAll('g.methods-group.text g.label foreignObject span.nodeLabel p, g.methods-group.text g.label foreignObject div p').forEach(m => {
          const txt = m.textContent.trim();
          if (txt) classData[className].methods.push(txt);
        });
      });
    
      // 2. Parse Notes
      const notes = [];
      
      // Method 1: Find traditional rect.note and text.noteText
      svgElement.querySelectorAll('g').forEach(g => {
        const noteRect = g.querySelector('rect.note');
        const noteText = g.querySelector('text.noteText');
        
        if (noteRect && noteText) {
          const text = noteText.textContent.trim();
          const x = parseFloat(noteRect.getAttribute('x'));
          const y = parseFloat(noteRect.getAttribute('y'));
          const width = parseFloat(noteRect.getAttribute('width'));
          const height = parseFloat(noteRect.getAttribute('height'));
          
          if (text && !isNaN(x) && !isNaN(y)) {
            notes.push({
              text: text,
              x: x,
              y: y,
              width: width || 0,
              height: height || 0,
              id: g.id || `note_${notes.length}`
            });
          }
        }
      });
      
      // Method 2: Find other note formats (like node undefined type)
      svgElement.querySelectorAll('g.node.undefined, g[id^="note"]').forEach(g => {
        // Check if it's a note (by background color, id or other features)
        const hasNoteBackground = g.querySelector('path[fill="#fff5ad"], path[style*="#fff5ad"], path[style*="fill:#fff5ad"]');
        const isNoteId = g.id && g.id.includes('note');
        
        if (hasNoteBackground || isNoteId) {
          // Try to get text from foreignObject
          let text = '';
          const foreignObject = g.querySelector('foreignObject');
          if (foreignObject) {
            const textEl = foreignObject.querySelector('p, span.nodeLabel, .nodeLabel');
            if (textEl) {
              text = textEl.textContent.trim();
            }
          }
          
          // If no text found, try other selectors
          if (!text) {
            const textEl = g.querySelector('text, .label text, tspan');
            if (textEl) {
              text = textEl.textContent.trim();
            }
          }
          
          if (text) {
            // Get position information
            const transform = g.getAttribute('transform');
            let x = 0, y = 0;
            if (transform) {
              const match = transform.match(/translate\(([^,]+),\s*([^)]+)\)/);
              if (match) {
                x = parseFloat(match[1]);
                y = parseFloat(match[2]);
              }
            }
            
            // Check if this note has already been added
            const existingNote = notes.find(n => n.text === text && Math.abs(n.x - x) < 10 && Math.abs(n.y - y) < 10);
            if (!existingNote) {
              notes.push({
                text: text,
                x: x,
                y: y,
                width: 0,
                height: 0,
                id: g.id || `note_${notes.length}`
              });
            }
          }
        }
      });
    
      // 3. Parse Note-to-Class Connections
      const noteTargets = {}; // Maps note.id to target className
      const connectionThreshold = 50; // Increase connection threshold
    
      // Find note connection paths, support multiple path types
      const noteConnections = [
        ...svgElement.querySelectorAll('path.relation.edge-pattern-dotted'),
        ...svgElement.querySelectorAll('path[id^="edgeNote"]'),
        ...svgElement.querySelectorAll('path.edge-thickness-normal.edge-pattern-dotted')
      ];
      
      noteConnections.forEach(pathEl => {
        const dAttr = pathEl.getAttribute('d');
        if (!dAttr) return;
    
        // Improved path parsing, support Bezier curves
        const pathPoints = [];
        
        // Parse various path commands
        const commands = dAttr.match(/[A-Za-z][^A-Za-z]*/g) || [];
        let currentX = 0, currentY = 0;
        
        commands.forEach(cmd => {
          const parts = cmd.match(/[A-Za-z]|[-+]?\d*\.?\d+/g) || [];
          const type = parts[0];
          const coords = parts.slice(1).map(Number);
          
          switch(type.toUpperCase()) {
            case 'M': // Move to
              if (coords.length >= 2) {
                currentX = coords[0];
                currentY = coords[1];
                pathPoints.push({x: currentX, y: currentY});
              }
              break;
            case 'L': // Line to
              for (let i = 0; i < coords.length; i += 2) {
                if (coords[i+1] !== undefined) {
                  currentX = coords[i];
                  currentY = coords[i+1];
                  pathPoints.push({x: currentX, y: currentY});
                }
              }
              break;
            case 'C': // Cubic bezier
              for (let i = 0; i < coords.length; i += 6) {
                if (coords[i+5] !== undefined) {
                  // Get end point coordinates
                  currentX = coords[i+4];
                  currentY = coords[i+5];
                  pathPoints.push({x: currentX, y: currentY});
                }
              }
              break;
            case 'Q': // Quadratic bezier
              for (let i = 0; i < coords.length; i += 4) {
                if (coords[i+3] !== undefined) {
                  currentX = coords[i+2];
                  currentY = coords[i+3];
                  pathPoints.push({x: currentX, y: currentY});
                }
              }
              break;
          }
        });
    
        if (pathPoints.length < 2) return;
        
        const pathStart = pathPoints[0];
        const pathEnd = pathPoints[pathPoints.length - 1];
    
        // Find the closest note to path start point
        let closestNote = null;
        let minDistToNote = Infinity;
        notes.forEach(note => {
          const dist = Math.sqrt(Math.pow(note.x - pathStart.x, 2) + Math.pow(note.y - pathStart.y, 2));
          if (dist < minDistToNote) {
            minDistToNote = dist;
            closestNote = note;
          }
        });
    
        // Find the closest class to path end point
        let targetClassName = null;
        let minDistToClass = Infinity;
        for (const currentClassName in classData) {
          const classInfo = classData[currentClassName];
          const classCenterX = classInfo.x;
          const classCenterY = classInfo.y;
          const classWidth = classInfo.width || 200; // Default width
          const classHeight = classInfo.height || 200; // Default height
    
          // Calculate distance from path end to class center
          const distToCenter = Math.sqrt(
            Math.pow(pathEnd.x - classCenterX, 2) + 
            Math.pow(pathEnd.y - classCenterY, 2)
          );
    
          // Also calculate distance to class boundary
          const classLeft = classCenterX - classWidth/2;
          const classRight = classCenterX + classWidth/2;
          const classTop = classCenterY - classHeight/2;
          const classBottom = classCenterY + classHeight/2;
          
          const dx = Math.max(classLeft - pathEnd.x, 0, pathEnd.x - classRight);
          const dy = Math.max(classTop - pathEnd.y, 0, pathEnd.y - classBottom);
          const distToEdge = Math.sqrt(dx*dx + dy*dy);
    
          // Use the smaller distance as the judgment criterion
          const finalDist = Math.min(distToCenter, distToEdge + classWidth/4);
          
          if (finalDist < minDistToClass) {
            minDistToClass = finalDist;
            targetClassName = currentClassName;
          }
        }
        
        // Relax connection conditions
        if (closestNote && targetClassName && 
            minDistToNote < connectionThreshold && 
            minDistToClass < connectionThreshold * 2) {
          
          const existing = noteTargets[closestNote.id];
          const currentScore = minDistToNote + minDistToClass;
          
          if (!existing || currentScore < existing.score) {
            noteTargets[closestNote.id] = { 
              name: targetClassName, 
              score: currentScore,
              noteDistance: minDistToNote,
              classDistance: minDistToClass
            };
          }
        }
      });
    
      // 4. Add Note Definitions to Mermaid output
      const noteMermaidLines = [];
      notes.forEach(note => {
        const targetInfo = noteTargets[note.id];
        if (targetInfo && targetInfo.name) {
          noteMermaidLines.push(`    note for ${targetInfo.name} "${note.text}"`);
        } else {
          noteMermaidLines.push(`    note "${note.text}"`);
        }
      });
      // Insert notes after 'classDiagram' line
      if (noteMermaidLines.length > 0) {
        mermaidLines.splice(1, 0, ...noteMermaidLines);
      }
      
      // 5. Add Class Definitions
      for (const className in classData) {
        const data = classData[className];
        if (data.stereotype) {
            mermaidLines.push(`    class ${className} {`);
            mermaidLines.push(`        ${data.stereotype}`);
        } else {
            mermaidLines.push(`    class ${className} {`);
        }
        data.members.forEach(member => { mermaidLines.push(`        ${member}`); });
        data.methods.forEach(method => { mermaidLines.push(`        ${method}`); });
        mermaidLines.push('    }');
      }
    
      const pathElements = Array.from(svgElement.querySelectorAll('path.relation[id^="id_"]'));
      const labelElements = Array.from(svgElement.querySelectorAll('g.edgeLabels .edgeLabel foreignObject p'));
    
      pathElements.forEach((path, index) => {
        const id = path.getAttribute('id'); 
        if (!id || !id.startsWith('id_')) return;
    
        // Remove 'id_' prefix and trailing number (e.g., '_1')
        let namePart = id.substring(3).replace(/_\d+$/, '');
    
        const idParts = namePart.split('_');
        let fromClass = null;
        let toClass = null;
    
        // Iterate through possible split points to find valid class names
        for (let i = 1; i < idParts.length; i++) {
            const potentialFrom = idParts.slice(0, i).join('_');
            const potentialTo = idParts.slice(i).join('_');
            
            if (classData[potentialFrom] && classData[potentialTo]) {
                fromClass = potentialFrom;
                toClass = potentialTo;
                break; // Found a valid pair
            }
        }
    
        if (!fromClass || !toClass) {
            console.error("Could not parse class relation from ID:", id);
            return; // Skip if we couldn't parse
        }
        
        // Get key attributes
        const markerEndAttr = path.getAttribute('marker-end') || "";
        const markerStartAttr = path.getAttribute('marker-start') || "";
        const pathClass = path.getAttribute('class') || "";
        
        // Determine line style: solid or dashed
        const isDashed = path.classList.contains('dashed-line') || 
                         path.classList.contains('dotted-line') || 
                         pathClass.includes('dashed') || 
                         pathClass.includes('dotted');
        const lineStyle = isDashed ? ".." : "--";
        
        let relationshipType = "";
        
        // Inheritance relation: <|-- or --|> (corrected inheritance relationship judgment)
        if (markerStartAttr.includes('extensionStart')) { 
            // marker-start has extension, arrow at start point, means: toClass inherits fromClass
            if (isDashed) {
                // Dashed inheritance (implementation relationship): fromClass <|.. toClass
                relationshipType = `${fromClass} <|.. ${toClass}`;
            } else {
                // Solid inheritance: fromClass <|-- toClass
            relationshipType = `${fromClass} <|${lineStyle} ${toClass}`;
        } 
        } 
        else if (markerEndAttr.includes('extensionEnd')) { 
            // marker-end has extension, arrow at end point, means: fromClass inherits toClass
            if (isDashed) {
                // Dashed inheritance (implementation relationship): toClass <|.. fromClass
                relationshipType = `${toClass} <|.. ${fromClass}`;
            } else {
                // Solid inheritance: toClass <|-- fromClass
                relationshipType = `${toClass} <|${lineStyle} ${fromClass}`;
            }
        }
        // Implementation relation: ..|> (corrected implementation relationship judgment)
        else if (markerStartAttr.includes('lollipopStart') || markerStartAttr.includes('implementStart')) {
            relationshipType = `${toClass} ..|> ${fromClass}`;
        }
        else if (markerEndAttr.includes('implementEnd') || markerEndAttr.includes('lollipopEnd') || 
                 (markerEndAttr.includes('interfaceEnd') && isDashed)) {
            relationshipType = `${fromClass} ..|> ${toClass}`;
        }
        // Composition relation: *-- (corrected composition relationship judgment)
        else if (markerStartAttr.includes('compositionStart')) {
            // marker-start has composition, diamond at start point, means: fromClass *-- toClass
            relationshipType = `${fromClass} *${lineStyle} ${toClass}`;
        }
        else if (markerEndAttr.includes('compositionEnd') || 
                 markerEndAttr.includes('diamondEnd') && markerEndAttr.includes('filled')) { 
            relationshipType = `${toClass} *${lineStyle} ${fromClass}`;
        } 
        // Aggregation relation: o-- (corrected aggregation relationship judgment)
        else if (markerStartAttr.includes('aggregationStart')) {
            // marker-start has aggregation, empty diamond at start point, means: toClass --o fromClass
            relationshipType = `${toClass} ${lineStyle}o ${fromClass}`;
        }
        else if (markerEndAttr.includes('aggregationEnd') || 
                 markerEndAttr.includes('diamondEnd') && !markerEndAttr.includes('filled')) { 
            relationshipType = `${fromClass} o${lineStyle} ${toClass}`;
        } 
        // Dependency relation: ..> or --> (corrected dependency relationship judgment)
        else if (markerStartAttr.includes('dependencyStart')) {
            if (isDashed) {
            relationshipType = `${toClass} <.. ${fromClass}`;
            } else {
                relationshipType = `${toClass} <-- ${fromClass}`;
        }
        }
        else if (markerEndAttr.includes('dependencyEnd')) { 
            if (isDashed) {
            relationshipType = `${fromClass} ..> ${toClass}`;
            } else {
                relationshipType = `${fromClass} --> ${toClass}`;
        }
        }
        // Association relation: --> (corrected association relationship judgment)
        else if (markerStartAttr.includes('arrowStart') || markerStartAttr.includes('openStart')) {
            relationshipType = `${toClass} <${lineStyle} ${fromClass}`;
        }
        else if (markerEndAttr.includes('arrowEnd') || markerEndAttr.includes('openEnd')) { 
            relationshipType = `${fromClass} ${lineStyle}> ${toClass}`;
        }
        // Arrowless solid line link: --
        else if (lineStyle === "--" && !markerEndAttr.includes('End') && !markerStartAttr.includes('Start')) { 
            relationshipType = `${fromClass} -- ${toClass}`;
        }
        // Arrowless dashed line link: ..
        else if (lineStyle === ".." && !markerEndAttr.includes('End') && !markerStartAttr.includes('Start')) {
            relationshipType = `${fromClass} .. ${toClass}`;
        }
        // Default relation
        else {
            relationshipType = `${fromClass} ${lineStyle} ${toClass}`;
        }
        
        // Get relationship label text
        const labelText = (labelElements[index] && labelElements[index].textContent) ? 
                           labelElements[index].textContent.trim() : "";
        
        if (relationshipType) {
            mermaidLines.push(`    ${relationshipType}${labelText ? ' : ' + labelText : ''}`);
        }
      });
    
      if (mermaidLines.length <= 1 && Object.keys(classData).length === 0 && notes.length === 0) return null;
      return '```mermaid\n' + mermaidLines.join('\n') + '\n```';
    }
    
    /**
     * Helper: Convert SVG Sequence Diagram to Mermaid code
     * @param {SVGElement} svgElement - The SVG DOM element for the sequence diagram
     * @returns {string|null}
     */
    function convertSequenceDiagramSvgToMermaidText(svgElement) {
        if (!svgElement) return null;
    
        // 1. Parse participants 
        const participants = [];
        console.log("Looking for sequence participants..."); // DEBUG
        
        // Find all participant text elements
        svgElement.querySelectorAll('text.actor-box').forEach((textEl) => {
            const name = textEl.textContent.trim().replace(/^"|"$/g, ''); // Remove quotes
            const x = parseFloat(textEl.getAttribute('x'));
            console.log("Found participant:", name, "at x:", x); // DEBUG
            if (name && !isNaN(x)) {
                participants.push({ name, x });
            }
        });
        
        console.log("Total participants found:", participants.length); // DEBUG
        participants.sort((a, b) => a.x - b.x);
        
        // Remove duplicate participants
        const uniqueParticipants = [];
        const seenNames = new Set();
        participants.forEach(p => {
            if (!seenNames.has(p.name)) {
                uniqueParticipants.push(p);
                seenNames.add(p.name);
            }
        });
    
        // 2. Parse Notes
        const notes = [];
        svgElement.querySelectorAll('g').forEach(g => {
            const noteRect = g.querySelector('rect.note');
            const noteText = g.querySelector('text.noteText');
            
            if (noteRect && noteText) {
                const text = noteText.textContent.trim();
                const x = parseFloat(noteRect.getAttribute('x'));
                const width = parseFloat(noteRect.getAttribute('width'));
                const leftX = x;
                const rightX = x + width;
                
                // Find all participants within note coverage range
                const coveredParticipants = [];
                uniqueParticipants.forEach(p => {
                    // Check if participant is within note's horizontal range
                    if (p.x >= leftX && p.x <= rightX) {
                        coveredParticipants.push(p);
                    }
                });
                
                // Sort by x coordinate
                coveredParticipants.sort((a, b) => a.x - b.x);
                
                if (coveredParticipants.length > 0) {
                    let noteTarget;
                    if (coveredParticipants.length === 1) {
                        // Single participant
                        noteTarget = coveredParticipants[0].name;
                    } else {
                        // Multiple participants, use first and last
                        const firstParticipant = coveredParticipants[0].name;
                        const lastParticipant = coveredParticipants[coveredParticipants.length - 1].name;
                        noteTarget = `${firstParticipant},${lastParticipant}`;
                    }
                    
                    notes.push({
                        text: text,
                        target: noteTarget,
                        y: parseFloat(noteRect.getAttribute('y'))
                    });
                }
            }
        });
        
        // 3. Parse message lines and message text
        const messages = [];
        
        // Collect all message texts
        const messageTexts = [];
        svgElement.querySelectorAll('text.messageText').forEach(textEl => {
            const text = textEl.textContent.trim();
            const y = parseFloat(textEl.getAttribute('y'));
            const x = parseFloat(textEl.getAttribute('x'));
            if (text && !isNaN(y)) {
                messageTexts.push({ text, y, x });
            }
        });
        messageTexts.sort((a, b) => a.y - b.y);
        console.log("Found message texts:", messageTexts.length); // DEBUG
        
        // Collect all message lines
        const messageLines = [];
        svgElement.querySelectorAll('line.messageLine0, line.messageLine1').forEach(lineEl => {
            const x1 = parseFloat(lineEl.getAttribute('x1'));
            const y1 = parseFloat(lineEl.getAttribute('y1'));
            const x2 = parseFloat(lineEl.getAttribute('x2'));
            const y2 = parseFloat(lineEl.getAttribute('y2'));
            const isDashed = lineEl.classList.contains('messageLine1');
            
            if (!isNaN(x1) && !isNaN(y1) && !isNaN(x2) && !isNaN(y2)) {
                messageLines.push({ x1, y1, x2, y2, isDashed });
            }
        });
        
        // Collect all curved message paths (self messages)
        svgElement.querySelectorAll('path.messageLine0, path.messageLine1').forEach(pathEl => {
            const d = pathEl.getAttribute('d');
            const isDashed = pathEl.classList.contains('messageLine1');
            
            if (d) {
                // Parse path, check if it's a self message
                const moveMatch = d.match(/M\s*([^,\s]+)[,\s]+([^,\s]+)/);
                const endMatch = d.match(/([^,\s]+)[,\s]+([^,\s]+)$/);
                
                if (moveMatch && endMatch) {
                    const x1 = parseFloat(moveMatch[1]);
                    const y1 = parseFloat(moveMatch[2]);
                    const x2 = parseFloat(endMatch[1]);
                    const y2 = parseFloat(endMatch[2]);
                    
                    // Check if it's a self message (start and end x coordinates are close)
                    if (Math.abs(x1 - x2) < 20) { // Allow some margin of error
                        messageLines.push({ 
                            x1, y1, x2, y2, isDashed, 
                            isSelfMessage: true 
                        });
                    }
                }
            }
        });
        
        messageLines.sort((a, b) => a.y1 - b.y1);
        console.log("Found message lines:", messageLines.length); // DEBUG
        
        // 4. Match message lines and message text
        for (let i = 0; i < Math.min(messageLines.length, messageTexts.length); i++) {
            const line = messageLines[i];
            const messageText = messageTexts[i];
            
            let fromParticipant = null;
            let toParticipant = null;
            
            if (line.isSelfMessage) {
                // Self message - find participant closest to x1
                let minDist = Infinity;
                for (const p of uniqueParticipants) {
                    const dist = Math.abs(p.x - line.x1);
                    if (dist < minDist) {
                        minDist = dist;
                        fromParticipant = toParticipant = p.name;
                    }
                }
            } else {
                // Find sender and receiver based on x coordinates
                let minDist1 = Infinity;
                for (const p of uniqueParticipants) {
                    const dist = Math.abs(p.x - line.x1);
                    if (dist < minDist1) {
                        minDist1 = dist;
                        fromParticipant = p.name;
                    }
                }
                
                let minDist2 = Infinity;
                for (const p of uniqueParticipants) {
                    const dist = Math.abs(p.x - line.x2);
                    if (dist < minDist2) {
                        minDist2 = dist;
                        toParticipant = p.name;
                    }
                }
            }
            
            if (fromParticipant && toParticipant) {
                // Determine arrow type
                let arrow;
                if (line.isDashed) {
                    arrow = '-->>'; // Dashed arrow
                } else {
                    arrow = '->>'; // Solid arrow
                }
                
                messages.push({
                    from: fromParticipant,
                    to: toParticipant,
                    text: messageText.text,
                    arrow: arrow,
                    y: line.y1,
                    isSelfMessage: line.isSelfMessage || false
                });
                
                console.log(`Message ${i + 1}: ${fromParticipant} ${arrow} ${toParticipant}: ${messageText.text}`); // DEBUG
            }
        }
    
        // 5. Parse loop areas
        const loops = [];
        const loopLines = svgElement.querySelectorAll('line.loopLine');
        if (loopLines.length >= 4) {
            const xs = Array.from(loopLines).map(line => [
                parseFloat(line.getAttribute('x1')),
                parseFloat(line.getAttribute('x2'))
            ]).flat();
            const ys = Array.from(loopLines).map(line => [
                parseFloat(line.getAttribute('y1')),
                parseFloat(line.getAttribute('y2'))
            ]).flat();
            
            const xMin = Math.min(...xs);
            const xMax = Math.max(...xs);
            const yMin = Math.min(...ys);
            const yMax = Math.max(...ys);
            
            let loopText = '';
            const loopTextEl = svgElement.querySelector('.loopText');
            if (loopTextEl) {
                loopText = loopTextEl.textContent.trim();
            }
            
            loops.push({ xMin, xMax, yMin, yMax, text: loopText });
            console.log("Found loop:", loopText, "from y", yMin, "to", yMax); // DEBUG
        }
    
        // 6. Generate Mermaid code
        let mermaidOutput = "sequenceDiagram\n";
        
        // Add participants
        uniqueParticipants.forEach(p => {
            mermaidOutput += `  participant ${p.name}\n`;
        });
        mermaidOutput += "\n";
    
        // Sort all events by y coordinate (messages, notes, loops)
        const events = [];
        
        messages.forEach(msg => {
            events.push({ type: 'message', y: msg.y, data: msg });
        });
        
        notes.forEach(note => {
            events.push({ type: 'note', y: note.y, data: note });
        });
        
        loops.forEach(loop => {
            events.push({ type: 'loop_start', y: loop.yMin - 1, data: loop });
            events.push({ type: 'loop_end', y: loop.yMax + 1, data: loop });
        });
        
        events.sort((a, b) => a.y - b.y);
        
        // Generate events
        let loopStack = [];
        events.forEach(event => {
            if (event.type === 'loop_start') {
                const text = event.data.text ? ` ${event.data.text}` : '';
                mermaidOutput += `  loop${text}\n`;
                loopStack.push(event.data);
            } else if (event.type === 'loop_end') {
                if (loopStack.length > 0) {
                    mermaidOutput += `  end\n`;
                    loopStack.pop();
                }
            } else if (event.type === 'note') {
                const indent = loopStack.length > 0 ? '  ' : '';
                mermaidOutput += `${indent}  note over ${event.data.target}: ${event.data.text}\n`;
            } else if (event.type === 'message') {
                const indent = loopStack.length > 0 ? '  ' : '';
                const msg = event.data;
                mermaidOutput += `${indent}  ${msg.from}${msg.arrow}${msg.to}: ${msg.text}\n`;
            }
        });
        
        // Close remaining loops
        while (loopStack.length > 0) {
            mermaidOutput += `  end\n`;
            loopStack.pop();
        }
    
        if (uniqueParticipants.length === 0 && messages.length === 0) return null;
        console.log("Sequence diagram conversion completed. Participants:", uniqueParticipants.length, "Messages:", messages.length, "Notes:", notes.length); // DEBUG
        console.log("Generated sequence mermaid code:", mermaidOutput.substring(0, 200) + "..."); // DEBUG
        return '```mermaid\n' + mermaidOutput.trim() + '\n```';
    }
    
    /**
     * Helper: Convert SVG State Diagram to Mermaid code
     * @param {SVGElement} svgElement - The SVG DOM element for the state diagram
     * @returns {string|null}
     */
    function convertStateDiagramSvgToMermaidText(svgElement) {
        if (!svgElement) return null;
    
        console.log("Converting state diagram...");
        
        const nodes = [];
    
        // 1. Parse all states
        svgElement.querySelectorAll('g.node.statediagram-state').forEach(stateEl => {
            const stateName = stateEl.querySelector('foreignObject .nodeLabel p, foreignObject .nodeLabel span')?.textContent.trim();
            if (!stateName) return;
    
            const transform = stateEl.getAttribute('transform');
            const rect = stateEl.querySelector('rect.basic.label-container');
            if (!transform || !rect) return;
    
            const transformMatch = transform.match(/translate\(([^,]+),\s*([^)]+)\)/);
            if (!transformMatch) return;
    
            const tx = parseFloat(transformMatch[1]);
            const ty = parseFloat(transformMatch[2]);
            const rx = parseFloat(rect.getAttribute('x'));
            const ry = parseFloat(rect.getAttribute('y'));
            const width = parseFloat(rect.getAttribute('width'));
            const height = parseFloat(rect.getAttribute('height'));
    
            nodes.push({
                name: stateName,
                x1: tx + rx,
                y1: ty + ry,
                x2: tx + rx + width,
                y2: ty + ry + height
            });
            console.log(`Found State: ${stateName}`, nodes[nodes.length-1]);
        });
    
        // 2. Find start state
        const startStateEl = svgElement.querySelector('g.node.default circle.state-start');
        if (startStateEl) {
            const startGroup = startStateEl.closest('g.node');
            const transform = startGroup.getAttribute('transform');
            const transformMatch = transform.match(/translate\(([^,]+),\s*([^)]+)\)/);
            const r = parseFloat(startStateEl.getAttribute('r'));
            if (transformMatch && r) {
                const tx = parseFloat(transformMatch[1]);
                const ty = parseFloat(transformMatch[2]);
                nodes.push({
                    name: '[*]',
                    x1: tx - r,
                    y1: ty - r,
                    x2: tx + r,
                    y2: ty + r,
                    isSpecial: true
                });
                console.log("Found Start State", nodes[nodes.length-1]);
            }
        }
    
        // 3. Find end state
        svgElement.querySelectorAll('g.node.default').forEach(endGroup => {
            if (endGroup.querySelectorAll('path').length >= 2) {
                 const transform = endGroup.getAttribute('transform');
                 if(transform) {
                    const transformMatch = transform.match(/translate\(([^,]+),\s*([^)]+)\)/);
                    if (transformMatch) {
                        const tx = parseFloat(transformMatch[1]);
                        const ty = parseFloat(transformMatch[2]);
                        const r = 7; // Mermaid end circle radius is 7
                        nodes.push({
                            name: '[*]',
                            x1: tx - r,
                            y1: ty - r,
                            x2: tx + r,
                            y2: ty + r,
                            isSpecial: true
                        });
                        console.log("Found End State", nodes[nodes.length-1]);
                    }
                }
            }
        });
    
        // 4. Get all labels
        const labels = [];
        svgElement.querySelectorAll('g.edgeLabel').forEach(labelEl => {
            const text = labelEl.querySelector('foreignObject .edgeLabel p, foreignObject .edgeLabel span')?.textContent.trim().replace(/^"|"$/g, '');
            const transform = labelEl.getAttribute('transform');
            if (text && transform) {
                const match = transform.match(/translate\(([^,]+),\s*([^)]+)\)/);
                if (match) {
                    labels.push({
                        text: text,
                        x: parseFloat(match[1]),
                        y: parseFloat(match[2])
                    });
                }
            }
        });
    
        function getDistanceToBox(px, py, box) {
            const dx = Math.max(box.x1 - px, 0, px - box.x2);
            const dy = Math.max(box.y1 - py, 0, py - box.y2);
            return Math.sqrt(dx * dx + dy * dy);
        }
    
        function getDistance(x1, y1, x2, y2) {
            return Math.sqrt(Math.pow(x1 - x2, 2) + Math.pow(y1 - y2, 2));
        }
    
        const transitions = [];
    
        // 5. Process paths
        svgElement.querySelectorAll('path.transition').forEach(pathEl => {
            const dAttr = pathEl.getAttribute('d');
            if (!dAttr) return;
    
            const startMatch = dAttr.match(/M\s*([^,\s]+)[,\s]+([^,\s]+)/);
            // More robustly find the last coordinate pair in the d string
            const pathSegments = dAttr.split(/[A-Za-z]/);
            const lastSegment = pathSegments[pathSegments.length-1].trim();
            const endCoords = lastSegment.split(/[\s,]+/).map(parseFloat);
    
            if (!startMatch || endCoords.length < 2) return;
    
            const startX = parseFloat(startMatch[1]);
            const startY = parseFloat(startMatch[2]);
            const endX = endCoords[endCoords.length - 2];
            const endY = endCoords[endCoords.length - 1];
    
            let sourceNode = null, targetNode = null;
            let minSourceDist = Infinity, minTargetDist = Infinity;
    
            nodes.forEach(node => {
                const distToStart = getDistanceToBox(startX, startY, node);
                if (distToStart < minSourceDist) {
                    minSourceDist = distToStart;
                    sourceNode = node;
                }
                const distToEnd = getDistanceToBox(endX, endY, node);
                if (distToEnd < minTargetDist) {
                    minTargetDist = distToEnd;
                    targetNode = node;
                }
            });
    
            let transitionLabel = '';
            if (sourceNode && targetNode && (minSourceDist < 5) && (minTargetDist < 5)) {
                // Find label
                const midX = (startX + endX) / 2;
                const midY = (startY + endY) / 2;
                let closestLabel = null;
                let minLabelDist = Infinity;
    
                labels.forEach(label => {
                    const dist = getDistance(midX, midY, label.x, label.y);
                    if (dist < minLabelDist) {
                        minLabelDist = dist;
                        closestLabel = label;
                    }
                });
    
                if (closestLabel && minLabelDist < 150) { // Arbitrary threshold, seems to work
                    transitionLabel = closestLabel.text;
                }
                
                if(sourceNode === targetNode) return; // Ignore self-loops for now
                
                const newTransition = {
                    from: sourceNode.name,
                    to: targetNode.name,
                    label: transitionLabel
                };
                
                // Avoid adding duplicates
                if (!transitions.some(t => t.from === newTransition.from && t.to === newTransition.to && t.label === newTransition.label)) {
                     transitions.push(newTransition);
                }
            }
        });
    
        // 6. Generate Mermaid code
        let mermaidCode = "stateDiagram-v2\n";
        transitions.forEach(t => {
            let line = `    ${t.from} --> ${t.to}`;
            if (t.label) {
                line += ` : "${t.label}"`;
            }
            mermaidCode += line + '\n';
        });
    
        if (transitions.length === 0) return null;
    
        console.log("State diagram conversion completed. Transitions:", transitions.length);
        console.log("Generated state diagram mermaid code:", mermaidCode);
        
        return '```mermaid\n' + mermaidCode.trim() + '\n```';
    }

    function convertMermaidSvgToMarkdown(svgElement) {
        if (!svgElement) return null;

        const diagramTypeDesc = (svgElement.getAttribute('aria-roledescription') || '').toLowerCase();
        const diagramClass = (svgElement.getAttribute('class') || '').toLowerCase();
        if (diagramTypeDesc.includes('error')) return null;

        if (diagramTypeDesc.includes('flowchart') || diagramClass.includes('flowchart')) {
            return convertFlowchartSvgToMermaidText(svgElement);
        }
        if (diagramTypeDesc.includes('class') || diagramClass.includes('classdiagram') || diagramClass.includes('class')) {
            return convertClassDiagramSvgToMermaidText(svgElement);
        }
        if (diagramTypeDesc.includes('sequence') || diagramClass.includes('sequencediagram') || diagramClass.includes('sequence')) {
            return convertSequenceDiagramSvgToMermaidText(svgElement);
        }
        if (diagramTypeDesc.includes('state') || diagramClass.includes('statediagram')) {
            return convertStateDiagramSvgToMermaidText(svgElement);
        }
        if (svgElement.querySelector('path.flowchart-link, g.node[id^="flowchart-"]')) {
            return convertFlowchartSvgToMermaidText(svgElement);
        }

        return null;
    }

    function extractMermaidSource(container) {
        if (!container) return null;

        const sourceElement = container.querySelector('pre code, code, textarea, [data-mermaid], [data-code]');
        const source = cleanCodeBlockText(
            sourceElement?.getAttribute?.('data-mermaid') ||
            sourceElement?.getAttribute?.('data-code') ||
            sourceElement?.textContent ||
            ''
        );
        if (!source) return null;

        const firstLine = source.split(/\r?\n/, 1)[0].trim();
        const isMermaidSource = /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|gantt|journey|pie|gitGraph|mindmap|timeline|quadrantChart|requirementDiagram|C4Context)\b/.test(firstLine);
        return isMermaidSource ? `\n\`\`\`mermaid\n${source}\n\`\`\`\n\n` : null;
    }

    function isMermaidContainer(node, tag, cls) {
        const id = node.id || '';
        if (id.endsWith('-mermaid')) return true;
        if (id.endsWith('-mermaid-svg')) return true;
        if (cls.includes('mermaid') && !cls.includes('mermaidTooltip')) return true;
        return tag === 'figure' && !!node.querySelector('[id$="-mermaid"], svg[id^="mermaid-"], svg[id$="-mermaid-svg"]');
    }

    function convertMermaidContainer(node) {
        const svg = findMermaidSvg(node);
        const mermaidOutput = convertMermaidSvgToMarkdown(svg);
        if (mermaidOutput) {
            return `\n${mermaidOutput}\n\n`;
        }
        return extractMermaidSource(node) || '';
    }

    function normalizeMarkdownFences(markdown) {
        const usesCrLf = markdown.includes('\r\n');
        const lines = markdown.replace(/\r\n/g, '\n').split('\n');
        const output = [];
        let inFence = false;
        let previousBlankOutsideFence = false;

        lines.forEach((line, index) => {
            const trimmed = line.trim();
            const isFence = trimmed.startsWith('```');

            if (inFence && isFence && trimmed !== '```') {
                const fenceIndex = line.indexOf('```');
                const afterFence = line.slice(fenceIndex + 3).trimStart();
                output.push(line.slice(0, fenceIndex + 3));
                if (afterFence) {
                    output.push('');
                    output.push(afterFence);
                }
                previousBlankOutsideFence = false;
                inFence = false;
                return;
            }

            if (!inFence && !isFence && trimmed === '') {
                if (!previousBlankOutsideFence) {
                    output.push(line);
                }
                previousBlankOutsideFence = true;
                return;
            }

            output.push(line);
            previousBlankOutsideFence = false;

            if (!isFence) return;

            if (inFence) {
                const nextLine = lines[index + 1];
                if (nextLine !== undefined && nextLine.trim() !== '') {
                    output.push('');
                    previousBlankOutsideFence = true;
                }
            }
            inFence = !inFence;
        });

        return output.join(usesCrLf ? '\r\n' : '\n').trim();
    }

    function cleanCodeBlockText(text) {
        return (text || '')
            .replace(/^\s*Copy code\s*\n/i, '')
            .replace(/\n\s*Copy code\s*$/i, '')
            .trim();
    }

    function wrapFencedBlock(language, codeText) {
        const lang = (language || '').trim();
        const code = (codeText || '').trim();
        if (!code) return '';
        return `\n\n\ \ \ ${lang}\n${code}\n\ \ \ \n\n`.replace(/\u0000/g, '`');
    }

    function extractCodeWikiSnippet(node) {
        const language = (node.querySelector('.language')?.textContent || '').trim().toLowerCase();
        const codeText = cleanCodeBlockText(node.querySelector('.hljs')?.textContent || '');
        return wrapFencedBlock(language, codeText);
    }

    function extractEmbeddedSvgElement(container) {
        const encodedHref = container.querySelector('image[href^="data:image/svg+xml;base64,"], image[*|href^="data:image/svg+xml;base64,"]')
            ?.getAttribute('href');
        if (!encodedHref) return null;

        const prefix = 'data:image/svg+xml;base64,';
        if (!encodedHref.startsWith(prefix)) return null;

        try {
            const svgText = atob(encodedHref.slice(prefix.length));
            return new DOMParser().parseFromString(svgText, 'image/svg+xml').documentElement;
        } catch (error) {
            return null;
        }
    }

    function convertCodeWikiDiagram(node) {
        const decodedSvg = extractEmbeddedSvgElement(node);
        const mermaidOutput = convertMermaidSvgToMarkdown(decodedSvg);
        if (mermaidOutput) {
            return `\n${mermaidOutput}\n\n`;
        }

        const image = node.querySelector('image[href], image[*|href]');
        const href = image?.getAttribute('href') || '';
        const alt = escapeMarkdownText(
            node.querySelector('.zoomable-image-container')?.getAttribute('aria-label') ||
            node.querySelector('.zoomable-image-container')?.getAttribute('alt') ||
            'Diagram'
        );

        if (href.startsWith('data:image/')) {
            return `\n![${alt}](${href})\n\n`;
        }

        return '';
    }

    /**
     * Recursively convert DOM node to Markdown
     */
    function processNode(node, parserId = getPlatform().id) {
        if (!node) return '';
        if (node.nodeType === Node.TEXT_NODE) {
            let text = node.textContent.replace(/\s+/g, ' ');
            return text ? escapeMarkdownText(text) : '';
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return '';

        const tag = node.tagName.toLowerCase();
        const cls = (node.className || '').toString();
        const parser = getPlatformParser();

        // Skip hidden elements
        if (node.style?.display === 'none' || node.style?.visibility === 'hidden') {
            return '';
        }

        const customResult = parser?.processCustomNode?.(node, {
            extractCodeWikiSnippet,
            convertCodeWikiDiagram,
            formatTable,
            cleanCodeBlockText,
            detectLanguage
        });
        if (customResult !== null && customResult !== undefined) {
            return customResult;
        }

        let children = '';
        // Process child nodes
        for (const child of node.childNodes) {
            children += processNode(child, parserId);
        }
        const normalizedChildren = children.replace(/\n{3,}/g, '\n\n');
        children = normalizedChildren.trim();

        switch (tag) {
            // Headings (strip external action links like "报告问题" from h1)
            case 'h1': {
                // Remove any anchor links from heading text
                const cleanChildren = children.replace(/\s*\[.*?\]\(.*?\)\s*$/, '').trim();
                return `\n\n# ${cleanChildren}\n\n`;
            }
            case 'h2': return `\n\n## ${children}\n\n`;
            case 'h3': return `\n\n### ${children}\n\n`;
            case 'h4': return `\n\n#### ${children}\n\n`;
            case 'h5': return `\n\n##### ${children}\n\n`;
            case 'h6': return `\n\n###### ${children}\n\n`;

            // Paragraphs
            case 'p': {
                return children ? `${children}\n\n` : '';
            }

            case 'documentation-markdown':
                return normalizedChildren;

            // Blockquotes
            case 'blockquote':
                return children ? children.split('\n').map(l => `> ${l}`).join('\n') + '\n\n' : '';

            // Lists
            case 'ul': {
                const items = [];
                node.querySelectorAll(':scope > li').forEach(li => {
                    let text = '';
                    li.childNodes.forEach(child => { text += processNode(child, parserId); });
                    text = text.trim().replace(/\n+/g, ' ');
                    items.push(`- ${text}`);
                });
                return items.length ? items.join('\n') + '\n\n' : '';
            }
            case 'ol': {
                const items = [];
                node.querySelectorAll(':scope > li').forEach((li, i) => {
                    let text = '';
                    li.childNodes.forEach(child => { text += processNode(child, parserId); });
                    text = text.trim().replace(/\n+/g, ' ');
                    items.push(`${i + 1}. ${text}`);
                });
                return items.length ? items.join('\n') + '\n\n' : '';
            }

            // Code blocks
            case 'pre': {
                const svg = findMermaidSvg(node);
                const mermaidOutput = convertMermaidSvgToMarkdown(svg);
                if (mermaidOutput) {
                    return `\n${mermaidOutput}\n\n`;
                }

                const code = node.querySelector('code');
                const text = cleanCodeBlockText(code ? code.textContent : node.textContent);
                if (!text) return '';
                const lang = detectLanguage(node);
                return wrapFencedBlock(lang, text);
            }

            // Inline code
            case 'code': {
                if (!isInsidePre(node)) {
                    const text = node.textContent.replace(/\s+/g, ' ').trim();
                    return text ? `\`${text}\`` : '';
                }
                return children;
            }

            // Links
            case 'a': {
                const href = node.getAttribute('href') || '';
                const platform = getPlatform();
                let text = children.trim() || node.textContent.trim();
                // Skip feishu report links and other external action links
                if (href.includes('feishu.cn') || href.includes('producthunt') || (platform.id === 'zread' && href.includes('github.com'))) {
                    return '';
                }
                text = formatLineReferenceLinkText(href, text);
                if (href && text && !href.startsWith('#') && !href.startsWith('javascript:')) {
                    const url = toAbsoluteUrl(href);
                    if (!isSafeMarkdownUrl(url)) return text;
                    return `[${text}](${url})`;
                }
                return text;
            }

            // Images
            case 'img': {
                const src = node.getAttribute('src') || '';
                const alt = escapeMarkdownText(node.getAttribute('alt') || '');
                if (src) {
                    const url = toAbsoluteUrl(src);
                    if (!isSafeMarkdownUrl(url, false, false)) return '';
                    return `![${alt}](${url})`;
                }
                return '';
            }

            // Tables
            case 'table': return formatTable(node);
            case 'thead':
            case 'tbody':
            case 'tr':
            case 'th':
            case 'td':
                return children;

            // Horizontal rule
            case 'hr': return '\n---\n\n';

            // Inline formatting
            case 'strong': case 'b': return `**${children}**`;
            case 'em': case 'i': return `*${children}*`;
            case 'br': return '\n';

            case 'details': {
                const summary = node.querySelector(':scope > summary');
                const summaryText = summary ? processNode(summary, parserId).trim() : 'Details';
                let detailContent = '';
                node.childNodes.forEach(child => {
                    if (child !== summary) detailContent += processNode(child, parserId);
                });
                const quoted = detailContent.trim().split('\n').map(line => `> ${line}`).join('\n');
                return `\n> **${summaryText || 'Details'}**\n${quoted}\n\n`;
            }
            case 'summary':
                return children;

            // Section label (small tag before h1, e.g., "入门")
            case 'small':
                return children ? `*${children}*\n\n` : '';

            // Figure elements: code blocks (shiki) or mermaid diagrams
            case 'figure': {
                // Mermaid diagram
                if (isMermaidContainer(node, tag, cls)) {
                    return convertMermaidContainer(node);
                }
                // Code block figure (shiki)
                const pre = node.querySelector('pre');
                const code = node.querySelector('pre code');
                if (pre && code) {
                    const codeText = cleanCodeBlockText(code.textContent);
                    if (!codeText) return '';
                    // Try to get language from the figure class or data attributes
                    let lang = '';
                    const langMatch = cls.match(/(?:lang|language|syntax)-(\w+)/i);
                    if (langMatch) lang = langMatch[1];
                    // Also try to infer from shiki's language class on pre
                    if (!lang) {
                        const preCls = pre.className || '';
                        const preLang = preCls.match(/language-(\w+)/i);
                        if (preLang) lang = preLang[1];
                    }
                    return wrapFencedBlock(lang, codeText);
                }
                return children;
            }

            // Alert boxes (div[data-slot="alert"])
            case 'div': {
                if (isMermaidContainer(node, tag, cls)) {
                    return convertMermaidContainer(node);
                }
                if (node.getAttribute && node.getAttribute('data-slot') === 'alert') {
                    const paragraphs = node.querySelectorAll('p, li');
                    const alertText = Array.from(paragraphs)
                        .map(p => escapeMarkdownText(p.textContent.trim()))
                        .filter(t => t)
                        .join('\n');
                    return alertText
                        ? `> **Note:** ${alertText.split('\n').join('\n> ')}\n\n`
                        : '';
                }
                if (node.childElementCount === 1) {
                    const onlyChildTag = node.firstElementChild?.tagName?.toLowerCase();
                    if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'pre', 'figure', 'documentation-markdown'].includes(onlyChildTag || '')) {
                        return normalizedChildren;
                    }
                }
                return children;
            }

            // Source code reference links (zread specific)
            case 'span':
                return children;

            default:
                return children;
        }
    }

    function formatLineReferenceLinkText(href, text) {
        const lineInfoMatch = (href || '').match(/#L(\d+)(?:-L(\d+))?$/);
        if (!lineInfoMatch) return text;

        const pathPart = href.substring(0, href.indexOf('#'));
        const filename = pathPart.substring(pathPart.lastIndexOf('/') + 1) || 'link';
        const startLine = lineInfoMatch[1];
        const endLine = lineInfoMatch[2];
        const lineRef = endLine && endLine !== startLine ? `L${startLine}-L${endLine}` : `L${startLine}`;
        const isSourcesContext = /^Sources:\s*\[.*\]$/i.test(text.trim());
        const display = `${escapeMarkdownText(filename)} ${lineRef}`;
        return isSourcesContext ? `Sources: [${display}]` : display;
    }

    /**
     * Check if a code element is inside a pre element
     */
    function isInsidePre(node) {
        let p = node.parentElement;
        while (p) {
            if (p.tagName.toLowerCase() === 'pre') return true;
            p = p.parentElement;
        }
        return false;
    }

    /**
     * Detect coding language from a code block
     */
    function detectLanguage(preElement) {
        // Check class names (handles shiki: "shiki shiki-theme ... language-bash")
        const cls = preElement.className || '';
        // Try shiki's language- prefix first (e.g., "language-bash")
        const shikiMatch = cls.match(/language-(\w+)/i);
        if (shikiMatch) return shikiMatch[1];
        // Fallback to other patterns
        const m = cls.match(/(?:lang|syntax)-(\w+)/i);
        if (m) return m[1];

        const code = preElement.querySelector('code');
        if (code) {
            const codeCls = code.className || '';
            const cm = codeCls.match(/(?:lang|language|syntax)-(\w+)/i);
            if (cm) return cm[1];
        }

        // Heuristic detection from content
        const text = preElement.textContent || '';
        if (text.includes('import ') || text.includes('from ') || text.includes('def ') || text.includes('class ') || text.includes('if __name__')) return 'python';
        if (text.includes('function ') || text.includes('const ') || text.includes('let ') || text.includes('=>')) return 'javascript';
        if (text.includes('#include') || text.includes('std::')) return 'cpp';
        if (text.includes('package ') && text.includes('func ')) return 'go';
        if (text.includes('fn ') && text.includes('->')) return 'rust';
        if (text.match(/^[\w-]+:\s*[\w-]+/m) && !text.includes('```')) return 'yaml';
        if (text.includes('docker') && text.includes('FROM ')) return 'dockerfile';
        if (text.includes('$ ') || text.includes('apt-get') || text.includes('apt ')) return 'bash';

        return '';
    }

    /**
     * Format a table to GFM Markdown
     */
    function formatTable(node) {
        const tableRows = Array.from(node.querySelectorAll('tr')).map(tr => {
            const cells = Array.from(tr.children)
                .filter(cell => ['th', 'td'].includes(cell.tagName.toLowerCase()))
                .map(cell => ({
                    isHeader: cell.tagName.toLowerCase() === 'th',
                    text: escapeMarkdownText(cell.textContent.trim())
                }));

            return cells.filter(cell => cell.text);
        }).filter(row => row.length > 0);

        const headerRow = [];
        const rows = [];

        const theadRow = tableRows.find(row => row.some(cell => cell.isHeader));
        if (theadRow) {
            theadRow.forEach(cell => headerRow.push(cell.text));
        }

        let remainingRows = tableRows;
        if (headerRow.length > 0) {
            remainingRows = tableRows.slice(1);
        }

        remainingRows.forEach(row => {
            rows.push(row.map(cell => cell.text));
        });

        if (headerRow.length === 0 && rows.length > 0) {
            const firstRow = rows.shift();
            firstRow.forEach(cell => headerRow.push(cell));
        }

        if (headerRow.length === 0) return '';

        const colCount = headerRow.length;

        // Ensure all rows have same column count
        rows.forEach(row => {
            while (row.length < colCount) row.push('');
        });

        let result = '\n\n';
        result += '| ' + headerRow.join(' | ') + ' |\n';
        result += '| ' + headerRow.map(() => '---').join(' | ') + ' |\n';
        rows.forEach(row => {
            result += '| ' + row.join(' | ') + ' |\n';
        });

        return result + '\n';
    }

    /**
     * Extract slug from URL
     */
    function getSlugFromUrl(url) {
        const match = url.match(/(?:zread\.ai|deepwiki\.com)\/[^/]+\/[^/]+\/(.+)/) ||
            url.match(/codewiki\.google\/github\.com\/[^/]+\/([^/#?]+)/);
        return match ? match[1].replace(/[\/\\:*?"<>|]/g, '-') : 'document';
    }

    /**
     * Extract all page links from the sidebar navigation
     * This is the key function for batch processing
     */
    function extractAllPages() {
        const baseUrl = window.location.origin;
        const formattedHeadTitle = cleanHeadTitle(document.title || '');
        const parser = getPlatformParser();
        if (!parser?.extractPages) {
            return { success: false, error: 'No parser available for this platform.' };
        }
        return parser.extractPages(baseUrl, formattedHeadTitle, { getPageTitle, cleanTitleText });
    }

    console.log('wiki2md-extension: content script loaded');
})();
