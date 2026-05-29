// Store all product data
let allProductsData = [];
let currentStoreCollections = [];
let currentStoreUrl = '';
let isExtracting = false;

document.addEventListener('DOMContentLoaded', function () {
    // Use existing stats container from HTML
    const statsContainer = document.getElementById('statsContainer');

    // Get the current tab URL when the popup opens
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (tabs.length > 0) {
            const currentUrl = tabs[0].url;
            try {
                const urlObj = new URL(currentUrl);
                // Extract just the domain and protocol
                currentStoreUrl = `${urlObj.protocol}//${urlObj.hostname}`;

                // Check if it's a Shopify store
                checkShopifyStore(currentUrl);

                // Check cache first, then decide whether to scrape
                if (!isExtracting) {
                    setTimeout(() => {
                        checkCacheAndStart();
                    }, 1000);
                }
            } catch (e) {
                console.error('Error parsing URL:', e);
                showError('Invalid URL format. Please navigate to a valid Shopify store first.');
            }
        } else {
            // No active tab found
            showError('No active tab found. Please navigate to a Shopify store first.');
        }
    });

    // Add event listeners for buttons
    // Hide extract button since extraction happens automatically
    const extractBtn = document.getElementById('extractBtn');
    if (extractBtn) {
        extractBtn.style.display = 'none';
    }
    document.getElementById('viewResultsBtn').addEventListener('click', showResultsPage);
    document.getElementById('downloadBtn').addEventListener('click', downloadCSV);
    document.getElementById('cachedDownloadBtn').addEventListener('click', downloadCSV);
    document.getElementById('checkNewBtn').addEventListener('click', checkForNewProducts);
    document.getElementById('rescrapeBtn').addEventListener('click', () => {
        hideCachedBanner();
        startExtraction();
    });
});

function checkShopifyStore(url) {
    // Check if the current page is a Shopify store
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (tabs.length === 0) return;

        // Use chrome.tabs.executeScript for Manifest V2 compatibility
        // or check if chrome.scripting is available
        if (chrome.scripting && chrome.scripting.executeScript) {
            chrome.scripting.executeScript({
                target: { tabId: tabs[0].id },
                func: isShopifyStore
            }, (results) => {
                if (chrome.runtime.lastError) {
                    console.error('Error checking Shopify:', chrome.runtime.lastError);
                    return;
                }

                if (results && results[0] && results[0].result) {
                    const progressMessage = document.getElementById('progressMessage');
                    if (progressMessage) {
                        progressMessage.textContent = 'Shopify store detected. Ready to extract.';
                    }
                } else {
                    const progressMessage = document.getElementById('progressMessage');
                    if (progressMessage) {
                        progressMessage.textContent = 'This may not be a Shopify store. Extraction might fail.';
                    }
                }
            });
        } else {
            // Fallback for older Chrome versions
            chrome.tabs.executeScript(tabs[0].id, {
                code: `(${isShopifyStore.toString()})()`
            }, (results) => {
                if (chrome.runtime.lastError) {
                    console.error('Error checking Shopify:', chrome.runtime.lastError);
                    return;
                }

                if (results && results[0]) {
                    const progressMessage = document.getElementById('progressMessage');
                    if (progressMessage) {
                        progressMessage.textContent = 'Shopify store detected. Ready to extract.';
                    }
                } else {
                    const progressMessage = document.getElementById('progressMessage');
                    if (progressMessage) {
                        progressMessage.textContent = 'This may not be a Shopify store. Extraction might fail.';
                    }
                }
            });
        }
    });
}

function isShopifyStore() {
    // Check for Shopify-specific elements and patterns
    const shopifyIndicators = [
        window.Shopify && typeof window.Shopify === 'object',
        document.querySelector('[data-shopify]'),
        document.querySelector('[class*="shopify"]'),
        document.querySelector('link[href*="shopify"]'),
        document.body.innerHTML.includes('shopify')
    ];

    return shopifyIndicators.some(indicator => indicator);
}

// ── Smart Cache + Background Scraping Logic ──────────────────────────────────

let _progressListener = null; // single active storage listener

function attachProgressListener() {
    if (_progressListener) chrome.storage.onChanged.removeListener(_progressListener);
    _progressListener = (changes, area) => {
        if (area !== 'local' || !changes.bgScrapeState) return;
        const state = changes.bgScrapeState.newValue;
        if (!state || state.storeUrl !== currentStoreUrl) return;
        applyBgState(state);
    };
    chrome.storage.onChanged.addListener(_progressListener);
}

