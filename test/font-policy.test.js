import assert from 'assert'
import http from 'http'
import puppeteer from 'puppeteer'
import crawler from '../src/crawler'
import { generateOgImage } from '../src/og-preview'
import { blockTypography, isTypographyUrl } from '../src/font-policy'

async function main() {
    assert(isTypographyUrl('https://cloud.typography.com/7426274/770508/css/fonts.css'))
    assert(!isTypographyUrl('https://typography.com.example.org/font.css'))
    const server = http.createServer((req, res) => {
        res.setHeader('Content-Type', req.url === '/local.css' ? 'text/css' : 'text/html')
        res.end(req.url === '/local.css' ? 'body { color: rgb(1, 2, 3) }' :
            '<link rel="stylesheet" href="https://cloud.typography.com/7426274/770508/css/fonts.css"><link rel="stylesheet" href="/local.css"><main id="mainview" class="etext txt"></main><script>document.querySelector("main").textContent="SPA rendered"</script>')
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    let browser
    try {
        browser = await puppeteer.launch({ headless: true })
        const url = `http://127.0.0.1:${server.address().port}`
        for (const mode of ['crawler', 'metadata']) {
            const page = await browser.newPage()
            const blocked = [], completed = []
            page.on('requestfailed', req => { if (isTypographyUrl(req.url())) blocked.push(req.url()) })
            page.on('requestfinished', req => completed.push(req.url()))
            if (mode === 'crawler') {
                const html = await crawler({browser: {newPage: async () => page}, url})
                assert(html.includes('SPA rendered'))
            } else {
                await blockTypography(page)
                await page.goto(url, {waitUntil: 'networkidle0'})
                assert.equal(await page.$eval('main', el => el.textContent), 'SPA rendered')
                assert.equal(await page.$eval('body', el => getComputedStyle(el).color), 'rgb(1, 2, 3)')
                await page.close()
            }
            assert.equal(blocked.length, 1, `${mode} must abort the hosted stylesheet`)
            assert(!completed.some(isTypographyUrl))
            assert(completed.some(url => url.endsWith('/local.css')))
        }
        // Exercise the actual screenshot path, serving a fixture for the
        // provider CSS so the test never contacts typography.com.
        const imagePage = await browser.newPage()
        const completed = []
        imagePage.on('requestfinished', req => completed.push(req.url()))
        const on = imagePage.on.bind(imagePage)
        imagePage.on = (event, handler) => {
            if (event !== 'request') return on(event, handler)
            return on(event, req => handler({
                url: () => req.url(),
                resourceType: () => req.resourceType(),
                abort: () => req.abort(),
                continue: () => isTypographyUrl(req.url())
                    ? req.respond({ status: 200, contentType: 'text/css', body: 'body { font-family: serif }' })
                    : req.continue()
            }))
        }
        const jpeg = await generateOgImage({ browser: { newPage: async () => imagePage }, url })
        assert(completed.some(isTypographyUrl), 'OG screenshots must load provider CSS')
        assert.equal(jpeg.subarray(0, 2).toString('hex'), 'ffd8')
        console.log('font policy browser tests passed: HTML blocked, OG image allowed')
    } finally {
        if (browser) await browser.close()
        await new Promise(resolve => server.close(resolve))
    }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
