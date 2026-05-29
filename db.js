// IndexedDB wrapper for Shopify Scraper
// Handles: Products, Scraped Data (stores), Settings

const DB_NAME = 'ShopifyScraperDB';
const DB_VERSION = 1;

const STORES = {
  PRODUCTS: 'products',
  SCRAPED_STORES: 'scraped_stores',
};

// ── Open / Init DB ──────────────────────────────────────────────────────────

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      // Products store — keyed by storeUrl + product id
      if (!db.objectStoreNames.contains(STORES.PRODUCTS)) {
        const ps = db.createObjectStore(STORES.PRODUCTS, { keyPath: 'uid' });
        ps.createIndex('storeUrl', 'storeUrl', { unique: false });
        ps.createIndex('collectionHandle', 'collectionHandle', { unique: false });
      }

      // Scraped stores — one record per store URL
      if (!db.objectStoreNames.contains(STORES.SCRAPED_STORES)) {
        const ss = db.createObjectStore(STORES.SCRAPED_STORES, { keyPath: 'storeUrl' });
        ss.createIndex('scrapedAt', 'scrapedAt', { unique: false });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ── Products ────────────────────────────────────────────────────────────────

async function saveProducts(storeUrl, products, collectionHandle = 'all') {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.PRODUCTS, 'readwrite');
    const store = tx.objectStore(STORES.PRODUCTS);

    for (const product of products) {
      store.put({
        uid: `${storeUrl}__${product.id}`,
        storeUrl,
        collectionHandle,
        ...product,
        savedAt: Date.now(),
      });
    }

    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function getProductsByStore(storeUrl) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.PRODUCTS, 'readonly');
    const index = tx.objectStore(STORES.PRODUCTS).index('storeUrl');
    const req = index.getAll(storeUrl);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getProductsByCollection(storeUrl, collectionHandle) {
  const all = await getProductsByStore(storeUrl);
  return all.filter(p => p.collectionHandle === collectionHandle);
}

async function clearProductsByStore(storeUrl) {
  const db = await openDB();
  return new Promise(async (resolve, reject) => {
    const tx = db.transaction(STORES.PRODUCTS, 'readwrite');
    const index = tx.objectStore(STORES.PRODUCTS).index('storeUrl');
    const req = index.getAllKeys(storeUrl);

    req.onsuccess = () => {
      for (const key of req.result) {
        tx.objectStore(STORES.PRODUCTS).delete(key);
      }
    };

    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

// ── Scraped Stores (full store data) ────────────────────────────────────────

async function saveScrapedStore(storeUrl, data) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.SCRAPED_STORES, 'readwrite');
    tx.objectStore(STORES.SCRAPED_STORES).put({
      storeUrl,
      collections: data.collections || [],
      totalProducts: data.totalProducts || 0,
      fileSizeBytes: data.fileSizeBytes || 0,
      scrapedAt: Date.now(),
    });
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function getScrapedStore(storeUrl) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.SCRAPED_STORES, 'readonly');
    const req = tx.objectStore(STORES.SCRAPED_STORES).get(storeUrl);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function getAllScrapedStores() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.SCRAPED_STORES, 'readonly');
    const req = tx.objectStore(STORES.SCRAPED_STORES).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function deleteScrapedStore(storeUrl) {
  await clearProductsByStore(storeUrl);
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.SCRAPED_STORES, 'readwrite');
    tx.objectStore(STORES.SCRAPED_STORES).delete(storeUrl);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

// ── Settings (chrome.storage.sync) ─────────────────────────────────────────

const Settings = {
  async get(key, defaultValue = null) {
    return new Promise((resolve) => {
      chrome.storage.sync.get(key, (result) => {
        resolve(result[key] !== undefined ? result[key] : defaultValue);
      });
    });
  },

  async set(key, value) {
    return new Promise((resolve) => {
      chrome.storage.sync.set({ [key]: value }, resolve);
    });
  },

  async getAll() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(null, resolve);
    });
  },

  async remove(key) {
    return new Promise((resolve) => {
      chrome.storage.sync.remove(key, resolve);
    });
  },
};

// ── Exports ─────────────────────────────────────────────────────────────────

window.ShopifyDB = {
  saveProducts,
  getProductsByStore,
  getProductsByCollection,
  clearProductsByStore,
  saveScrapedStore,
  getScrapedStore,
  getAllScrapedStores,
  deleteScrapedStore,
  Settings,
};
