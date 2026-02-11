/**
 * OG Preview Generator for Litteraturbanken Reader Pages
 * 
 * Generates Open Graph social media preview images and metadata
 * for reader pages (URLs containing /sida/).
 */

import sharp from 'sharp'

const OG_IMAGE_WIDTH = 1200
const OG_IMAGE_HEIGHT = 630

// Simple in-memory cache for generated images (key: url, value: {buffer, timestamp})
const imageCache = new Map()
const CACHE_TTL = 60 * 60 * 1000 // 1 hour in ms
const MAX_CACHE_SIZE = 100

function getCachedImage(url) {
    const cached = imageCache.get(url)
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
        return cached.buffer
    }
    if (cached) {
        imageCache.delete(url) // Expired
    }
    return null
}

function setCachedImage(url, buffer) {
    // Evict oldest if cache is full
    if (imageCache.size >= MAX_CACHE_SIZE) {
        const oldestKey = imageCache.keys().next().value
        imageCache.delete(oldestKey)
    }
    imageCache.set(url, { buffer, timestamp: Date.now() })
}

/**
 * Check if a URL is a reader page
 */
export function isReaderPage(urlPath) {
    return urlPath.includes('/sida/')
}

/**
 * Check if a URL is a facsimile page
 */
export function isFacsimilePage(urlPath) {
    return urlPath.endsWith('/faksimil')
}

/**
 * Parse reader URL to extract metadata
 * URL format: /författare/{authorId}/titlar/{titleId}/sida/{pageNum}/etext
 */
export function parseReaderUrl(urlPath) {
    const match = urlPath.match(/\/författare\/([^/]+)\/titlar\/([^/]+)\/sida\/(\d+)/)
    if (match) {
        return {
            authorId: match[1],
            titleId: match[2],
            pageNum: match[3]
        }
    }
    return null
}

/**
 * Generate OG image for a facsimile page by fetching the underlying image
 * and resizing/cropping it to OG dimensions
 */
async function generateFacsimileOgImage({ browser, pagePool, url }) {
    let page = null
    let fromPool = false

    try {
        // Try to get page from pool, fallback to creating new page
        if (pagePool) {
            page = await pagePool.acquire()
            fromPool = true
        } else {
            page = await browser.newPage()
        }
        await page.setUserAgent("littb-snapshot-og")
        
        // Navigate and wait for the facsimile image to load
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
        
        // Wait for the facsimile image to have a non-empty src attribute
        // The Angular app loads the image dynamically, so we need to wait for src to be set
        try {
            await page.waitForFunction(
                () => {
                    const img = document.querySelector('img.faksimil')
                    return img && img.src && img.src.length > 0
                },
                { timeout: 15000 }
            )
        } catch (selectorError) {
            // Log what images are on the page for debugging
            const images = await page.evaluate(() => {
                return Array.from(document.querySelectorAll('img')).map(img => ({
                    src: img.src,
                    className: img.className
                }))
            })
            console.error('[Facsimile] Images on page:', JSON.stringify(images, null, 2))
            throw new Error(`Facsimile image not loaded: ${selectorError.message}`)
        }
        
        // Get the facsimile image URL
        let imageUrl = await page.evaluate(() => {
            const img = document.querySelector('img.faksimil')
            return img ? img.src : null
        })
        
        if (!imageUrl) {
            throw new Error('Could not find facsimile image')
        }
        
        // Request the largest pre-rendered size (5) instead of whatever size the page loaded
        // URL pattern: .../lb11625223_3/lb11625223_3_0003.jpeg -> .../lb11625223_5/lb11625223_5_0003.jpeg
        // Replace both folder and filename size indicators
        imageUrl = imageUrl.replace(/_[1-4](\/)/g, '_5$1')  // folder
        imageUrl = imageUrl.replace(/_[1-4]_(\d+\.jpeg)$/, '_5_$1')  // filename
        
        // Fetch the largest size image
        const response = await fetch(imageUrl)
        if (!response.ok) {
            throw new Error(`Failed to fetch facsimile image: ${response.status}`)
        }
        const imageBuffer = Buffer.from(await response.arrayBuffer())
        
        // Use sharp to resize and crop to OG dimensions
        // We'll resize to fit width, then crop from top to get OG aspect ratio
        const processedImage = await sharp(imageBuffer)
            .resize(OG_IMAGE_WIDTH, OG_IMAGE_HEIGHT, {
                fit: 'cover',
                position: 'top' // Keep top of image, crop bottom
            })
            .jpeg({ quality: 85 })
            .toBuffer()
        
        return processedImage

    } finally {
        if (page) {
            if (fromPool && pagePool) {
                await pagePool.release(page)
            } else {
                await page.close()
            }
        }
    }
}

