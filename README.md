# Typefaces

small collection of beautiful fonts under "free/libre/open source" licenses.

thanks to 
* this [twitter thread](https://twitter.com/gontijodesign/status/1394624373823348737) by [@gontijodesign](https://twitter.com/gontijodesign) *([backup](https://web.archive.org/web/20210519090950/https://threadreaderapp.com/thread/1394624373823348737.html))*,
* the [Velvetyne Type Foundry](http://www.velvetyne.fr/about/) and 
* all the type designers releasing their work under permissive licenses 🖤

## Playground

A GitHub Pages site, built by [`.github/workflows/pages.yml`](.github/workflows/pages.yml):

* **Home page** (`/`): this text and a link. It loads no webfonts.
* **Playground** (`/playground/`): a text field with sample text, and every family rendered in its own font.
  Fonts load lazily, when a row scrolls into view. Per family there is a tick and a star; the picks are kept in
  `localStorage` and in the URL hash (`#t=…&s=…`), so a link carries them. "Copy list" copies the picks as text.
  A filter shows only starred or ticked families.

### How the build works

`scripts/build_fonts.py` reads [`scripts/families.json`](scripts/families.json), which lists per family directory
the font files to use and the licence files. For each family it

1. takes the files the family ships (a prebuilt WOFF2 is copied as it is; TTF/OTF is converted to WOFF2),
2. copies the licence files next to the fonts,
3. writes the manifest `fonts/manifest.json` that the playground reads (family, styles, axes, licence, source repo).

Fonts are **converted, never subset or renamed**. Per the [OFL FAQ](https://openfontlicense.org/ofl-faq/)
(2.2.1) a plain WOFF2 conversion is not a Modified Version, but removing glyphs (2.6) is, and with a Reserved
Font Name it would force a rename.

**Cache:** every family has a key: the submodule commit (or the tree hash for a plain directory), its config
entry and the script version. The workflow restores the previous build's `_site/fonts` with `actions/cache`;
a family whose key is unchanged is not converted again. A cold build takes about a minute.

Families that are not in `families.json` are listed under "Left out" in `skipped` (and on the playground),
with the reason: a licence that does not allow public web redistribution, no licence stated, or no font binaries.
To add a family, add an entry to `families.json`.

To build locally:

```sh
pip install -r requirements.txt
git submodule update --init
python scripts/build_fonts.py        # writes _site/fonts
cp -R site/. _site/
python -m http.server --directory _site
```

### One-time setup

In the repository settings under **Pages**, set **Source** to **GitHub Actions**.
