// Background service worker for the extension
chrome.runtime.onInstalled.addListener(() => {
    console.log('Shopify Data Extractor installed');
});

// ── Background IndexedDB (same DB as popup) ──────────────────────────────────
const BG_DB_NAME = 'ShopifyScraperDB';
const BG_DB_VER  = 1;

function bgOpenDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(BG_DB_NAME, BG_DB_VER);
        req.onsuccess = () => resolve(req.result);
        req.onerror  = () => reject(req.error);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('products')) {
                const ps = db.createObjectStore('products', { keyPath: 'uid' });
                ps.createIndex('storeUrl', 'storeUrl', { unique: false });
                ps.createIndex('collectionHandle', 'collectionHandle', { unique: false });
            }
            if (!db.objectStoreNames.contains('scraped_stores')) {
                const ss = db.createObjectStore('scraped_stores', { keyPath: 'storeUrl' });
                ss.createIndex('scrapedAt', 'scrapedAt', { unique: false });
            }
        };
    });
}

async function bgSaveProducts(storeUrl, products) {
    const db = await bgOpenDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('products', 'readwrite');
        const store = tx.objectStore('products');
        for (const p of products) {
            store.put({ uid: `${storeUrl}__${p.id}`, storeUrl, collectionHandle: p.collection_handle || 'all', ...p, savedAt: Date.now() });
        }
        tx.oncomplete = () => resolve(true);
        tx.onerror    = () => reject(tx.error);
    });
}

async function bgGetExistingProductIds(storeUrl) {
    const db = await bgOpenDB();
    return new Promise((resolve, reject) => {
        const tx  = db.transaction('products', 'readonly');
        const req = tx.objectStore('products').index('storeUrl').getAll(storeUrl);
        req.onsuccess = () => resolve(new Set(req.result.map(p => String(p.id))));
        req.onerror   = () => reject(req.error);
    });
}

async function bgClearProducts(storeUrl) {
    const db = await bgOpenDB();
    return new Promise((resolve, reject) => {
        const tx  = db.transaction('products', 'readwrite');
        const req = tx.objectStore('products').index('storeUrl').getAllKeys(storeUrl);
        req.onsuccess = () => { for (const k of req.result) tx.objectStore('products').delete(k); };
        tx.oncomplete = () => resolve(true);
        tx.onerror    = () => reject(tx.error);
    });
}

async function bgGetScrapedStore(storeUrl) {
    const db = await bgOpenDB();
    return new Promise((resolve, reject) => {
        const req = db.transaction('scraped_stores', 'readonly').objectStore('scraped_stores').get(storeUrl);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror   = () => reject(req.error);
    });
}

async function bgSaveScrapedStore(storeUrl, data) {
    const existing = (await bgGetScrapedStore(storeUrl)) || {};
    const db = await bgOpenDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('scraped_stores', 'readwrite');
        tx.objectStore('scraped_stores').put({
            ...existing, storeUrl,
            collections:    data.collections    ?? existing.collections    ?? [],
            totalProducts:           data.totalProducts           ?? existing.totalProducts           ?? 0,
            fileSizeBytes:           data.fileSizeBytes           ?? existing.fileSizeBytes           ?? 0,
            faviconDataUrl:          existing.faviconDataUrl      ?? '',
            collectionProductCounts: data.collectionProductCounts ?? existing.collectionProductCounts ?? null,
            collectionProductIds:    data.collectionProductIds    ?? existing.collectionProductIds    ?? null,
            scrapedAt: Date.now(),
        });
        tx.oncomplete = () => resolve(true);
        tx.onerror    = () => reject(tx.error);
    });
}

// ── Badge helpers ─────────────────────────────────────────────────────────────
function setBadge(count, color = '#8b5cf6') {
    const text = count <= 0 ? '' : count >= 10000 ? `${Math.floor(count / 1000)}k` : String(count);
    chrome.action.setBadgeText({ text });
    if (text) chrome.action.setBadgeBackgroundColor({ color });
}

// ── Scrape state helpers ──────────────────────────────────────────────────────
async function setScrapingState(patch) {
    const prev = (await chrome.storage.local.get('bgScrapeState')).bgScrapeState || {};
    const next = { ...prev, ...patch };
    await chrome.storage.local.set({ bgScrapeState: next });
    return next;
}

