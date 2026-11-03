#!/usr/bin/env python3
"""Read Petrosoft's MySQL export as data; never execute SQL from a backup."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re

PRIVATE_TABLES = {
    "active_sessions", "ci_sessions", "last_active", "sms_otp", "sms_sentlist",
    "pushnotification_tokens", "gst_einvoice_auth_config", "biometric_settings",
    "whatsapp_log", "logfile_mobileapps", "users_test",
}
SECRET = re.compile(r"password|passwd|^pwd$|^pass$|auth_token|access_token|device_token|api_key|aspid|sender_id|sms_url|sms_username|api_link|^token$", re.I)

def statements(source):
    start = 0
    quoted = False
    escaped = False
    for index, char in enumerate(source):
        if escaped:
            escaped = False
        elif quoted and char == "\\":
            escaped = True
        elif char == "'":
            quoted = not quoted
        elif char == ";" and not quoted:
            yield source[start:index].strip()
            start = index + 1

def values(source):
    """Parse tuple values including MySQL backslash and doubled-quote escapes."""
    index = 0
    length = len(source)
    escapes = {"0": "\0", "b": "\b", "n": "\n", "r": "\r", "t": "\t", "Z": "\x1a"}
    while index < length:
        while index < length and source[index] in " \r\n\t,": index += 1
        if index >= length: break
        if source[index] != "(": raise ValueError("Expected an INSERT tuple")
        index += 1
        row = []
        while index < length:
            while index < length and source[index].isspace(): index += 1
            if source[index] == "'":
                index += 1
                item = []
                while index < length:
                    char = source[index]
                    if char == "\\":
                        index += 1
                        item.append(escapes.get(source[index], source[index]))
                    elif char == "'":
                        if index + 1 < length and source[index+1] == "'":
                            item.append("'")
                            index += 1
                        else:
                            index += 1
                            break
                    else: item.append(char)
                    index += 1
                row.append("".join(item))
            else:
                begin = index
                while index < length and source[index] not in ",)": index += 1
                atom = source[begin:index].strip()
                if atom.upper() == "NULL": row.append(None)
                elif re.fullmatch(r"-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?", atom): row.append(atom)
                else: raise ValueError("Unsupported SQL literal in INSERT")
            while index < length and source[index].isspace(): index += 1
            if index >= length: raise ValueError("Incomplete INSERT")
            if source[index] == ")":
                index += 1
                break
            if source[index] != ",": raise ValueError("Expected a value separator")
            index += 1
        yield row

def sanitize(value):
    if isinstance(value, dict): return {key: sanitize(item) for key, item in value.items() if not SECRET.search(key)}
    if isinstance(value, list): return [sanitize(item) for item in value]
    return value

def parse_backup(path):
    source = Path(path).read_text(encoding="utf-8")
    tables = {}
    skipped = Counter()
    total = 0
    for statement in statements(source):
        match = re.search(r"(?:^|\n)INSERT INTO\s+`(\w+)`\s*\((.*?)\)\s+VALUES\s*(.*)$", statement, re.S)
        if not match: continue
        table, columns_text, tuple_text = match.groups()
        columns = [".".join(re.findall(r"`([^`]+)`", part)) for part in columns_text.split(",")]
        for row in values(tuple_text):
            total += 1
            if len(row) != len(columns): raise ValueError("Column count mismatch in " + table)
            if table in PRIVATE_TABLES:
                skipped[table] += 1
                continue
            record = sanitize(dict(zip(columns, row)))
            if table == "logfile":
                # Log payloads may include credentials or complete customer forms.
                record.pop("value", None)
                record.pop("ipaddress", None)
            if table == "options" and SECRET.search(str(record.get("name", ""))): continue
            tables.setdefault(table, []).append(record)
    return {"format": "petrosoft-native-v1", "sourceSha256": hashlib.sha256(source.encode()).hexdigest(),
            "insertRows": total, "excludedTables": dict(skipped), "tables": tables}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("backup")
    parser.add_argument("--output", default=".petrosoft/native.json")
    args = parser.parse_args()
    result = parse_backup(args.backup)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    output.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    output.chmod(0o600)
    print(json.dumps({"parsed": result["insertRows"], "tables": len(result["tables"]),
                      "retained": sum(len(rows) for rows in result["tables"].values()), "output": str(output)}))

if __name__ == "__main__": main()