/**
 * Generate OG preview image from a reader page
 */
export async function generateOgImage({ browser, pagePool, url, outputPath }) {
    // Check cache first
    const cached = getCachedImage(url)
    if (cached) {
        return cached
    }

    // For facsimile pages, fetch the underlying image directly (much faster)
    if (isFacsimilePage(url)) {
        const imageBuffer = await generateFacsimileOgImage({ browser, pagePool, url })
        setCachedImage(url, imageBuffer)
        return imageBuffer
    }

    let page = null
    let fromPool = false
    
    // Use a real browser user agent - the custom littb-snapshot-og agent may be blocked by Cloudflare
    const CHROME_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

    try {
        // Try to get page from pool, fallback to creating new page
        if (pagePool) {
            page = await pagePool.acquire()
            fromPool = true
        } else {
            page = await browser.newPage()
        }
        await page.setUserAgent(CHROME_UA)
        
        // Block unnecessary resources for faster loading
        await page.setRequestInterception(true)
        page.on('request', (req) => {
            const resourceType = req.resourceType()
            // Block images, media, and websockets - we only need HTML/CSS/JS/fonts
            if (['image', 'media', 'websocket'].includes(resourceType)) {
                req.abort()
            } else {
                req.continue()
            }
        })
        
        // Set viewport to OG image dimensions
        await page.setViewport({
            width: OG_IMAGE_WIDTH,
            height: OG_IMAGE_HEIGHT,
            deviceScaleFactor: 1.5 // Slightly lower for speed, still good quality
        })
        
        // Wait for page to load - use networkidle2 for Angular SPA
        await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 })
        
        // Wait for the text content to load
        try {
            // Wait for loading to complete first (Angular shows 'searching' class while loading)
            await page.waitForFunction(
                () => !document.querySelector('.searching'),
                { timeout: 20000 }
            )
            // Then wait for the text content
            await page.waitForSelector('.etext.txt, .etext', { timeout: 10000 })
        } catch (selectorError) {
            // Check if this is a page that doesn't exist or has no content
            const hasSearching = await page.evaluate(() => !!document.querySelector('.searching'))
            if (hasSearching) {
                console.error('[OG Preview] Page content never loaded (stuck in searching state) for:', url)
                throw new Error('Page content could not be loaded - the page may not exist')
            }
            throw selectorError
        }
        
        // Inject custom styles for OG preview
        await page.addStyleTag({
            content: `
                /* Hide navigation and sidebar */
                #leftCorridor,
                #rightCorridor,
                .mainnav,
                .logo_link_monogram,
                .pager_ctrls,
                .preloader,
                footer,
                .toolbar,
                #toolbar,
                .nav-controls,
                [role="navigation"] {
                    display: none !important;
                }
                
                /* Style the body for OG preview */
                body {
                    background: linear-gradient(135deg, #faf8f5 0%, #f5f0e8 100%) !important;
                    margin: 0 !important;
                    padding: 0 !important;
                    overflow: hidden !important;
                }
                
                /* Center and style the text content */
                .reader_main,
                #mainview {
                    position: fixed !important;
                    top: 0 !important;
                    left: 0 !important;
                    right: 0 !important;
                    bottom: 0 !important;
                    display: flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    padding: 30px 50px !important;
                    box-sizing: border-box !important;
                    container-type: inline-size !important;
                    container-name: mainview !important;
                }
                
                .etext.txt {
                    max-width: 900px !important;
                    max-height: 560px !important;
                    overflow: hidden !important;
                    font-size: 22px !important;
                    line-height: 1.5 !important;
                    color: #2c2c2c !important;
                    text-align: center !important;
                    position: relative !important;
                }
                
                /* Container query: scale down text for narrower containers */
                @container mainview (max-width: 1100px) {
                    .etext.txt {
                        font-size: 20px !important;
                    }
                    ._head, .poemname, .titlepage h1, .titlepage h2, .titlepage .title {
                        font-size: 22px !important;
                    }
                }
                
                @container mainview (max-width: 900px) {
                    .etext.txt {
                        font-size: 18px !important;
                    }
                    ._head, .poemname, .titlepage h1, .titlepage h2, .titlepage .title {
                        font-size: 20px !important;
                    }
                }
                
                /* Style poem headings and title pages */
                ._head, .poemname, .titlepage h1, .titlepage h2, .titlepage .title,
                .titelsida, .smutstitelsida, ._p.title, .titelsida *, .smutstitelsida * {
                    font-size: 24px !important;
                    font-weight: 600 !important;
                    margin-bottom: 12px !important;
                    margin-top: 0 !important;
                    letter-spacing: 0.02em !important;
                    color: #1a1a1a !important;
                    max-width: 100% !important;
                    overflow: visible !important;
                    word-wrap: break-word !important;
                }
                
                /* Override extreme letter-spacing on any text - use multiple selectors for specificity */
                .etext.txt *,
                .etext *,
                .reader_main *,
                #mainview .etext *,
                .titelsida *,
                .smutstitelsida *,
                ._p.title,
                ._p.title * {
                    letter-spacing: normal !important;
                }
                
                /* Force smaller font on title page elements */
                .titelsida ._p.title,
                .smutstitelsida ._p.title,
                ._p.title .w {
                    font-size: 28px !important;
                    letter-spacing: 0.05em !important;
                }
                
                /* Poetry line styling */
                ._l {
                    display: block !important;
                    margin: 2px 0 !important;
                }
                
                ._lg {
                    margin: 10px 0 !important;
                }
                
                /* Fade out overflow text - on full-width container */
                #mainview::after {
                    content: '' !important;
                    position: fixed !important;
                    bottom: 0 !important;
                    left: 0 !important;
                    right: 0 !important;
                    height: 120px !important;
                    background: linear-gradient(transparent, #f5f0e8) !important;
                    pointer-events: none !important;
                    z-index: 100 !important;
                }
                
                /* Hide page number elements */
                .pname::before {
                    display: none !important;
                }
            `
        })
        
        // Force reset letter-spacing via JavaScript (inline styles have highest specificity)
        await page.evaluate(() => {
            // Reset letter-spacing on all text elements
            document.querySelectorAll('.etext *, .reader_main *, .titelsida *, .smutstitelsida *').forEach(el => {
                el.style.setProperty('letter-spacing', 'normal', 'important');
            });
            // Also reset font-size on title elements to something reasonable
            document.querySelectorAll('._p.title, ._p.title *, .titelsida ._p, .smutstitelsida ._p').forEach(el => {
                const currentSize = parseFloat(window.getComputedStyle(el).fontSize);
                if (currentSize > 40) {
                    el.style.setProperty('font-size', '28px', 'important');
                }
            });
        })
        
        // Take the screenshot
        const screenshotBuffer = await page.screenshot({
            type: 'jpeg',
            quality: 85, // Slightly lower for smaller file size
            clip: {
                x: 0,
                y: 0,
                width: OG_IMAGE_WIDTH,
                height: OG_IMAGE_HEIGHT
            }
        })
        
        // Cache the result
        setCachedImage(url, screenshotBuffer)
        
        return screenshotBuffer

    } finally {
        if (page) {
            if (fromPool && pagePool) {
                await pagePool.release(page)
            } else {
                await page.close()
            }
        }
    }
}

