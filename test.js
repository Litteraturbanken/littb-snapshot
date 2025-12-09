import puppeteer from "puppeteer"

;(async function() {
  let browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-setuid-sandbox"]
  })
  let url = "http://jrox.asuscomm.com:8080/?show=Aldous%20Huxley%20-%20Brave%20New%20World"
  let page = await browser.newPage()
  await page.goto(url, { waitUntil: "networkidle0" })
  let html = await page.content()
  console.log("html", html)
})()