function applyBgState(state) {
    if (state.isRunning) {
        // Show live progress
        hideCachedBanner();
        updateProgress(state.progress || 0, state.message || '');
        const pc = document.getElementById('productsCount');
        const cc = document.getElementById('collectionsCount');
        if (pc) pc.textContent = state.productsScraped || 0;
        if (cc && state.collectionsTotal) cc.textContent = state.collectionsTotal;
        const statsContainer = document.getElementById('statsContainer');
        if (statsContainer) statsContainer.style.display = 'grid';
    } else if (!state.error) {
        // Done — load from IndexedDB
        loadCompletedScrape(state);
    } else {
        // Error
        isExtracting = false;
        showError(`<div class="error-title"><i class="fas fa-times-circle"></i> Scraping Failed</div><div class="error-message">${state.error}</div>`);
        updateProgress(100, 'Extraction failed', true);
        resetExtractButton();
    }
}

async function loadCompletedScrape(state) {
    isExtracting = false;
    const cached = await ShopifyDB.getScrapedStore(currentStoreUrl);
    if (!cached) return;
    const products = await ShopifyDB.getProductsByStore(currentStoreUrl);
    allProductsData = products;
    currentStoreCollections = cached.collections || [];
    chrome.storage.local.set({ storeData: { collections: currentStoreCollections, products: allProductsData, storeUrl: currentStoreUrl } });
    updateProgress(100, state.isIncremental
        ? `Done! ${state.productsScraped} new products added.`
        : `Complete! ${products.length} products scraped.`);
    // Enable buttons and show collection dropdown
    populateCachedCollectionDropdown(currentStoreCollections);
    const downloadBtn = document.getElementById('downloadBtn');
    const viewResultsBtn = document.getElementById('viewResultsBtn');
    if (downloadBtn) downloadBtn.disabled = false;
    if (viewResultsBtn) viewResultsBtn.disabled = false;
    const resultsSection = document.querySelector('.results-section');
    if (resultsSection) resultsSection.style.display = 'block';
}

async function checkCacheAndStart() {
    if (!currentStoreUrl) { startExtraction(); return; }

    // First check if background is already scraping this store
    const stored = await chrome.storage.local.get('bgScrapeState');
    const bgState = stored.bgScrapeState;
    if (bgState && bgState.isRunning && bgState.storeUrl === currentStoreUrl) {
        isExtracting = true;
        applyBgState(bgState);
        attachProgressListener();
        return;
    }

    // Check IndexedDB cache
    const cached = await ShopifyDB.getScrapedStore(currentStoreUrl);
    if (!cached) { startExtraction(); return; }

    const products = await ShopifyDB.getProductsByStore(currentStoreUrl);
    allProductsData = products;
    currentStoreCollections = cached.collections || [];
    chrome.storage.local.set({ storeData: { collections: currentStoreCollections, products: allProductsData, storeUrl: currentStoreUrl } });
    showCachedBanner(cached);
}

function showCachedBanner(cached) {
    const banner = document.getElementById('cachedBanner');
    const progressSection = document.querySelector('.progress-section');
    const resultsSection = document.querySelector('.results-section');

    // Format date
    const date = new Date(cached.scrapedAt);
    const dateStr = date.toLocaleDateString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });

    document.getElementById('cachedMeta').innerHTML =
        `<strong>${cached.totalProducts} products</strong> from <strong>${cached.collections.length} collections</strong> &nbsp;|&nbsp; Last scraped: ${dateStr}`;

    banner.style.display = 'flex';
    progressSection.style.display = 'none';

    // Enable collection dropdown & action buttons with cached data
    populateCachedCollectionDropdown(cached.collections);
    resultsSection.style.display = 'block';

    const downloadBtn = document.getElementById('downloadBtn');
    const viewResultsBtn = document.getElementById('viewResultsBtn');
    if (downloadBtn) downloadBtn.disabled = false;
    if (viewResultsBtn) viewResultsBtn.disabled = false;
}

function hideCachedBanner() {
    document.getElementById('cachedBanner').style.display = 'none';
    document.querySelector('.progress-section').style.display = 'block';
    document.getElementById('newProductsResult').style.display = 'none';
}

function populateCachedCollectionDropdown(collections) {
    const collectionSelector = document.getElementById('collectionSelector');
    const collectionSelect = document.getElementById('collectionSelect');
    const collectionInfo = document.getElementById('collectionInfo');

    if (!collectionSelect) return;

    collectionSelect.innerHTML = '<option value="all">All Collections (All Products)</option>';

    const countByHandle = {};
    allProductsData.forEach(p => {
        const h = p.collection_handle || p.collectionHandle;
        if (h) countByHandle[h] = (countByHandle[h] || 0) + 1;
    });

    collections.forEach(col => {
        const count = countByHandle[col.handle] || 0;
        const opt = document.createElement('option');
        opt.value = col.handle;
        opt.textContent = `${col.title} (${count} products)`;
        opt.dataset.count = count;
        collectionSelect.appendChild(opt);
    });

    const total = allProductsData.length;
    const allOpt = collectionSelect.querySelector('option[value="all"]');
    if (allOpt) { allOpt.textContent = `All Collections (${total} products)`; allOpt.dataset.count = total; }
    if (collectionInfo) collectionInfo.textContent = `${collections.length} collections · ${total} products (cached)`;
    if (collectionSelector) collectionSelector.style.display = 'block';

    // Update stats
    const collectionsCount = document.getElementById('collectionsCount');
    const productsCount = document.getElementById('productsCount');
    if (collectionsCount) collectionsCount.textContent = collections.length;
    if (productsCount) productsCount.textContent = total;
}

