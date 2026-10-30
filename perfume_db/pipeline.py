"""Full autonomous run: inbox import → collection → NLP → analytics → dashboard data.

python3 -m perfume_db.pipeline            # everything
python3 -m perfume_db.pipeline --offline  # skip network collection (re-analyse + rebuild)
"""
import datetime
import json
import sys
from pathlib import Path

from . import analytics, collect, importer, nlp

OUT = Path(__file__).resolve().parent.parent


def main(argv):
    offline = "--offline" in argv
    print("1/4 inbox import:", importer.import_inbox(), file=sys.stderr)
    if not offline:
        collect.run(next((a for a in argv if not a.startswith("--")), None))
    print("3/4 NLP:", nlp.run(), "reviews analysed", file=sys.stderr)
    data = analytics.build()
    data["generated"] = datetime.date.today().isoformat()
    js = "window.PERFUME_DASH = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n"
    (OUT / "perfumes_data.js").write_text(js, encoding="utf-8")
    t = data["totals"]
    print(f"4/4 dashboard: {t['perfumes']} perfumes, {t['reviews']} reviews "
          f"({t['fr_perfumes']} FR perfumes, {t['fr_reviews']} FR reviews)", file=sys.stderr)
    return t


if __name__ == "__main__":
    main(sys.argv[1:])
