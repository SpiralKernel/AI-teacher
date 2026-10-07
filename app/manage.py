"""本地维护入口：uv run python -m app.manage sync|backup|stats。"""
import argparse
import shutil
import sqlite3
from datetime import datetime

from app.config import Settings
from app.db import connect, initialize, replenish


def main():
    parser = argparse.ArgumentParser(description="AI-teacher 数据维护")
    parser.add_argument("command", choices=["sync", "backup", "stats"])
    args = parser.parse_args()
    settings = Settings()
    initialize(settings.database_path)
    if args.command == "backup":
        destination = settings.database_path.parent / "backups" / (datetime.now().strftime("%Y%m%d-%H%M%S-%f") + ".sqlite3")
        destination.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(settings.database_path) as source, sqlite3.connect(destination) as target:
            source.backup(target)
        print(f"备份已保存：{destination.resolve()}")
        assets = settings.database_path.parent / "imports"
        if assets.exists():
            asset_destination = destination.with_suffix(".assets")
            shutil.copytree(assets, asset_destination)
            print(f"导入页面备份：{asset_destination.resolve()}")
    else:
        with connect(settings.database_path) as db:
            if args.command == "sync":
                print(f"新增题目：{replenish(db)}；课程结构已同步。")
            for table in ["knowledge", "questions", "attempts", "audit_events"]:
                print(f"{table}: {db.execute('SELECT COUNT(*) FROM ' + table).fetchone()[0]}")


if __name__ == "__main__":
    main()
