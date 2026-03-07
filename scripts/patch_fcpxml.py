#!/usr/bin/env python3
"""
Patch a DaVinci Resolve multicam FCPXML using an edited audio FCPXML as the cut guide.

Usage (primary — from edited FCPXML):
    python3 patch_fcpxml.py <multicam.fcpxml> --from-edited <edited.fcpxml> <output.fcpxml>

Usage (legacy — raw cut ranges):
    python3 patch_fcpxml.py <multicam.fcpxml> --cuts '<[[s,e],...]>' <output.fcpxml>

How the patched FCPXML is structured
-------------------------------------
The spine contains one outer clip per kept segment, laid out sequentially.
Each outer clip (primary camera, e.g. C2056) owns the lane clips (secondary
cameras, audio) as **direct children** with lane attributes — exactly matching
the original DaVinci Resolve multicam layout.

DaVinci Resolve's convention for connected lane clips
------------------------------------------------------
In a DR multicam FCPXML the offset of every lane clip equals the *source TC*
of its parent outer clip (i.e. parent.start), NOT the parent's sequence
position (parent.offset).  This is the sync anchor DaVinci uses to keep all
lanes locked together.  When we advance the outer clip's start by `ks` seconds
(to skip the cut region) we must also advance every lane clip's offset by the
same amount so it stays:

    lane.offset = outer.start   (always equals the parent's new start value)

Getting this wrong — leaving lane.offset at the original source TC for every
segment — is what causes clips to "float" at the wrong position after import.
"""

import sys
import json
import re
from fractions import Fraction
from copy import deepcopy
import xml.etree.ElementTree as ET


# ── Rational time helpers ─────────────────────────────────────────────────────

def parse_time(s: str) -> Fraction:
    s = s.strip().rstrip("s")
    if "/" in s:
        n, d = s.split("/", 1)
        return Fraction(int(n), int(d))
    return Fraction(s)


def fmt_time(f: Fraction) -> str:
    f = Fraction(f)
    return f"{f.numerator}/{f.denominator}s"


def secs_to_frac(s: float) -> Fraction:
    return Fraction(s).limit_denominator(300000)


# ── Parse kept segments from edited FCPXML ────────────────────────────────────

def extract_kept_from_edited_fcpxml(edited_path: str) -> list:
    """
    Read the edited audio FCPXML (output of CLIPPER's generateFCPXML).
    Each <asset-clip> in the spine has start= and duration= that define a kept segment.
    Returns list of (start, end) Fraction pairs in source/timeline seconds.
    """
    raw = open(edited_path, "r", encoding="utf-8").read()
    raw = re.sub(r"<!DOCTYPE[^>]*>", "", raw)
    root = ET.fromstring(raw)

    spine = root.find(".//spine")
    if spine is None:
        raise RuntimeError("No <spine> found in edited FCPXML")

    kept = []
    for child in spine:
        start_str = child.get("start")
        dur_str   = child.get("duration")
        if start_str and dur_str:
            start = parse_time(start_str)
            dur   = parse_time(dur_str)
            kept.append((start, start + dur))

    if not kept:
        raise RuntimeError("No kept segments found in edited FCPXML")

    return kept


# ── Kept-segment calculation from raw cuts ────────────────────────────────────

def compute_kept_from_cuts(cuts: list, total_duration: Fraction) -> list:
    sorted_cuts = sorted(
        (secs_to_frac(s), secs_to_frac(e)) for s, e in cuts
    )
    kept = []
    pos = Fraction(0)
    for cs, ce in sorted_cuts:
        if cs > pos:
            kept.append((pos, cs))
        pos = max(pos, ce)
    if pos < total_duration:
        kept.append((pos, total_duration))
    return [(s, e) for s, e in kept if e > s]


# ── Lane-clip patching ────────────────────────────────────────────────────────

