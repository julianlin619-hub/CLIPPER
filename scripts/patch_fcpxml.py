#!/usr/bin/env python3
"""
patch_fcpxml.py — blade-and-close-gaps edit of a multicam FCPXML.

Usage:
    python3 patch_fcpxml.py <multicam.fcpxml> <segment_groups_json> <gap_seconds> <output.fcpxml>

segment_groups_json — JSON array of arrays of {start, end} in MP4 seconds:
    '[[{"start":0,"end":5}],[{"start":10,"end":20},{"start":25,"end":30}]]'
gap_seconds — seconds of dead space to insert between segments (e.g. 60)

Algorithm
---------
The MP4 was rendered from the multicam sequence starting at tc_start, so
MP4 time 0.0s == sequence timeline tc_start.

For each kept range [ks, ke] (MP4 seconds, 0-based):

  ks_frac = Fraction(ks)          # advance into source by this much
  ke_frac = Fraction(ke)
  seg_dur = ke_frac - ks_frac     # snapped to frame boundary

  OUTER <clip>:
    offset   = timeline_cursor    (advances sequentially, starts at tc_start)
    start    = outer_orig.start + ks_frac  (source TC advances into the clip)
    duration = seg_dur

  LANE children (clip/asset-clip with lane= attribute):
    offset   = outer.new_start    (DaVinci Resolve convention: lane offset = parent source TC)
    start    = lane_orig.start + ks_frac  (each lane advances its own source TC by ks)
    duration = seg_dur

  NON-LANE children (<video>, <adjust-transform>, etc.):
    Untouched — these are media-resource anchors, not timing.

DaVinci Resolve convention: lane.offset must equal the parent outer clip's
new `start` value (the source TC after advancing).  Any other value causes
lanes to float to the wrong position on import.
"""

import sys
import json
import re
import os
from fractions import Fraction
from copy import deepcopy
import xml.etree.ElementTree as ET


# ─────────────────────────────────────────────────────────────────────────────
# Rational time helpers
# ─────────────────────────────────────────────────────────────────────────────

def parse_time(s: str) -> Fraction:
    s = s.strip().rstrip("s")
    if "/" in s:
        n, d = s.split("/", 1)
        return Fraction(int(n), int(d))
    return Fraction(s)

def fmt_time(f: Fraction) -> str:
    f = Fraction(f)
    return f"{f.numerator}/{f.denominator}s"

def snap(t: Fraction, frame_dur: Fraction) -> Fraction:
    """Round t to the nearest frame boundary."""
    frames = round(t / frame_dur)
    return frames * frame_dur

def log(obj: dict):
    print(json.dumps(obj), flush=True)


# ─────────────────────────────────────────────────────────────────────────────
# Frame duration
# ─────────────────────────────────────────────────────────────────────────────

def get_frame_duration(root, sequence) -> Fraction:
    fmt_id = sequence.get("format")
    for fmt in root.findall(".//format"):
        if fmt.get("id") == fmt_id and fmt.get("frameDuration"):
            return parse_time(fmt.get("frameDuration"))
    return Fraction(1001, 30000)  # fallback: 29.97 fps


# ─────────────────────────────────────────────────────────────────────────────
# Lane-clip patching (DaVinci Resolve multicam convention)
# ─────────────────────────────────────────────────────────────────────────────

def patch_lane_clips(container, outer_new_start: Fraction, ks: Fraction):
    """
    Update all direct lane children of `container` for a new kept segment.

    DaVinci Resolve convention:
      lane.offset = parent outer clip's new start (source TC after advancing).
      lane.start  = original lane start + ks  (advance into source by same amount).
      lane.duration = outer's new duration (already written on container).

    Non-lane children (<video>, <adjust-transform>, …) are left completely
    untouched — they are media-resource anchors, not edit timing.
    """
    new_dur = parse_time(container.get("duration"))
    for child in container:
        if child.get("lane") is None:
            continue  # non-lane child → leave alone
        if child.tag not in ("clip", "asset-clip", "audio", "mc-clip"):
            continue

        orig_start = parse_time(child.get("start", "0/1s"))
        child.set("offset",   fmt_time(outer_new_start))   # DR sync anchor
        child.set("start",    fmt_time(orig_start + ks))   # advance source TC
        child.set("duration", fmt_time(new_dur))

        # Recurse for nested lane clips (rare but possible)
        patch_lane_clips(child, outer_new_start, ks)


# ─────────────────────────────────────────────────────────────────────────────
# Core patch
# ─────────────────────────────────────────────────────────────────────────────

