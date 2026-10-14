// While a popup is open, the page behind it holds still. A phone's Safari
// keeps scrolling a page under overflow: hidden, so instead the page is
// pinned where it is (position: fixed, moved up by however far it had
// scrolled) and put back at the same spot when the last popup closes. A popup
// taller than the screen still scrolls on its own.
(function () {
  let pinnedAt = null;

  function pin(on) {
    if (on === (pinnedAt !== null)) return;
    const body = document.body;
    if (on) {
      pinnedAt = window.scrollY;
      // On computers whose scrollbar takes up room, the page would slide
      // sideways into the space it leaves, so that space is kept.
      const bar = window.innerWidth - document.documentElement.clientWidth;
      body.style.paddingRight = bar > 0 ? `${bar}px` : "";
      body.style.top = `${-pinnedAt}px`;
      body.classList.add("pinned");
    } else {
      body.classList.remove("pinned");
      body.style.top = body.style.paddingRight = "";
      window.scrollTo(0, pinnedAt);
      pinnedAt = null;
    }
  }

  // Watching the open attribute catches every way a popup opens or closes,
  // Esc included, and a popup opened over another keeps the page pinned.
  const check = () => pin(Boolean(document.querySelector("dialog[open]")));
  new MutationObserver(check).observe(document.body, { attributes: true, attributeFilter: ["open"], subtree: true });
  check();
})();
