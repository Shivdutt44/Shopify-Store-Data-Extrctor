let allStores = [];
let currentShareUrl = '';

document.addEventListener('DOMContentLoaded', async () => {
    await renderHistory();
    document.getElementById('searchInput').addEventListener('input', filterCards);
    document.getElementById('clearAllBtn').addEventListener('click', clearAll);
    document.getElementById('shareModalClose').addEventListener('click', closeShareModal);
    document.getElementById('shareModal').addEventListener('click', (e) => {
        if (e.target === document.getElementById('shareModal')) closeShareModal();
    });
    document.querySelectorAll('.h-share-btn').forEach(btn => {
        btn.addEventListener('click', () => handleShare(btn.dataset.action));
    });
});

async function renderHistory() {
    const grid = document.getElementById('historyGrid');
    grid.innerHTML = `<div class="h-loading"><i class="fas fa-spinner fa-spin"></i><span>Loading history...</span></div>`;

    allStores = await ShopifyDB.getAllScrapedStores();
    allStores.sort((a, b) => b.scrapedAt - a.scrapedAt);

    updateStats();

    if (!allStores.length) {
        grid.innerHTML = `
            <div class="h-empty">
                <i class="fas fa-inbox"></i>
                <h3>No History Yet</h3>
                <span>Scrape a Shopify store to see it here.</span>
            </div>`;
        return;
    }

    grid.innerHTML = '';
    allStores.forEach((store, i) => {
        const card = buildCard(store, i);
        grid.appendChild(card);
        // If fileSize not yet calculated, compute it async and update badge
        if (!store.fileSizeBytes || store.fileSizeBytes === 0) {
            computeAndUpdateFileSize(store, card);
        }
    });
}

function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '—';
    if (bytes < 1024)          return `${bytes} B`;
    if (bytes < 1024 * 1024)   return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function computeAndUpdateFileSize(store, card) {
    try {
        const products = await ShopifyDB.getProductsByStore(store.storeUrl);
        if (!products || products.length === 0) return;

        const bytes = new Blob([JSON.stringify(products)]).size;

        // Update DB record
        await ShopifyDB.saveScrapedStore(store.storeUrl, {
            collections: store.collections || [],
            totalProducts: store.totalProducts || products.length,
            fileSizeBytes: bytes,
        });

        // Update badge in the already-rendered card
        const badge = card.querySelector('.h-badge-size span');
        if (badge) badge.textContent = formatBytes(bytes);
    } catch (e) {
        console.error('File size calc error:', e);
    }
}

function buildCard(store, index) {
    let domain = store.storeUrl;
    try { domain = new URL(store.storeUrl).hostname; } catch {}

    const initials = domain.slice(0, 2).toUpperCase();

    const date = new Date(store.scrapedAt);
    const dateStr = date.toLocaleDateString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });

    const totalProds = store.totalProducts || 0;
    const totalCols  = (store.collections || []).length;
    const fileSize   = formatBytes(store.fileSizeBytes || 0);

    // Google Favicon API — reliable across all Shopify stores
    const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;

    const card = document.createElement('div');
    card.className = 'h-card';
    card.dataset.url = store.storeUrl;
    card.style.animationDelay = `${index * 0.05}s`;
    card.innerHTML = `
        <div class="h-card-strip"></div>
        <div class="h-card-body">
            <div class="h-card-identity">
                <div class="h-card-logo">
                    <img src="${faviconUrl}" alt="${initials}"
                         onerror="this.src='';this.style.display='none';this.nextElementSibling.style.display='flex'">
                    <span class="h-logo-fallback" style="display:none">${initials}</span>
                </div>
                <div class="h-card-name-wrap">
                    <div class="h-card-name" title="${domain}">${domain}</div>
                    <div class="h-card-url">${store.storeUrl}</div>
                </div>
            </div>

            <div class="h-card-badges">
                <div class="h-badge"><i class="fas fa-cubes"></i> ${totalProds} Products</div>
                <div class="h-badge"><i class="fas fa-layer-group"></i> ${totalCols} Collections</div>
                <div class="h-badge h-badge-size"><i class="fas fa-file-csv"></i> <span>${fileSize}</span></div>
            </div>

            <div class="h-card-date">
                <i class="fas fa-clock"></i>
                <span>Scraped: ${dateStr}</span>
            </div>

            <div class="h-card-actions">
                <button class="h-action-btn h-action-download" data-url="${store.storeUrl}" title="Download CSV">
                    <i class="fas fa-file-csv"></i>
                    Download
                </button>
                <button class="h-action-btn h-action-share" data-url="${store.storeUrl}" title="Share">
                    <i class="fas fa-share-alt"></i>
                    Share
                </button>
                <button class="h-action-btn h-action-delete" data-url="${store.storeUrl}" title="Delete">
                    <i class="fas fa-trash"></i>
                    Delete
                </button>
            </div>
        </div>`;

    // Clickable store name → open in new tab
    card.querySelector('.h-card-name').addEventListener('click', () => {
        chrome.tabs.create({ url: store.storeUrl });
    });

    // Download
    card.querySelector('.h-action-download').addEventListener('click', () => downloadStore(store));

    // Share
    card.querySelector('.h-action-share').addEventListener('click', () => openShareModal(store));

    // Delete
    card.querySelector('.h-action-delete').addEventListener('click', () => deleteStore(store.storeUrl, card));

    return card;
}