async function checkForNewProducts() {
    const btn = document.getElementById('checkNewBtn');
    const resultDiv = document.getElementById('newProductsResult');

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Checking...';
    resultDiv.style.display = 'none';

    // Hide cached banner, show progress
    hideCachedBanner();
    updateProgress(0, 'Checking for new products...');
    isExtracting = true;

    // Delegate to background (incremental mode)
    chrome.runtime.sendMessage({ action: 'startScraping', storeUrl: currentStoreUrl, incrementalOnly: true });

    attachProgressListener();

    // Listen for completion to show result message
    const onDone = (changes, area) => {
        if (area !== 'local' || !changes.bgScrapeState) return;
        const state = changes.bgScrapeState.newValue;
        if (!state || state.storeUrl !== currentStoreUrl || state.isRunning) return;

        chrome.storage.onChanged.removeListener(onDone);
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-sync-alt"></i> Check New Products';

        if (state.error) {
            resultDiv.style.display = 'block';
            resultDiv.innerHTML = `<i class="fas fa-exclamation-triangle" style="color:#ef4444"></i> ${state.error}`;
            return;
        }

        const added = state.productsScraped || 0;
        resultDiv.style.display = 'block';
        resultDiv.innerHTML = added === 0
            ? `<i class="fas fa-check-circle" style="color:#10b981"></i> No new products found. Your data is up to date!`
            : `<i class="fas fa-plus-circle" style="color:#6366f1"></i> <strong>${added} new products</strong> added! Download CSV to get updated sheet.`;

        // Refresh cached banner with new data
        loadCompletedScrape(state).then(() => {
            ShopifyDB.getScrapedStore(currentStoreUrl).then(c => { if (c) showCachedBanner(c); });
        });
    };
    chrome.storage.onChanged.addListener(onDone);
}

// ── End Smart Cache Logic ────────────────────────────────────────────────────

function startExtraction() {
    if (isExtracting) return;
    isExtracting = true;

    // Reset UI
    allProductsData = [];
    currentStoreCollections = [];
    const downloadBtn   = document.getElementById('downloadBtn');
    const viewResultsBtn = document.getElementById('viewResultsBtn');
    const extractBtn    = document.getElementById('extractBtn');
    const statsContainer = document.getElementById('statsContainer');
    const collectionSelector = document.getElementById('collectionSelector');
    const collectionSelect   = document.getElementById('collectionSelect');
    if (downloadBtn)   downloadBtn.disabled = true;
    if (viewResultsBtn) viewResultsBtn.disabled = true;
    if (extractBtn)   { extractBtn.disabled = true; extractBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Extracting...</span>'; }
    if (statsContainer) statsContainer.style.display = 'none';
    if (collectionSelector) collectionSelector.style.display = 'none';
    if (collectionSelect) collectionSelect.innerHTML = '<option value="all">All Collections (All Products)</option>';

    updateProgress(0, 'Starting background extraction...');

    // Delegate to background service worker — survives popup close
    chrome.runtime.sendMessage({ action: 'startScraping', storeUrl: currentStoreUrl, incrementalOnly: false });
    attachProgressListener();
}

// fetchStoreData removed — scraping now handled by background.js via startBackgroundScraping()

function fetchWithTimeout(url, options = {}, timeout = 10000) {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            reject(new Error('Request timeout'));
        }, timeout);

        fetch(url, options)
            .then(response => {
                clearTimeout(timeoutId);
                resolve(response);
            })
            .catch(error => {
                clearTimeout(timeoutId);
                reject(error);
            });
    });
}

function showResultsPage() {
    chrome.windows.create({
        url: chrome.runtime.getURL('results.html'),
        type: 'popup',
        width: 1200,
        height: 800,
        focused: true
    });
}

function downloadCSV() {
    const exportTypeSelect = document.getElementById('exportType');
    const exportType = exportTypeSelect ? exportTypeSelect.value : 'products';

    if (exportType === 'collections') {
        downloadCollectionsCSV();
    } else {
        downloadProductsCSV();
    }
}

