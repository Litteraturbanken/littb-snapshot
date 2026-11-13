// Block the hosted stylesheet as well as font files: stylesheet loads may
// contribute to the provider's pageview count even when fonts are aborted.
export function isTypographyUrl(value) {
    try {
        const host = new URL(value).hostname.toLowerCase()
        return host === 'typography.com' || host.endsWith('.typography.com')
    } catch (_) {
        return false
    }
}

export async function blockTypography(page) {
    await page.setRequestInterception(true)
    page.on('request', request => {
        if (isTypographyUrl(request.url())) request.abort()
        else request.continue()
    })
}