/**
 * Extract metadata from a reader page
 */
export async function extractMetadata({ browser, pagePool, url }) {
    let page = null
    let fromPool = false

    try {
        // Try to get page from pool, fallback to creating new page
        if (pagePool) {
            page = await pagePool.acquire()
            fromPool = true
        } else {
            page = await browser.newPage()
        }
        await page.setUserAgent("littb-snapshot-og")
        
        await page.goto(url, { waitUntil: "networkidle0" })
        await page.waitForSelector('.etext.txt', { timeout: 10000 })
        
        const metadata = await page.evaluate(() => {
            // Extract author
            const authorEl = document.querySelector('#rightCorridor .author a, .author a')
            const author = authorEl ? authorEl.textContent.trim() : null
            
            // Extract book title
            const titleEl = document.querySelector('#rightCorridor .title, a.title')
            const bookTitle = titleEl ? titleEl.textContent.trim() : null
            
            // Extract year
            const yearMatch = document.querySelector('#rightCorridor')?.textContent.match(/\((\d{4})\)/)
            const year = yearMatch ? yearMatch[1] : null
            
            // Extract current chapter/poem title
            const chapterEl = document.querySelector('.navtitle, .current_part p')
            const chapterTitle = chapterEl ? chapterEl.textContent.trim() : null
            
            // Get the main text content (first few lines for description)
            const textContent = document.querySelector('.etext.txt')
            let description = ''
            if (textContent) {
                const lines = textContent.querySelectorAll('._l')
                const textLines = []
                lines.forEach((line, i) => {
                    if (i < 4) {
                        textLines.push(line.textContent.trim())
                    }
                })
                description = textLines.join(' / ')
            }
            
            return {
                author,
                bookTitle,
                year,
                chapterTitle,
                description,
                pageTitle: document.title
            }
        })
        
        return metadata

    } finally {
        if (page) {
            if (fromPool && pagePool) {
                await pagePool.release(page)
            } else {
                await page.close()
            }
        }
    }
}

