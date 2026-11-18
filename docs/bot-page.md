# SectionaryBot (copy for the /bot page)

**Who we are.** SectionaryBot is the crawler behind Blimp, a reference
library of real website and online-store designs, built by Blackbird.

**What it does.** It visits public pages of online stores the way a browser
does, once, and takes screenshots of those pages, plus short silent screen
recordings of the sections that move (slideshows, background videos, scrolling
text), so designers can study how stores are built. It captures at most a handful of pages per store (home,
one or two collections, one or two products) at desktop and phone width, no
more than one page per second, and identifies itself in every request as
`SectionaryBot/<version>` with a link to this page.

To show how a page behaves, it may scroll, open the navigation menu, move a
slideshow to its next slide, select a product option or open a product preview,
and take a screenshot or a short recording of the result.
On stores whose robots.txt allows it, it also adds one product to a cart to
photograph the cart, then empties the cart again. While it does this it blocks
the store's analytics and ad tracking, so it is not counted as a shopper. It
never types into a field, and the only form it sends is a product's add to cart.

**What it does not do.** It never signs in, never goes to checkout or places an
order, never enters any details, never captures account, checkout or search pages, never
collects personal data, and never copies your code, images or files. Recordings
are made by our own browser as it shows the page; your video files are never
downloaded. The only things stored are our own screenshots and short screen
recordings, plus public facts about the page (its address, the platform it runs
on, the apps it loads).

**It respects robots.txt.** Add this to yours and it will stop:

```
User-agent: SectionaryBot
Disallow: /
```

**Opt out or ask for removal.** Send the store address to [contact address,
set when the domain is bought] or use the form on this page. We add the store
to a block list our crawler checks before every run and remove its screenshots
and recordings within 48 hours.

**Attribution.** Every screenshot and recording in Blimp names the store and
links to the page it came from.
