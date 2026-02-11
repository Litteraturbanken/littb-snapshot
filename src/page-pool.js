/**
 * Browser Page Pool
 *
 * Maintains a pool of reusable Puppeteer pages to avoid the overhead
 * of creating/destroying pages on every request.
 *
 * Performance Benefits:
 * - Eliminates page creation overhead (~50-200ms per request)
 * - Reduces memory allocation churn
 * - Allows pre-warming of browser contexts
 */

class PagePool {
    constructor(browser, poolSize = 5) {
        this.browser = browser
        this.poolSize = poolSize
        this.availablePages = []
        this.busyPages = new Set()
        this.initialized = false
    }

    /**
     * Initialize the pool with pre-created pages
     */
    async init() {
        if (this.initialized) return

        console.log(`[PagePool] Initializing pool with ${this.poolSize} pages...`)
        const startTime = Date.now()

        for (let i = 0; i < this.poolSize; i++) {
            try {
                const page = await this.browser.newPage()
                this.availablePages.push(page)
            } catch (e) {
                console.error(`[PagePool] Failed to create page ${i}:`, e)
            }
        }

        this.initialized = true
        const duration = Date.now() - startTime
        console.log(`[PagePool] Initialized with ${this.availablePages.length} pages in ${duration}ms`)
    }

    /**
     * Acquire a page from the pool
     * If no pages are available, create a new temporary page
     */
    async acquire() {
        // Ensure pool is initialized
        if (!this.initialized) {
            await this.init()
        }

        let page = this.availablePages.pop()

        if (!page) {
            // Pool exhausted - create temporary page
            console.log('[PagePool] Pool exhausted, creating temporary page')
            page = await this.browser.newPage()
            page._isTemporary = true
        } else {
            // Reset page state before reuse
            console.log(`[PagePool] Acquired page from pool (${this.busyPages.size + 1} busy, ${this.availablePages.length} available)`)
            await this.resetPage(page)
        }

        this.busyPages.add(page)
        return page
    }

    /**
     * Release a page back to the pool
     */
    async release(page) {
        if (!page) return

        this.busyPages.delete(page)

        // If temporary page, close it
        if (page._isTemporary) {
            try {
                await page.close()
            } catch (e) {
                console.error('[PagePool] Error closing temporary page:', e)
            }
            return
        }

        // Return to pool for reuse
        this.availablePages.push(page)
        console.log(`[PagePool] Released page to pool (${this.busyPages.size} busy, ${this.availablePages.length} available)`)
    }

    /**
     * Reset page state between requests
     * SIMPLIFIED: Don't navigate to about:blank to avoid frame detach issues
     * Each request will set its own state (user agent, interception, etc.)
     */
    async resetPage(page) {
        try {
            // Only clear event listeners - let each request set its own state
            page.removeAllListeners()
        } catch (e) {
            console.error('[PagePool] Error resetting page:', e.message)
            // If even this fails, the page is probably dead - create a new one
            try {
                await page.close()
            } catch (_) {}

            // Create replacement page
            const newPage = await this.browser.newPage()
            return newPage
        }

        return page
    }

    /**
     * Close all pages in the pool
     */
    async destroy() {
        console.log('[PagePool] Destroying pool...')

        // Close all available pages
        for (const page of this.availablePages) {
            try {
                await page.close()
            } catch (e) {
                console.error('[PagePool] Error closing available page:', e)
            }
        }

        // Close all busy pages
        for (const page of this.busyPages) {
            try {
                await page.close()
            } catch (e) {
                console.error('[PagePool] Error closing busy page:', e)
            }
        }

        this.availablePages = []
        this.busyPages.clear()
        this.initialized = false
    }

    /**
     * Get pool statistics
     */
    getStats() {
        return {
            total: this.poolSize,
            available: this.availablePages.length,
            busy: this.busyPages.size,
            initialized: this.initialized
        }
    }
}

export default PagePool