/**
 * Generate OG meta tags HTML
 */
export function generateOgMetaTags({ url, imageUrl, metadata }) {
    const { author, bookTitle, year, chapterTitle, description } = metadata
    
    // Build the title
    let title = ''
    if (chapterTitle) {
        title = chapterTitle
    }
    if (bookTitle) {
        title = title ? `${title} — ${bookTitle}` : bookTitle
    }
    if (author) {
        title = `${title} av ${author}`
    }
    if (year) {
        title = `${title} (${year})`
    }
    
    // Build the description
    const ogDescription = description || `Läs ${bookTitle || 'texten'} av ${author || 'författaren'} på Litteraturbanken`
    
    return `
<!-- Open Graph / Facebook -->
<meta property="og:type" content="article">
<meta property="og:url" content="${escapeHtml(url)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(ogDescription)}">
<meta property="og:image" content="${escapeHtml(imageUrl)}">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="${OG_IMAGE_WIDTH}">
<meta property="og:image:height" content="${OG_IMAGE_HEIGHT}">
<meta property="og:site_name" content="Litteraturbanken">
<meta property="og:locale" content="sv_SE">

<!-- Twitter -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:url" content="${escapeHtml(url)}">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(ogDescription)}">
<meta name="twitter:image" content="${escapeHtml(imageUrl)}">

<!-- Article metadata -->
<meta property="article:author" content="${escapeHtml(author || '')}">
`.trim()
}

function escapeHtml(str) {
    if (!str) return ''
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
}

/**
 * Extract metadata from HTML using cheerio (no puppeteer needed)
 * This is efficient for injecting OG tags into already-fetched HTML
 */
export function extractMetadataFromHtml($) {
    // Extract author from the sidebar or header
    const authorEl = $('#rightCorridor .author a, .author a').first()
    const author = authorEl.length ? authorEl.text().trim() : null
    
    // Extract book title
    const titleEl = $('#rightCorridor .title, a.title').first()
    const bookTitle = titleEl.length ? titleEl.text().trim() : null
    
    // Extract year - look for (YYYY) pattern in rightCorridor
    const rightCorridorText = $('#rightCorridor').text()
    const yearMatch = rightCorridorText.match(/\((\d{4})\)/)
    const year = yearMatch ? yearMatch[1] : null
    
    // Extract current chapter/poem title
    const chapterEl = $('.navtitle, .current_part p, .page_title').first()
    const chapterTitle = chapterEl.length ? chapterEl.text().trim() : null
    
    // Get the main text content (first few lines for description)
    const lines = $('.etext.txt ._l')
    const textLines = []
    lines.each((i, el) => {
        if (i < 4) {
            textLines.push($(el).text().trim())
        }
    })
    const description = textLines.join(' / ')
    
    return {
        author,
        bookTitle,
        year,
        chapterTitle,
        description,
        pageTitle: $('title').text()
    }
}

/**
 * Inject OG meta tags into HTML head
 * IMPORTANT: We use prepend() to add tags at the BEGINNING of <head>
 * because Slack only reads the first 32KB and Apple/others have similar limits.
 * If we append(), the tags end up after ~200KB of inlined CSS and are never seen.
 */
export function injectOgTags($, url, ogImageBaseUrl) {
    const metadata = extractMetadataFromHtml($)
    const imageUrl = ogImageBaseUrl + '/og-image' + new URL(url).pathname
    const metaTags = generateOgMetaTags({ url, imageUrl, metadata })
    
    // Inject at the BEGINNING of head so unfurlers see it within their byte limits
    // Slack: 32KB, Facebook: 512KB, Twitter: 1MB, LinkedIn: 3MB
    $('head').prepend('\n' + metaTags + '\n')
    
    return $
}

export default {
    isReaderPage,
    isFacsimilePage,
    parseReaderUrl,
    generateOgImage,
    extractMetadata,
    extractMetadataFromHtml,
    injectOgTags,
    generateOgMetaTags
}
