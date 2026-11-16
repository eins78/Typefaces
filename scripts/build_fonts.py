#!/usr/bin/env python3
"""Build the web fonts and the manifest for the playground.

For every family listed in scripts/families.json:
  - find the font files (shipped WOFF2 is copied, TTF/OTF is converted to WOFF2),
  - copy the licence files next to them,
  - write <out>/<id>/family.json with the faces and their axes.
Then merge everything into <out>/manifest.json.

Fonts are converted as they are: no subsetting, no renaming. Both would count as
modifying the font under the OFL.

Cache: each family directory gets a key (the submodule commit, or the tree hash for
a plain directory, plus the config entry and the script version). If <out>/<id>/.key
already has that key, the family is not converted again. CI restores <out> from the
previous build before running this script.
"""
import argparse
import configparser
import glob
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import unicodedata

from fontTools.ttLib import TTFont

SCRIPT_VERSION = "1"
REPO_URL = "https://github.com/eins78/Typefaces"
LICENSE_CHECKS = {
    "OFL-1.1": re.compile(r"SIL OPEN FONT LICENSE", re.I),
    "MIT": re.compile(r"Permission is hereby granted, free of charge"),
}
LICENSE_URLS = {
    "OFL-1.1": "https://openfontlicense.org/",
    "MIT": "https://opensource.org/license/mit",
}


def slug(text):
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def safe_filename(name):
    stem, ext = os.path.splitext(name)
    return re.sub(r"[^A-Za-z0-9._-]+", "-", stem).strip("-") + ext.lower()


def git_key(path):
    """Gitlink SHA for a submodule, tree hash for a plain directory."""
    return subprocess.check_output(["git", "rev-parse", f"HEAD:{path}"], text=True).strip()


def submodule_urls():
    cp = configparser.ConfigParser()
    cp.read(".gitmodules")
    return {cp[s]["path"]: cp[s]["url"].removesuffix(".git") for s in cp.sections()}


def name_of(font, *ids):
    for i in ids:
        rec = font["name"].getDebugName(i)
        if rec:
            return rec
    return None


def describe(font, path):
    """Family, style and axes of one font file."""
    os2 = font["OS/2"]
    family = name_of(font, 16, 1) or os.path.splitext(os.path.basename(path))[0]
    axes = []
    if "fvar" in font:
        names = font["name"]
        for a in font["fvar"].axes:
            label = names.getDebugName(a.axisNameID) or a.axisTag
            axes.append({"tag": a.axisTag, "name": label, "min": a.minValue, "default": a.defaultValue, "max": a.maxValue})
    weight = os2.usWeightClass
    tags = {a["tag"]: a for a in axes}
    italic = bool(os2.fsSelection & 1) or bool(font["post"].italicAngle) and "slnt" not in tags
    if "ital" in tags and tags["ital"]["max"] >= 1 and tags["ital"]["min"] < 1:
        italic = False  # the page handles ital as a slider
    return {
        "family": family,
        "style": name_of(font, 17, 2) or "Regular",
        "weight": weight,
        "italic": italic,
        "width": os2.usWidthClass,
        "axes": axes,
    }


def check_license(src_dir, entry):
    pattern = LICENSE_CHECKS[entry["license"]]
    for rel in entry["license_files"]:
        with open(os.path.join(src_dir, rel), encoding="utf-8", errors="replace") as fh:
            if not pattern.search(fh.read()):
                sys.exit(f"{entry['dir']}: {rel} does not look like {entry['license']}")


