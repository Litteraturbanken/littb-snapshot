import express from "express"
import { createProxyMiddleware } from "http-proxy-middleware"
import crawler from "./crawler"
import ogPreview from "./og-preview"

import puppeteer from "puppeteer"
import url from "url"
import * as cheerio from "cheerio"

let browser = null

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
    res.status(200).json({ status: 'ok', browser: browser?.connected ?? false })
})

// OG Preview Image endpoint - returns JPEG image for social media previews
app.get('/og-image/{*splat}', async function(req, res) {
    if(!browser || !browser.connected) {
        browser = await puppeteer.launch({ 
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
            args: ["--no-sandbox", '--disable-dev-shm-usage', '--disable-setuid-sandbox'] 
        })
    }
    
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
        const imageBuffer = await ogPreview.generateOgImage({ browser, url: targetUrl })
        
        res.set('Content-Type', 'image/jpeg')
        res.set('Cache-Control', 'public, max-age=86400') // Cache for 24 hours
        res.send(imageBuffer)
    } catch(e) {
        console.error("OG image generation error:", e)
        res.status(500).json({ error: 'Failed to generate OG image', message: e.message })
    }
})

// OG Meta Tags endpoint - returns HTML meta tags to inject into <head>
app.get('/og-meta/{*splat}', async function(req, res) {
    if(!browser || !browser.connected) {
        browser = await puppeteer.launch({ 
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
            args: ["--no-sandbox", '--disable-dev-shm-usage', '--disable-setuid-sandbox'] 
        })
    }
    
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
        const metadata = await ogPreview.extractMetadata({ browser, url: targetUrl })
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
        res.status(500).json({ error: 'Failed to extract OG metadata', message: e.message })
    }
})

// Combined OG endpoint - returns JSON with both image URL and meta tags
app.get('/og/{*splat}', async function(req, res) {
    if(!browser || !browser.connected) {
        browser = await puppeteer.launch({ 
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
            args: ["--no-sandbox", '--disable-dev-shm-usage', '--disable-setuid-sandbox'] 
        })
    }
    
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
        const metadata = await ogPreview.extractMetadata({ browser, url: targetUrl })
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
        res.status(500).json({ error: 'Failed to generate OG preview', message: e.message })
    }
})

app.get("/{*splat}", async function(req, res, next) {
    if(!browser || !browser.connected) {
        browser = await puppeteer.launch({ 
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
            args: ["--no-sandbox", '--disable-dev-shm-usage', '--disable-setuid-sandbox'] 
        })
    }
    let path = new URL(req.originalUrl, `http://${req.hostname}`).pathname
    path = path.replace("/&_escaped_fragment_=", "")
    if(path == "/index.html.gz") {
        path = "/"
    }
    const from = SERVER_ROOT + path
    // const from = "http://localhost:9000" + path
    
    const type = path.split(".")[path.split(".").length - 1]
    
    try {
        var content = await crawler({ url : from, browser})
    } catch(e) {
        console.warn("fetch error", e)
        errMsg = e.message
        errType = 500
    }
    if(!errType) {
        const $ = cheerio.load(content)
        var {errMsg, errType} = getErrors($)
        
        // Inject OG tags for reader pages (/sida/ URLs)
        if (!errType && ogPreview.isReaderPage(path)) {
            try {
                ogPreview.injectOgTags($, from, OG_IMAGE_BASE_URL)
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
