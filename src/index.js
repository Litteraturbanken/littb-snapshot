import express from "express"
import proxy from "http-proxy-middleware"
import crawler from "./crawler"

import puppeteer from "puppeteer"
import url from "url"
import cheerio from "cheerio"

let browser = null

const SERVER_ROOT = process.env.SERVER_ROOT || "https://litteraturbanken.se"

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

app.use(['/txt', '/img', '/red', "/fonts", "/favicon.ico", "*.css"], proxy({ target: 'https://litteraturbanken.se', changeOrigin: true }))

app.get("*", async function(req, res, next) {
    if(!browser || browser.isClosed) {
        browser = await puppeteer.launch({ args: ["--no-sandbox", '--disable-dev-shm-usage', '--disable-setuid-sandbox'] })
        browser._process.once('close', () => browser.isClosed = true);
    }
    let path = url.parse(req.originalUrl).pathname
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
const HOST = process.env.HOST || '0.0.0.0'
const PORT = process.env.HOST || 8282
app.listen(PORT, HOST, () => console.log(`Listening on ${HOST}:${PORT}. Fetching from ${SERVER_ROOT}`))