def patch_lane_clips(container, outer_new_start: Fraction, ks: Fraction):
    """
    Update all direct lane children of *container* for a new kept segment.

    For each lane clip (clip/asset-clip/audio/mc-clip with a lane= attribute):

      offset   = outer_new_start
                 DaVinci Resolve's convention: lane offset = parent's source TC
                 (= outer.start after advancing by ks).  Using any other value
                 — the sequence cursor, the original TC, zero — causes clips to
                 float at the wrong position after import.

      start    = original_start + ks
                 Advances the lane clip's read-head into its source by the same
                 amount as the outer clip, keeping every lane in sync.

      duration = outer's new duration (already written onto container).

    Non-lane children (video, adjust-transform, etc.) are left untouched;
    they describe the media resource reference, not the clip timing.
    """
    new_dur = parse_time(container.get("duration"))
    for child in container:
        if child.get("lane") is None:
            continue  # leave non-lane children alone
        if child.tag not in ("clip", "asset-clip", "audio", "mc-clip"):
            continue

        orig_start = parse_time(child.get("start", "0/1s"))
        child.set("offset",   fmt_time(outer_new_start))   # sync anchor = parent's new start TC
        child.set("start",    fmt_time(orig_start + ks))   # advance into source
        child.set("duration", fmt_time(new_dur))

        # Recurse for any nested lane clips (unusual but possible)
        patch_lane_clips(child, outer_new_start, ks)


# ── Core patch ────────────────────────────────────────────────────────────────

