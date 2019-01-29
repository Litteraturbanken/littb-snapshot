

async function crawler({ browser, url, ua }) {

    let page = null
    let html = false

    try {
        page = await browser.newPage()
        await page.setUserAgent(ua)
        // page.on('console', msg => console.log('PAGE LOG:', msg.text()))
        // await page.evaluate(() => console.log(`UA is ${navigator.userAgent}`))
        //networkidle0: consider navigation to be finished when
        //there are no more than 2 network connections for at least 500 ms.
        //(https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#pagegobackoptions)
        await page.goto(url, { waitUntil: "networkidle0" })
        html = await page.content()
    } catch (e) {
        console.warn(`Not able to fetch ${url}`)
        console.warn(e)
    } finally {
        if (page) {
            await page.close()
        }
        return html
    }
}

export default crawler