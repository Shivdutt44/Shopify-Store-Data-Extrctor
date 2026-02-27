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

    // Helper to get high-res image
    function getHighResImage(url) {
        if (!url) return '';
        return url.replace(/_(?:[0-9]+x[0-9]+|pico|icon|thumb|small|compact|medium|large|grande|1024x1024|2048x2048)(?=\.[a-zA-Z0-9]+(?:\?.*)?$)/i, '');
    }

    // Maximum CSV file size (14MB to stay safely under Shopify's 15MB limit)
    const MAX_CSV_SIZE = 14 * 1024 * 1024; // 14MB in bytes

    function downloadCSV(products, fileName) {
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

        // Generate all CSV rows first
        const allRows = [];
        products.forEach(product => {
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

                    // Extra info
                    `"${escapeCsvValue(product.published_at)}"`,
                    `"${escapeCsvValue(product.created_at)}"`,
                    `"${escapeCsvValue(product.updated_at)}"`,
                    `"${escapeCsvValue(product.template_suffix)}"`,
                    `"${escapeCsvValue(product.published_scope)}"`,
                    `"${escapeCsvValue(product.collection_title)}"`,
                    `"${escapeCsvValue(product.collection_handle)}"`
                ];

                allRows.push(row.join(','));
            }
        });

        // Calculate total size
        const headerRow = headers.join(',');
        const totalContent = "\uFEFF" + headerRow + '\n' + allRows.join('\n');
        const totalSize = new Blob([totalContent]).size;

        // Extract base filename (remove .csv extension if present)
        const fileNameBase = fileName.replace(/\.csv$/i, '');

        // If under limit, download as single file
        if (totalSize <= MAX_CSV_SIZE) {
            downloadCSVChunk([headerRow, ...allRows], fileName);
            return;
        }

        // Split into multiple files
        const chunks = [];
        let currentChunk = [headerRow];
        let currentSize = new Blob(["\uFEFF" + headerRow]).size;

        for (const row of allRows) {
            const rowSize = new Blob([row]).size + 1; // +1 for newline

            if (currentSize + rowSize > MAX_CSV_SIZE && currentChunk.length > 1) {
                // Save current chunk and start new one
                chunks.push(currentChunk);
                currentChunk = [headerRow, row];
                currentSize = new Blob(["\uFEFF" + headerRow + '\n' + row]).size;
            } else {
                currentChunk.push(row);
                currentSize += rowSize;
            }
        }

        // Don't forget the last chunk
        if (currentChunk.length > 1) {
            chunks.push(currentChunk);
        }

        // Download all chunks
        chunks.forEach((chunk, index) => {
            const chunkFileName = `${fileNameBase}_part${index + 1}of${chunks.length}.csv`;
            setTimeout(() => {
                downloadCSVChunk(chunk, chunkFileName);
            }, index * 500); // Stagger downloads to avoid browser issues
        });

        // Show notification about multiple files
        if (chunks.length > 1) {
            setTimeout(() => {
                alert(`CSV file was split into ${chunks.length} parts due to Shopify's 15MB import limit.\n\nPlease import each part separately into Shopify.`);
            }, chunks.length * 500 + 100);
        }
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