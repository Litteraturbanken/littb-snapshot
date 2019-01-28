import express from "express"
import proxy from "http-proxy-middleware"
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

app.use(['/txt', '/img', '/red', "/fonts", "*.css"], proxy({ target: 'https://litteraturbanken.se', changeOrigin: true }))

app.get("*", async function(req, res, next) {
    if(!browser) {
        browser = await puppeteer.launch({ args: ["--no-sandbox", '--disable-dev-shm-usage', '--disable-setuid-sandbox'] })
    }
    let path = url.parse(req.originalUrl).pathname
    // console.log("path", path)
    const from = "https://litteraturbanken.se" + path
    console.time("fetch " + path)
    const type = path.split(".")[path.split(".").length - 1]
    let content = await crawler({ url : from, browser})
    console.timeEnd("fetch " + path) 
    // if(type == "html" || !type) {
    res.type('html')
    res.send(cleanHtml(content))
    // } else if(["css", "jpeg", "jpg"].includes(type)) {
    //     res.type(type)
    //     res.send(content)
    // }
})
const HOST = process.env.HOST || '0.0.0.0'
const PORT = 8080
app.listen(PORT, HOST, () => console.log(`Listening on ${HOST}:${PORT}.`))