// ── Main background scraping engine ──────────────────────────────────────────
async function startBackgroundScraping(storeUrl, incrementalOnly = false) {
    // Mark as running
    await chrome.storage.local.set({
        bgScrapeState: {
            isRunning: true, storeUrl,
            progress: 0, message: 'Starting...',
            collectionsTotal: 0, productsScraped: 0,
            isIncremental: incrementalOnly,
            error: null, completedAt: null,
            startedAt: Date.now(),
        }
    });
    setBadge(0, '#8b5cf6');

    try {
        // Fetch collections
        await setScrapingState({ progress: 10, message: 'Fetching collections...' });
        const colResp = await fetch(`${storeUrl}/collections.json`, { headers: { 'Accept': 'application/json' } });
        if (!colResp.ok) throw new Error(`Collections fetch failed: HTTP ${colResp.status}`);

        const colData   = await colResp.json();
        const collections = colData.collections || [];
        if (!collections.length) throw new Error('No collections found in this store');

        await setScrapingState({ collectionsTotal: collections.length, progress: 15, message: `Found ${collections.length} collections`, collections });

        // For incremental: get existing product IDs
        const existingIds = incrementalOnly ? await bgGetExistingProductIds(storeUrl) : new Set();

        // If full scrape: clear existing products first
        if (!incrementalOnly) await bgClearProducts(storeUrl);

        let totalNewProducts = 0;
        const BATCH_SIZE = 50;
        let batch = [];
        const collectionProductCounts = {}; // handle → count
        const colProductIds           = {}; // handle → [id, id, ...]

        async function flushBatch() {
            if (!batch.length) return;
            await bgSaveProducts(storeUrl, batch);
            batch = [];
        }

        for (let i = 0; i < collections.length; i++) {
            const col = collections[i];
            let page = 1, hasMore = true;
            colProductIds[col.handle] = [];

            while (hasMore) {
                const progress = 15 + Math.floor(((i + (page - 1) * 0.1) / collections.length) * 80);
                await setScrapingState({
                    progress: Math.min(progress, 94),
                    message: `${col.title} — page ${page}...`,
                    productsScraped: totalNewProducts,
                });
                setBadge(totalNewProducts);

                const url = `${storeUrl}/collections/${col.handle}/products.json?limit=250&page=${page}`;
                try {
                    const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
                    if (!resp.ok) { hasMore = false; break; }
                    const data = await resp.json();
                    if (!data.products?.length) { hasMore = false; break; }

                    for (const p of data.products) {
                        colProductIds[col.handle].push(String(p.id)); // track membership
                        if (incrementalOnly && existingIds.has(String(p.id))) continue;
                        batch.push({ ...p, collection_title: col.title, collection_handle: col.handle });
                        totalNewProducts++;
                    }

                    if (batch.length >= BATCH_SIZE) await flushBatch();

                    hasMore = data.products.length === 250;
                    page++;
                } catch { hasMore = false; }
            }

            collectionProductCounts[col.handle] = colProductIds[col.handle].length;
        }

        await flushBatch(); // flush remaining

        // Get total products count (existing + new)
        const db = await bgOpenDB();
        const totalCount = await new Promise((res, rej) => {
            const req = db.transaction('products', 'readonly').objectStore('products').index('storeUrl').count(storeUrl);
            req.onsuccess = () => res(req.result);
            req.onerror   = () => rej(req.error);
        });

        // Estimate file size
        const fileSizeBytes = totalCount * 750; // ~750 bytes per product avg

        await bgSaveScrapedStore(storeUrl, { collections, totalProducts: totalCount, fileSizeBytes, collectionProductCounts, collectionProductIds: colProductIds });

        await setScrapingState({
            isRunning: false, progress: 100,
            message: incrementalOnly
                ? `Done! ${totalNewProducts} new products added.`
                : `Complete! ${totalCount} products scraped.`,
            productsScraped: totalNewProducts,
            totalProducts: totalCount,
            completedAt: Date.now(),
        });

        // Badge: show checkmark briefly then clear
        chrome.action.setBadgeText({ text: '✓' });
        chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
        setTimeout(() => chrome.action.setBadgeText({ text: '' }), 3000);

    } catch (err) {
        await setScrapingState({ isRunning: false, error: err.message, progress: 0 });
        chrome.action.setBadgeText({ text: '!' });
        chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
        setTimeout(() => chrome.action.setBadgeText({ text: '' }), 4000);
    }
}

