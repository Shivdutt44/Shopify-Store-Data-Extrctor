// Background service worker for the extension
chrome.runtime.onInstalled.addListener(() => {
    console.log('Shopify Data Extractor installed');
});

// Listen for messages from content scripts or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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
chrome.action.onClicked.addListener((tab) => {
    // This will open the popup when the extension icon is clicked
    // The popup.html is set as the default in manifest.json
});