function downloadCollectionsCSV() {
    if (currentStoreCollections.length === 0) {
        alert('No collections available to download');
        return;
    }

    const collectionSelect = document.getElementById('collectionSelect');
    const selectedCollectionHandle = collectionSelect ? collectionSelect.value : 'all';

    const storeName = getStoreNameSlug();
    const dateStr = new Date().toISOString().slice(0, 10);

    let collectionsToExport = currentStoreCollections;
    let fileName = `${storeName}_collections_${dateStr}.csv`;

    if (selectedCollectionHandle !== 'all') {
        collectionsToExport = currentStoreCollections.filter(
            c => c.handle === selectedCollectionHandle
        );

        const selectedCollection = currentStoreCollections.find(
            c => c.handle === selectedCollectionHandle
        );
        const collectionTitle = selectedCollection ?
            selectedCollection.title.replace(/[^a-z0-9]/gi, '_').toLowerCase() :
            selectedCollectionHandle;
        fileName = `${storeName}_collections_${collectionTitle}_${dateStr}.csv`;
    }

    // Filter out collections with 0 products
    const productsByCollection = {};
    allProductsData.forEach(product => {
        if (product.collection_handle) {
            productsByCollection[product.collection_handle] = (productsByCollection[product.collection_handle] || 0) + 1;
        }
    });

    collectionsToExport = collectionsToExport.filter(c => productsByCollection[c.handle] > 0);

    if (collectionsToExport.length === 0) {
        alert('No collections with products found');
        return;
    }

    if (collectionsToExport.length === 0) {
        alert('No collections found for the selected option');
        return;
    }

    // Shopify Collections CSV format
    const headers = [
        'Handle',
        'Title',
        'Body (HTML)',
        'Published',
        'Image Src',
        'Image Alt Text',
        'Sort Order',
        'Template Suffix',
        'Meta Title',
        'Meta Description',
        'Url Handle'
    ];

    const csvRows = [];
    csvRows.push(headers.join(','));

    collectionsToExport.forEach(collection => {
        const row = [
            `"${escapeCsvValue(collection.handle || '')}"`,
            `"${escapeCsvValue(collection.title || '')}"`,
            `"${escapeCsvValue(collection.body_html || '')}"`,
            collection.published_at ? 'TRUE' : 'FALSE',
            `"${escapeCsvValue(collection.image?.src || '')}"`,
            `"${escapeCsvValue(collection.image?.alt || '')}"`,
            `"${escapeCsvValue(collection.sort_order || 'best-selling')}"`,
            `"${escapeCsvValue(collection.template_suffix || '')}"`,
            `"${escapeCsvValue(collection.metafields_global_title_tag || '')}"`,
            `"${escapeCsvValue(collection.metafields_global_description_tag || '')}"`,
            `"${escapeCsvValue(collection.handle || '')}"`
        ];

        csvRows.push(row.join(','));
    });

    // Create CSV file with BOM for UTF-8
    const csvContent = "\uFEFF" + csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    // Create download link
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', fileName);

    // Append to body (required for Firefox)
    document.body.appendChild(link);

    // Trigger download
    link.click();

    // Clean up
    document.body.removeChild(link);
    setTimeout(() => {
        URL.revokeObjectURL(url);
    }, 100);
}

function getStoreNameSlug() {
    try {
        return new URL(currentStoreUrl).hostname.replace(/\./g, '_');
    } catch {
        return 'store';
    }
}

