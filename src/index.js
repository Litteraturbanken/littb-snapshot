import express from "express"
import { createProxyMiddleware } from "http-proxy-middleware"
import crawler from "./crawler"
import ogPreview from "./og-preview"
import PagePool from "./page-pool"

import puppeteer from "puppeteer"
import url from "url"
import * as cheerio from "cheerio"

let browser = null
let pagePool = null
let browserError = null // tracks browser-level failures for health check

function isBrowserError(error) {
    return error.name === 'ProtocolError' ||
        error.message?.includes('timed out') ||
        error.message?.includes('Target closed') ||
        error.message?.includes('Session closed') ||
        error.message?.includes('Browser closed')
}

async function closeBrowser() {
    if (pagePool) {
        try { await pagePool.destroy() } catch(_) {}
        pagePool = null
    }
    if (browser) {
        try { await browser.close() } catch(_) {}
        browser = null
    }
}

async function ensureBrowser() {
    if (!browser || !browser.connected) {
        browser = await puppeteer.launch({
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
            args: ["--no-sandbox", '--disable-dev-shm-usage', '--disable-setuid-sandbox']
        })
        browserError = null

        // Initialize page pool with 5 pages (balances memory usage vs performance)
        pagePool = new PagePool(browser, 5)
        await pagePool.init()
    }
}

const SERVER_ROOT = process.env.SERVER_ROOT || "https://litteraturbanken.se"
const OG_IMAGE_BASE_URL = process.env.OG_IMAGE_BASE_URL || SERVER_ROOT

function cleanHtml(html) {
    const $ = cheerio.load(html)
    $("script[src]").remove()
    return $.html()
}

function getErrors($) {
    const err = $('[littb-err]')
    let errType = null, errMsg = null
    if(err.length) {
        errType = Number(err.attr("code"))
        errMsg = err.attr("msg")
    } else if($("#mainview").is(":empty")) {
        errType = 500
        errMsg = "Internal server error."
    }
    return {errType, errMsg}
}

const app = express()

app.use(['/txt', '/img', '/red', "/fonts", "/favicon.ico"], createProxyMiddleware({ target: 'https://litteraturbanken.se', changeOrigin: true }))
app.use(/(.*\.css$)/, createProxyMiddleware({ target: 'https://litteraturbanken.se', changeOrigin: true }))

// Health check endpoint
app.get('/healthz', (req, res) => {
    if (browserError) {
        return res.status(503).json({ status: 'unhealthy', error: browserError })
    }
    const poolStats = pagePool ? pagePool.getStats() : null
    res.status(200).json({
        status: 'ok',
        browser: browser?.connected ?? false,
        pagePool: poolStats
    })
})

// OG Preview Image endpoint - returns JPEG image for social media previews
app.get('/og-image/{*splat}', async function(req, res) {
    await ensureBrowser()

    // Express 5 returns splat as array, join with /
    let path = Array.isArray(req.params.splat) ? req.params.splat.join('/') : (req.params.splat || req.params[0])
    if (!path.startsWith('/')) {
        path = '/' + path
    }

    // Only allow reader pages
    if (!ogPreview.isReaderPage(path)) {
        return res.status(400).json({ error: 'OG preview only available for reader pages (URLs containing /sida/)' })
    }

    const targetUrl = SERVER_ROOT + path

    try {
        const imageBuffer = await ogPreview.generateOgImage({ browser, pagePool, url: targetUrl })

        // Set headers explicitly for social media crawlers
        res.set('Content-Type', 'image/jpeg')
        res.set('Content-Length', imageBuffer.length)
        res.set('Cache-Control', 'public, max-age=86400, immutable') // Cache for 24 hours
        res.set('Vary', 'Accept-Encoding')
        res.set('X-Content-Type-Options', 'nosniff')
        res.send(imageBuffer)
    } catch(e) {
        console.error("OG image generation error:", e)
        if (isBrowserError(e)) {
            browserError = e.message
            await closeBrowser()
        }
        res.status(500).json({ error: 'Failed to generate OG image', message: e.message })
    }
})