def patch(multicam_path: str, segment_groups: list, output_path: str, gap_seconds: float = 60.0):
    raw           = open(multicam_path, "r", encoding="utf-8").read()
    doctype_match = re.search(r"<!DOCTYPE[^>]*>", raw)
    doctype_str   = doctype_match.group(0) if doctype_match else "<!DOCTYPE fcpxml>"
    root          = ET.fromstring(re.sub(r"<!DOCTYPE[^>]*>", "", raw))

    sequence = root.find(".//sequence")
    if sequence is None:
        raise RuntimeError("No <sequence> found in FCPXML")

    spine = sequence.find("spine")
    if spine is None:
        raise RuntimeError("No <spine> found in sequence")

    tc_start  = parse_time(sequence.get("tcStart", "0/1s"))
    frame_dur = get_frame_duration(root, sequence)

    SPINE_TAGS = {"clip", "asset-clip", "mc-clip", "ref-clip"}
    outer_clips = [c for c in spine if c.tag in SPINE_TAGS]
    if not outer_clips:
        raise RuntimeError(f"No clip elements found in spine (got: {[c.tag for c in spine]})")

    total_ranges = sum(len(g) for g in segment_groups)
    log({"status": "started",
         "segments":    len(segment_groups),
         "total_ranges": total_ranges,
         "spine_clips":  len(outer_clips),
         "tc_start_s":   float(tc_start),
         "frame_dur":    str(frame_dur)})

    gap_dur         = snap(Fraction(gap_seconds).limit_denominator(30000), frame_dur)
    new_elements    = []
    timeline_cursor = tc_start

    for group_idx, kept_ranges in enumerate(segment_groups):
        # Insert 1-minute gap before each segment group (except the first)
        if group_idx > 0 and gap_dur > 0:
            gap_el = ET.Element("gap")
            gap_el.set("name",     f"Gap {group_idx}")
            gap_el.set("offset",   fmt_time(timeline_cursor))
            gap_el.set("duration", fmt_time(gap_dur))
            gap_el.set("start",    "0/1s")
            new_elements.append(gap_el)
            timeline_cursor += gap_dur
            log({"status": "gap", "group_idx": group_idx, "gap_dur_s": float(gap_dur)})

        if not kept_ranges:
            continue

        for idx, seg in enumerate(kept_ranges):
            ks = snap(Fraction(seg["start"]), frame_dur)
            ke = snap(Fraction(seg["end"]),   frame_dur)
            if ke <= ks:
                ke = ks + frame_dur

            seg_dur       = ke - ks
            seg_seq_start = tc_start + ks

            # Find which spine clip covers this range
            source_clip = None
            for c in outer_clips:
                clip_offset = parse_time(c.get("offset", "0/1s"))
                clip_end    = clip_offset + parse_time(c.get("duration"))
                if clip_offset <= seg_seq_start < clip_end:
                    source_clip = c
                    break
            if source_clip is None:
                source_clip = outer_clips[0]

            clip_offset       = parse_time(source_clip.get("offset", "0/1s"))
            clip_source_start = parse_time(source_clip.get("start"))
            advance           = seg_seq_start - clip_offset
            outer_new_start   = clip_source_start + advance

            new_outer = deepcopy(source_clip)
            new_outer.set("offset",   fmt_time(timeline_cursor))
            new_outer.set("start",    fmt_time(outer_new_start))
            new_outer.set("duration", fmt_time(seg_dur))

            patch_lane_clips(new_outer, outer_new_start, advance)

            new_elements.append(new_outer)

            log({"status": "segment",
                 "group":       group_idx,
                 "idx":         idx,
                 "mp4_s":       float(seg["start"]),
                 "mp4_e":       float(seg["end"]),
                 "seg_dur_s":   float(seg_dur),
                 "outer_start": fmt_time(outer_new_start),
                 "offset_s":    float(timeline_cursor)})

            timeline_cursor += seg_dur

    # Replace spine contents
    for child in list(spine):
        spine.remove(child)
    for el in new_elements:
        spine.append(el)

    sequence.set("duration", fmt_time(timeline_cursor - tc_start))

    log({"status": "done",
         "output":           output_path,
         "elements":         len(new_elements),
         "total_duration_s": float(timeline_cursor - tc_start)})

    _indent(root)
    xml_body = ET.tostring(root, encoding="unicode", xml_declaration=False)
    out = '<?xml version="1.0" encoding="UTF-8"?>\n' + doctype_str + "\n" + xml_body
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(out)


# ─────────────────────────────────────────────────────────────────────────────
# XML pretty-printer
# ─────────────────────────────────────────────────────────────────────────────

def _indent(elem, level=0):
    pad = "\n" + "  " * level
    if len(elem):
        if not elem.text or not elem.text.strip():
            elem.text = pad + "  "
        if not elem.tail or not elem.tail.strip():
            elem.tail = pad
        for child in elem:
            _indent(child, level + 1)
        if not child.tail or not child.tail.strip():
            child.tail = pad
    else:
        if level and (not elem.tail or not elem.tail.strip()):
            elem.tail = pad


# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) != 5:
        log({"error": "Usage: patch_fcpxml.py <multicam.fcpxml> <segment_groups_json> <gap_seconds> <output.fcpxml>"})
        sys.exit(1)

    multicam_path = sys.argv[1]
    groups_arg    = sys.argv[2]
    gap_seconds   = float(sys.argv[3])
    output_path   = sys.argv[4]

    if not os.path.exists(multicam_path):
        log({"error": f"File not found: {multicam_path}"})
        sys.exit(1)

    try:
        segment_groups = json.loads(groups_arg)
        if not isinstance(segment_groups, list) or not segment_groups:
            raise ValueError("segment_groups must be a non-empty JSON array")
        patch(multicam_path, segment_groups, output_path, gap_seconds=gap_seconds)
    except Exception as e:
        import traceback
        log({"error": str(e), "trace": traceback.format_exc()})
        sys.exit(1)
