// Content script to detect Shopify stores
(function() {
    // Listen for messages from the extension
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "isShopify") {
            sendResponse({isShopify: isShopifyStore()});
        }
        return true;
    });
    
    function isShopifyStore() {
        // Check for Shopify-specific elements and patterns
        const shopifyIndicators = [
            window.Shopify && typeof window.Shopify === 'object',
            document.querySelector('[data-shopify]'),
            document.querySelector('[class*="shopify"]'),
            document.querySelector('link[href*="shopify"]'),
            document.body.innerHTML.includes('shopify'),
            document.querySelector('script[src*="shopify"]'),
            // Additional checks for common Shopify patterns
            document.querySelector('.shopify-section'),
            document.querySelector('[data-section-type]'),
            document.querySelector('[data-section-id]')
        ];
        
        return shopifyIndicators.some(indicator => indicator);
    }
    
    // Expose function to popup via chrome.scripting.executeScript
    if (typeof window.isShopifyStore === 'undefined') {
        window.isShopifyStore = isShopifyStore;
    }
})();