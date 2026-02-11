

async function crawler({ browser, pagePool, url }) {

    let page = null
    let html = false
    let fromPool = false

    console.log(`[Crawler] pagePool available: ${!!pagePool}`)

    try {
        // Try to get page from pool, fallback to creating new page
        if (pagePool) {
            console.log('[Crawler] Using page pool')
            page = await pagePool.acquire()
            fromPool = true
        } else {
            console.log('[Crawler] Creating new page (no pool)')
            page = await browser.newPage()
        }

        await page.setUserAgent("littb-snapshot")

        // Block unnecessary resources for faster loading
        await page.setRequestInterception(true)
        page.on('request', (req) => {
            const resourceType = req.resourceType()
            // Block images, media, fonts, and websockets - we only need HTML/CSS/JS
            if (['image', 'media', 'font', 'websocket'].includes(resourceType)) {
                req.abort()
            } else {
                req.continue()
            }
        })

        page.on('pageerror', pageerr => {
            console.log('pageerror occurred: ', pageerr);
        })

        // networkidle2: faster than networkidle0 - allows up to 2 network connections
        // instead of waiting for complete silence (500ms with 0 connections)
        await page.goto(url, { waitUntil: "networkidle2", timeout: 15000 })
        html = await page.content()
    } catch (e) {
        throw e
    } finally {
        if (page) {
            if (fromPool && pagePool) {
                // Return page to pool for reuse
                await pagePool.release(page)
            } else {
                // Close page if not from pool
                await page.close()
            }
        }
    }
    return html
}

export default crawler