def patch_fcpxml(multicam_path: str, kept: list, output_path: str):
    """
    Apply kept segments to the multicam FCPXML, producing a new FCPXML
    with the same camera/audio structure but only the kept regions,
    laid out sequentially on the timeline.

    Output spine structure (one entry per kept segment):

        <clip offset="<seq_pos>" start="<outer_start + ks>" duration="<seg_dur>">
          <!-- non-lane children preserved as-is (video ref, adjust-transform) -->
          <clip lane="1" offset="<outer_start + ks>" start="<cam2_start + ks>" duration="<seg_dur>" />
          <asset-clip lane="2" offset="<outer_start + ks>" start="<audio_start + ks>" duration="<seg_dur>" />
        </clip>
        <clip offset="<seq_pos + prev_dur>" ...>  <!-- next segment -->
          ...
        </clip>

    Key invariant: lane.offset == parent.start for every lane clip.
    """
    raw = open(multicam_path, "r", encoding="utf-8").read()

    doctype_match = re.search(r"<!DOCTYPE[^>]*>", raw)
    doctype_str = doctype_match.group(0) if doctype_match else "<!DOCTYPE fcpxml>"

    root = ET.fromstring(re.sub(r"<!DOCTYPE[^>]*>", "", raw))

    # ── Locate key elements ───────────────────────────────────────────────────
    sequence = root.find(".//sequence")
    if sequence is None:
        raise RuntimeError("No <sequence> found in multicam FCPXML")

    tc_start = parse_time(sequence.get("tcStart", "0/1s"))

    spine = sequence.find("spine")
    if spine is None:
        raise RuntimeError("No <spine> in sequence")

    outer_clips = [c for c in spine if c.tag == "clip"]
    if not outer_clips:
        raise RuntimeError("No <clip> elements in spine")
    if len(outer_clips) > 1:
        raise RuntimeError(f"Multi-clip spine not supported yet (found {len(outer_clips)})")

    outer = outer_clips[0]
    outer_start = parse_time(outer.get("start"))  # source TC of primary camera

    # ── Detect frame duration from the sequence's format ─────────────────────
    # Segment boundaries from the edited FCPXML are derived from audio/word
    # timestamps and may be aligned to a different frame rate (e.g. 30 fps from
    # the MP3 export).  The multicam clips use the NLE's native frame rate
    # (e.g. 29.97 = 1001/30000s).  If we write non-frame-aligned durations,
    # the NLE rounds each clip to the nearest frame independently, and the
    # accumulated rounding errors become visible gaps on the timeline.
    #
    # Fix: snap every ks/ke to the nearest frame boundary of the multicam's
    # format before computing offsets and durations.  All source timecodes in
    # this project are already frame-aligned, so outer_start + ks_snapped is
    # guaranteed to land on a frame boundary.

    seq_format_id = sequence.get("format")
    frame_dur = Fraction(1001, 30000)  # safe default: 29.97 fps
    for fmt in root.findall(".//format"):
        if fmt.get("id") == seq_format_id and fmt.get("frameDuration"):
            frame_dur = parse_time(fmt.get("frameDuration"))
            break

    print(json.dumps({
        "status": "patching",
        "kept_segments": len(kept),
        "total_kept_s": float(sum(e - s for s, e in kept)),
        "frame_duration": str(frame_dur),
    }), flush=True)

    # ── Build one spine clip per kept segment ─────────────────────────────────
    new_clips = []
    timeline_cursor = tc_start

    for ks, ke in kept:
        # Snap ks/ke to the nearest frame of the multicam's native frame rate.
        # This prevents sub-frame rounding by the NLE from causing gaps.
        ks_frames = round(ks / frame_dur)
        ke_frames = round(ke / frame_dur)
        # Guarantee at least 1 frame; avoid zero-duration clips.
        if ke_frames <= ks_frames:
            ke_frames = ks_frames + 1
        ks = ks_frames * frame_dur
        ke = ke_frames * frame_dur

        seg_dur = ke - ks
        outer_new_start = outer_start + ks  # source TC advances by ks (frame-aligned)

        # Deep-copy preserves all children (video refs, adjust-transform, lane clips).
        # We then update only the timing attributes; structural children stay intact.
        new_outer = deepcopy(outer)
        new_outer.set("offset",   fmt_time(timeline_cursor))   # sequential sequence position
        new_outer.set("start",    fmt_time(outer_new_start))   # advanced source TC
        new_outer.set("duration", fmt_time(seg_dur))

        # Patch all direct lane children so their offset = this outer's new start,
        # advancing their source TC by ks to stay frame-locked with the outer.
        patch_lane_clips(new_outer, outer_new_start, ks)

        new_clips.append(new_outer)
        timeline_cursor += seg_dur

    # ── Replace spine contents ────────────────────────────────────────────────
    for child in list(spine):
        spine.remove(child)
    for clip in new_clips:
        spine.append(clip)

    # ── Update sequence duration ──────────────────────────────────────────────
    sequence.set("duration", fmt_time(timeline_cursor - tc_start))

    # ── Serialise ─────────────────────────────────────────────────────────────
    _indent(root)
    xml_body = ET.tostring(root, encoding="unicode", xml_declaration=False)
    output = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        + doctype_str + "\n"
        + xml_body
    )
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(output)

    print(json.dumps({
        "status": "done",
        "output": output_path,
        "segments": len(new_clips),
        "new_duration_s": float(timeline_cursor - tc_start),
    }), flush=True)


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


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import os

    def usage():
        print(json.dumps({"error": (
            "Usage: patch_fcpxml.py <multicam.fcpxml> --from-edited <edited.fcpxml> <output.fcpxml>\n"
            "   or: patch_fcpxml.py <multicam.fcpxml> --cuts '<json>' <output.fcpxml>"
        )}), flush=True)
        sys.exit(1)

    if len(sys.argv) != 5:
        usage()

    multicam_path = sys.argv[1]
    mode          = sys.argv[2]
    arg3          = sys.argv[3]
    output_path   = sys.argv[4]

    if not os.path.exists(multicam_path):
        print(json.dumps({"error": f"File not found: {multicam_path}"}), flush=True)
        sys.exit(1)

    try:
        if mode == "--from-edited":
            if not os.path.exists(arg3):
                print(json.dumps({"error": f"Edited FCPXML not found: {arg3}"}), flush=True)
                sys.exit(1)
            kept = extract_kept_from_edited_fcpxml(arg3)
        elif mode == "--cuts":
            cuts = json.loads(arg3)
            raw = re.sub(r"<!DOCTYPE[^>]*>", "", open(multicam_path).read())
            root = ET.fromstring(raw)
            seq = root.find(".//sequence")
            total = parse_time(seq.get("duration"))
            kept = compute_kept_from_cuts(cuts, total)
        else:
            usage()

        patch_fcpxml(multicam_path, kept, output_path)
    except Exception as e:
        import traceback
        print(json.dumps({"error": str(e), "trace": traceback.format_exc()}), flush=True)
        sys.exit(1)
