import asyncio
from timeit import default_timer

from aiohttp import ClientSession
import requests

HOST = "http://littb-snapshot-littb.os-dev.spraakbanken.gu.se"
# HOST = "http://localhost:8080"

def async_fetch(urls):
    """Fetch list of web pages asynchronously."""
    start_time = default_timer()

    loop = asyncio.get_event_loop() # event loop
    future = asyncio.ensure_future(fetch_all(urls)) # tasks to do
    loop.run_until_complete(future) # loop until done

    tot_elapsed = default_timer() - start_time
    print("Done. %.2fs" % tot_elapsed)

async def fetch_all(urls):
    """Launch requests for all web pages."""
    tasks = []
    fetch.start_time = dict() # dictionary of start times for each url
    async with ClientSession() as session:
        for url in urls:
            task = asyncio.ensure_future(fetch(url, session))
            tasks.append(task) # create list of tasks
        _ = await asyncio.gather(*tasks) # gather task responses

async def fetch(url, session):
    """Fetch a url, using specified ClientSession."""
    fetch.start_time[url] = default_timer()
    async with session.get(HOST + url) as response:
        resp = await response.read()
        elapsed = default_timer() - fetch.start_time[url]
        print('{0:30} {1:5.2f}'.format(url, elapsed))
        return resp

if __name__ == '__main__':
    url = "/forfattare/HanssonGD/titlar/Senecaprogrammet/sida/%s/etext"
    # url = "/forfattare/HanssonGD/titlar/Senecaprogrammet/sida/%s/etext"
    url_list = []
    for i in range(3, 104):
    # for i in range(3, 6):
        url_list.append(url % i)
    async_fetch(url_list)
