# Loci — agent brand handoff
Version 1.0 · 6 October 2026

Repository integration: shipped SVG logos are in `public/brand/`. All headers use the compact color lockup through `BrandLogo`. Next.js serves `src/app/icon.svg`, `src/app/favicon.ico` and `src/app/apple-icon.png` automatically. App PNGs and the Inter license are in `public/brand/`. The remaining export paths below refer to the original LOCI BRANDING handoff folder.

## Product and voice
Loci is a spatial canvas for learning. Students bring PDFs, screenshots, notes and course materials; the tutor explains beside them through writing, drawing and highlighting. Explanations stay in place and can be revisited or replayed. Primary audience: university students.

Core idea: **Understanding has a place.** Approved existing copy: “A spatial canvas for learning” and “Intelligence, given a place.” Website: learnwithloci.com. Write calmly, clearly and concretely; do not invent capabilities or claims.

## Preserve the existing UI
Keep its layout, generous space, fine borders, rounded controls and restrained shadows. Do not redesign the product around the logo or add broad colorful surfaces. Use these existing foundation colors:

| Token | Hex | Role |
|---|---|---|
| Eggshell | #FDFCFC | Main background |
| Warm taupe | #F5F3F1 | Quiet surfaces |
| Stone | #EBE8E4 | Borders and secondary surfaces |
| Ink | #000000 | Main text |
| Graphite | #44403B | Secondary text |
| Smoke | #777169 | Muted text; check contrast at actual size |

Inter remains the interface typeface. Retain current light weights and tight spacing in large headings. Shantell Sans is for handwritten teaching content. Preserve existing type scale. Logo lettering is outlined Inter Medium, optically spaced; use the asset instead of typing a replacement.

## Logo system
The spatial symbol contains peach, blue-violet and cream planes. It identifies Loci; the existing colorful orb represents the tutor/intelligence and remains separate product imagery.

- Default header: `svg/loci-horizontal-color.svg`.
- Tight horizontal spaces: `svg/loci-compact-color.svg`.
- Toolbar, avatar and small identity slot: `svg/loci-symbol-color.svg`.
- One-color printing: matching `*-black.svg`; white on dark: `*-white.svg`.
- Full color on dark: use the symbol plus white wordmark in `loci-horizontal-dark.svg` (includes its dark background). A transparent dark lockup can be assembled from the supplied color symbol and white wordmark, preserving the primary spacing.
- Browser tab: `svg/loci-favicon.svg` or `icons/favicon.ico`. It has simplified geometry and stronger flat colors for optical legibility.
- App icons: `svg/loci-app-icon.svg` and square PNGs. These have an opaque eggshell background; let the OS apply its mask. Rounded assets are previews, not submission masters.

Color, black and white logo PNGs have genuine transparent backgrounds. Dark lockup and app-icon masters intentionally have opaque backgrounds. White assets can look blank on a white image viewer.

## Spacing and size
Measure clear space from visible artwork, not the SVG canvas. Leave at least one quarter of the symbol height around every lockup. Maintain the supplied symbol-to-wordmark spacing and proportions.

Minimum display sizes: primary lockup 120 px wide; compact lockup 96 px wide; standard symbol 24 px high. Use the optimized favicon mark at 16–23 px. Do not squeeze the full lockup into an icon slot. For print, start at 30 mm primary width / 6 mm symbol height and inspect a proof.

Do not stretch, rotate, change plane order, add outlines or shadows, recolor arbitrarily, or rebuild the mark in CSS. Do not use the reference board as an asset. Use SVG for responsive web display; PNG for tools requiring raster images. Preserve aspect ratio and alt text: “Loci” for a linked brand logo; empty alt for decorative duplication.

## Restrained accent color
Logo gradient stops: peach #FFD4BC → #FFB99F → #EBA6BA; blue-violet #AC9DE9 → #718FE2 → #DCD9E4; cream #EFE9E4 → #F2E5D9. These are artwork colors, not new UI text or semantic tokens. Favicon flat colors: #FFBEA4, #7E8DD8, #E9DFD5.

Use occasional overlapping translucent planes in marketing composition, with the same slope and soft corners as the mark. Keep them away from reading material. In learning diagrams, use thin graphite connectors, small location dots and Shantell Sans annotations; reserve color for a local focus or highlight. Never encode meaning by color alone. Avoid generic AI sparkles, brains, graduation caps, robot mascots and stock education imagery.

## Asset status
`svg/`, `png/` and `icons/` are finished v1.0 production exports, recreated as clean geometry from the approved raster direction. This is a faithful vector interpretation, not a recovered original vector file; gradients and letter spacing are normalized. True one-color and favicon variants intentionally differ for functional clarity.

`reference/APPROVED-CONCEPT-NOT-PRODUCTION.png` is the earlier concept board only. Its UI examples and social handle are illustrative, not verified product facts. `ASSET-OVERVIEW.png` is an export review sheet, not a logo asset.

SVGs contain paths and gradients only: no external fonts, raster embeds or scripts. Do not edit their geometry casually. Keep this document alongside the assets when handing off to agents.
