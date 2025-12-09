import lxml.etree as etree
import urllib.request
from lxml.html import fromstring
from lxml.cssselect import CSSSelector
import re, sys, pprint

import concurrent.futures
import json
import queue


HOST = "http://littb-snapshot-littb.os-dev.spraakbanken.gu.se"

def fetch(url):
    url = HOST + url
    try:
        content = urllib.request.urlopen(url).read()
        return fromstring(content)
    except Exception as e:
        return

def harvest_links(url, seen):
    doc = fetch(url)
    if not doc: return
    urls = map(lambda e: e.get("href").split("?")[0], doc.cssselect("a[href^='/skola']"))
    new_urls = set(urls).difference(seen)
    seen.update(new_urls)
    print("new_urls", new_urls)
    for url in new_urls:
        harvest_links(url, seen)

seen = set()
harvest_links("/skola", seen)
print("done\n", "\n".join(seen))
sys.exit()
def printUrls():
    urls = harvest_links("/skola")
    seen = set(['/skola'])
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        future_to_url = {executor.submit(harvest_links, url): url for url in urls}
        wrap = lambda content, tag: "<%s>%s</%s>" % (tag, content, tag) 

        outfile = open("works.txt", "w")
        print_line = lambda x: print(x, file=outfile)
        for future in future_to_url:
            url = future_to_url[future]
            seen.add(url)
            print("seen url", url)
            try:
                urls = future.result()
                new_urls = set(urls).difference(seen)
                future_to_url.update({executor.submit(harvest_links, url): url for url in new_urls})
            except Exception as exc:
                print("err in url", url)

        pprint.pprint(seen)


printUrls()