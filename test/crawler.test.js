import assert from "assert"
import crawler from "../src/crawler"

class ReadinessPage {
    constructor() {
        this.renderComplete = false
    }

    async setUserAgent() {}
    async setRequestInterception() {}
    on() {}

    async goto(url, options) {
        // Model the production race: two requests may still be active when
        // networkidle2 resolves, but the rendered content is complete only
        // once the network is fully idle.
        this.renderComplete = options.waitUntil === "networkidle0"
    }

    async content() {
        return this.renderComplete
            ? '<main id="mainview">all titles rendered</main>'
            : '<main id="mainview">partial title list</main>'
    }

    async close() {}
}

async function main() {
    const page = new ReadinessPage()
    const browser = {
        async newPage() {
            return page
        }
    }

    const html = await crawler({
        browser,
        pagePool: null,
        url: "https://litteraturbanken.se/forfattare/StrindbergA/titlar"
    })

    assert.equal(
        html,
        '<main id="mainview">all titles rendered</main>',
        "crawler must not capture the page while API requests can still be active"
    )

    console.log("crawler readiness test passed")
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
