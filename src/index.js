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
    $("script[src],script[data-ga]").remove()
    return $.html()
}

function getErrors($) {
    const err = $('[littb-err]')
    let errType = null, errMsg = null
    if(err.length) {
        errType = Number(err.attr("code"))
        errMsg = err.attr("msg")
    }
    return {errType, errMsg}
}

const app = express()

app.use(['/txt', '/img', '/red', "/fonts", "/favicon.ico", "*.css"], proxy({ target: 'https://litteraturbanken.se', changeOrigin: true }))

app.get("*", async function(req, res, next) {
    if(!browser) {
        browser = await puppeteer.launch({ args: ["--no-sandbox", '--disable-dev-shm-usage', '--disable-setuid-sandbox'] })
    }
    let path = url.parse(req.originalUrl).pathname
    path = path.replace("/&_escaped_fragment_=", "")
    const from = SERVER_ROOT + path
    // const from = "http://localhost:9000" + path
    console.time("fetch " + path)
    const type = path.split(".")[path.split(".").length - 1]
    let content = await crawler({ url : from, browser})
    const $ = cheerio.load(content)
    console.timeEnd("fetch " + path) 
    const {errMsg, errType} = getErrors($)
    if(errType) {
        res.status(errType).send(errMsg)
    } else {
        res.type('html')
        res.send(cleanHtml(content))
    }
})
const HOST = process.env.HOST || '0.0.0.0'
const PORT = 8080
app.listen(PORT, HOST, () => console.log(`Listening on ${HOST}:${PORT}. Fetching from ${SERVER_ROOT}`))
