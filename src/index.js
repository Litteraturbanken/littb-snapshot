import express from "express"
import crawler from "./crawler"

import puppeteer from "puppeteer"
import url from "url"
import cheerio from "cheerio"

let browser = null

function cleanHtml(html) {
    const $ = cheerio.load(html)
    $("script[src]").remove()
    return $.html()
}

const app = express()
app.get("*", async function(req, res, next) {
    if(!browser) {
        browser = await puppeteer.launch({ args: ["--no-sandbox", '--disable-dev-shm-usage', '--disable-setuid-sandbox'] })
    }
    let path = url.parse(req.originalUrl).pathname
    // console.log("path", path)
    const from = "https://litteraturbanken.se" + path
    console.time("fetch" + path)
    let html = await crawler({ url : from, browser})
    console.timeEnd("fetch" + path) 
    res.type('html')
    res.send(cleanHtml(html))
})
const HOST = process.env.HOST || '0.0.0.0'
const PORT = 8080
app.listen(PORT, HOST, () => console.log(`Listening on ${HOST}:${PORT}.`))
