import express from "express"
import crawler from "./crawler"

import puppeteer from "puppeteer"
import url from "url"

let browser = null


const app = express()
app.get("*", async function(req, res, next) {
    if(!browser) {
        browser = await puppeteer.launch({ args: ["--no-sandbox", '--disable-dev-shm-usage', '--disable-setuid-sandbox'] })
    }
    let path = url.parse(req.originalUrl).pathname
    console.log("path", path)
    const from = "https://litteraturbanken.se" + path
    console.time("fetch")
    let html = await crawler({ url : from, browser})
    console.timeEnd("fetch") 
    res.type('html')
    res.send(html)
})
const HOST = process.env.HOST || '0.0.0.0'
const PORT = 8080
app.listen(PORT, HOST, () => console.log(`Listening on ${HOST}:${PORT}.`))


async function main() {
    console.time("browser start")
    
    console.timeEnd("browser start")
    const url = "https://litteraturbanken.se/forfattare/HanssonGD/titlar/Senecaprogrammet/sida/105/etext"
    const url2 = "https://litteraturbanken.se/forfattare/HanssonGD/titlar/Senecaprogrammet/sida/106/etext"
    console.time("first")
    var html = await crawler({ url, browser})
    console.timeEnd("first")
    console.log("html", html.length)
    console.time("second")
    html = await crawler({ url : url2, browser})
    console.timeEnd("second")
    console.log("html", html.length)
    await browser.close()
    console.log("done.")
}

async function test2() {
    console.time("browser start")
    const browser = await puppeteer.launch({ args: ["--no-sandbox"] })
    console.timeEnd("browser start")
    const url = "https://litteraturbanken.se/forfattare/HanssonGD/titlar/Senecaprogrammet/sida/105/etext"
    const url2 = "https://litteraturbanken.se/forfattare/HanssonGD/titlar/Senecaprogrammet/sida/106/etext"
    var first = crawler({ url, browser})
    var second = crawler({ url : url2, browser})
    console.time("both")
    let [firstHtml, secondHtml] = await Promise.all([first, second])
    console.timeEnd("both")
    console.log(firstHtml.length, secondHtml.length)

    await browser.close()
    console.log("done.")   
}

// main()

// test2()