function downloadProductsCSV() {
    if (allProductsData.length === 0) {
        alert('No product data available to download');
        return;
    }

    const collectionSelect = document.getElementById('collectionSelect');
    const selectedCollectionHandle = collectionSelect ? collectionSelect.value : 'all';
    const storeName = getStoreNameSlug();
    const dateStr = new Date().toISOString().slice(0, 10);

    let productsToExport = allProductsData;
    let fileNameBase = `${storeName}_products_${dateStr}`;

    if (selectedCollectionHandle !== 'all') {
        productsToExport = allProductsData.filter(
            p => p.collection_handle === selectedCollectionHandle
        );

        const selectedCollection = currentStoreCollections.find(
            c => c.handle === selectedCollectionHandle
        );
        const collectionTitle = selectedCollection ?
            selectedCollection.title.replace(/[^a-z0-9]/gi, '_').toLowerCase() :
            selectedCollectionHandle;
        fileNameBase = `${storeName}_${collectionTitle}_${dateStr}`;
    }

    if (productsToExport.length === 0) {
        alert('No products found for the selected collection');
        return;
    }

    // Helper to get high-res image
    function getHighResImage(url) {
        if (!url) return '';
        return url.replace(/_(?:[0-9]+x[0-9]+|pico|icon|thumb|small|compact|medium|large|grande|1024x1024|2048x2048)(?=\.[a-zA-Z0-9]+(?:\?.*)?$)/i, '');
    }

    // Shopify standard import format - optimized for direct import
    const headers = [
        'Handle', 'Title', 'Body (HTML)', 'Vendor', 'Product Category', 'Type', 'Tags',
        'Published', 'Option1 Name', 'Option1 Value', 'Option2 Name', 'Option2 Value',
        'Option3 Name', 'Option3 Value', 'Variant SKU', 'Variant Grams',
        'Variant Inventory Tracker', 'Variant Inventory Qty', 'Variant Inventory Policy',
        'Variant Fulfillment Service', 'Variant Price', 'Variant Compare At Price',
        'Variant Requires Shipping', 'Variant Taxable', 'Variant Barcode',
        'Image Src', 'Image Position', 'Image Alt Text', 'Gift Card',
        'SEO Title', 'SEO Description',
        'Google Shopping / Google Product Category', 'Google Shopping / Gender',
        'Google Shopping / Age Group', 'Google Shopping / MPN',
        'Google Shopping / Condition', 'Google Shopping / Custom Product',
        'Google Shopping / Custom Label 0', 'Google Shopping / Custom Label 1',
        'Google Shopping / Custom Label 2', 'Google Shopping / Custom Label 3',
        'Google Shopping / Custom Label 4', 'Variant Image', 'Variant Weight Unit',
        'Variant Tax Code', 'Cost per item', 'Price / International',
        'Compare At Price / International', 'Status', 'Collection'
    ];

    // Generate all CSV rows first to estimate size
    const allRows = [];
    productsToExport.forEach(product => {
        const variants = product.variants && product.variants.length > 0 ? product.variants : [{}];
        const images = product.images || [];
        const maxRows = Math.max(variants.length, images.length > 0 ? images.length : 1);

        for (let i = 0; i < maxRows; i++) {
            const variant = i < variants.length ? variants[i] : {};
            const image = i < images.length ? images[i] : null;
            const variantImage = variant.featured_image ? variant.featured_image.src : '';

            const row = [
                `"${escapeCsvValue(product.handle)}"`,
                `"${escapeCsvValue(product.title)}"`,
                `"${escapeCsvValue(product.body_html)}"`,
                `"${escapeCsvValue(product.vendor)}"`,
                `"${escapeCsvValue(product.product_type || '')}"`, // Product Category
                `"${escapeCsvValue(product.product_type || '')}"`, // Type
                `"${escapeCsvValue(product.tags)}"`,
                product.published_at ? 'true' : 'false',
                `"${escapeCsvValue(product.options && product.options[0] ? product.options[0].name : '')}"`,
                `"${escapeCsvValue(variant.option1)}"`,
                `"${escapeCsvValue(product.options && product.options[1] ? product.options[1].name : '')}"`,
                `"${escapeCsvValue(variant.option2)}"`,
                `"${escapeCsvValue(product.options && product.options[2] ? product.options[2].name : '')}"`,
                `"${escapeCsvValue(variant.option3)}"`,
                `"${escapeCsvValue(variant.sku)}"`,
                variant.grams !== undefined ? variant.grams : (i < variants.length ? '0' : ''),
                `"${escapeCsvValue(variant.inventory_management || '')}"`,
                variant.inventory_quantity !== undefined ? variant.inventory_quantity : (i < variants.length ? '0' : ''),
                `"${escapeCsvValue(variant.inventory_policy || (i < variants.length ? 'deny' : ''))}"`,
                `"${escapeCsvValue(variant.fulfillment_service || (i < variants.length ? 'manual' : ''))}"`,
                variant.price !== undefined && variant.price !== null ? variant.price : (i < variants.length ? '0.00' : ''),
                variant.compare_at_price || '',
                variant.requires_shipping !== undefined ? (variant.requires_shipping ? 'true' : 'false') : (i < variants.length ? 'false' : ''),
                variant.taxable !== undefined ? (variant.taxable ? 'true' : 'false') : (i < variants.length ? 'false' : ''),
                `"${escapeCsvValue(variant.barcode)}"`,
                `"${escapeCsvValue(getHighResImage(image?.src))}"`, // Image Src
                image ? String(i + 1) : '',
                `"${escapeCsvValue(image && image.alt ? image.alt : (image ? product.title : ''))}"`, // Image Alt Text
                product.gift_card ? 'true' : 'false',
                `"${escapeCsvValue(product.metafields_global_title_tag || '')}"`,
                `"${escapeCsvValue(product.metafields_global_description_tag || '')}"`,
                `""`, `""`, `""`, `""`, `""`, `""`, `""`, `""`, `""`, `""`, `""`, // Google Shopping
                `"${escapeCsvValue(getHighResImage(variantImage))}"`, // Variant Image
                `"${escapeCsvValue(variant.weight_unit || (i < variants.length ? 'kg' : ''))}"`,
                `""`, `""`, `""`, `""`, // Tax code, Cost, Price Int...
                `"${escapeCsvValue(product.status || 'active')}"`, // Status
                `"${escapeCsvValue(product.collection_title || '')}"` // Collection - Shopify will link products to this collection
            ];

            allRows.push(row.join(','));
        }
    });

    const headerRow = headers.join(',');
    downloadCSVChunk([headerRow, ...allRows], `${fileNameBase}.csv`);
}

