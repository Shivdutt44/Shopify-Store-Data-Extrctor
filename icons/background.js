// Background service worker for the extension
chrome.runtime.onInstalled.addListener(() => {
    console.log('Shopify Data Extractor installed');
});

// Listen for messages from content scripts or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "checkShopify") {
        // Check if the current page is a Shopify store
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            if (tabs.length === 0) {
                sendResponse({isShopify: false});
                return;
            }
            
            chrome.scripting.executeScript({
                target: {tabId: tabs[0].id},
                func: isShopifyStore
            }, (results) => {
                if (chrome.runtime.lastError) {
                    console.error('Error checking Shopify:', chrome.runtime.lastError);
                    sendResponse({isShopify: false});
                    return;
                }
                
                sendResponse({isShopify: results[0].result});
            });
        });
        
        return true; // Will respond asynchronously
    }
});

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