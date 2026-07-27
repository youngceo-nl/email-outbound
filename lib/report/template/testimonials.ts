/*
 * The client wall from theconversionbrands.com, as shown on the homepage.
 * Scraped 2026-07-27 — names, handles, the funnel screenshot each card shows,
 * and where the card links (the actual page built for that person, or their
 * profile). Images are served from the company site itself, so the deck shows
 * exactly what the homepage shows, and a card click lands on real work.
 *
 * Template content, deliberately: these are Conversion Brands' own clients and
 * do not vary per prospect. Update this list when the homepage wall changes.
 */

export type Testimonial = {
  name: string;
  handle: string;
  href: string;
  image: string;
};

const SITE = "https://theconversionbrands.com";

export const TESTIMONIALS: Testimonial[] = [
  { name: "Alexi Michael", handle: "aleximichael", href: "https://www.instagram.com/aleximichael/", image: `${SITE}/assets/case-studies/em/alexi-shot.jpg` },
  { name: "Samuel Onuha", handle: "sonuha", href: "https://www.instagram.com/sonuha/", image: `${SITE}/assets/case-studies/em/samuel-shot.jpg` },
  { name: "Jasmine Elizabeth", handle: "jasmiines.world", href: "https://ultimatebrandingcourse.webflow.io/watch-training", image: `${SITE}/assets/case-studies/em/jasmine-shot.jpg` },
  { name: "Karim", handle: "section8karim", href: "https://section8training.com/", image: `${SITE}/assets/case-studies/em/karim-shot.jpg` },
  { name: "Leena Ahmed", handle: "leenaahmed", href: "https://airbnbchallenge.webflow.io/", image: `${SITE}/assets/case-studies/em/leena-shot.jpg` },
  { name: "Brez", handle: "brezscales", href: "https://theonlydecision.webflow.io/scale-2-0-full-showcase", image: `${SITE}/assets/case-studies/em/brez-shot.jpg` },
  { name: "Justin Waller", handle: "justinwinwaller7", href: "https://www.smalltownexit.com/", image: `${SITE}/assets/case-studies/em/justin-shot.jpg` },
  { name: "Robert Oliver", handle: "robthebank", href: "https://www.milliondollarbrand.club/confirmation", image: `${SITE}/assets/case-studies/em/robert-shot.jpg` },
  { name: "Sean Frimpong", handle: "ayehxncho", href: "https://www.instagram.com/ayehxncho", image: `${SITE}/assets/case-studies/em/sean-shot.png` },
  { name: "Alan Tursunbaev", handle: "go.detail", href: "https://www.instagram.com/go.detail/", image: `${SITE}/assets/case-studies/em/alan-shot.jpg` },
  { name: "Jordan Welch", handle: "jordanwelch", href: "https://jordanwelch.co/", image: `${SITE}/assets/case-studies/em/jordan-shot.jpg` },
];

/** Where the ask slide sends people. No booking URL exists on the site yet —
 *  the homepage buttons are all "#" — so this lands on the site itself until a
 *  real scheduling link is configured. */
export const BOOKING_URL = "https://theconversionbrands.com/";