function downloadCSVChunk(rows, fileName) {
    const csvContent = "\uFEFF" + rows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => {
        URL.revokeObjectURL(url);
    }, 100);
}

function escapeCsvValue(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/"/g, '""');
}

function showError(message) {
    const progressContainer = document.querySelector('.progress-section');
    const errorCard = document.createElement('div');
    errorCard.className = 'error-card';
    errorCard.innerHTML = message;
    progressContainer.appendChild(errorCard);

    // Add retry button
    const retryBtn = document.createElement('button');
    retryBtn.className = 'btn retry-btn';
    retryBtn.innerHTML = '<i class="fas fa-redo"></i><span>Retry Extraction</span>';
    retryBtn.addEventListener('click', function () {
        errorCard.remove();
        startExtraction();
    });
    progressContainer.appendChild(retryBtn);
}

function updateProgress(percent, message = '', isError = false) {
    const progressRing = document.querySelector('.progress-ring-circle');
    const percentageText = document.querySelector('.percentage');
    const progressMessage = document.getElementById('progressMessage');

    // Ensure percent stays between 0-100
    percent = Math.max(0, Math.min(100, Math.round(percent)));

    // Calculate the dash offset for the circular progress
    // Fixed: Use the correct radius (45) for calculation
    const circumference = 2 * Math.PI * 45;
    const offset = circumference - (percent / 100) * circumference;

    // Update progress ring
    progressRing.style.strokeDashoffset = offset;

    // Update percentage text
    percentageText.textContent = `${percent}%`;

    // Update progress message if provided
    if (message) {
        progressMessage.textContent = message;
    }

    // Handle error state
    if (isError) {
        progressRing.style.stroke = 'var(--error)';
        percentageText.style.color = 'var(--error)';
    } else {
        progressRing.style.stroke = 'url(#gradient)';
        percentageText.style.color = '';
    }
}

function resetExtractButton() {
    const extractBtn = document.getElementById('extractBtn');
    if (extractBtn) {
        extractBtn.disabled = false;
        extractBtn.innerHTML = '<i class="fas fa-bolt"></i><span>Extract Data</span>';
    }
    isExtracting = false;
}

// Fetch helper with timeout to avoid hanging requests
async function fetchWithTimeout(resource, options = {}) {
    const { timeout = 8000 } = options;

    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(resource, {
        ...options,
        signal: controller.signal
    });
    clearTimeout(id);
    return response;
}

// Tab Switching Functionality
document.addEventListener('DOMContentLoaded', function () {
    // Tab navigation
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', function () {
            const targetTab = this.getAttribute('data-tab');

            // Remove active class from all buttons and contents
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));

            // Add active class to clicked button and corresponding content
            this.classList.add('active');
            document.getElementById(targetTab + '-tab').classList.add('active');

            // Auto-load theme info when About Theme tab is clicked
            if (targetTab === 'detector') {
                detectThemeInfo();
            }
        });
    });
});