// OG Meta Tags endpoint - returns HTML meta tags to inject into <head>
app.get('/og-meta/{*splat}', async function(req, res) {
    await ensureBrowser()

    // Express 5 returns splat as array, join with /
    let path = Array.isArray(req.params.splat) ? req.params.splat.join('/') : (req.params.splat || req.params[0])
    if (!path.startsWith('/')) {
        path = '/' + path
    }

    // Only allow reader pages
    if (!ogPreview.isReaderPage(path)) {
        return res.status(400).json({ error: 'OG meta only available for reader pages (URLs containing /sida/)' })
    }

    const targetUrl = SERVER_ROOT + path
    const ogImageUrl = OG_IMAGE_BASE_URL + '/og-image' + path

    try {
        const metadata = await ogPreview.extractMetadata({ browser, pagePool, url: targetUrl })
        const metaTags = ogPreview.generateOgMetaTags({
            url: targetUrl,
            imageUrl: ogImageUrl,
            metadata
        })

        res.set('Content-Type', 'text/html; charset=utf-8')
        res.set('Cache-Control', 'public, max-age=86400') // Cache for 24 hours
        res.send(metaTags)
    } catch(e) {
        console.error("OG meta extraction error:", e)
        if (isBrowserError(e)) {
            browserError = e.message
            await closeBrowser()
        }
        res.status(500).json({ error: 'Failed to extract OG metadata', message: e.message })
    }
})

// Combined OG endpoint - returns JSON with both image URL and meta tags
app.get('/og/{*splat}', async function(req, res) {
    await ensureBrowser()

    // Express 5 returns splat as array, join with /
    let path = Array.isArray(req.params.splat) ? req.params.splat.join('/') : (req.params.splat || req.params[0])
    if (!path.startsWith('/')) {
        path = '/' + path
    }

    // Only allow reader pages
    if (!ogPreview.isReaderPage(path)) {
        return res.status(400).json({ error: 'OG preview only available for reader pages (URLs containing /sida/)' })
    }

    const targetUrl = SERVER_ROOT + path
    const ogImageUrl = OG_IMAGE_BASE_URL + '/og-image' + path

    try {
        const metadata = await ogPreview.extractMetadata({ browser, pagePool, url: targetUrl })
        const metaTags = ogPreview.generateOgMetaTags({
            url: targetUrl,
            imageUrl: ogImageUrl,
            metadata
        })

        res.set('Cache-Control', 'public, max-age=86400')
        res.json({
            url: targetUrl,
            imageUrl: ogImageUrl,
            metadata,
            metaTags
        })
    } catch(e) {
        console.error("OG preview error:", e)
        if (isBrowserError(e)) {
            browserError = e.message
            await closeBrowser()
        }
        res.status(500).json({ error: 'Failed to generate OG preview', message: e.message })
    }
})

app.get("/{*splat}", async function(req, res, next) {
    await ensureBrowser()

    let path = new URL(req.originalUrl, `http://${req.hostname}`).pathname
    path = path.replace("/&_escaped_fragment_=", "")
    if(path == "/index.html.gz") {
        path = "/"
    }
    const from = SERVER_ROOT + path

    const type = path.split(".")[path.split(".").length - 1]

    let errMsg, errType
    try {
        var content = await crawler({ url : from, browser})
    } catch(e) {
        console.warn("fetch error", e)
        if (isBrowserError(e)) {
            browserError = e.message
            await closeBrowser()
        }
        errMsg = e.message
        errType = 500
    }
    if(!errType) {
        const $ = cheerio.load(content)
        ;({errMsg, errType} = getErrors($))

        // Inject OG tags for reader pages (/sida/ URLs)
        if (!errType && ogPreview.isReaderPage(path)) {
            try {
                // Use SERVER_ROOT for OG image URLs in production
                // This ensures the public URL is used, not the internal service URL
                ogPreview.injectOgTags($, from, SERVER_ROOT)
                content = $.html()
            } catch(e) {
                console.error("Error injecting OG tags:", e)
            }
        }
    }

    if(errType) {
        console.log("fetch error for", path)
        res.status(errType).send(errMsg)
    } else {
        console.log("fetch success for", path)
        res.type('html')
        res.send(cleanHtml(content))
    }
})

// Global error handlers
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error)
})
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason)
})

const HOST = process.env.HOST || '0.0.0.0'
const PORT = process.env.PORT || 8282
app.listen(PORT, HOST, () => console.log(`Listening on ${HOST}:${PORT}. Fetching from ${SERVER_ROOT}`))
