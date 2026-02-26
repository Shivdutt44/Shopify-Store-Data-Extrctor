document.addEventListener('DOMContentLoaded', function () {
    const tabsWrapper = document.getElementById('tabsWrapper');
    const tabsContainer = document.getElementById('tabs');
    const tabContent = document.getElementById('tabContent');
    const prevTabBtn = document.getElementById('prevTabBtn');
    const nextTabBtn = document.getElementById('nextTabBtn');
    const storeUrlDisplay = document.getElementById('storeUrlDisplay');
    const downloadAllBtn = document.getElementById('downloadAllBtn');

    let storeData = null;
    let activeTabIndex = 0;

    // Load stored data
    chrome.storage.local.get(['storeData'], function (result) {
        if (result.storeData) {
            storeData = result.storeData;
            storeUrlDisplay.textContent = storeData.storeUrl;
            renderTabs();
            setupDownloadAllButton();
        } else {
            tabContent.innerHTML = `
                <div class="error-card">
                    <div class="error-title">
                        <i class="fas fa-exclamation-circle"></i>
                        No Data Available
                    </div>
                    <div class="error-message">
                        Please extract data from the extension popup first.
                    </div>
                </div>`;
        }
    });

    function setupDownloadAllButton() {
        downloadAllBtn.addEventListener('click', function () {
            if (!storeData || !storeData.products || storeData.products.length === 0) {
                alert('No product data available to download');
                return;
            }

            downloadCSV(storeData.products, `shopify_all_products_${new Date().toISOString().slice(0, 10)}.csv`);
        });
    }

    function renderTabs() {
        tabsContainer.innerHTML = '';

        // Add "All Products" tab
        const allProductsTab = document.createElement('button');
        allProductsTab.className = 'tab active';
        allProductsTab.innerHTML = `
            <i class="fas fa-cubes"></i>
            <span>All Products</span>
            <span class="badge">${storeData.products.length}</span>
        `;
        allProductsTab.addEventListener('click', () => {
            setActiveTab(0);
            renderAllProducts();
        });
        tabsContainer.appendChild(allProductsTab);

        // Add collection tabs
        storeData.collections.forEach((collection, index) => {
            const collectionProducts = storeData.products.filter(
                p => p.collection_handle === collection.handle
            );

            const tab = document.createElement('button');
            tab.className = 'tab';
            tab.innerHTML = `
                <i class="fas fa-folder"></i>
                <span>${collection.title}</span>
                <span class="badge">${collectionProducts.length}</span>
            `;
            tab.addEventListener('click', () => {
                setActiveTab(index + 1);
                renderCollectionProducts(collection);
            });
            tabsContainer.appendChild(tab);
        });

        // Set first tab as active by default
        setActiveTab(0);
        renderAllProducts();
        updateTabScrollButtons();
    }

    function setActiveTab(index) {
        const tabs = document.querySelectorAll('.tab');
        tabs.forEach((tab, i) => {
            if (i === index) {
                tab.classList.add('active');
                // Scroll tab into view
                tab.scrollIntoView({
                    behavior: 'smooth',
                    block: 'nearest',
                    inline: 'center'
                });
            } else {
                tab.classList.remove('active');
            }
        });
        activeTabIndex = index;
    }

    function renderAllProducts() {
        const products = storeData.products;

        if (products.length === 0) {
            tabContent.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">
                        <i class="fas fa-box-open"></i>
                    </div>
                    <p>No products found in this store</p>
                </div>`;
            return;
        }

        let html = `
            <div class="products-header">
                <h2><i class="fas fa-cubes"></i> All Products (${products.length})</h2>
            </div>
            <div class="products-grid">`;

        products.forEach(product => {
            const imageUrl = product.images && product.images.length > 0
                ? product.images[0].src
                : 'https://via.placeholder.com/300x300?text=No+Image';

            const price = product.variants && product.variants.length > 0
                ? `$${product.variants[0].price}`
                : 'Price not available';

            html += `
            <div class="product-card">
                <div class="product-image-container">
                    <img class="product-image" src="${imageUrl}" alt="${product.title}" onerror="this.src='https://via.placeholder.com/300x300?text=No+Image'">
                </div>
                <div class="product-details">
                    <h4 class="product-title">${product.title}</h4>
                    <div class="product-price">${price}</div>
                    <div class="product-collection">
                        <i class="fas fa-folder"></i>
                        ${product.collection_title || 'Uncategorized'}
                    </div>
                    ${product.vendor ? `<div class="product-vendor">
                        <i class="fas fa-industry"></i>
                        ${product.vendor}
                    </div>` : ''}
                </div>
            </div>`;
        });

        html += `</div>`;
        tabContent.innerHTML = html;
    }

    function renderCollectionProducts(collection) {
        const products = storeData.products.filter(
            p => p.collection_handle === collection.handle
        );

        if (products.length === 0) {
            tabContent.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">
                        <i class="fas fa-box-open"></i>
                    </div>
                    <p>No products found in this collection</p>
                </div>`;
            return;
        }

        let html = `
            <div class="products-header">
                <h2><i class="fas fa-folder"></i> ${collection.title} (${products.length})</h2>
            </div>
            <div class="products-grid">`;

        products.forEach(product => {
            const imageUrl = product.images && product.images.length > 0
                ? product.images[0].src
                : 'https://via.placeholder.com/300x300?text=No+Image';

            const price = product.variants && product.variants.length > 0
                ? `$${product.variants[0].price}`
                : 'Price not available';

            html += `
            <div class="product-card">
                <div class="product-image-container">
                    <img class="product-image" src="${imageUrl}" alt="${product.title}" onerror="this.src='https://via.placeholder.com/300x300?text=No+Image'">
                </div>
                <div class="product-details">
                    <h4 class="product-title">${product.title}</h4>
                    <div class="product-price">${price}</div>
                    ${product.vendor ? `<div class="product-vendor">
                        <i class="fas fa-industry"></i>
                        ${product.vendor}
                    </div>` : ''}
                </div>
            </div>`;
        });

        html += `</div>`;
        tabContent.innerHTML = html;
    }

    function updateTabScrollButtons() {
        const tabs = document.querySelectorAll('.tab');
        const tabsWidth = tabsWrapper.clientWidth;
        const tabsContainerWidth = tabsContainer.scrollWidth;

        prevTabBtn.style.display = 'none';
        nextTabBtn.style.display = 'none';

        if (tabsContainerWidth > tabsWidth) {
            nextTabBtn.style.display = 'flex';
        }

        tabsContainer.addEventListener('scroll', function () {
            const scrollLeft = tabsContainer.scrollLeft;
            const maxScroll = tabsContainer.scrollWidth - tabsContainer.clientWidth;

            prevTabBtn.style.display = scrollLeft > 0 ? 'flex' : 'none';
            nextTabBtn.style.display = scrollLeft < maxScroll - 5 ? 'flex' : 'none';
        });
    }

    function downloadCSV(products, fileName) {
        // CSV header row
        const headers = [
            'Handle',
            'Title',
            'Body (HTML)',
            'Vendor',
            'Type',
            'Tags',
            'Published At',
            'Option1 Name',
            'Option1 Value',
            'Variant SKU',
            'Variant Price',
            'Variant Compare At Price',
            'Image Src',
            'Collection'
        ];

        // Process all products into CSV rows
        const csvRows = [];
        csvRows.push(headers.join(','));

        products.forEach(product => {
            const variants = product.variants && product.variants.length > 0 ? product.variants : [{}];
            const images = product.images || [];
            const maxRows = Math.max(variants.length, images.length > 0 ? images.length : 1);

            for (let i = 0; i < maxRows; i++) {
                const variant = i < variants.length ? variants[i] : {};
                const image = i < images.length ? images[i] : null;

                const row = [
                    `"${escapeCsvValue(product.handle)}"`,
                    `"${escapeCsvValue(product.title)}"`,
                    `"${escapeCsvValue(product.body_html)}"`,
                    `"${escapeCsvValue(product.vendor)}"`,
                    `"${escapeCsvValue(product.product_type)}"`,
                    `"${escapeCsvValue(product.tags)}"`,
                    `"${escapeCsvValue(product.published_at)}"`,
                    `"${escapeCsvValue(product.options && product.options[0] ? product.options[0].name : '')}"`,
                    `"${escapeCsvValue(variant.option1)}"`,
                    `"${escapeCsvValue(variant.sku)}"`,
                    variant.price || (i < variants.length ? '0.00' : ''),
                    variant.compare_at_price || (i < variants.length ? '0.00' : ''),
                    `"${escapeCsvValue(image?.src)}"`,
                    `"${escapeCsvValue(product.collection_title)}"`
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

    // Tab navigation buttons
    prevTabBtn.addEventListener('click', function () {
        tabsContainer.scrollBy({
            left: -200,
            behavior: 'smooth'
        });
    });

    nextTabBtn.addEventListener('click', function () {
        tabsContainer.scrollBy({
            left: 200,
            behavior: 'smooth'
        });
    });

    // Handle window resize
    window.addEventListener('resize', function () {
        updateTabScrollButtons();
    });
});// Replace your existing results.js with this fixed version