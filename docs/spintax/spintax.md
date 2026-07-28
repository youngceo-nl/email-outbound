we are going to have spintax on our email copy so that the deliverability increases. 
-----------
deprecated:
first off, we need a plan on what words to spintax: the entire email copy or just the hello and ending

secondly, we need to know how many spintax versions we need per how many emails are sent out
------------
------------
current implementation:
Het hoeft alleen maar zo te zijn dat spintax geaccepteerd wordt en werkende in de tool
De spintax zet ik zelf wel in de e-mail copy, als de tool het maar herkend en roteert
------------
------------
shipped (2026-07-28):
Syntax: [option a|option b|option c] inline in subject/body copy, anywhere.
Recognized in: campaign step templates, positive-reply templates, and the
per-category Outreach Ready templates. One option is picked per (lead,
template text) — the same lead always gets the same pick for unchanged copy;
different leads rotate. A live preview (sample lead) is shown under every
template field, including a warning for unmatched [ / ] brackets.
------------