// Theme/Store Detector Function
async function detectThemeInfo() {
    const storeNameEl = document.getElementById('storeName');
    const themeIdEl = document.getElementById('themeId');
    const themeNameEl = document.getElementById('themeName');
    const themeVersionEl = document.getElementById('themeVersion');
    const themePlanEl = document.getElementById('themePlan');
    const platformEl = document.getElementById('platform');
    const mobileEl = document.getElementById('mobile');
    const emailEl = document.getElementById('email');

    // Set loading state
    storeNameEl.textContent = 'Detecting...';
    themeIdEl.textContent = 'Detecting...';
    themeNameEl.textContent = 'Detecting...';
    themeVersionEl.textContent = 'Detecting...';
    themePlanEl.textContent = 'Detecting...';
    if (platformEl) platformEl.textContent = 'Detecting...';
    if (mobileEl) mobileEl.textContent = 'Detecting...';
    if (emailEl) emailEl.textContent = 'Detecting...';

    try {
        // Get current tab
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs.length === 0) {
            throw new Error('No active tab found');
        }

        const tab = tabs[0];
        const url = new URL(tab.url);
        const storeDomain = url.hostname;

        // Inject content script to detect theme info
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            function: detectShopifyTheme
        });

        if (results && results[0] && results[0].result) {
            const themeData = results[0].result;

            storeNameEl.textContent = themeData.storeName || storeDomain;
            themeIdEl.textContent = themeData.themeId || 'N/A';
            themeNameEl.textContent = themeData.themeName || 'N/A';
            themeVersionEl.textContent = themeData.themeVersion || 'N/A';

            // Format plan gracefully (e.g. 'basic' to 'Basic', 'enterprise' to 'Plus / Enterprise')
            if (themeData.themePlan) {
                let planStr = themeData.themePlan.toLowerCase().trim();
                if (planStr === 'enterprise' || planStr === 'custom' || planStr === 'plus') {
                    themePlanEl.textContent = 'Shopify Plus';
                } else {
                    themePlanEl.textContent = planStr.charAt(0).toUpperCase() + planStr.slice(1);
                }
            } else {
                themePlanEl.textContent = 'Basic';
            }
            if (platformEl) platformEl.textContent = themeData.platform || 'Shopify';
            if (mobileEl) mobileEl.textContent = themeData.mobile || 'Not Found';
            if (emailEl) emailEl.textContent = themeData.email || 'Not Found';
        } else {
            // Fallback: use store URL as store name
            storeNameEl.textContent = storeDomain;
            themeIdEl.textContent = 'Not detected';
            themeNameEl.textContent = 'Not detected';
            themeVersionEl.textContent = 'N/A';
            themePlanEl.textContent = 'N/A';
            if (platformEl) platformEl.textContent = 'Shopify';
            if (mobileEl) mobileEl.textContent = 'Not Found';
            if (emailEl) emailEl.textContent = 'Not Found';
        }
    } catch (error) {
        console.error('Error detecting theme:', error);
        storeNameEl.textContent = 'Error';
        themeIdEl.textContent = 'Error';
        themeNameEl.textContent = 'Error';
        themeVersionEl.textContent = 'Error';
        themePlanEl.textContent = 'Error';
        if (platformEl) platformEl.textContent = 'Error';
        if (mobileEl) mobileEl.textContent = 'Error';
        if (emailEl) emailEl.textContent = 'Error';
    }
}

