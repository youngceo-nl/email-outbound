import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { ReportDeck } from "./deck";
import { fontFaceCss, logos } from "./fonts";
import type { ReportContent } from "../schema";

/*
 * The deck as one self-contained HTML page — markup, both stylesheets, fonts
 * and a small navigation script all inlined, nothing fetched at view time.
 * document.css is included for the brand variables and the chart/table/stat
 * styles the slides reuse; deck.css turns pages into full-screen slides.
 */

const NAV_SCRIPT = `
(function () {
  var slides = Array.prototype.slice.call(document.querySelectorAll(".cbd-slide"));
  var dots = Array.prototype.slice.call(document.querySelectorAll(".cbd-dots button"));
  var container = document.getElementById("cbd-slides");
  var progress = document.getElementById("cbd-progress");
  var current = 0;

  function go(index) {
    var next = Math.max(0, Math.min(slides.length - 1, index));
    slides[next].scrollIntoView({ behavior: "smooth" });
  }

  function sync() {
    var mid = container.scrollTop + container.clientHeight / 2;
    for (var i = 0; i < slides.length; i++) {
      if (slides[i].offsetTop <= mid && mid < slides[i].offsetTop + slides[i].offsetHeight) {
        current = i;
        break;
      }
    }
    dots.forEach(function (dot, i) { dot.classList.toggle("active", i === current); });
    if (progress) progress.style.width = ((current + 1) / slides.length) * 100 + "%";
  }

  dots.forEach(function (dot) {
    dot.addEventListener("click", function () { go(Number(dot.dataset.slide)); });
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "ArrowDown" || event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") {
      event.preventDefault();
      go(current + 1);
    }
    if (event.key === "ArrowUp" || event.key === "ArrowLeft" || event.key === "PageUp") {
      event.preventDefault();
      go(current - 1);
    }
  });
  container.addEventListener("scroll", sync, { passive: true });
  sync();
})();
`;

export async function buildReportDeckHtml(
  content: ReportContent,
  opts?: { prospectPhoto?: string | null },
): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");

  const assets = { logoMark: logos().mark, prospectPhoto: opts?.prospectPhoto ?? null };
  const body = renderToStaticMarkup(createElement(ReportDeck, { content, assets }));
  const docCss = readFileSync(join(process.cwd(), "lib", "report", "renderer", "document.css"), "utf8");
  const deckCss = readFileSync(join(process.cwd(), "lib", "report", "renderer", "deck.css"), "utf8");

  return `<!doctype html>
<html lang="en" class="cbd-html"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${content.metadata.displayName} — Pitch Walkthrough</title>
<style>${fontFaceCss()}</style>
<style>${docCss}</style>
<style>${deckCss}</style>
</head><body class="cbd-body">${body}<script>${NAV_SCRIPT}</script></body></html>`;
}