// ── Stats ────────────────────────────────────────────────────────────────────

function updateStats() {
    document.getElementById('totalStores').textContent     = allStores.length;
    document.getElementById('totalProducts').textContent   = allStores.reduce((s, x) => s + (x.totalProducts || 0), 0).toLocaleString();
    document.getElementById('totalCollections').textContent = allStores.reduce((s, x) => s + (x.collections || []).length, 0);
}

// ── Search ───────────────────────────────────────────────────────────────────

function filterCards() {
    const q = document.getElementById('searchInput').value.toLowerCase();
    document.querySelectorAll('.h-card').forEach(card => {
        card.style.display = card.dataset.url.toLowerCase().includes(q) ? '' : 'none';
    });
}

// ── Delete ───────────────────────────────────────────────────────────────────

async function deleteStore(storeUrl, cardEl) {
    let domain = storeUrl;
    try { domain = new URL(storeUrl).hostname; } catch {}
    if (!confirm(`Delete all cached data for "${domain}"?`)) return;

    await ShopifyDB.deleteScrapedStore(storeUrl);
    cardEl.style.transition = 'opacity 0.3s, transform 0.3s';
    cardEl.style.opacity = '0';
    cardEl.style.transform = 'scale(0.9)';
    setTimeout(() => {
        cardEl.remove();
        allStores = allStores.filter(s => s.storeUrl !== storeUrl);
        updateStats();
        if (!document.querySelectorAll('.h-card').length) {
            document.getElementById('historyGrid').innerHTML = `
                <div class="h-empty">
                    <i class="fas fa-inbox"></i>
                    <h3>No History Yet</h3>
                    <span>Scrape a Shopify store to see it here.</span>
                </div>`;
        }
    }, 320);
}

async function clearAll() {
    if (!confirm('Clear ALL scrape history? This cannot be undone.')) return;
    for (const s of allStores) await ShopifyDB.deleteScrapedStore(s.storeUrl);
    renderHistory();
}

// ── Download ─────────────────────────────────────────────────────────────────

