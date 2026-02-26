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

                // Automatically start extraction if not already extracting
                if (!isExtracting) {
                    setTimeout(() => {
                        startExtraction();
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

function startExtraction() {
    if (isExtracting) return;

    isExtracting = true;
    const extractBtn = document.getElementById('extractBtn');
    if (extractBtn) {
        extractBtn.disabled = true;
        extractBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Extracting...</span>';
    }

    // Reset state
    allProductsData = [];
    currentStoreCollections = [];
    const downloadBtn = document.getElementById('downloadBtn');
    const viewResultsBtn = document.getElementById('viewResultsBtn');
    if (downloadBtn) {
        downloadBtn.disabled = true;
    }
    if (viewResultsBtn) {
        viewResultsBtn.disabled = true;
    }
    const statsContainer = document.getElementById('statsContainer');
    if (statsContainer) {
        statsContainer.style.display = 'none';
    }
    const collectionSelector = document.getElementById('collectionSelector');
    if (collectionSelector) {
        collectionSelector.style.display = 'none';
    }
    const collectionSelect = document.getElementById('collectionSelect');
    if (collectionSelect) {
        collectionSelect.innerHTML = '<option value="all">All Collections (All Products)</option>';
    }

    // Start extraction process
    fetchStoreData();
}

async function fetchStoreData() {
    const progressRing = document.querySelector('.progress-ring-circle');
    const percentageText = document.querySelector('.percentage');
    const progressMessage = document.getElementById('progressMessage');
    const collectionsCount = document.getElementById('collectionsCount');
    const productsCount = document.getElementById('productsCount');
    const collectionSelect = document.getElementById('collectionSelect');
    const collectionInfo = document.getElementById('collectionInfo');
    const extractBtn = document.getElementById('extractBtn');
    const statsContainer = document.getElementById('statsContainer');

    if (!currentStoreUrl) {
        showError('No store URL detected. Please navigate to a Shopify store first.');
        resetExtractButton();
        return;
    }

    updateProgress(0, 'Initializing automatic extraction...');

    try {
        // First, try to fetch collections
        updateProgress(10, 'Connecting to store for automatic extraction...');
        const collectionsUrl = `${currentStoreUrl}/collections.json`;
        const collectionsResponse = await fetchWithTimeout(collectionsUrl, {
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!collectionsResponse.ok) {
            throw new Error(`HTTP error! status: ${collectionsResponse.status}`);
        }

        const collectionsData = await collectionsResponse.json();
        updateProgress(30, 'Analyzing collections for automatic extraction...');

        if (collectionsData && collectionsData.collections) {
            const collections = collectionsData.collections;
            currentStoreCollections = collections;

            if (collections.length === 0) {
                showError('No collections found in this store');
                updateProgress(100, 'No collections found', true);
                resetExtractButton();
                return;
            }

            // Update stats
            if (collectionsCount) {
                collectionsCount.textContent = collections.length;
            }
            if (statsContainer) {
                statsContainer.style.display = 'grid';
            }

            // Populate collection dropdown with product counts
            let totalProducts = 0;
            const productCountsByCollection = {};

            // First get all collection handles to count products
            for (let i = 0; i < collections.length; i++) {
                const collection = collections[i];
                try {
                    const progress = 30 + Math.floor((i / collections.length) * 20);
                    updateProgress(progress, `Counting products in ${collection.title} for automatic extraction...`);

                    const productsUrl = `${currentStoreUrl}/collections/${collection.handle}/products.json`;
                    const productsResponse = await fetchWithTimeout(productsUrl, {
                        headers: {
                            'Accept': 'application/json'
                        }
                    });

                    if (productsResponse.ok) {
                        const productsData = await productsResponse.json();
                        if (productsData && productsData.products) {
                            const products = productsData.products;
                            productCountsByCollection[collection.handle] = products.length;
                            totalProducts += products.length;
                        } else {
                            productCountsByCollection[collection.handle] = 0;
                        }
                    } else {
                        productCountsByCollection[collection.handle] = 0;
                    }
                } catch (error) {
                    console.error(`Error counting products for collection ${collection.title}:`, error);
                    productCountsByCollection[collection.handle] = 0;
                }
            }

            // Now populate the dropdown with counts
            if (collectionSelect) {
                collections.forEach(collection => {
                    const productCount = productCountsByCollection[collection.handle] || 0;
                    const option = document.createElement('option');
                    option.value = collection.handle;
                    option.textContent = `${collection.title} (${productCount} products)`;
                    option.dataset.count = productCount;
                    collectionSelect.appendChild(option);
                });
            }

            // Update the "All Collections" option with total count
            const allOption = collectionSelect ? collectionSelect.querySelector('option[value="all"]') : null;
            if (allOption) {
                allOption.textContent = `All Collections (${totalProducts} products)`;
                allOption.dataset.count = totalProducts;
            }

            // Update collection info
            if (collectionInfo) {
                collectionInfo.textContent = `Found ${collections.length} collections with ${totalProducts} total products`;
            }

            // Now fetch all products for each collection
            for (let i = 0; i < collections.length; i++) {
                const collection = collections[i];
                try {
                    const progress = 50 + Math.floor((i / collections.length) * 40);
                    updateProgress(progress, `Fetching ${collection.title} products for automatic extraction...`);

                    const productsUrl = `${currentStoreUrl}/collections/${collection.handle}/products.json`;
                    const productsResponse = await fetchWithTimeout(productsUrl, {
                        headers: {
                            'Accept': 'application/json'
                        }
                    });

                    if (productsResponse.ok) {
                        const productsData = await productsResponse.json();

                        if (productsData && productsData.products) {
                            const products = productsData.products;

                            // Store products for CSV export with all possible fields
                            products.forEach(product => {
                                const productData = {
                                    // Basic product info
                                    handle: product.handle || '',
                                    title: product.title || '',
                                    body_html: product.body_html || '',
                                    vendor: product.vendor || '',
                                    product_type: product.product_type || '',
                                    tags: product.tags || '',
                                    published_at: product.published_at || '',
                                    created_at: product.created_at || '',
                                    updated_at: product.updated_at || '',
                                    template_suffix: product.template_suffix || '',
                                    published_scope: product.published_scope || '',
                                    status: product.status || 'active',

                                    // SEO fields
                                    metafields_global_title_tag: product.metafields_global_title_tag || '',
                                    metafields_global_description_tag: product.metafields_global_description_tag || '',

                                    // Options
                                    options: product.options || [],

                                    // Variants
                                    variants: product.variants || [],

                                    // Images
                                    images: product.images || [],
                                    image: product.image || null,

                                    // Collection info
                                    collection_title: collection.title || '',
                                    collection_handle: collection.handle || '',

                                    // Additional fields
                                    requires_shipping: product.requires_shipping || false,
                                    taxable: product.taxable || false,
                                    gift_card: product.gift_card || false,
                                    inventory_quantity: product.variants?.[0]?.inventory_quantity || 0,
                                    inventory_management: product.variants?.[0]?.inventory_management || '',
                                    inventory_policy: product.variants?.[0]?.inventory_policy || 'deny',
                                    fulfillment_service: product.variants?.[0]?.fulfillment_service || 'manual',
                                    weight: product.variants?.[0]?.weight || 0,
                                    weight_unit: product.variants?.[0]?.weight_unit || 'kg',
                                    price: product.variants?.[0]?.price || '0.00',
                                    compare_at_price: product.variants?.[0]?.compare_at_price || '0.00',
                                    sku: product.variants?.[0]?.sku || '',
                                    barcode: product.variants?.[0]?.barcode || '',
                                    grams: product.variants?.[0]?.grams || 0
                                };
                                allProductsData.push(productData);
                            });

                            // Update products count
                            if (productsCount) {
                                productsCount.textContent = allProductsData.length;
                            }
                        }
                    }
                } catch (error) {
                    console.error(`Error fetching products for collection ${collection.title}:`, error);
                }
            }

            // Show collection selector
            const collectionSelector = document.getElementById('collectionSelector');
            if (collectionSelector) {
                collectionSelector.style.display = 'block';
            }

            // Complete progress
            updateProgress(100, 'Automatic extraction complete!');

            // Enable buttons if we have data
            if (allProductsData.length > 0) {
                const downloadBtn = document.getElementById('downloadBtn');
                const viewResultsBtn = document.getElementById('viewResultsBtn');
                if (downloadBtn) {
                    downloadBtn.disabled = false;
                }
                if (viewResultsBtn) {
                    viewResultsBtn.disabled = false;
                }
            }

            // Store data for results page
            chrome.storage.local.set({
                storeData: {
                    collections: currentStoreCollections,
                    products: allProductsData,
                    storeUrl: currentStoreUrl
                }
            });

        } else {
            showError('No collections found or data format unexpected. This might not be a Shopify store.');
            updateProgress(100, 'Extraction failed', true);
            resetExtractButton();
        }
    } catch (error) {
        console.error('Error fetching store data:', error);
        updateProgress(100, 'Extraction failed', true);

        let errorMessage = `
            <div class="error-title">
                <i class="fas fa-times-circle"></i>
                Extraction Failed
            </div>
            <div class="error-message">
                We couldn't extract data from this store. Possible reasons:
                <ul class="error-list">
                    <li>The store doesn't allow public access to collections/products</li>
                    <li>The store has CORS restrictions</li>
                    <li>The URL is not a valid Shopify store</li>
                    <li>You've reached rate limits (try again later)</li>
                </ul>
            </div>
        `;

        // Add specific error information if available
        if (error.message) {
            errorMessage += `
                <div class="error-message" style="margin-top: 10px; font-size: 12px;">
                    <strong>Technical Details:</strong> ${error.message}
                </div>
            `;
        }

        showError(errorMessage);

        resetExtractButton();
    } finally {
        isExtracting = false;
    }
}

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
    if (allProductsData.length === 0) {
        alert('No product data available to download');
        return;
    }

    const collectionSelect = document.getElementById('collectionSelect');
    const selectedCollectionHandle = collectionSelect.value;

    let productsToExport = allProductsData;
    let fileName = `shopify_products_${new Date().toISOString().slice(0, 10)}.csv`;

    if (selectedCollectionHandle !== 'all') {
        productsToExport = allProductsData.filter(
            p => p.collection_handle === selectedCollectionHandle
        );

        // Get the collection title for the filename
        const selectedCollection = currentStoreCollections.find(
            c => c.handle === selectedCollectionHandle
        );
        const collectionTitle = selectedCollection ?
            selectedCollection.title.replace(/[^a-z0-9]/gi, '_').toLowerCase() :
            selectedCollectionHandle;
        fileName = `shopify_products_${collectionTitle}_${new Date().toISOString().slice(0, 10)}.csv`;
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

    // Shopify standard import format + all tracked fields
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
        'Compare At Price / International', 'Status',
        // Our extra fields
        'Published At', 'Created At', 'Updated At', 'Template Suffix',
        'Published Scope', 'Collection Title', 'Collection Handle'
    ];

    const csvRows = [];
    csvRows.push(headers.join(','));

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
                `""`, // Product Category
                `"${escapeCsvValue(product.product_type || product.type)}"`, // Type
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

                // Extra info
                `"${escapeCsvValue(product.published_at)}"`,
                `"${escapeCsvValue(product.created_at)}"`,
                `"${escapeCsvValue(product.updated_at)}"`,
                `"${escapeCsvValue(product.template_suffix)}"`,
                `"${escapeCsvValue(product.published_scope)}"`,
                `"${escapeCsvValue(product.collection_title)}"`,
                `"${escapeCsvValue(product.collection_handle)}"`
            ];

            csvRows.push(row.join(','));
        }
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

    // Set loading state
    storeNameEl.textContent = 'Detecting...';
    themeIdEl.textContent = 'Detecting...';
    themeNameEl.textContent = 'Detecting...';
    themeVersionEl.textContent = 'Detecting...';
    themePlanEl.textContent = 'Detecting...';
    if (platformEl) platformEl.textContent = 'Detecting...';

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
        } else {
            // Fallback: use store URL as store name
            storeNameEl.textContent = storeDomain;
            themeIdEl.textContent = 'Not detected';
            themeNameEl.textContent = 'Not detected';
            themeVersionEl.textContent = 'N/A';
            themePlanEl.textContent = 'N/A';
            if (platformEl) platformEl.textContent = 'Shopify';
        }
    } catch (error) {
        console.error('Error detecting theme:', error);
        storeNameEl.textContent = 'Error';
        themeIdEl.textContent = 'Error';
        themeNameEl.textContent = 'Error';
        themeVersionEl.textContent = 'Error';
        themePlanEl.textContent = 'Error';
        if (platformEl) platformEl.textContent = 'Error';
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
        platform: 'Shopify'
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