// Function to run in page context to detect theme info
function detectShopifyTheme() {
    const result = {
        storeName: null,
        themeId: null,
        themeName: null,
        themeVersion: null,
        themePlan: null,
        platform: 'Shopify',
        mobile: null,
        email: null
    };

    try {
        // Try to get store name from various sources
        if (window.Shopify && window.Shopify.shop) {
            result.storeName = window.Shopify.shop;
        }

        // Look for theme ID in various places
        const themeScript = document.querySelector('script[data-theme-id]');
        if (themeScript) {
            result.themeId = themeScript.getAttribute('data-theme-id');
        }

        // Look for theme ID in window.Shopify.theme (common in Shopify themes)
        if (window.Shopify?.theme?.id) {
            result.themeId = window.Shopify.theme.id.toString();
        }
        // Get schema_name from Shopify.theme object
        if (window.Shopify?.theme?.schema_name) {
            result.themeName = window.Shopify.theme.schema_name;
        }
        if (window.theme?.id) {
            result.themeId = window.theme.id.toString();
        }

        // Look for theme ID and schema_version in script tags
        const scripts = document.querySelectorAll('script');
        scripts.forEach(script => {
            const text = script.textContent || '';
            // Match Shopify theme IDs (typically 12-15 digit numbers)
            const idMatch = text.match(/"id"\s*:\s*(\d{12,15})/);
            if (idMatch && idMatch[1]) {
                result.themeId = idMatch[1];
            }

            // Match schema_version for Theme Version
            const schemaMatch = text.match(/"schema_version"\s*:\s*"([^"]+)"/);
            if (schemaMatch && schemaMatch[1]) {
                result.themeVersion = schemaMatch[1];
            }

            // Match schema_name for Theme Name
            const schemaNameMatch = text.match(/"schema_name"\s*:\s*"([^"]+)"/);
            if (schemaNameMatch && schemaNameMatch[1] && !result.themeName) {
                result.themeName = schemaNameMatch[1];
            }

            // Match Shopify plan commonly logged in __st.plan_name internally by Shopify
            if (!result.themePlan) {
                const planNameMatch = text.match(/["']plan_name["']\s*:\s*["']([^"']+)["']/i);
                if (planNameMatch && planNameMatch[1]) {
                    result.themePlan = planNameMatch[1];
                } else {
                    // Fallbacks for Shopify Analytics
                    const analyticsPlan = text.match(/ShopifyAnalytics\.meta[\s\S]*?["']?plan["']?\s*:\s*["']([^"']+)["']/i);
                    if (analyticsPlan && analyticsPlan[1]) {
                        result.themePlan = analyticsPlan[1];
                    }
                }
            }
        });

        // Detect Store Mobile/Phone Number
        try {
            // 1. Check for tel: links
            const telLinks = document.querySelectorAll('a[href^="tel:"]');
            if (telLinks.length > 0) {
                result.mobile = telLinks[0].href.replace('tel:', '').trim();
            }

            if (!result.mobile) {
                // 2. Look for obvious phone-related meta tags or JSON-LD
                const scriptTags = document.querySelectorAll('script[type="application/ld+json"]');
                for (let script of scriptTags) {
                    try {
                        const json = JSON.parse(script.innerText);
                        if (json && json.telephone) {
                            result.mobile = json.telephone;
                            break;
                        }
                        // Also check within array format
                        if (Array.isArray(json)) {
                            const match = json.find(j => j.telephone);
                            if (match) {
                                result.mobile = match.telephone;
                                break;
                            }
                        }
                    } catch (e) { }
                }
            }

            if (!result.mobile) {
                // 3. RegEx search the text body for common phone formats, prioritizing header/footer
                const docText = (document.querySelector('header')?.innerText || '') + ' ' + (document.querySelector('footer')?.innerText || '');
                // Basic regex for common formats like (123) 456-7890, 123-456-7890, +1 234 567 8900
                const phoneMatch = docText.match(/(?:(?:\+?1\s*(?:[.-]\s*)?)?(?:\(\s*([2-9]1[02-9]|[2-9][02-8]1|[2-9][02-8][02-9])\s*\)|([2-9]1[02-9]|[2-9][02-8]1|[2-9][02-8][02-9]))\s*(?:[.-]\s*)?)?([2-9]1[02-9]|[2-9][02-9]1|[2-9][02-9]{2})\s*(?:[.-]\s*)?([0-9]{4})(?:\s*(?:#|x\.?|ext\.?|extension)\s*(\d+))?/i);
                if (phoneMatch && phoneMatch[0]) {
                    // Make sure it truly looks like a number and not random digits
                    let p = phoneMatch[0].trim();
                    if (p.replace(/\D/g, '').length >= 10) {
                        result.mobile = p;
                    }
                }
            }
        } catch (e) {
            console.log('Error detecting mobile:', e);
        }

        // Detect Store Email
        try {
            // 1. Check for mailto: links
            const mailtoLinks = document.querySelectorAll('a[href^="mailto:"]');
            if (mailtoLinks.length > 0) {
                result.email = mailtoLinks[0].href.replace('mailto:', '').split('?')[0].trim();
            }

            if (!result.email) {
                // 2. Look in JSON-LD
                const scriptTags = document.querySelectorAll('script[type="application/ld+json"]');
                for (let script of scriptTags) {
                    try {
                        const json = JSON.parse(script.innerText);
                        if (json && json.email) {
                            result.email = json.email;
                            break;
                        }
                        if (Array.isArray(json)) {
                            const match = json.find(j => j.email);
                            if (match) {
                                result.email = match.email;
                                break;
                            }
                        }
                    } catch (e) { }
                }
            }

            if (!result.email) {
                // 3. RegEx search footer and header
                const docText = (document.querySelector('footer')?.innerText || '') + ' ' + (document.querySelector('header')?.innerText || '');
                const emailMatch = docText.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/i);
                if (emailMatch && emailMatch[1]) {
                    // Ignore common image/asset extensions that might look like emails via regex matching
                    const ext = emailMatch[1].split('.').pop().toLowerCase();
                    if (!['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) {
                        result.email = emailMatch[1];
                    }
                }
            }
        } catch (e) {
            console.log('Error detecting email:', e);
        }

        // Try to find theme name from meta tags or body attributes
        const themeMeta = document.querySelector('meta[name="theme"]');
        if (themeMeta) {
            result.themeName = themeMeta.getAttribute('content');
        }

        // Look for Shopify theme configuration
        const bodyClasses = document.body.className;
        const themeMatch = bodyClasses.match(/theme-(\d+)/);
        if (themeMatch) {
            result.themeId = themeMatch[1];
        }

        // Try to get theme info from window object
        if (window.theme) {
            if (window.theme.id) result.themeId = window.theme.id.toString();
            if (window.theme.name) result.themeName = window.theme.name;
            if (window.theme.version && !result.themeVersion) result.themeVersion = window.theme.version;
        }

        // Look for theme JSON in page
        const themeJsonEl = document.querySelector('#theme-json');
        if (themeJsonEl) {
            try {
                const themeData = JSON.parse(themeJsonEl.textContent);
                if (themeData.id) result.themeId = themeData.id.toString();
                if (themeData.name) result.themeName = themeData.name;
            } catch (e) { }
        }

        // Try to get from Shopify analytics or routes
        if (window.Shopify?.routes?.root) {
            // Store is confirmed to be Shopify
        }

    } catch (error) {
        console.error('Error in detectShopifyTheme:', error);
    }

    return result;
}

// ── Hamburger → opens History Window ────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('hamburgerBtn').addEventListener('click', () => {
        chrome.windows.create({
            url: chrome.runtime.getURL('history.html'),
            type: 'popup',
            width: Math.min(screen.availWidth, 1100),
            height: Math.min(screen.availHeight, 700),
            focused: true
        });
    });
});