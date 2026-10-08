"""本地维护入口：uv run python -m app.manage sync|backup|stats。"""
import argparse
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path

from app.config import Settings
from app.db import connect, initialize, replenish


def main():
    parser = argparse.ArgumentParser(description="AI-teacher 数据维护")
    parser.add_argument("command", choices=["sync", "backup", "stats", "import-bank"])
    parser.add_argument("--dataset", choices=["tal", "cjeval", "ceval", "all"], default="all")
    parser.add_argument("--source-root", type=Path)
    parser.add_argument("--stage", choices=["junior", "primary", "senior", "unknown", "all"], default="junior")
    args = parser.parse_args()
    settings = Settings()
    if args.command != "backup":
        initialize(settings.database_path)
    if args.command == "import-bank":
        from app.bank import import_records
        from app.datasets import iter_dataset, source_manifest
        root=args.source_root or settings.database_path.parent/"sources"
        for dataset in (["cjeval", "tal", "ceval"] if args.dataset == "all" else [args.dataset]):
            manifest=source_manifest(root,dataset)
            if not manifest["count"]:
                raise SystemExit(f"{dataset} 没有本地数据，请先运行 scripts/fetch_sources.py")
            records=(q for q in iter_dataset(root,dataset) if args.stage=="all" or q["stage"]==args.stage)
            with connect(settings.database_path) as db:
                result=import_records(db,dataset,records,manifest)
            print(f"{dataset}: {result}；筛选学段={args.stage}")
    elif args.command == "backup":
        destination = settings.database_path.parent / "backups" / (datetime.now().strftime("%Y%m%d-%H%M%S-%f") + ".sqlite3")
        destination.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(settings.database_path) as source, sqlite3.connect(destination) as target:
            source.backup(target)
        destination.chmod(0o600)
        print(f"备份已保存：{destination.resolve()}")
        assets = settings.database_path.parent / "imports"
        if assets.exists():
            asset_destination = destination.with_suffix(".assets")
            shutil.copytree(assets, asset_destination)
            print(f"导入页面备份：{asset_destination.resolve()}")
        answers = settings.database_path.parent / "bank_answers"
        if answers.exists():
            answer_destination=destination.with_suffix(".answers")
            shutil.copytree(answers,answer_destination)
            print(f"主观解答备份：{answer_destination.resolve()}")
        teacher_images = settings.database_path.parent / "teacher_images"
        if teacher_images.exists():
            teacher_destination = destination.with_suffix(".teacher-images")
            shutil.copytree(teacher_images, teacher_destination)
            print(f"答疑照片备份：{teacher_destination.resolve()}")
    else:
        with connect(settings.database_path) as db:
            if args.command == "sync":
                print(f"新增题目：{replenish(db)}；课程结构已同步。")
            for table in ["knowledge", "questions", "attempts", "bank_questions", "bank_taxonomy", "bank_attempts", "audit_events"]:
                print(f"{table}: {db.execute('SELECT COUNT(*) FROM ' + table).fetchone()[0]}")


if __name__ == "__main__":
    main()
