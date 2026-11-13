import assert from 'assert'
import http from 'http'
import puppeteer from 'puppeteer'
import crawler from '../src/crawler'
import { blockTypography, isTypographyUrl } from '../src/font-policy'

async function main() {
    assert(isTypographyUrl('https://cloud.typography.com/7426274/770508/css/fonts.css'))
    assert(!isTypographyUrl('https://typography.com.example.org/font.css'))
    const server = http.createServer((req, res) => {
        res.setHeader('Content-Type', req.url === '/local.css' ? 'text/css' : 'text/html')
        res.end(req.url === '/local.css' ? 'body { color: rgb(1, 2, 3) }' :
            '<link rel="stylesheet" href="https://cloud.typography.com/7426274/770508/css/fonts.css"><link rel="stylesheet" href="/local.css"><main id="mainview"></main><script>document.querySelector("main").textContent="SPA rendered"</script>')
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
        console.log('font policy browser tests passed')
    } finally {
        if (browser) await browser.close()
        await new Promise(resolve => server.close(resolve))
    }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