// Listen for messages from content scripts or popup
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {

    if (request.action === "fetchFavicon") {
        fetchFaviconAsBase64(request.storeUrl)
            .then(dataUrl => sendResponse({ success: true, dataUrl }))
            .catch(() => sendResponse({ success: false }));
        return true;
    }

    if (request.action === "startScraping") {
        startBackgroundScraping(request.storeUrl, request.incrementalOnly || false);
        sendResponse({ started: true });
        return true;
    }

    if (request.action === "checkShopify") {
        // Check if the current page is a Shopify store
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            if (tabs.length === 0) {
                sendResponse({ isShopify: false });
                return;
            }

            chrome.scripting.executeScript({
                target: { tabId: tabs[0].id },
                func: isShopifyStore
            }, (results) => {
                if (chrome.runtime.lastError) {
                    console.error('Error checking Shopify:', chrome.runtime.lastError);
                    sendResponse({ isShopify: false });
                    return;
                }

                sendResponse({ isShopify: results[0].result });
            });
        });

        return true; // Will respond asynchronously
    }

    if (request.action === "fetchStoreData") {
        // Fetch store data using background script to avoid CORS issues
        const storeUrl = request.storeUrl;

        fetchStoreDataFromBackground(storeUrl)
            .then(data => {
                sendResponse({ success: true, data: data });
            })
            .catch(error => {
                sendResponse({ success: false, error: error.message });
            });

        return true; // Will respond asynchronously
    }
});

// Function to fetch store data from background (avoids CORS) - fetches ALL products with pagination
async function fetchStoreDataFromBackground(storeUrl) {
    const results = {
        collections: [],
        products: []
    };

    try {
        // First fetch collections
        const collectionsUrl = `${storeUrl}/collections.json`;
        const collectionsResponse = await fetch(collectionsUrl, {
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!collectionsResponse.ok) {
            throw new Error(`HTTP error! status: ${collectionsResponse.status}`);
        }

        const collectionsData = await collectionsResponse.json();

        if (collectionsData && collectionsData.collections) {
            results.collections = collectionsData.collections;

            // Now fetch ALL products for each collection with pagination
            for (const collection of results.collections) {
                try {
                    let page = 1;
                    let hasMoreProducts = true;

                    while (hasMoreProducts) {
                        // Request up to 250 products per page (Shopify max)
                        const productsUrl = `${storeUrl}/collections/${collection.handle}/products.json?limit=250&page=${page}`;
                        const productsResponse = await fetch(productsUrl, {
                            headers: {
                                'Accept': 'application/json'
                            }
                        });

                        if (productsResponse.ok) {
                            const productsData = await productsResponse.json();

                            if (productsData && productsData.products && productsData.products.length > 0) {
                                // Add collection info to each product
                                productsData.products.forEach(product => {
                                    product.collection_title = collection.title || '';
                                    product.collection_handle = collection.handle || '';
                                });
                                results.products.push(...productsData.products);

                                // If we got less than 250 products, we've reached the end
                                if (productsData.products.length < 250) {
                                    hasMoreProducts = false;
                                } else {
                                    page++;
                                }
                            } else {
                                hasMoreProducts = false;
                            }
                        } else {
                            hasMoreProducts = false;
                        }
                    }
                } catch (error) {
                    console.error(`Error fetching products for collection ${collection.title}:`, error);
                }
            }
        }

        return results;
    } catch (error) {
        console.error('Error fetching store data:', error);
        throw error;
    }
}

function isShopifyStore() {
    // Check for Shopify-specific elements and patterns
    const shopifyIndicators = [
        window.Shopify && typeof window.Shopify === 'object',
        document.querySelector('[data-shopify]'),
        document.querySelector('[class*="shopify"]'),
        document.querySelector('link[href*="shopify"]'),
        document.body.innerHTML.includes('shopify'),
        document.querySelector('script[src*="shopify"]')
    ];

    return shopifyIndicators.some(indicator => indicator);
}

// Handle extension icon click
chrome.action.onClicked.addListener((_tab) => {
    // This will open the popup when the extension icon is clicked
    // The popup.html is set as the default in manifest.json
});

// Fetch store favicon and return as base64 data URL
async function fetchFaviconAsBase64(storeUrl) {
    // Try sources in priority order: SVG > PNG > ICO > Google API
    const candidates = [
        `${storeUrl}/favicon.svg`,
        `${storeUrl}/favicon.png`,
        `${storeUrl}/apple-touch-icon.png`,
        `${storeUrl}/apple-touch-icon-precomposed.png`,
        `${storeUrl}/favicon.ico`,
        `https://www.google.com/s2/favicons?domain=${new URL(storeUrl).hostname}&sz=128`,
    ];

    for (const url of candidates) {
        try {
            const ctrl = new AbortController();
            setTimeout(() => ctrl.abort(), 4000);
            const resp = await fetch(url, { signal: ctrl.signal });
            if (!resp.ok) continue;
            const contentType = resp.headers.get('content-type') || '';
            // Skip HTML responses (redirect to homepage)
            if (contentType.includes('text/html')) continue;
            const buffer = await resp.arrayBuffer();
            if (buffer.byteLength < 100) continue; // skip tiny/empty files
            const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
            const mime = contentType.split(';')[0].trim() || 'image/x-icon';
            return `data:${mime};base64,${base64}`;
        } catch { continue; }
    }
    throw new Error('No favicon found');
}