def build_family(entry, out_root, urls):
    src_dir = entry["dir"]
    fam_id = slug(src_dir)
    out_dir = os.path.join(out_root, fam_id)
    key = hashlib.sha1(
        "|".join([SCRIPT_VERSION, git_key(src_dir), json.dumps(entry, sort_keys=True)]).encode()
    ).hexdigest()
    key_file = os.path.join(out_dir, ".key")
    if os.path.exists(key_file) and open(key_file).read() == key and os.path.exists(os.path.join(out_dir, "family.json")):
        print(f"cached  {src_dir}")
        return fam_id, "cached"

    check_license(src_dir, entry)
    shutil.rmtree(out_dir, ignore_errors=True)
    os.makedirs(out_dir)

    sources = []
    for pattern in entry["files"]:
        found = sorted(glob.glob(os.path.join(src_dir, pattern)))
        if not found:
            sys.exit(f"{src_dir}: no files match {pattern}")
        sources += found

    faces = []
    taken = set()
    for src in sources:
        font = TTFont(src)
        info = describe(font, src)
        name = safe_filename(os.path.basename(src))
        name = os.path.splitext(name)[0] + ".woff2"
        while name in taken:
            name = "x-" + name
        taken.add(name)
        dest = os.path.join(out_dir, name)
        if src.lower().endswith(".woff2"):
            shutil.copyfile(src, dest)
        else:
            font.flavor = "woff2"
            font.save(dest)
        info.update(file=name, bytes=os.path.getsize(dest), source=os.path.relpath(src, src_dir))
        faces.append(info)

    licenses = []
    for rel in entry["license_files"]:
        name = "LICENSE-" + safe_filename(os.path.basename(rel)).replace(".md", ".txt")
        shutil.copyfile(os.path.join(src_dir, rel), os.path.join(out_dir, name))
        licenses.append(name)

    url = urls.get(src_dir)
    meta = {
        "id": fam_id,
        "collection": src_dir,
        "source": url or f"{REPO_URL}/tree/master/{src_dir.replace(' ', '%20')}",
        "in_tree": url is None,
        "license": {"id": entry["license"], "url": LICENSE_URLS[entry["license"]], "files": licenses},
        "faces": faces,
    }
    with open(os.path.join(out_dir, "family.json"), "w") as fh:
        json.dump(meta, fh, indent=1)
    with open(key_file, "w") as fh:
        fh.write(key)
    print(f"built   {src_dir}: {len(faces)} files, {sum(f['bytes'] for f in faces) // 1024} KiB")
    return fam_id, "built"


def group_rows(collections):
    """One row per typographic family. A collection can hold several (B612 + B612 Mono, Syne + Syne Mono)."""
    rows = {}
    for coll in collections:
        for face in coll["faces"]:
            key = (coll["id"], face["family"])
            row = rows.setdefault(key, {"coll": coll, "name": face["family"], "faces": []})
            row["faces"].append(face)
    out = []
    used = set()
    for (coll_id, name), row in sorted(rows.items(), key=lambda kv: kv[0][1].lower()):
        row_id = slug(name)
        if row_id in used:
            row_id = f"{row_id}-{coll_id}"
        used.add(row_id)
        coll = row["coll"]
        faces = sorted(row["faces"], key=lambda f: (f["italic"], f["width"], f["weight"], f["file"]))
        out.append({
            "id": row_id,
            "name": name,
            "collection": coll["collection"],
            "dir": coll["id"],
            "source": coll["source"],
            "license": coll["license"],
            "variable": any(f["axes"] for f in faces),
            "bytes": sum(f["bytes"] for f in faces),
            "faces": faces,
        })
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="_site/fonts")
    ap.add_argument("--config", default="scripts/families.json")
    ap.add_argument("--only", help="build only this directory (for testing)")
    args = ap.parse_args()

    with open(args.config) as fh:
        config = json.load(fh)
    urls = submodule_urls()
    os.makedirs(args.out, exist_ok=True)

    entries = [e for e in config["families"] if not args.only or e["dir"] == args.only]
    wanted = set()
    stats = {"cached": 0, "built": 0}
    for entry in entries:
        fam_id, state = build_family(entry, args.out, urls)
        wanted.add(fam_id)
        stats[state] += 1

    # Drop output of families that are no longer in the config.
    if not args.only:
        for name in os.listdir(args.out):
            if os.path.isdir(os.path.join(args.out, name)) and name not in wanted:
                shutil.rmtree(os.path.join(args.out, name))
                print(f"removed {name}")

    collections = []
    for fam_id in sorted(wanted):
        with open(os.path.join(args.out, fam_id, "family.json")) as fh:
            collections.append(json.load(fh))
    rows = group_rows(collections)
    manifest = {
        "families": rows,
        "skipped": config["skipped"],
        "total_bytes": sum(r["bytes"] for r in rows),
    }
    with open(os.path.join(args.out, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=1)
    print(f"\n{len(rows)} families from {len(collections)} directories, {manifest['total_bytes'] / 1e6:.1f} MB "
          f"({stats['built']} built, {stats['cached']} cached)")


if __name__ == "__main__":
    main()