async function downloadStore(store) {
    const btn = event.currentTarget;
    const origHTML = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
    btn.disabled = true;

    try {
        const products = await ShopifyDB.getProductsByStore(store.storeUrl);
        if (!products || products.length === 0) {
            alert('No product data found for this store.');
            return;
        }

        let domain = store.storeUrl;
        try { domain = new URL(store.storeUrl).hostname.replace(/\./g, '_'); } catch {}

        const dateStr = new Date().toISOString().slice(0, 10);
        const fileName = `${domain}_products_${dateStr}.csv`;

        const headers = [
            'Handle','Title','Body (HTML)','Vendor','Product Category','Type','Tags',
            'Published','Option1 Name','Option1 Value','Option2 Name','Option2 Value',
            'Option3 Name','Option3 Value','Variant SKU','Variant Grams',
            'Variant Inventory Tracker','Variant Inventory Qty','Variant Inventory Policy',
            'Variant Fulfillment Service','Variant Price','Variant Compare At Price',
            'Variant Requires Shipping','Variant Taxable','Variant Barcode',
            'Image Src','Image Position','Image Alt Text','Gift Card',
            'SEO Title','SEO Description',
            'Google Shopping / Google Product Category','Google Shopping / Gender',
            'Google Shopping / Age Group','Google Shopping / MPN',
            'Google Shopping / Condition','Google Shopping / Custom Product',
            'Google Shopping / Custom Label 0','Google Shopping / Custom Label 1',
            'Google Shopping / Custom Label 2','Google Shopping / Custom Label 3',
            'Google Shopping / Custom Label 4','Variant Image','Variant Weight Unit',
            'Variant Tax Code','Cost per item','Price / International',
            'Compare At Price / International','Status','Collection'
        ];

        function getHighResImage(url) {
            if (!url) return '';
            return url.replace(/_(?:[0-9]+x[0-9]+|pico|icon|thumb|small|compact|medium|large|grande|1024x1024|2048x2048)(?=\.[a-zA-Z0-9]+(?:\?.*)?$)/i, '');
        }

        function esc(v) {
            if (v === null || v === undefined) return '';
            return String(v).replace(/"/g, '""');
        }

        const rows = [headers.join(',')];

        products.forEach(product => {
            const variants = product.variants && product.variants.length > 0 ? product.variants : [{}];
            const images   = product.images || [];
            const maxRows  = Math.max(variants.length, images.length > 0 ? images.length : 1);

            for (let i = 0; i < maxRows; i++) {
                const variant = i < variants.length ? variants[i] : {};
                const image   = i < images.length ? images[i] : null;
                const variantImage = variant.featured_image ? variant.featured_image.src : '';

                rows.push([
                    `"${esc(product.handle)}"`,
                    `"${esc(product.title)}"`,
                    `"${esc(product.body_html)}"`,
                    `"${esc(product.vendor)}"`,
                    `"${esc(product.product_type || '')}"`,
                    `"${esc(product.product_type || '')}"`,
                    `"${esc(product.tags)}"`,
                    product.published_at ? 'true' : 'false',
                    `"${esc(product.options?.[0]?.name || '')}"`,
                    `"${esc(variant.option1)}"`,
                    `"${esc(product.options?.[1]?.name || '')}"`,
                    `"${esc(variant.option2)}"`,
                    `"${esc(product.options?.[2]?.name || '')}"`,
                    `"${esc(variant.option3)}"`,
                    `"${esc(variant.sku)}"`,
                    variant.grams !== undefined ? variant.grams : (i < variants.length ? '0' : ''),
                    `"${esc(variant.inventory_management || '')}"`,
                    variant.inventory_quantity !== undefined ? variant.inventory_quantity : (i < variants.length ? '0' : ''),
                    `"${esc(variant.inventory_policy || (i < variants.length ? 'deny' : ''))}"`,
                    `"${esc(variant.fulfillment_service || (i < variants.length ? 'manual' : ''))}"`,
                    variant.price ?? (i < variants.length ? '0.00' : ''),
                    variant.compare_at_price || '',
                    variant.requires_shipping !== undefined ? (variant.requires_shipping ? 'true' : 'false') : (i < variants.length ? 'false' : ''),
                    variant.taxable !== undefined ? (variant.taxable ? 'true' : 'false') : (i < variants.length ? 'false' : ''),
                    `"${esc(variant.barcode)}"`,
                    `"${esc(getHighResImage(image?.src))}"`,
                    image ? String(i + 1) : '',
                    `"${esc(image?.alt || (image ? product.title : ''))}"`,
                    product.gift_card ? 'true' : 'false',
                    `"${esc(product.metafields_global_title_tag || '')}"`,
                    `"${esc(product.metafields_global_description_tag || '')}"`,
                    `""`,`""`,`""`,`""`,`""`,`""`,`""`,`""`,`""`,`""`,`""`,
                    `"${esc(getHighResImage(variantImage))}"`,
                    `"${esc(variant.weight_unit || (i < variants.length ? 'kg' : ''))}"`,
                    `""`,`""`,`""`,`""`,
                    `"${esc(product.status || 'active')}"`,
                    `"${esc(product.collection_title || '')}"`
                ].join(','));
            }
        });

        const csv = '﻿' + rows.join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = fileName;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 100);

    } finally {
        btn.innerHTML = origHTML;
        btn.disabled = false;
    }
}

// ── Share Modal ───────────────────────────────────────────────────────────────

function openShareModal(store) {
    currentShareUrl = store.storeUrl;
    document.getElementById('shareStoreName').textContent = store.storeUrl;
    document.getElementById('shareCopied').style.display = 'none';
    document.getElementById('shareModal').style.display = 'flex';
}

function closeShareModal() {
    document.getElementById('shareModal').style.display = 'none';
}

function handleShare(action) {
    const url = currentShareUrl;
    let domain = url;
    try { domain = new URL(url).hostname; } catch {}

    if (action === 'copy') {
        navigator.clipboard.writeText(url).then(() => {
            document.getElementById('shareCopied').style.display = 'flex';
            setTimeout(() => { document.getElementById('shareCopied').style.display = 'none'; }, 2500);
        });
    } else if (action === 'whatsapp') {
        const text = encodeURIComponent(`Check out this Shopify store: ${url}`);
        chrome.tabs.create({ url: `https://wa.me/?text=${text}` });
    } else if (action === 'email') {
        const subject = encodeURIComponent(`Shopify Store: ${domain}`);
        const body    = encodeURIComponent(`Check out this Shopify store:\n${url}`);
        chrome.tabs.create({ url: `mailto:?subject=${subject}&body=${body}` });
    } else if (action === 'twitter') {
        const text = encodeURIComponent(`Interesting Shopify store: ${url}`);
        chrome.tabs.create({ url: `https://twitter.com/intent/tweet?text=${text}` });
    }
}
